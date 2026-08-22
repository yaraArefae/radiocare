import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeRoles(role: unknown): string[] {
  const roles = Array.isArray(role)
    ? role
    : String(role ?? "").split(",");

  return roles.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/*
  A doctor reading who their assigned secretary is.

  The doctor is taken from the session, so this can only ever answer
  about the person asking.
*/
async function requireDoctor(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) return { error: "You must sign in first.", status: 401 };

  if (!normalizeRoles(session.user?.role).includes("doctor")) {
    return { error: "Doctor access is required.", status: 403 };
  }

  return { doctorUserId: String(session.user?.id ?? "") };
}

export async function GET(request: Request) {
  try {
    const check = await requireDoctor(request);

    if ("error" in check) {
      return Response.json(
        { success: false, message: check.error },
        { status: check.status },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT s.id, s.full_name AS fullName, s.phone, s.status,
              u.email, s.created_at AS createdAt
       FROM secretary_profile s
       JOIN user u ON u.id = s.user_id
       WHERE s.doctor_user_id = ?`,
      [check.doctorUserId],
    );

    return Response.json({
      success: true,
      secretary: (rows as any[])[0] ?? null,
    });
  } catch (error) {
    console.error("Secretary read error:", error);

    return Response.json(
      { success: false, message: "This could not be loaded." },
      { status: 500 },
    );
  }
}

/*
  Hiring and removing a secretary is not done here.

  A secretary is staff, and who employs whom is an administrative
  decision: a doctor creating logins for the application they work in
  would let any approved doctor mint accounts nobody reviewed. The
  administration does it from /api/admin/secretaries, and this route
  lets a doctor see who has been assigned to them.
*/
