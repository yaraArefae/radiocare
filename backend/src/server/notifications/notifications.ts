import { sql } from "@/server/database/database";

/*
  Tells every administrator that something is waiting for their review.
  Registration requests sit in the queue until an admin acts on them, so
  they have to be pushed rather than discovered by chance.
*/
export async function notifyAdmins(notification: {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  try {
    const [adminRows] = await sql.execute(
      "SELECT id FROM `user` WHERE role LIKE '%admin%' AND banned = FALSE",
    );

    const admins = adminRows as { id: string }[];

    if (admins.length === 0) return;

    await createNotifications(
      admins.map((admin) => ({
        userId: admin.id,
        userRole: "admin" as const,
        ...notification,
      })),
    );
  } catch (error) {
    console.error("Unable to notify the administrators:", error);
  }
}

export type NotificationType =
  | "appointment_invitation"
  | "appointment_confirmed"
  | "appointment_declined"
  | "appointment_rescheduled"
  | "appointment_cancelled"
  | "appointment_completed"
  | "appointment_reminder"
  | "chat_message"
  /* A message between a doctor or a patient and the administration. */
  | "support_message"
  | "new_case"
  | "registration_request"
  /* An account change made by an admin, such as new clinics. */
  | "account_updated";

export type NewNotification = {
  userId: string;
  /*
    A secretary is notified too. She is told when the doctor leaves her
    a visit to arrange, which is the one thing in this application that
    is addressed to her and to nobody else.
  */
  userRole: "doctor" | "patient" | "admin" | "secretary";
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  appointmentId?: string;
  studyId?: string;
};

/*
  A failing notification must never break the action that produced it,
  so every write is isolated and only logged when it goes wrong.
*/
export async function createNotifications(
  notifications: NewNotification[],
) {
  const candidates = notifications.filter(
    (notification) => notification.userId && notification.title,
  );

  if (candidates.length === 0) return;

  try {
    /*
      A patient record does not always belong to a sign-in account, for
      example when a doctor registers the patient manually. Those ids are
      dropped so one of them cannot fail the whole batch.
    */
    const uniqueUserIds = [
      ...new Set(candidates.map((notification) => notification.userId)),
    ];

    const [userRows] = await sql.execute(
      `SELECT id FROM user WHERE id IN (${uniqueUserIds
        .map(() => "?")
        .join(", ")})`,
      uniqueUserIds,
    );

    const knownUserIds = new Set(
      (userRows as { id: string }[]).map((row) => row.id),
    );

    const validNotifications = candidates.filter((notification) =>
      knownUserIds.has(notification.userId),
    );

    if (validNotifications.length === 0) return;

    const placeholders = validNotifications
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");

    const values = validNotifications.flatMap((notification) => [
      notification.userId,
      notification.userRole,
      notification.type,
      notification.title.slice(0, 255),
      notification.body ?? null,
      notification.link ?? null,
      notification.appointmentId ?? null,
      notification.studyId ?? null,
    ]);

    await sql.execute(
      `INSERT INTO notification
       (user_id, user_role, type, title, body, link, appointment_id, study_id)
       VALUES ${placeholders}`,
      values,
    );
  } catch (error) {
    console.error("Unable to store notifications:", error);
  }
}

export async function createNotification(notification: NewNotification) {
  await createNotifications([notification]);
}

/*
  Formats an appointment date the same way in every notification text.
*/
export function describeAppointmentTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "the scheduled time";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}
