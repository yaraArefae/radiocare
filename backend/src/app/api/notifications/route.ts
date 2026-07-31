import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_NOTIFICATIONS = 60;

/*
  Returns the newest notifications of the signed in user together with
  the unread counter that the bell icon shows.
*/
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    await databaseReady;

    const [notificationRows] = await sql.execute(
      `SELECT id, type, title, COALESCE(body, '') AS body,
         COALESCE(link, '') AS link, appointment_id AS appointmentId,
         study_id AS studyId, is_read AS isRead, created_at AS createdAt
       FROM notification
       WHERE user_id = ?${unreadOnly ? " AND is_read = FALSE" : ""}
       ORDER BY created_at DESC
       LIMIT ${MAXIMUM_NOTIFICATIONS}`,
      [session.user?.id],
    );

    const [unreadRows] = await sql.execute(
      `SELECT COUNT(*) AS unreadCount
       FROM notification
       WHERE user_id = ? AND is_read = FALSE`,
      [session.user?.id],
    );

    const notifications = (notificationRows as any[]).map(
      (notification) => ({
        ...notification,
        isRead: Boolean(notification.isRead),
      }),
    );

    return Response.json({
      success: true,
      notifications,
      unreadCount: Number((unreadRows as any[])[0]?.unreadCount ?? 0),
    });
  } catch (error) {
    console.error("Load notifications API error:", error);

    return Response.json(
      { success: false, message: "Unable to load notifications." },
      { status: 500 },
    );
  }
}

/*
  Marks one, several, or all notifications of the user as read.
*/
export async function PATCH(request: Request) {
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

    const body = (await request.json()) as Record<string, unknown>;
    const markAll = body?.markAll === true;

    const ids = Array.isArray(body?.ids)
      ? (body.ids as unknown[])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : [];

    if (!markAll && ids.length === 0) {
      return Response.json(
        {
          success: false,
          message: "Provide notification ids or set markAll to true.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    if (markAll) {
      await sql.execute(
        `UPDATE notification SET is_read = TRUE
         WHERE user_id = ? AND is_read = FALSE`,
        [session.user?.id],
      );
    } else {
      await sql.execute(
        `UPDATE notification SET is_read = TRUE
         WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`,
        [session.user?.id, ...ids],
      );
    }

    const [unreadRows] = await sql.execute(
      `SELECT COUNT(*) AS unreadCount
       FROM notification
       WHERE user_id = ? AND is_read = FALSE`,
      [session.user?.id],
    );

    return Response.json({
      success: true,
      unreadCount: Number((unreadRows as any[])[0]?.unreadCount ?? 0),
    });
  } catch (error) {
    console.error("Update notifications API error:", error);

    return Response.json(
      { success: false, message: "Unable to update notifications." },
      { status: 500 },
    );
  }
}

/*
  Clears the notification list of the signed in user.
*/
export async function DELETE(request: Request) {
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

    await databaseReady;

    await sql.execute("DELETE FROM notification WHERE user_id = ?", [
      session.user?.id,
    ]);

    return Response.json({ success: true, unreadCount: 0 });
  } catch (error) {
    console.error("Clear notifications API error:", error);

    return Response.json(
      { success: false, message: "Unable to clear notifications." },
      { status: 500 },
    );
  }
}
