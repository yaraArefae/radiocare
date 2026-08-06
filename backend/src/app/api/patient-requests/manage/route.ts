import {
  deliverCredentials,
  generateTemporaryPassword,
  markTemporaryPassword,
  recordAdminAction,
  TEMPORARY_PASSWORD_VALIDITY_MS,
} from "@/server/admin/admin-actions";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATIENT_AUTH_ROLE = "patient";

type CreatedUserResult = {
  id?: string;
  user?: { id?: string };
};

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/*
  Approves or rejects a patient registration request. Approving creates
  the sign-in account, the patient record, and a temporary password the
  admin hands over to the patient.
*/
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

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

    const body = (await request.json()) as Record<string, unknown>;
    const requestId = String(body?.requestId ?? "").trim();
    const action = String(body?.action ?? "").trim().toLowerCase();
    const reason = String(body?.reason ?? "").trim().slice(0, 1000);

    if (!requestId || !["approve", "reject"].includes(action)) {
      return Response.json(
        {
          success: false,
          message: "A request id and a valid action are required.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [applicationRows] = await sql.execute(
      `SELECT id, full_name AS fullName, email, phone, age, gender,
         symptoms, medical_history AS medicalHistory, status
       FROM patient_application
       WHERE id = ?
       LIMIT 1`,
      [requestId],
    );

    const application = (applicationRows as any[])[0];

    if (!application) {
      return Response.json(
        { success: false, message: "Request not found." },
        { status: 404 },
      );
    }

    if (application.status === "Approved") {
      return Response.json(
        {
          success: false,
          message: "This request was already approved.",
        },
        { status: 409 },
      );
    }

    if (action === "reject") {
      await sql.execute(
        `UPDATE patient_application
         SET status = 'Rejected', rejection_reason = ?, reviewed_by = ?,
           reviewed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [reason || null, session.user?.id ?? null, requestId],
      );

      await recordAdminAction({
        adminId: session.user?.id,
        adminEmail: session.user?.email,
        action: "patient_request_rejected",
        targetType: "patient_application",
        targetId: requestId,
        targetLabel: application.fullName,
        details: reason || null,
      });

      return Response.json({
        success: true,
        message: "The request was rejected.",
        status: "Rejected",
      });
    }

    const temporaryPassword = generateTemporaryPassword();
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + TEMPORARY_PASSWORD_VALIDITY_MS,
    );

    const createdResult = (await auth.api.createUser({
      body: {
        name: application.fullName,
        email: application.email,
        password: temporaryPassword,
        role: PATIENT_AUTH_ROLE,
      },
    })) as unknown as CreatedUserResult;

    const createdUserId =
      createdResult.user?.id || createdResult.id;

    if (!createdUserId) {
      throw new Error("The patient account was created without a user ID.");
    }

    try {
      /*
        The patient record uses the account id, which is what the study,
        appointment, and messaging queries expect.
      */
      await sql.execute(
        `INSERT INTO patient
         (id, name, age, gender, phone, email, symptoms, medical_history, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active')
         ON DUPLICATE KEY UPDATE name = VALUES(name), age = VALUES(age),
           gender = VALUES(gender), phone = VALUES(phone), email = VALUES(email),
           symptoms = VALUES(symptoms), medical_history = VALUES(medical_history),
           status = 'Active', updated_at = CURRENT_TIMESTAMP(3)`,
        [
          createdUserId,
          application.fullName,
          application.age,
          application.gender,
          application.phone,
          application.email,
          application.symptoms,
          application.medicalHistory,
        ],
      );

      await sql.execute(
        `UPDATE patient_application
         SET status = 'Approved', approved_user_id = ?, login_email = ?,
           temporary_password_issued_at = ?, temporary_password_expires_at = ?,
           rejection_reason = NULL, reviewed_by = ?,
           reviewed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [
          createdUserId,
          application.email,
          issuedAt,
          expiresAt,
          session.user?.id ?? null,
          requestId,
        ],
      );
    } catch (databaseError) {
      /*
        If the patient record fails we remove the account again, so no
        half created patient is left behind.
      */
      try {
        await auth.api.removeUser({
          body: { userId: createdUserId },
          headers: request.headers,
        });
      } catch (cleanupError) {
        console.error(
          "Unable to remove the incomplete patient account:",
          cleanupError,
        );
      }

      throw databaseError;
    }

    /*
      The temporary password only works until it expires, and the first
      sign in has to replace it.
    */
    await markTemporaryPassword(createdUserId, expiresAt);

    const delivery = await deliverCredentials({
      to: application.email,
      name: application.fullName,
      loginEmail: application.email,
      temporaryPassword,
      expiresAt,
      role: "patient",
    });

    await recordAdminAction({
      adminId: session.user?.id,
      adminEmail: session.user?.email,
      action: "patient_request_approved",
      targetType: "user",
      targetId: createdUserId,
      targetLabel: application.fullName,
      details: delivery.delivered
        ? `Credentials emailed to ${application.email}`
        : `Email not sent: ${delivery.reason}`,
    });

    return Response.json({
      success: true,
      message: delivery.delivered
        ? `The patient account was created and the details were emailed to ${application.email}.`
        : "The patient account was created. The email could not be sent, so hand the details over directly.",
      status: "Approved",
      emailDelivered: delivery.delivered,
      emailError: delivery.delivered ? null : delivery.reason,
      credentials: {
        loginEmail: application.email,
        temporaryPassword,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Manage patient request API error:", error);

    return Response.json(
      { success: false, message: "Unable to process the request." },
      { status: 500 },
    );
  }
}
