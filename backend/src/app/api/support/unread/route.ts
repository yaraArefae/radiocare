import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  How much of the administration conversation is still unread by whoever
  is asking.

  Every dashboard shows this, so it is deliberately the cheapest
  question the feature can answer: a count, never the messages
  themselves, and reading it never marks anything read. Opening the
  conversation is what does that.
*/

function normalizeRoles(role: string | string[] | null | undefined) {
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

    if (!session?.user?.id) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    await databaseReady;

    const isAdmin = normalizeRoles(session.user.role).includes("admin");

    if (isAdmin) {
      /*
        An administrator is waiting on everybody's messages, so the
        count spans every thread, and the number of threads that hold
        them is worth knowing too: five messages from one doctor is a
        different morning than five from five people.
      */
      const [rows] = await sql.execute(
        `SELECT COUNT(*) AS unreadCount,
                COUNT(DISTINCT user_id) AS threadCount
         FROM support_message
         WHERE sender_role <> 'admin' AND is_read = FALSE`,
      );

      const row = (rows as any[])[0];

      return Response.json({
        success: true,
        unreadCount: Number(row?.unreadCount ?? 0),
        threadCount: Number(row?.threadCount ?? 0),
      });
    }

    const [rows] = await sql.execute(
      `SELECT COUNT(*) AS unreadCount
       FROM support_message
       WHERE user_id = ? AND sender_role = 'admin' AND is_read = FALSE`,
      [session.user.id],
    );

    return Response.json({
      success: true,
      unreadCount: Number((rows as any[])[0]?.unreadCount ?? 0),
      threadCount: 0,
    });
  } catch (error) {
    console.error("Support unread count API error:", error);

    return Response.json(
      { success: false, message: "Unable to read the message count." },
      { status: 500 },
    );
  }
}
