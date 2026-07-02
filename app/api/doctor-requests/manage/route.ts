import {
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/database";

export const runtime = "nodejs";

/*
  يجب أن يطابق اسم دور الطبيب داخل permissions.ts.
  إذا كان اسم الدور عندك radiologist بدل doctor،
  غيّري القيمة هنا فقط.
*/
const DOCTOR_AUTH_ROLE = "doctor";

const TEMPORARY_PASSWORD_VALIDITY_MS =
  24 * 60 * 60 * 1000;

type SessionUser = {
  id?: string;
  role?: string | string[] | null;
};

type DoctorRequestRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  specialty: string;
  subspecialty: string | null;
  license_number: string;
  licensing_authority: string;
  license_expiry_date: string;
  years_of_experience: number;
  current_workplace: string;
  status: string;
};

type ActionBody = {
  requestId?: unknown;
  action?: unknown;
  reason?: unknown;
  requestedInfo?: unknown;
};

type CreatedUserResult = {
  id?: string;
  user?: {
    id?: string;
  };
};

function normalizeRoles(
  role: SessionUser["role"]
): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function readRequiredText(
  value: unknown,
  fieldName: string
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function generateTemporaryPassword(): string {
  /*
    كلمة مرور عشوائية تحتوي ضمنيًا على حروف وأرقام،
    مع إضافة حرف كبير ورمز ورقم لضمان التنوع.
  */
  return `Rc!${randomBytes(10).toString(
    "base64url"
  )}7A`;
}

function createEmailSlug(fullName: string): string {
  const normalized = fullName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");

  return normalized || "doctor";
}

function generateUniqueLoginEmail(
  fullName: string
): string {
  const base = createEmailSlug(fullName);

  let suffix = 0;

  while (suffix < 10000) {
    const localPart =
      suffix === 0 ? base : `${base}${suffix + 1}`;

    const email = `${localPart}@radiocare.com`;

    const existingUser = db
      .prepare(`
        SELECT id
        FROM "user"
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
      `)
      .get(email);

    if (!existingUser) {
      return email;
    }

    suffix += 1;
  }

  return `doctor.${randomUUID().slice(
    0,
    8
  )}@radiocare.com`;
}

async function requireAdmin(
  request: NextRequest
): Promise<SessionUser> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) {
    throw new Response(
      JSON.stringify({
        message: "Authentication required.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const user = session.user as SessionUser;
  const roles = normalizeRoles(user.role);

  if (!roles.includes("admin")) {
    throw new Response(
      JSON.stringify({
        message: "Admin access is required.",
      }),
      {
        status: 403,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  return user;
}

function getDoctorRequest(
  requestId: string
): DoctorRequestRow | undefined {
  return db
    .prepare(`
      SELECT
        id,
        full_name,
        email,
        phone,
        specialty,
        subspecialty,
        license_number,
        licensing_authority,
        license_expiry_date,
        years_of_experience,
        current_workplace,
        status
      FROM doctor_application
      WHERE id = ?
    `)
    .get(requestId) as
    | DoctorRequestRow
    | undefined;
}

/*
  PATCH /api/doctor-requests/manage

  actions:
  - approve
  - reject
  - request-info
*/
export async function PATCH(
  request: NextRequest
) {
  try {
    const adminUser = await requireAdmin(request);

    const body =
      (await request.json()) as ActionBody;

    const requestId = readRequiredText(
      body.requestId,
      "Request ID"
    );

    const action = readRequiredText(
      body.action,
      "Action"
    ).toLowerCase();

    const doctorRequest =
      getDoctorRequest(requestId);

    if (!doctorRequest) {
      return NextResponse.json(
        {
          message:
            "Doctor request was not found.",
        },
        { status: 404 }
      );
    }

    if (action === "approve") {
      if (doctorRequest.status === "Approved") {
        return NextResponse.json(
          {
            message:
              "This doctor request is already approved.",
          },
          { status: 409 }
        );
      }

      if (doctorRequest.status === "Rejected") {
        return NextResponse.json(
          {
            message:
              "A rejected request cannot be approved directly.",
          },
          { status: 409 }
        );
      }

      /*
        النظام ينشئ تلقائيًا:
        1. إيميل دخول فريد.
        2. كلمة مرور مؤقتة.
        3. تاريخ انتهاء بعد 24 ساعة.
      */
      const loginEmail =
        generateUniqueLoginEmail(
          doctorRequest.full_name
        );

      const temporaryPassword =
        generateTemporaryPassword();

      const issuedAt = new Date();
      const expiresAt = new Date(
        issuedAt.getTime() +
          TEMPORARY_PASSWORD_VALIDITY_MS
      );

      const createdResult =
        (await auth.api.createUser({
          body: {
            name: doctorRequest.full_name,
            email: loginEmail,
            password: temporaryPassword,
            role: DOCTOR_AUTH_ROLE,
          },
        })) as unknown as CreatedUserResult;

      const createdUserId =
        createdResult.user?.id ||
        createdResult.id;

      if (!createdUserId) {
        throw new Error(
          "The doctor account was created without a user ID."
        );
      }

      try {
        const approveTransaction =
          db.transaction(() => {
            db.prepare(`
              UPDATE doctor_application
              SET
                status = 'Approved',
                approved_user_id = ?,
                login_email = ?,
                must_change_password = 1,
                temporary_password_issued_at = ?,
                temporary_password_expires_at = ?,
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                admin_notes = NULL,
                requested_more_info = NULL,
                rejection_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              createdUserId,
              loginEmail,
              issuedAt.toISOString(),
              expiresAt.toISOString(),
              adminUser.id || null,
              requestId
            );

            db.prepare(`
              INSERT INTO doctor_profile (
                id,
                user_id,
                application_id,
                full_name,
                phone,
                specialty,
                subspecialty,
                license_number,
                licensing_authority,
                license_expiry_date,
                years_of_experience,
                current_workplace,
                status
              )
              VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                'Active'
              )
            `).run(
              `DOC-${randomUUID()}`,
              createdUserId,
              requestId,
              doctorRequest.full_name,
              doctorRequest.phone,
              doctorRequest.specialty,
              doctorRequest.subspecialty,
              doctorRequest.license_number,
              doctorRequest.licensing_authority,
              doctorRequest.license_expiry_date,
              doctorRequest.years_of_experience,
              doctorRequest.current_workplace
            );
          });

        approveTransaction();
      } catch (databaseError) {
        /*
          إذا فشل حفظ ملف الطبيب بعد إنشاء الحساب،
          نحذف حساب المصادقة حتى لا يبقى حساب ناقص.
        */
        try {
          await auth.api.removeUser({
            body: {
              userId: createdUserId,
            },
            headers: request.headers,
          });
        } catch (cleanupError) {
          console.error(
            "Failed to remove orphan doctor account:",
            cleanupError
          );
        }

        throw databaseError;
      }

      return NextResponse.json({
        message:
          "Doctor approved and temporary credentials created successfully.",
        status: "Approved",
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
      if (doctorRequest.status === "Approved") {
        return NextResponse.json(
          {
            message:
              "An approved doctor cannot be rejected from this request.",
          },
          { status: 409 }
        );
      }

      const reason = readRequiredText(
        body.reason,
        "Rejection reason"
      );

      db.prepare(`
        UPDATE doctor_application
        SET
          status = 'Rejected',
          rejection_reason = ?,
          requested_more_info = NULL,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        reason,
        adminUser.id || null,
        requestId
      );

      return NextResponse.json({
        message:
          "Doctor request rejected successfully.",
        status: "Rejected",
      });
    }

    if (action === "request-info") {
      if (doctorRequest.status === "Approved") {
        return NextResponse.json(
          {
            message:
              "More information cannot be requested after approval.",
          },
          { status: 409 }
        );
      }

      const requestedInfo = readRequiredText(
        body.requestedInfo,
        "Requested information"
      );

      db.prepare(`
        UPDATE doctor_application
        SET
          status = 'Needs More Information',
          requested_more_info = ?,
          rejection_reason = NULL,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        requestedInfo,
        adminUser.id || null,
        requestId
      );

      return NextResponse.json({
        message:
          "More information was requested successfully.",
        status: "Needs More Information",
      });
    }

    return NextResponse.json(
      {
        message:
          "Unsupported doctor request action.",
      },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    console.error(
      "Failed to update doctor request:",
      error
    );

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to update the doctor request.",
      },
      { status: 500 }
    );
  }
}
