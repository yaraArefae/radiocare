import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { createNotification } from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUser = {
  id?: string;
  role?: string | string[] | null;
};

function normalizeRoles(role: SessionUser["role"]): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isDoctor && !isPatient) {
      return Response.json(
        { success: false, message: "Doctor or patient access is required." },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const appointmentId = url.searchParams.get("appointmentId");

    if (!appointmentId) {
      return Response.json(
        { success: false, message: "appointmentId is required." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [appointmentRows] = await sql.execute(
      `SELECT doctor_id AS doctorId, patient_id AS patientId
       FROM appointment
       WHERE id = ?
       LIMIT 1`,
      [appointmentId],
    );

    const appointment = (appointmentRows as any[])[0];

    if (!appointment) {
      return Response.json(
        { success: false, message: "Appointment not found." },
        { status: 404 },
      );
    }

    const userId = session.user?.id;
    if (isDoctor && appointment.doctorId !== userId) {
      return Response.json(
        { success: false, message: "Doctor access denied for this appointment." },
        { status: 403 },
      );
    }

    if (isPatient && appointment.patientId !== userId) {
      return Response.json(
        { success: false, message: "Patient access denied for this appointment." },
        { status: 403 },
      );
    }

    const [messagesRows] = await sql.execute(
      `SELECT id, sender_id AS senderId, sender_role AS senderRole,
       message, created_at AS createdAt
       FROM chat_message
       WHERE appointment_id = ?
       ORDER BY created_at ASC`,
      [appointmentId],
    );

    return Response.json({
      success: true,
      messages: messagesRows as any[],
    });
  } catch (error) {
    console.error("Load chat messages API error:", error);
    return Response.json(
      { success: false, message: "Unable to load chat messages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isDoctor && !isPatient) {
      return Response.json(
        { success: false, message: "Doctor or patient access is required." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as unknown;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as any).appointmentId !== "string" ||
      !((body as any).appointmentId as string).trim() ||
      typeof (body as any).message !== "string" ||
      !((body as any).message as string).trim()
    ) {
      return Response.json(
        { success: false, message: "appointmentId and message are required." },
        { status: 400 },
      );
    }

    const appointmentId = ((body as any).appointmentId as string).trim();
    const message = ((body as any).message as string).trim();

    await databaseReady;

    const [appointmentRows] = await sql.execute(
      `SELECT doctor_id AS doctorId, patient_id AS patientId, study_id AS studyId
       FROM appointment
       WHERE id = ?
       LIMIT 1`,
      [appointmentId],
    );

    const appointment = (appointmentRows as any[])[0];
    if (!appointment) {
      return Response.json(
        { success: false, message: "Appointment not found." },
        { status: 404 },
      );
    }

    const userId = session.user?.id;
    if (isDoctor && appointment.doctorId !== userId) {
      return Response.json(
        { success: false, message: "Doctor access denied for this appointment." },
        { status: 403 },
      );
    }

    if (isPatient && appointment.patientId !== userId) {
      return Response.json(
        { success: false, message: "Patient access denied for this appointment." },
        { status: 403 },
      );
    }

    const senderRole = isDoctor ? "doctor" : "patient";

    const [insertResult] = await sql.execute(
      `INSERT INTO chat_message (appointment_id, sender_id, sender_role, message)
       VALUES (?, ?, ?, ?)`,
      [appointmentId, userId, senderRole, message],
    );

    const insertId = (insertResult as any).insertId;

    /*
      The other side of the conversation gets a notification so they do
      not have to keep the chat open to notice new messages.
    */
    const isFromDoctor = senderRole === "doctor";

    await createNotification({
      userId: isFromDoctor ? appointment.patientId : appointment.doctorId,
      userRole: isFromDoctor ? "patient" : "doctor",
      type: "chat_message",
      title: isFromDoctor
        ? "New message from your doctor"
        : `New message from ${session.user?.name ?? "your patient"}`,
      body: message.slice(0, 300),
      link: isFromDoctor ? "/patients/dashboard" : "/doctor/calendar",
      appointmentId,
      studyId: appointment.studyId,
    });

    return Response.json({
      success: true,
      chatMessage: {
        id: insertId,
        senderId: userId,
        senderRole,
        message,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Send chat message API error:", error);
    return Response.json(
      { success: false, message: "Unable to send message." },
      { status: 500 },
    );
  }
}
