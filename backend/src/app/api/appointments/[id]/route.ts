import {
  findConflictingAppointment,
  formatDateTimeForSql,
  normalizeDurationMinutes,
} from "@/server/appointments/scheduling";
import { auth } from "@/server/auth/auth";
import { resolveActingDoctor } from "@/server/secretaries/acting-doctor";
import { databaseReady, sql } from "@/server/database/database";
import {
  createNotification,
  describeAppointmentTime,
} from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type AppointmentRow = {
  id: string;
  studyId: string;
  patientId: string;
  doctorId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
  notes: string | null;
};

/*
  Who is allowed to move an appointment into which status.
*/
const patientActions = {
  confirm: "Confirmed",
  decline: "Declined",
} as const;

const doctorActions = {
  cancel: "Cancelled",
  complete: "Completed",
  reschedule: "Pending",
  /*
    A secretary sending on a visit her doctor asked for.

    It lands in the same status a reschedule does, because the result is
    the same thing: an invitation now sitting in front of the patient.
    It is named separately because what it means is different - nothing
    is being moved, it is being sent for the first time - and a button
    labelled "reschedule" on a visit the patient has never seen reads as
    a mistake.
  */
  send: "Pending",
} as const;

const closedStatuses = ["Cancelled", "Completed"];

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isPatient = roles.includes("patient");

    /*
      A secretary changes their doctor's appointments through the same
      actions the doctor uses. Everything below compares against the
      doctor's own id, so cancelling and rescheduling work for both
      without a second set of rules to keep in step.
    */
    const acting = await resolveActingDoctor(session);
    const isDoctor = acting !== null;

    if (!isDoctor && !isPatient) {
      return Response.json(
        {
          success: false,
          message: "Doctor or patient access is required.",
        },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const appointmentId = String(id || "").trim();

    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body?.action || "").trim().toLowerCase();

    if (!appointmentId || !action) {
      return Response.json(
        {
          success: false,
          message: "An appointment id and an action are required.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [appointmentRows] = await sql.execute(
      `SELECT id, study_id AS studyId, patient_id AS patientId,
         doctor_id AS doctorId, scheduled_at AS scheduledAt,
         duration_minutes AS durationMinutes, status, notes
       FROM appointment
       WHERE id = ?
       LIMIT 1`,
      [appointmentId],
    );

    const appointment = (appointmentRows as AppointmentRow[])[0];

    if (!appointment) {
      return Response.json(
        { success: false, message: "Appointment not found." },
        { status: 404 },
      );
    }

    const userId = session.user?.id;

    if (isDoctor && appointment.doctorId !== acting!.doctorUserId) {
      return Response.json(
        {
          success: false,
          message: "This appointment belongs to another doctor.",
        },
        { status: 403 },
      );
    }

    if (!isDoctor && isPatient && appointment.patientId !== userId) {
      return Response.json(
        {
          success: false,
          message: "This appointment belongs to another patient.",
        },
        { status: 403 },
      );
    }

    const responseNote =
      typeof body.responseNote === "string"
        ? body.responseNote.trim().slice(0, 1000)
        : "";

    /*
      Patient side: approve or decline the invitation the doctor sent.
    */
    if (!isDoctor && action in patientActions) {
      if (appointment.status !== "Pending") {
        return Response.json(
          {
            success: false,
            message: `This appointment is already marked as "${appointment.status}".`,
          },
          { status: 409 },
        );
      }

      const nextStatus =
        patientActions[action as keyof typeof patientActions];

      await sql.execute(
        `UPDATE appointment
         SET status = ?, patient_response_note = ?,
           patient_responded_at = CURRENT_TIMESTAMP(3),
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [nextStatus, responseNote || null, appointmentId],
      );

      await sql.execute(
        `INSERT INTO chat_message (appointment_id, sender_id, sender_role, message)
         VALUES (?, ?, 'patient', ?)`,
        [
          appointmentId,
          userId,
          nextStatus === "Confirmed"
            ? `Appointment approved by the patient.${responseNote ? ` Note: ${responseNote}` : ""}`
            : `Appointment declined by the patient.${responseNote ? ` Reason: ${responseNote}` : ""}`,
        ],
      );

      await createNotification({
        userId: appointment.doctorId,
        userRole: "doctor",
        type:
          nextStatus === "Confirmed"
            ? "appointment_confirmed"
            : "appointment_declined",
        title:
          nextStatus === "Confirmed"
            ? "Appointment approved by the patient"
            : "Appointment declined by the patient",
        body: `${session.user?.name ?? "The patient"} ${
          nextStatus === "Confirmed" ? "approved" : "declined"
        } the visit on ${describeAppointmentTime(
          appointment.scheduledAt,
        )} UTC.${responseNote ? ` Note: ${responseNote}` : ""}`,
        link: "/doctor/calendar",
        appointmentId,
        studyId: appointment.studyId,
      });

      return Response.json({
        success: true,
        appointment: {
          ...appointment,
          scheduledAt: new Date(appointment.scheduledAt).toISOString(),
          status: nextStatus,
          patientResponseNote: responseNote,
        },
      });
    }

    /*
      Doctor side: cancel, complete, or move the appointment to a new slot.
    */
    if (isDoctor && action in doctorActions) {
      /* Both of these carry a time, so both skip the closed check. */
      const setsATime = action === "reschedule" || action === "send";

      if (closedStatuses.includes(appointment.status) && !setsATime) {
        return Response.json(
          {
            success: false,
            message: `This appointment is already marked as "${appointment.status}".`,
          },
          { status: 409 },
        );
      }

      if (!setsATime) {
        const nextStatus =
          doctorActions[action as keyof typeof doctorActions];

        await sql.execute(
          `UPDATE appointment
           SET status = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [nextStatus, appointmentId],
        );

        await sql.execute(
          `INSERT INTO chat_message (appointment_id, sender_id, sender_role, message)
           VALUES (?, ?, 'doctor', ?)`,
          [
            appointmentId,
            userId,
            nextStatus === "Cancelled"
              ? `The doctor cancelled this appointment.${responseNote ? ` Reason: ${responseNote}` : ""}`
              : "The doctor marked this appointment as completed.",
          ],
        );

        await createNotification({
          userId: appointment.patientId,
          userRole: "patient",
          type:
            nextStatus === "Cancelled"
              ? "appointment_cancelled"
              : "appointment_completed",
          title:
            nextStatus === "Cancelled"
              ? "Your appointment was cancelled"
              : "Your visit was marked as completed",
          body: `The visit on ${describeAppointmentTime(
            appointment.scheduledAt,
          )} UTC was marked as ${nextStatus.toLowerCase()}.${
            responseNote ? ` Reason: ${responseNote}` : ""
          }`,
          link: "/patients/dashboard",
          appointmentId,
          studyId: appointment.studyId,
        });

        return Response.json({
          success: true,
          appointment: {
            ...appointment,
            scheduledAt: new Date(appointment.scheduledAt).toISOString(),
            status: nextStatus,
          },
        });
      }

      const scheduledAtText =
        typeof body.scheduledAt === "string" ? body.scheduledAt.trim() : "";

      const scheduledAt = new Date(scheduledAtText);

      if (!scheduledAtText || Number.isNaN(scheduledAt.getTime())) {
        return Response.json(
          {
            success: false,
            message: "A valid new date and time is required to reschedule.",
          },
          { status: 400 },
        );
      }

      if (scheduledAt.getTime() <= Date.now()) {
        return Response.json(
          {
            success: false,
            message: "The new appointment time must be in the future.",
          },
          { status: 400 },
        );
      }

      const durationMinutes = normalizeDurationMinutes(
        body.durationMinutes ?? appointment.durationMinutes,
      );

      const conflict = await findConflictingAppointment({
        doctorId: String(userId),
        startsAt: scheduledAt,
        durationMinutes,
        ignoreAppointmentId: appointmentId,
      });

      if (conflict) {
        return Response.json(
          {
            success: false,
            message:
              "This time slot overlaps another appointment in your calendar.",
            conflict,
          },
          { status: 409 },
        );
      }

      const notes =
        typeof body.notes === "string"
          ? body.notes.trim()
          : (appointment.notes ?? "");

      /*
        A new time always needs a fresh approval from the patient.
      */
      await sql.execute(
        `UPDATE appointment
         SET scheduled_at = ?, duration_minutes = ?, notes = ?,
           status = 'Pending', patient_response_note = NULL,
           patient_responded_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          formatDateTimeForSql(scheduledAt),
          durationMinutes,
          notes || null,
          appointmentId,
        ],
      );

      await sql.execute(
        `INSERT INTO chat_message (appointment_id, sender_id, sender_role, message)
         VALUES (?, ?, 'doctor', ?)`,
        [
          appointmentId,
          userId,
          `The appointment was moved to ${scheduledAt.toISOString()} (${durationMinutes} minutes). Please approve the new time.`,
        ],
      );

      await createNotification({
        userId: appointment.patientId,
        userRole: "patient",
        type: "appointment_rescheduled",
        title: "Your appointment was moved to a new time",
        body: `The new time is ${describeAppointmentTime(
          scheduledAt,
        )} UTC (${durationMinutes} minutes). Please approve it.`,
        link: "/patients/dashboard",
        appointmentId,
        studyId: appointment.studyId,
      });

      return Response.json({
        success: true,
        appointment: {
          ...appointment,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes,
          notes,
          status: "Pending",
          patientResponseNote: "",
        },
      });
    }

    return Response.json(
      {
        success: false,
        message: `The action "${action}" is not allowed for your role.`,
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("Update appointment API error:", error);

    return Response.json(
      { success: false, message: "Unable to update the appointment." },
      { status: 500 },
    );
  }
}
