import { randomUUID } from "node:crypto";

import {
  findConflictingAppointment,
  formatDateTimeForSql,
  normalizeDurationMinutes,
} from "@/server/appointments/scheduling";
import { auth } from "@/server/auth/auth";
import { resolveActingDoctor } from "@/server/secretaries/acting-doctor";
import { servesClinic } from "@/server/clinics/doctor-clinics";
import { databaseReady, sql } from "@/server/database/database";
import {
  createNotification,
  describeAppointmentTime,
} from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUser = {
  id?: string;
  role?: string | string[] | null;
};

function normalizeRoles(
  role: SessionUser["role"]
): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}


export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isPatient = roles.includes("patient");

    /*
      A doctor reads their own calendar, and a secretary reads the one
      of the doctor they work for. Both take the same branch below,
      because a secretary's whole job is that calendar: giving them a
      separate query would be a second place for the rules to drift.
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

    await databaseReady;

    /*
      The calendar only needs the visible month, so it may send
      ?from=...&to=... to narrow the result down.
    */
    const { searchParams } = new URL(request.url);
    const fromValue = searchParams.get("from");
    const toValue = searchParams.get("to");

    const rangeConditions: string[] = [];
    const rangeValues: string[] = [];

    if (fromValue) {
      const fromDate = new Date(fromValue);

      if (!Number.isNaN(fromDate.getTime())) {
        rangeConditions.push("a.scheduled_at >= ?");
        rangeValues.push(formatDateTimeForSql(fromDate));
      }
    }

    if (toValue) {
      const toDate = new Date(toValue);

      if (!Number.isNaN(toDate.getTime())) {
        rangeConditions.push("a.scheduled_at < ?");
        rangeValues.push(formatDateTimeForSql(toDate));
      }
    }

    const rangeClause =
      rangeConditions.length > 0
        ? ` AND ${rangeConditions.join(" AND ")}`
        : "";

    const sharedColumns = `a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
         a.duration_minutes AS durationMinutes, a.status,
         COALESCE(a.notes, '') AS notes,
         COALESCE(a.patient_response_note, '') AS patientResponseNote,
         a.patient_responded_at AS patientRespondedAt, a.created_at AS createdAt,
         s.body_region AS bodyRegion, s.imaging_view AS imagingView, s.priority`;

    const query = isDoctor
      ? `SELECT ${sharedColumns},
         p.name AS patientName, p.id AS patientId,
         COALESCE(p.phone, '') AS patientPhone,
         COALESCE(s.patient_age, p.age) AS patientAge,
         COALESCE(s.patient_gender, p.gender) AS patientGender
         FROM appointment a
         JOIN study s ON s.id = a.study_id
         JOIN patient p ON p.id = a.patient_id
         WHERE a.doctor_id = ?${rangeClause}
         ORDER BY a.scheduled_at ASC`
      : `SELECT ${sharedColumns},
         dp.full_name AS doctorName, a.doctor_id AS doctorId,
         COALESCE(dp.specialty, '') AS doctorSpecialty,
         COALESCE(dp.current_workplace, '') AS doctorWorkplace
         FROM appointment a
         JOIN study s ON s.id = a.study_id
         LEFT JOIN doctor_profile dp ON dp.user_id = a.doctor_id
         /*
           A visit the doctor asked his secretary to arrange is not an
           invitation yet. It reaches the patient when she sends it, so
           until then it is not theirs to see or answer.
         */
         WHERE a.patient_id = ? AND a.status <> 'Requested'${rangeClause}
         ORDER BY a.scheduled_at ASC`;

    const [appointmentsRows] = await sql.execute(query, [
      isDoctor ? acting!.doctorUserId : session.user?.id,
      ...rangeValues,
    ]);

    return Response.json({
      success: true,
      appointments: appointmentsRows as any[],
    });
  } catch (error) {
    console.error("Appointment list API error:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to load appointments.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);

    const acting = await resolveActingDoctor(session);

    if (!acting) {
      return Response.json(
        {
          success: false,
          message: "Doctor or secretary access is required.",
        },
        { status: 403 },
      );
    }

    const body = (await request.json()) as unknown;

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as any).studyId !== "string" ||
      !((body as any).studyId as string).trim() ||
      typeof (body as any).scheduledAt !== "string" ||
      !((body as any).scheduledAt as string).trim()
    ) {
      return Response.json(
        {
          success: false,
          message:
            "studyId and scheduledAt are required to create an appointment.",
        },
        { status: 400 },
      );
    }

    const studyId = ((body as any).studyId as string).trim();
    const scheduledAtText = ((body as any).scheduledAt as string).trim();
    const notes =
      typeof (body as any).notes === "string"
        ? (body as any).notes.trim()
        : "";

    const scheduledAt = new Date(scheduledAtText);

    if (Number.isNaN(scheduledAt.getTime())) {
      return Response.json(
        {
          success: false,
          message: "The appointment date and time are invalid.",
        },
        { status: 400 },
      );
    }

    if (scheduledAt.getTime() <= Date.now()) {
      return Response.json(
        {
          success: false,
          message: "The appointment must be scheduled in the future.",
        },
        { status: 400 },
      );
    }

    const durationMinutes = normalizeDurationMinutes(
      (body as any).durationMinutes,
    );

    await databaseReady;

    const [doctorRows] = await sql.execute(
      `SELECT specialty, subspecialty, clinics,
         supported_body_regions AS supportedBodyRegions
       FROM doctor_profile
       WHERE user_id = ?
       LIMIT 1`,
      [acting.doctorUserId],
    );

    const doctorProfile = (doctorRows as any[])[0];

    if (!doctorProfile) {
      return Response.json(
        {
          success: false,
          message:
            "Doctor profile not found or not approved yet.",
        },
        { status: 404 },
      );
    }


    const [studyRows] = await sql.execute(
      `SELECT id, patient_id AS patientId, clinic_key AS clinicKey
       FROM study
       WHERE id = ?
       LIMIT 1`,
      [studyId],
    );

    const study = (studyRows as any[])[0];

    if (!study) {
      return Response.json(
        {
          success: false,
          message: "Study not found.",
        },
        { status: 404 },
      );
    }

    if (!servesClinic(doctorProfile, study.clinicKey)) {
      return Response.json(
        {
          success: false,
          message:
            "You may only schedule appointments for studies in your assigned clinic.",
        },
        { status: 403 },
      );
    }

    const conflict = await findConflictingAppointment({
      doctorId: acting.doctorUserId,
      startsAt: scheduledAt,
      durationMinutes,
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

    const appointmentId = `AP-${Date.now()}-${randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

    const scheduledAtSql = formatDateTimeForSql(scheduledAt);

    /*
      Who the new visit goes to next.

      A doctor names a time and his secretary sends it out: she is the
      one the patient already talks to about appointments, and a
      practice where the doctor books directly and the secretary finds
      out afterwards is a practice with two calendars. So his booking
      lands as 'Requested', on her desk.

      A doctor with no secretary has nobody to hand it to, and a request
      nobody can act on would simply never reach the patient, so his
      booking is the invitation itself. The secretary's own bookings are
      always invitations: she is the one who would otherwise be sending
      it to herself.
    */
    const [secretaryRows] = await sql.execute(
      `SELECT id FROM secretary_profile
       WHERE doctor_user_id = ? AND status = 'Active' LIMIT 1`,
      [acting.doctorUserId],
    );

    const hasSecretary = (secretaryRows as unknown[]).length > 0;

    const initialStatus =
      acting.actedByRole === "doctor" && hasSecretary
        ? "Requested"
        : "Pending";

    await sql.execute(
      `INSERT INTO appointment
       (id, study_id, patient_id, doctor_id, scheduled_at, duration_minutes, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appointmentId,
        studyId,
        study.patientId,
        acting.doctorUserId,
        scheduledAtSql,
        durationMinutes,
        initialStatus,
        notes || null,
      ],
    );

    /*
      The invitation is delivered to the patient through the private chat
      as well, so they see it next to the doctor conversation.
    */
    await sql.execute(
      `INSERT INTO chat_message (appointment_id, sender_id, sender_role, message)
       VALUES (?, ?, 'doctor', ?)`,
      [
        appointmentId,
        /*
          Sent as the doctor even when a secretary booked it. To the
          patient this is an invitation from their doctor, and a message
          from a name they have never seen would read as a stranger
          asking them to come to a hospital.
        */
        acting.doctorUserId,
        `Appointment invitation sent for ${scheduledAt.toISOString()} (${durationMinutes} minutes). Please approve or decline it from your dashboard.`,
      ],
    );

    const [doctorNameRows] = await sql.execute(
      "SELECT full_name AS fullName FROM doctor_profile WHERE user_id = ? LIMIT 1",
      [acting.doctorUserId],
    );

    const doctorName =
      (doctorNameRows as any[])[0]?.fullName ?? "Your doctor";

    /*
      Who is told, and what they are told.

      A request the doctor left for his secretary is not an invitation
      yet, so telling the patient about it would ask them to approve
      something nobody has offered them. She is told instead, and the
      patient hears about it when she sends it.
    */
    if (initialStatus === "Requested") {
      const [secretaryUserRows] = await sql.execute(
        `SELECT user_id AS userId FROM secretary_profile
         WHERE doctor_user_id = ? AND status = 'Active' LIMIT 1`,
        [acting.doctorUserId],
      );

      const secretaryUserId = (secretaryUserRows as any[])[0]?.userId;

      if (secretaryUserId) {
        await createNotification({
          userId: String(secretaryUserId),
          userRole: "secretary",
          type: "appointment_invitation",
          title: "The doctor asked for a visit",
          body: `${doctorName} asked for a visit on ${describeAppointmentTime(
            scheduledAt,
          )} UTC. Send it to the patient, or change the time first.`,
          link: "/secretary",
          appointmentId,
          studyId,
        });
      }
    } else {
      await createNotification({
        userId: study.patientId,
        userRole: "patient",
        type: "appointment_invitation",
        title: "New appointment invitation",
        body: `${doctorName} suggested an appointment on ${describeAppointmentTime(
          scheduledAt,
        )} UTC. Please approve or decline it.`,
        link: "/patients/dashboard",
        appointmentId,
        studyId,
      });
    }

    return Response.json({
      success: true,
      appointment: {
        id: appointmentId,
        studyId,
        patientId: study.patientId,
        doctorId: acting.doctorUserId,
        scheduledAt: scheduledAt.toISOString(),
        durationMinutes,
        status: initialStatus,
        notes,
      },
    });
  } catch (error) {
    console.error("Create appointment API error:", error);

    return Response.json(
      {
        success: false,
        message:
          "Unable to schedule the appointment. Please try again.",
      },
      { status: 500 },
    );
  }
}
