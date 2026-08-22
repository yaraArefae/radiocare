import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  deliverCredentials,
  markTemporaryPassword,
  recordAdminAction,
} from "@/server/admin/admin-actions";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRETARY_AUTH_ROLE = "secretary";

const TEMPORARY_PASSWORD_VALIDITY_MS = 24 * 60 * 60 * 1000;

type SessionUser = {
  id?: string;
  email?: string | null;
  role?: string | string[] | null;
};

type SecretaryRequestRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  national_id: string;
  qualification: string;
  years_of_experience: number;
  languages: unknown;
  photo_path: string | null;
  status: string;
};

type CreatedUserResult = {
  id?: string;
  user?: { id?: string };
};

function normalizeRoles(role: SessionUser["role"]) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function readRequiredText(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function generateTemporaryPassword() {
  return `Rc!${randomBytes(10).toString("base64url")}7A`;
}

function createEmailSlug(fullName: string) {
  const normalized = fullName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized || "secretary";
}

async function generateUniqueLoginEmail(fullName: string) {
  const base = createEmailSlug(fullName);

  let suffix = 0;

  while (suffix < 10000) {
    const localPart = suffix === 0 ? base : `${base}${suffix + 1}`;
    const email = `${localPart}@radiocare.com`;

    await databaseReady;

    const [users] = await sql.execute(
      "SELECT id FROM `user` WHERE LOWER(email)=LOWER(?) LIMIT 1",
      [email],
    );

    if (!(users as unknown[])[0]) return email;

    suffix += 1;
  }

  return `secretary.${randomUUID().slice(0, 8)}@radiocare.com`;
}

async function requireAdmin(request: NextRequest): Promise<SessionUser> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new Response(
      JSON.stringify({ message: "Authentication required." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const user = session.user as SessionUser;

  if (!normalizeRoles(user.role).includes("admin")) {
    throw new Response(
      JSON.stringify({ message: "Admin access is required." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return user;
}

async function getSecretaryRequest(requestId: string) {
  await databaseReady;

  const [rows] = await sql.execute(
    `SELECT id, full_name, email, phone, national_id, qualification,
            years_of_experience, languages, photo_path, status
     FROM secretary_application WHERE id = ? LIMIT 1`,
    [requestId],
  );

  return (rows as SecretaryRequestRow[])[0];
}

/*
  PATCH /api/secretary-requests/manage

  approve | reject | request-info

  Approving is where the doctor is chosen, and it cannot be skipped: a
  secretary account with no doctor behind it signs in to a calendar that
  belongs to nobody. The administration decides who staffs whom, which
  is the whole reason hiring a secretary was moved away from the doctors
  themselves.
*/
export async function PATCH(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request);

    const body = (await request.json()) as Record<string, unknown>;

    const requestId = readRequiredText(body.requestId, "Request ID");
    const action = readRequiredText(body.action, "Action").toLowerCase();

    const application = await getSecretaryRequest(requestId);

    if (!application) {
      return NextResponse.json(
        { message: "Secretary application was not found." },
        { status: 404 },
      );
    }

    if (action === "approve") {
      if (application.status === "Approved") {
        return NextResponse.json(
          { message: "This application is already approved." },
          { status: 409 },
        );
      }

      if (application.status === "Rejected") {
        return NextResponse.json(
          { message: "A rejected application cannot be approved directly." },
          { status: 409 },
        );
      }

      const doctorUserId =
        typeof body.doctorUserId === "string" ? body.doctorUserId.trim() : "";

      if (!doctorUserId) {
        return NextResponse.json(
          {
            message:
              "Choose the doctor this secretary will work for before approving.",
          },
          { status: 400 },
        );
      }

      const [doctorRows] = await sql.execute(
        `SELECT full_name AS fullName FROM doctor_profile
         WHERE user_id = ? AND status = 'Active'`,
        [doctorUserId],
      );

      const doctor = (doctorRows as Array<{ fullName: string }>)[0];

      if (!doctor) {
        return NextResponse.json(
          { message: "That doctor was not found, or is not active." },
          { status: 404 },
        );
      }

      /*
        One secretary per doctor. Two accounts moving the same calendar
        would let one undo the other's booking without either knowing.
      */
      const [existing] = await sql.execute(
        "SELECT id FROM secretary_profile WHERE doctor_user_id = ?",
        [doctorUserId],
      );

      if ((existing as unknown[]).length > 0) {
        return NextResponse.json(
          {
            message: `${doctor.fullName} already has a secretary. Remove the current one first.`,
          },
          { status: 409 },
        );
      }

      const loginEmail = await generateUniqueLoginEmail(
        application.full_name,
      );

      const temporaryPassword = generateTemporaryPassword();

      const issuedAt = new Date();
      const expiresAt = new Date(
        issuedAt.getTime() + TEMPORARY_PASSWORD_VALIDITY_MS,
      );

      const createdResult = (await auth.api.createUser({
        body: {
          name: application.full_name,
          email: loginEmail,
          password: temporaryPassword,
          role: SECRETARY_AUTH_ROLE,
        },
      })) as unknown as CreatedUserResult;

      const createdUserId = createdResult.user?.id || createdResult.id;

      if (!createdUserId) {
        throw new Error(
          "The secretary account was created without a user ID.",
        );
      }

      try {
        const now = new Date();

        await sql.execute(
          `INSERT INTO secretary_profile
             (id, user_id, doctor_user_id, application_id, full_name, phone,
              national_id, qualification, years_of_experience, languages,
              photo_path, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active')`,
          [
            `SEC-${randomUUID()}`,
            createdUserId,
            doctorUserId,
            requestId,
            application.full_name,
            application.phone,
            application.national_id,
            application.qualification,
            application.years_of_experience,
            typeof application.languages === "string"
              ? application.languages
              : JSON.stringify(application.languages ?? []),
            application.photo_path ?? null,
          ],
        );

        await sql.execute(
          `UPDATE secretary_application SET status='Approved',
             approved_user_id=?, assigned_doctor_user_id=?, login_email=?,
             must_change_password=TRUE, temporary_password_issued_at=?,
             temporary_password_expires_at=?, reviewed_by=?, reviewed_at=?,
             admin_notes=NULL, requested_more_info=NULL, rejection_reason=NULL,
             updated_at=? WHERE id=?`,
          [
            createdUserId,
            doctorUserId,
            loginEmail,
            issuedAt,
            expiresAt,
            adminUser.id || null,
            now,
            now,
            requestId,
          ],
        );
      } catch (databaseError) {
        /*
          A login with no profile behind it can sign in and reach
          nothing, which is worse than no login at all.
        */
        try {
          await auth.api.removeUser({
            body: { userId: createdUserId },
            headers: request.headers,
          });
        } catch (cleanupError) {
          console.error(
            "Failed to remove orphan secretary account:",
            cleanupError,
          );
        }

        throw databaseError;
      }

      await markTemporaryPassword(createdUserId, expiresAt);

      const delivery = await deliverCredentials({
        to: application.email,
        name: application.full_name,
        loginEmail,
        temporaryPassword,
        expiresAt,
        role: "secretary",
      });

      await recordAdminAction({
        adminId: adminUser.id,
        adminEmail: adminUser.email,
        action: "secretary_request_approved",
        targetType: "user",
        targetId: createdUserId,
        targetLabel: application.full_name,
        details: delivery.delivered
          ? `Assigned to ${doctor.fullName}. Credentials emailed to ${application.email}`
          : `Assigned to ${doctor.fullName}. Email not sent: ${delivery.reason}`,
      });

      return NextResponse.json({
        message: delivery.delivered
          ? `${application.full_name} now manages the calendar of ${doctor.fullName}. The sign-in details were emailed to ${application.email}.`
          : `${application.full_name} now manages the calendar of ${doctor.fullName}. The email could not be sent, so hand the details over directly.`,
        status: "Approved",
        emailDelivered: delivery.delivered,
        emailError: delivery.delivered ? null : delivery.reason,
        credentials: {
          email: loginEmail,
          temporaryPassword,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          validForHours: 24,
        },
      });
    }

    if (action === "reject") {
      if (application.status === "Approved") {
        return NextResponse.json(
          {
            message:
              "An approved secretary cannot be rejected from this application.",
          },
          { status: 409 },
        );
      }

      const reason = readRequiredText(body.reason, "Rejection reason");

      await sql.execute(
        `UPDATE secretary_application SET status='Rejected',
           rejection_reason=?, requested_more_info=NULL, reviewed_by=?,
           reviewed_at=CURRENT_TIMESTAMP(3), updated_at=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [reason, adminUser.id || null, requestId],
      );

      return NextResponse.json({
        message: "Secretary application rejected.",
        status: "Rejected",
      });
    }

    if (action === "request-info") {
      if (application.status === "Approved") {
        return NextResponse.json(
          {
            message:
              "More information cannot be requested after approval.",
          },
          { status: 409 },
        );
      }

      const requestedInfo = readRequiredText(
        body.requestedInfo,
        "Requested information",
      );

      await sql.execute(
        `UPDATE secretary_application SET status='Needs More Information',
           requested_more_info=?, rejection_reason=NULL, reviewed_by=?,
           reviewed_at=CURRENT_TIMESTAMP(3), updated_at=CURRENT_TIMESTAMP(3)
         WHERE id=?`,
        [requestedInfo, adminUser.id || null, requestId],
      );

      return NextResponse.json({
        message: "More information was requested.",
        status: "Needs More Information",
      });
    }

    return NextResponse.json(
      { message: "Unsupported secretary application action." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof Response) return error;

    console.error("Failed to update secretary application:", error);

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to update the secretary application.",
      },
      { status: 500 },
    );
  }
}
