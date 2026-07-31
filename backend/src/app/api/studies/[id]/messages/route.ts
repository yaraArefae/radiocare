import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import {
  findClinicDoctors,
  isAbnormalTriage,
  resolveCaseAccess,
} from "@/server/messaging/case-access";
import {
  createNotification,
  createNotifications,
} from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_MESSAGE_LENGTH = 2000;

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/*
  Returns the follow-up conversation of one case and marks the messages
  written by the other side as read.
*/
export async function GET(request: Request, context: RouteContext) {
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

    const { id } = await context.params;
    const studyId = String(id || "").trim();

    await databaseReady;

    const access = await resolveCaseAccess(session.user, studyId);

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    const [messageRows] = await sql.execute(
      `SELECT id, sender_id AS senderId, sender_role AS senderRole,
         message, is_read AS isRead, created_at AS createdAt
       FROM case_message
       WHERE study_id = ?
       ORDER BY created_at ASC`,
      [studyId],
    );

    await sql.execute(
      `UPDATE case_message SET is_read = TRUE
       WHERE study_id = ? AND sender_role <> ? AND is_read = FALSE`,
      [studyId, access.role],
    );

    return Response.json({
      success: true,
      role: access.role,
      study: {
        id: access.study.id,
        patientId: access.study.patientId,
        patientName: access.study.patientName,
        bodyRegion: access.study.bodyRegion,
        triageResult: access.study.triageResult,
        isAbnormal: isAbnormalTriage(access.study.triageResult),
      },
      doctorName: access.doctorName,
      messages: (messageRows as any[]).map((row) => ({
        ...row,
        isRead: Boolean(row.isRead),
      })),
    });
  } catch (error) {
    console.error("Load case messages API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the case messages." },
      { status: 500 },
    );
  }
}

/*
  Sends a follow-up message and notifies the other side of the case.
*/
export async function POST(request: Request, context: RouteContext) {
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

    const { id } = await context.params;
    const studyId = String(id || "").trim();

    const body = (await request.json()) as Record<string, unknown>;
    const message =
      typeof body?.message === "string"
        ? body.message.trim().slice(0, MAXIMUM_MESSAGE_LENGTH)
        : "";

    if (!message) {
      return Response.json(
        { success: false, message: "The message cannot be empty." },
        { status: 400 },
      );
    }

    await databaseReady;

    const access = await resolveCaseAccess(session.user, studyId);

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    const [insertResult] = await sql.execute(
      `INSERT INTO case_message (study_id, sender_id, sender_role, message)
       VALUES (?, ?, ?, ?)`,
      [studyId, session.user?.id, access.role, message],
    );

    const isFromDoctor = access.role === "doctor";

    if (isFromDoctor) {
      await createNotification({
        userId: access.study.patientId,
        userRole: "patient",
        type: "chat_message",
        title: "New message about your case",
        body: message.slice(0, 300),
        link: "/patients/dashboard",
        studyId,
      });
    }

    /*
      A patient message goes to the doctor who already answered. When no
      doctor answered yet, every doctor of the clinic that owns the case
      is told, otherwise the message would sit unseen until somebody
      happens to open the case list.
    */
    let notifiedDoctors = 0;

    if (!isFromDoctor) {
      const recipients = access.doctorId
        ? [{ doctorId: access.doctorId }]
        : await findClinicDoctors(access.study.clinicKey);

      await createNotifications(
        recipients.map((doctor: { doctorId: string }) => ({
          userId: doctor.doctorId,
          userRole: "doctor" as const,
          type: "chat_message" as const,
          title: `New message from ${
            session.user?.name ?? "your patient"
          }`,
          body: message.slice(0, 300),
          link: `/studies/${studyId}`,
          studyId,
        })),
      );

      notifiedDoctors = recipients.length;
    }

    return Response.json({
      success: true,
      notifiedDoctors,
      chatMessage: {
        id: (insertResult as any).insertId,
        senderId: session.user?.id,
        senderRole: access.role,
        message,
        isRead: false,
        createdAt: new Date().toISOString(),
      },
      /*
        A patient whose message reached no doctor at all is told that the
        clinic has nobody available yet, instead of waiting for a reply
        that cannot come.
      */
      waitingForDoctor: !isFromDoctor && notifiedDoctors === 0,
    });
  } catch (error) {
    console.error("Send case message API error:", error);

    return Response.json(
      { success: false, message: "Unable to send the message." },
      { status: 500 },
    );
  }
}
