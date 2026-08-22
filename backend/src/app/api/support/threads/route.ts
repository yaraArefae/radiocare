import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The administration's inbox: every doctor and patient who has written,
  newest conversation first, with what is still unanswered counted.

  Accounts that never wrote are not listed. An administrator who wants
  to start a conversation opens it from the account itself, and it
  appears here as soon as the first message exists.
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

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      );
    }

    await databaseReady;

    /*
      One row per thread. The last message is read from the row with the
      highest id rather than the latest timestamp, because two messages
      written in the same millisecond would otherwise tie.
    */
    const [rows] = await sql.execute(
      `SELECT
         t.user_id AS userId,
         u.name AS userName,
         u.email AS userEmail,
         u.role AS userRole,
         t.messageCount,
         t.lastMessageAt,
         t.unreadCount,
         m.message AS lastMessage,
         m.sender_role AS lastMessageRole
       FROM (
         SELECT user_id,
                COUNT(*) AS messageCount,
                MAX(created_at) AS lastMessageAt,
                MAX(id) AS lastMessageId,
                SUM(
                  CASE WHEN sender_role <> 'admin' AND is_read = FALSE
                  THEN 1 ELSE 0 END
                ) AS unreadCount
         FROM support_message
         GROUP BY user_id
       ) AS t
       JOIN \`user\` u ON u.id = t.user_id
       LEFT JOIN support_message m ON m.id = t.lastMessageId
       ORDER BY t.lastMessageAt DESC`,
    );

    const threads = (rows as any[]).map((row) => ({
      userId: row.userId,
      userName: row.userName,
      userEmail: row.userEmail,
      userRole: normalizeRoles(row.userRole)[0] ?? "patient",
      messageCount: Number(row.messageCount ?? 0),
      unreadCount: Number(row.unreadCount ?? 0),
      lastMessage: row.lastMessage ?? "",
      lastMessageRole: row.lastMessageRole ?? "",
      lastMessageAt: row.lastMessageAt,
    }));

    return Response.json({
      success: true,
      threads,
      unreadTotal: threads.reduce(
        (total, thread) => total + thread.unreadCount,
        0,
      ),
    });
  } catch (error) {
    console.error("Load support threads API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the conversations." },
      { status: 500 },
    );
  }
}
