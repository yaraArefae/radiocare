import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeRoles(role: unknown) {
  const values = Array.isArray(role)
    ? role
    : String(role ?? "").split(",");

  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return {
      error: Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      ),
    };
  }

  if (!normalizeRoles(session.user?.role).includes("admin")) {
    return {
      error: Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      ),
    };
  }

  return { session };
}

/*
  Withdraws an approved doctor's access, or gives it back.

  Nothing is deleted. The reports this doctor signed are part of the
  medical record of every patient they read for, and a report whose
  author vanished is a report nobody can stand behind. The profile is
  marked instead, which is enough to stop them: the clinic queues, the
  study routes and the patient facing directory all read only rows whose
  status is Active.

  Their cases do not vanish with them either. A study addressed to this
  doctor stays in its clinic and is read by whoever else works there,
  which is why the clinic was never allowed to lose sight of a case
  addressed to one person.
*/
export async function PATCH(request: Request, context: RouteContext) {
  const check = await requireAdmin(request);

  if ("error" in check) return check.error;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const action = String(body?.action ?? "").trim().toLowerCase();
    const reason = String(body?.reason ?? "").trim();

    if (action !== "revoke" && action !== "restore") {
      return Response.json(
        {
          success: false,
          message: "The action has to be revoke or restore.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT id, user_id AS userId, full_name AS fullName, status
       FROM doctor_profile WHERE id = ? OR user_id = ?`,
      [String(id), String(id)],
    );

    const doctor = (rows as any[])[0];

    if (!doctor) {
      return Response.json(
        { success: false, message: "That doctor was not found." },
        { status: 404 },
      );
    }

    const nextStatus = action === "revoke" ? "Revoked" : "Active";

    await sql.execute(
      "UPDATE doctor_profile SET status = ?, updated_at = NOW(3) WHERE id = ?",
      [nextStatus, doctor.id],
    );

    /*
      The login is banned rather than removed, for the same reason the
      profile is kept: a deleted user leaves reports signed by an id
      that resolves to nobody. Better Auth stores the reason, so an
      administrator looking later can see why.
    */
    try {
      if (action === "revoke") {
        await auth.api.banUser({
          body: {
            userId: String(doctor.userId),
            banReason:
              reason || "Access withdrawn by the administration.",
          },
          headers: request.headers,
        });
      } else {
        await auth.api.unbanUser({
          body: { userId: String(doctor.userId) },
          headers: request.headers,
        });
      }
    } catch (banError) {
      /*
        The profile status is what the application actually reads, so a
        failure here does not leave the doctor working. It is logged
        rather than raised, because rolling the status back would.
      */
      console.error("Doctor ban toggle failed:", banError);
    }

    /*
      A revoked doctor's secretary loses their calendar with them: the
      account exists to manage one doctor's appointments, and that
      doctor no longer has any.
    */
    if (action === "revoke") {
      await sql.execute(
        "UPDATE secretary_profile SET status = 'Suspended' WHERE doctor_user_id = ?",
        [String(doctor.userId)],
      );
    } else {
      await sql.execute(
        "UPDATE secretary_profile SET status = 'Active' WHERE doctor_user_id = ?",
        [String(doctor.userId)],
      );
    }

    return Response.json({
      success: true,
      status: nextStatus,
      message:
        action === "revoke"
          ? `${doctor.fullName} can no longer sign in or receive cases. ` +
            "Their existing reports are unchanged."
          : `${doctor.fullName} can sign in and receive cases again.`,
    });
  } catch (error) {
    console.error("Doctor access change error:", error);

    return Response.json(
      { success: false, message: "This could not be changed." },
      { status: 500 },
    );
  }
}
