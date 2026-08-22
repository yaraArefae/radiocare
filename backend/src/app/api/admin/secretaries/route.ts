import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreatedUserResult = {
  user?: { id?: string };
  id?: string;
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
  Every secretary, and every doctor who could be given one.

  Both lists come back together because the page needs both to do
  anything: assigning a secretary is choosing a doctor, and a doctor who
  already has one must not be offered again.
*/
export async function GET(request: Request) {
  const check = await requireAdmin(request);

  if ("error" in check) return check.error;

  try {
    await databaseReady;

    const [secretaries] = await sql.execute(
      `SELECT s.id, s.full_name AS fullName, s.phone, s.status,
              u.email, s.doctor_user_id AS doctorUserId,
              d.full_name AS doctorName, s.created_at AS createdAt
       FROM secretary_profile s
       JOIN user u ON u.id = s.user_id
       LEFT JOIN doctor_profile d ON d.user_id = s.doctor_user_id
       ORDER BY s.created_at DESC`,
    );

    const [doctors] = await sql.execute(
      `SELECT d.user_id AS userId, d.full_name AS fullName,
              d.specialty,
              (SELECT COUNT(*) FROM secretary_profile s
               WHERE s.doctor_user_id = d.user_id) AS secretaryCount
       FROM doctor_profile d
       WHERE d.status = 'Active'
       ORDER BY d.full_name`,
    );

    return Response.json({
      success: true,
      secretaries,
      doctors: (doctors as any[]).map((row) => ({
        userId: String(row.userId),
        fullName: String(row.fullName),
        specialty: String(row.specialty ?? ""),
        hasSecretary: Number(row.secretaryCount ?? 0) > 0,
      })),
    });
  } catch (error) {
    console.error("Admin secretaries read error:", error);

    return Response.json(
      { success: false, message: "This could not be loaded." },
      { status: 500 },
    );
  }
}

/*
  Employs a secretary and attaches them to one doctor.

  The doctor is named by the administration, which is the point of
  moving this out of the doctor's own pages: an account that can move
  appointments is staff, and staff are hired by the people who run the
  clinic rather than by whoever will be working with them.
*/
export async function POST(request: Request) {
  const check = await requireAdmin(request);

  if ("error" in check) return check.error;

  try {
    const body = await request.json();

    const fullName = String(body?.fullName ?? "").trim();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const phone = String(body?.phone ?? "").trim();
    const password = String(body?.password ?? "");
    const doctorUserId = String(body?.doctorUserId ?? "").trim();

    if (!fullName || !email || !doctorUserId || password.length < 8) {
      return Response.json(
        {
          success: false,
          message:
            "A name, an email, a doctor and a password of at least 8 " +
            "characters are required.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    /*
      The doctor has to exist and be active. Without this an
      administrator could attach a secretary to a mistyped id, and the
      account would sign in to a calendar that belongs to nobody.
    */
    const [doctorRows] = await sql.execute(
      `SELECT full_name AS fullName FROM doctor_profile
       WHERE user_id = ? AND status = 'Active'`,
      [doctorUserId],
    );

    const doctor = (doctorRows as any[])[0];

    if (!doctor) {
      return Response.json(
        { success: false, message: "That doctor was not found." },
        { status: 404 },
      );
    }

    const [existing] = await sql.execute(
      "SELECT id FROM secretary_profile WHERE doctor_user_id = ?",
      [doctorUserId],
    );

    if ((existing as any[]).length > 0) {
      return Response.json(
        {
          success: false,
          message:
            String(doctor.fullName) +
            " already has a secretary. Remove the current one first.",
        },
        { status: 409 },
      );
    }

    const created = (await auth.api.createUser({
      body: {
        name: fullName,
        email,
        password,
        role: "secretary",
      },
    })) as unknown as CreatedUserResult;

    const secretaryUserId = created.user?.id || created.id;

    if (!secretaryUserId) {
      throw new Error("The secretary account was created without an id.");
    }

    try {
      await sql.execute(
        `INSERT INTO secretary_profile
           (id, user_id, doctor_user_id, full_name, phone)
         VALUES (?, ?, ?, ?, ?)`,
        [
          `SEC-${randomUUID()}`,
          secretaryUserId,
          doctorUserId,
          fullName,
          phone || null,
        ],
      );
    } catch (databaseError) {
      /*
        A login with no profile behind it can sign in and reach nothing,
        which is worse than no login at all, so it is removed again.
      */
      await auth.api.removeUser({
        body: { userId: secretaryUserId },
        headers: request.headers,
      });

      throw databaseError;
    }

    return Response.json({
      success: true,
      message: `${fullName} can now manage the calendar of ${doctor.fullName}.`,
    });
  } catch (error) {
    console.error("Admin secretary create error:", error);

    const message =
      error instanceof Error && /email/i.test(error.message)
        ? "That email is already registered."
        : "The secretary account could not be created.";

    return Response.json({ success: false, message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const check = await requireAdmin(request);

  if ("error" in check) return check.error;

  try {
    const body = await request.json();
    const secretaryId = String(body?.secretaryId ?? "").trim();

    if (!secretaryId) {
      return Response.json(
        { success: false, message: "Which secretary?" },
        { status: 400 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      "SELECT user_id AS userId FROM secretary_profile WHERE id = ?",
      [secretaryId],
    );

    const secretary = (rows as any[])[0];

    if (!secretary) {
      return Response.json(
        { success: false, message: "That secretary was not found." },
        { status: 404 },
      );
    }

    await sql.execute("DELETE FROM secretary_profile WHERE id = ?", [
      secretaryId,
    ]);

    /*
      The login goes with the profile. Leaving the account behind would
      leave somebody able to sign in to an application that no longer
      knows what they are allowed to see.
    */
    await auth.api.removeUser({
      body: { userId: String(secretary.userId) },
      headers: request.headers,
    });

    return Response.json({
      success: true,
      message: "The secretary account was removed.",
    });
  } catch (error) {
    console.error("Admin secretary delete error:", error);

    return Response.json(
      { success: false, message: "The account could not be removed." },
      { status: 500 },
    );
  }
}
