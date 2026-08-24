import type { ClinicKey } from "@/server/clinics/clinic-key";
import { doctorCaseScope, doctorClinics } from "@/server/clinics/doctor-clinics";
import {
  deliverCredentials,
  generateTemporaryPassword,
  markTemporaryPassword,
  recordAdminAction,
  TEMPORARY_PASSWORD_VALIDITY_MS,
} from "@/server/admin/admin-actions";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { normalizeRoles } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Lists the patients the signed in user is allowed to see. A doctor gets
  the patients who have a study in their own clinic, an administrator
  gets everyone, and a patient gets only their own record.
*/
/*
  Narrows a doctor to one of their own clinics when the screen asks for
  it. The requested clinic is intersected with what the doctor already
  covers, never added to it: a link can focus the view, it can never
  widen what the doctor is allowed to see.
*/
function narrowToRequestedClinic(
  clinics: ClinicKey[],
  requested: string | null,
) {
  const wanted = String(requested ?? "").trim().toLowerCase();

  if (!wanted) return clinics;

  return clinics.filter((clinic) => clinic === wanted);
}

export async function GET(request: Request) {
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

    const roles = normalizeRoles(session.user?.role);
    const isAdmin = roles.includes("admin");
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isAdmin && !isDoctor && !isPatient) {
      return Response.json(
        { success: false, message: "You are not allowed to list patients." },
        { status: 403 },
      );
    }

    await databaseReady;

    let scopeClause = "";
    const scopeValues: string[] = [];

    if (!isAdmin && isDoctor) {
      const [profileRows] = await sql.execute(
        `SELECT id, specialty, subspecialty, clinics,
           supported_body_regions AS supportedBodyRegions
         FROM doctor_profile
         WHERE user_id = ? LIMIT 1`,
        [String(session.user?.id ?? "")],
      );

      const profile = (profileRows as any[])[0];

      if (!profile) {
        return Response.json(
          {
            success: false,
            message: "Doctor profile not found or not approved yet.",
          },
          { status: 404 },
        );
      }

      const scope = doctorCaseScope(
        "s.clinic_key",
        "s.doctor_id",
        narrowToRequestedClinic(
          doctorClinics(profile),
          new URL(request.url).searchParams.get("clinic"),
        ),
        String(profile.id ?? ""),
      );

      scopeClause = `WHERE EXISTS (
        SELECT 1 FROM study s
        WHERE s.patient_id = p.id AND ${scope.condition}
      )`;
      scopeValues.push(...scope.values);
    } else if (!isAdmin && isPatient) {
      scopeClause = "WHERE p.id = ?";
      scopeValues.push(String(session.user?.id ?? ""));
    }

    const [patientRows] = await sql.execute(
      `SELECT p.id, p.name, p.age, p.gender,
         COALESCE(p.phone, '') AS phone, COALESCE(p.email, '') AS email,
         COALESCE(p.symptoms, '') AS symptoms,
         COALESCE(p.medical_history, '') AS medicalHistory,
         p.status, p.created_at AS createdAt,
         COALESCE(u.banned, FALSE) AS accountSuspended,
         u.id IS NOT NULL AS hasAccount,
         (SELECT COUNT(*) FROM study s WHERE s.patient_id = p.id) AS totalStudies,
         (SELECT MAX(s.created_at) FROM study s WHERE s.patient_id = p.id) AS lastStudyAt,
         (SELECT COUNT(*) FROM study s
          WHERE s.patient_id = p.id AND s.status = 'Completed') AS completedStudies,
         (SELECT COUNT(*) FROM appointment a
          WHERE a.patient_id = p.id AND a.status IN ('Pending', 'Confirmed')) AS openAppointments
       FROM patient p
       LEFT JOIN \`user\` u ON u.id = p.id
       ${scopeClause}
       ORDER BY COALESCE(
         (SELECT MAX(s.created_at) FROM study s WHERE s.patient_id = p.id),
         p.created_at
       ) DESC
       LIMIT 500`,
      scopeValues,
    );

    const patients = (patientRows as any[]).map((row) => ({
      ...row,
      /*
        A suspended sign-in account outranks the clinical status, so a
        blocked patient is never shown as active to a doctor.
      */
      accountSuspended: Boolean(row.accountSuspended),
      hasAccount: Boolean(row.hasAccount),
      status: row.accountSuspended ? "Suspended" : row.status,
      age: Number(row.age ?? 0),
      totalStudies: Number(row.totalStudies ?? 0),
      completedStudies: Number(row.completedStudies ?? 0),
      openAppointments: Number(row.openAppointments ?? 0),
    }));

    return Response.json({
      success: true,
      role: isAdmin ? "admin" : isDoctor ? "doctor" : "patient",
      patients,
      counts: {
        total: patients.length,
        active: patients.filter((item) => item.status === "Active").length,
        withOpenAppointment: patients.filter(
          (item) => item.openAppointments > 0,
        ).length,
        totalStudies: patients.reduce(
          (total, item) => total + item.totalStudies,
          0,
        ),
      },
    });
  } catch (error) {
    console.error("List patients API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the patients." },
      { status: 500 },
    );
  }
}

/*
  Registers a patient directly, for someone who came to the clinic
  without sending a request first. It creates the sign-in account, the
  clinical record, and the temporary password in one step, which the
  admin screen could not do before: creating a bare user account left a
  patient without an age, a gender, or a history.
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

    const readText = (value: unknown, maximum = 2000) =>
      typeof value === "string" ? value.trim().slice(0, maximum) : "";

    const fullName = readText(body.fullName, 255);
    const email = readText(body.email, 255).toLowerCase();
    const phone = readText(body.phone, 100);
    const gender = readText(body.gender, 20);
    const symptoms = readText(body.symptoms);
    const medicalHistory = readText(body.medicalHistory);
    const age = Number(body.age);

    if (!fullName || !email) {
      return Response.json(
        {
          success: false,
          message: "The full name and the email address are required.",
        },
        { status: 400 },
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { success: false, message: "The email address is not valid." },
        { status: 400 },
      );
    }

    if (!Number.isFinite(age) || age < 0 || age > 120) {
      return Response.json(
        { success: false, message: "Please enter a valid age." },
        { status: 400 },
      );
    }

    if (!["Male", "Female"].includes(gender)) {
      return Response.json(
        { success: false, message: "Please choose the gender." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [existingUser] = await sql.execute(
      "SELECT id FROM `user` WHERE email = ? LIMIT 1",
      [email],
    );

    if ((existingUser as unknown[]).length > 0) {
      return Response.json(
        {
          success: false,
          message: "An account with this email address already exists.",
        },
        { status: 409 },
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    const expiresAt = new Date(
      Date.now() + TEMPORARY_PASSWORD_VALIDITY_MS,
    );

    const created = (await auth.api.createUser({
      body: {
        name: fullName,
        email,
        password: temporaryPassword,
        role: "patient",
      },
    })) as unknown as { id?: string; user?: { id?: string } };

    const createdUserId = created.user?.id || created.id;

    if (!createdUserId) {
      throw new Error("The patient account was created without a user ID.");
    }

    try {
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
          fullName,
          Math.round(age),
          gender,
          phone || null,
          email,
          symptoms || null,
          medicalHistory || null,
        ],
      );
    } catch (databaseError) {
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

    await markTemporaryPassword(createdUserId, expiresAt);

    const delivery = await deliverCredentials({
      to: email,
      name: fullName,
      loginEmail: email,
      temporaryPassword,
      expiresAt,
      role: "patient",
    });

    await recordAdminAction({
      adminId: session.user?.id,
      adminEmail: session.user?.email,
      action: "patient_registered_by_admin",
      targetType: "user",
      targetId: createdUserId,
      targetLabel: fullName,
      details: delivery.delivered
        ? `Credentials emailed to ${email}`
        : `Email not sent: ${delivery.reason}`,
    });

    return Response.json(
      {
        success: true,
        message: delivery.delivered
          ? `The patient was registered and the details were emailed to ${email}.`
          : "The patient was registered. The email could not be sent, so hand the details over directly.",
        emailDelivered: delivery.delivered,
        emailError: delivery.delivered ? null : delivery.reason,
        patientId: createdUserId,
        credentials: {
          loginEmail: email,
          temporaryPassword,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Register patient API error:", error);

    return Response.json(
      { success: false, message: "Unable to register the patient." },
      { status: 500 },
    );
  }
}
