import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The accounts an administrator can write to.

  The inbox only knows the people who wrote first, which makes it
  impossible to start a conversation - and starting one is exactly what
  an administrator needs when a doctor's clinics are wrong or a request
  needs a question asked. This lists every doctor and patient, whether
  or not a thread exists yet, and says which of them already has one.

  Administrators are left out: the thread belongs to a doctor or a
  patient, and the administration is the other end of all of them.
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

    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim();
    const role = (url.searchParams.get("role") ?? "").trim().toLowerCase();

    const conditions = ["u.role NOT LIKE '%admin%'"];
    const values: string[] = [];

    if (role === "doctor" || role === "patient") {
      conditions.push("u.role LIKE ?");
      values.push(`%${role}%`);
    }

    if (search) {
      conditions.push("(u.name LIKE ? OR u.email LIKE ?)");
      values.push(`%${search}%`, `%${search}%`);
    }

    /*
      Banned accounts stay in the list. An administrator often has to
      tell somebody why their account was closed, and that message is
      the one that would be impossible to send otherwise.
    */
    const [rows] = await sql.execute(
      `SELECT u.id, u.name, u.email, u.role, u.banned,
              COUNT(m.id) AS messageCount
       FROM \`user\` u
       LEFT JOIN support_message m ON m.user_id = u.id
       WHERE ${conditions.join(" AND ")}
       GROUP BY u.id, u.name, u.email, u.role, u.banned
       ORDER BY u.role ASC, u.name ASC
       LIMIT 200`,
      values,
    );

    const accounts = (rows as any[]).map((row) => ({
      userId: row.id,
      userName: row.name ?? "",
      userEmail: row.email ?? "",
      userRole: normalizeRoles(row.role)[0] ?? "patient",
      banned: Boolean(row.banned),
      hasThread: Number(row.messageCount ?? 0) > 0,
    }));

    return Response.json({ success: true, accounts });
  } catch (error) {
    console.error("Support accounts API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the accounts." },
      { status: 500 },
    );
  }
}
