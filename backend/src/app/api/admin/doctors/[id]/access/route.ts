import { auth } from "@/server/auth/auth";
import { doctorClinics } from "@/server/clinics/doctor-clinics";
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
  Who could take this doctor's patients.

  The colleagues of their own clinics, because a case belongs to a body
  region before it belongs to a person: handing a chest queue to a
  doctor who reads wrists moves the problem rather than solving it. The
  doctor being withdrawn is not among them.
*/
export async function GET(request: Request, context: RouteContext) {
  const check = await requireAdmin(request);

  if ("error" in check) return check.error;

  try {
    const { id } = await context.params;

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT id, user_id AS userId, clinics, specialty, subspecialty,
              supported_body_regions AS supportedBodyRegions
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

    const theirClinics = doctorClinics(doctor);

    const [others] = await sql.execute(
      `SELECT id, full_name AS fullName, specialty, subspecialty, clinics,
              supported_body_regions AS supportedBodyRegions
       FROM doctor_profile
       WHERE status = 'Active' AND id <> ?
       ORDER BY full_name`,
      [String(doctor.id)],
    );

    const colleagues = (others as any[]).filter((other) =>
      doctorClinics(other).some((clinic) => theirClinics.includes(clinic)),
    );

    return Response.json({
      success: true,
      colleagues: colleagues.map((row) => ({
        id: String(row.id),
        fullName: String(row.fullName),
        specialty: String(row.specialty ?? ""),
      })),
    });
  } catch (error) {
    console.error("Doctor colleagues read error:", error);

    return Response.json(
      { success: false, message: "This could not be loaded." },
      { status: 500 },
    );
  }
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
      The cases addressed to a withdrawn doctor have to go somewhere.

      A patient chose this doctor, and their scan is now sitting in front
      of somebody who can no longer sign in. Since a case only reaches
      the doctor it was addressed to, leaving it there means it reaches
      nobody at all: not a queue with an idle name on it, but a case that
      has fallen out of the application.

      Where they go is the administration's call. Naming a replacement
      hands the patients to one doctor, which is what a practice usually
      wants. Naming nobody clears the address instead, and the cases
      return to their clinic for whoever works there - the state they
      would have been in had the patient never chosen.

      Only open cases move. A case that was read keeps the name of the
      doctor who read it, because the report is theirs and a record that
      reassigns its author afterwards is a record that lies about who
      made the decision.
    */
    let movedCases = 0;
    let movedTo = "";

    if (action === "revoke") {
      const requested =
        typeof body?.transferToDoctorId === "string"
          ? body.transferToDoctorId.trim()
          : "";

      let replacementId: string | null = null;

      if (requested) {
        const [replacementRows] = await sql.execute(
          `SELECT id, full_name AS fullName FROM doctor_profile
           WHERE id = ? AND status = 'Active'`,
          [requested],
        );

        const replacement = (replacementRows as any[])[0];

        if (!replacement) {
          return Response.json(
            {
              success: false,
              message:
                "The doctor the cases would move to was not found, or is " +
                "not active.",
            },
            { status: 404 },
          );
        }

        replacementId = String(replacement.id);
        movedTo = String(replacement.fullName);
      }

      const [moved] = await sql.execute(
        `UPDATE study
         SET doctor_id = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE doctor_id = ?
           AND status NOT IN ('Completed', 'Reviewed', 'Approved')`,
        [replacementId, doctor.id],
      );

      movedCases = Number((moved as any)?.affectedRows ?? 0);

      /*
        A visit that has not happened yet cannot happen: the doctor it
        was booked with no longer works here. It is cancelled rather
        than moved, because a patient agreed to see this doctor at this
        time and neither half of that is still true.
      */
      await sql.execute(
        `UPDATE appointment
         SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP(3)
         WHERE doctor_id = ?
           AND status IN ('Requested', 'Pending', 'Confirmed')
           AND scheduled_at >= CURRENT_TIMESTAMP(3)`,
        [String(doctor.userId)],
      );
    }

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

      Only a secretary who was still working is suspended, and only a
      suspended one is given back. A secretary the administration
      withdrew on her own account is marked 'Revoked', and restoring her
      doctor must not quietly reverse that decision: the two were made
      about different people, for different reasons.
    */
    if (action === "revoke") {
      await sql.execute(
        `UPDATE secretary_profile SET status = 'Suspended'
         WHERE doctor_user_id = ? AND status = 'Active'`,
        [String(doctor.userId)],
      );
    } else {
      await sql.execute(
        `UPDATE secretary_profile SET status = 'Active'
         WHERE doctor_user_id = ? AND status = 'Suspended'`,
        [String(doctor.userId)],
      );
    }

    return Response.json({
      success: true,
      status: nextStatus,
      movedCases,
      /*
        The count is said out loud. An administrator withdrawing a
        doctor is deciding about patients as well, and "seven cases
        moved to Dr X" is the part of that decision they cannot see on
        the screen they are looking at.
      */
      message:
        action === "revoke"
          ? `${doctor.fullName} can no longer sign in or receive cases. ` +
            (movedCases === 0
              ? "They had no open cases. "
              : movedTo
                ? `${movedCases} open case${movedCases === 1 ? "" : "s"} moved to ${movedTo}. `
                : `${movedCases} open case${movedCases === 1 ? "" : "s"} returned to their clinic. `) +
            "Their signed reports are unchanged, and any visit that had " +
            "not happened yet was cancelled."
          : `${doctor.fullName} can sign in and receive cases again. ` +
            "The cases that were moved when their access was withdrawn " +
            "stay where they went.",
    });
  } catch (error) {
    console.error("Doctor access change error:", error);

    return Response.json(
      { success: false, message: "This could not be changed." },
      { status: 500 },
    );
  }
}
