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
  Withdraws a secretary's access, or gives it back.

  This exists beside the delete route rather than instead of it, for the
  reason the doctors have the same pair: a secretary has booked
  appointments, and those rows record who booked them. Deleting the
  account leaves a booking made by an id that resolves to nobody, and a
  patient asking who moved their appointment gets no answer.

  Marking the profile is enough to stop her. resolveActingDoctor only
  hands back a calendar to a secretary whose status is Active, so a
  withdrawn one signs in and reaches nothing rather than reaching
  somebody else's day.

  The status distinguishes who did it. 'Revoked' is this route, an
  administrator deciding about the secretary herself. 'Suspended' is set
  when her doctor loses access, which is a consequence rather than a
  decision, and is lifted again when that doctor is restored. Keeping
  them apart stops restoring a doctor from quietly undoing an
  administrator's separate decision about their secretary.
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
        { success: false, message: "The action has to be revoke or restore." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT s.id, s.user_id AS userId, s.full_name AS fullName,
              s.status, s.doctor_user_id AS doctorUserId,
              d.full_name AS doctorName, d.status AS doctorStatus
       FROM secretary_profile s
       LEFT JOIN doctor_profile d ON d.user_id = s.doctor_user_id
       WHERE s.id = ? OR s.user_id = ?`,
      [String(id), String(id)],
    );

    const secretary = (rows as any[])[0];

    if (!secretary) {
      return Response.json(
        { success: false, message: "That secretary was not found." },
        { status: 404 },
      );
    }

    if (action === "restore" && String(secretary.doctorStatus) !== "Active") {
      /*
        Handing back a calendar that belongs to a withdrawn doctor would
        put her straight back into the state the doctor's own
        withdrawal created, so the reason is said plainly instead.
      */
      return Response.json(
        {
          success: false,
          message:
            `${secretary.doctorName ?? "Her doctor"} does not have access, ` +
            "so there is no calendar to give back. Restore the doctor first.",
        },
        { status: 409 },
      );
    }

    const nextStatus = action === "revoke" ? "Revoked" : "Active";

    await sql.execute(
      "UPDATE secretary_profile SET status = ?, updated_at = NOW(3) WHERE id = ?",
      [nextStatus, secretary.id],
    );

    /*
      The login is banned rather than removed, for the same reason the
      profile is kept. Better Auth stores the reason, so an
      administrator looking later can see why.
    */
    try {
      if (action === "revoke") {
        await auth.api.banUser({
          body: {
            userId: String(secretary.userId),
            banReason: reason || "Access withdrawn by the administration.",
          },
          headers: request.headers,
        });
      } else {
        await auth.api.unbanUser({
          body: { userId: String(secretary.userId) },
          headers: request.headers,
        });
      }
    } catch (banError) {
      /*
        The profile status is what the application actually reads, so a
        failure here does not leave her working. It is logged rather
        than raised, because rolling the status back would.
      */
      console.error("Secretary ban toggle failed:", banError);
    }

    return Response.json({
      success: true,
      status: nextStatus,
      message:
        action === "revoke"
          ? `${secretary.fullName} can no longer sign in or change ` +
            `appointments. The bookings she made are unchanged.`
          : `${secretary.fullName} can sign in and manage the calendar ` +
            `of ${secretary.doctorName ?? "her doctor"} again.`,
    });
  } catch (error) {
    console.error("Secretary access change error:", error);

    return Response.json(
      { success: false, message: "This could not be changed." },
      { status: 500 },
    );
  }
}
