import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genderValues = ["Male", "Female"];

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function readText(value: unknown, maximumLength = 2000) {
  return typeof value === "string"
    ? value.trim().slice(0, maximumLength)
    : "";
}

/*
  Public endpoint: a person asks for a patient account. The account is
  only created once an admin approves the request.
*/
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const fullName = readText(body.fullName, 255);
    const email = readText(body.email, 255).toLowerCase();
    const phone = readText(body.phone, 100);
    const nationalId = readText(body.nationalId, 100);
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

    if (!genderValues.includes(gender)) {
      return Response.json(
        { success: false, message: "Please choose the gender." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [existingRows] = await sql.execute(
      `SELECT id, status FROM patient_application WHERE email = ? LIMIT 1`,
      [email],
    );

    const existingApplication = (existingRows as any[])[0];

    if (existingApplication) {
      return Response.json(
        {
          success: false,
          message:
            existingApplication.status === "Rejected"
              ? "A previous request with this email was rejected. Please contact the clinic."
              : "A request with this email address already exists.",
        },
        { status: 409 },
      );
    }

    const [existingUserRows] = await sql.execute(
      "SELECT id FROM user WHERE email = ? LIMIT 1",
      [email],
    );

    if ((existingUserRows as unknown[]).length > 0) {
      return Response.json(
        {
          success: false,
          message: "An account with this email address already exists.",
        },
        { status: 409 },
      );
    }

    const applicationId = `PA-${Date.now()}-${randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

    await sql.execute(
      `INSERT INTO patient_application
       (id, full_name, email, phone, age, gender, national_id, symptoms, medical_history)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        applicationId,
        fullName,
        email,
        phone || null,
        Math.round(age),
        gender,
        nationalId || null,
        symptoms || null,
        medicalHistory || null,
      ],
    );

    return Response.json(
      {
        success: true,
        message:
          "Your request was sent. You will receive your sign-in details once an administrator approves it.",
        applicationId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create patient request API error:", error);

    return Response.json(
      { success: false, message: "Unable to send the request." },
      { status: 500 },
    );
  }
}

/*
  Admin view of the registration requests.
*/
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

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const status = readText(searchParams.get("status"), 30);

    await databaseReady;

    const [applicationRows] = await sql.execute(
      `SELECT id, full_name AS fullName, email, COALESCE(phone, '') AS phone,
         age, gender, COALESCE(national_id, '') AS nationalId,
         COALESCE(symptoms, '') AS symptoms,
         COALESCE(medical_history, '') AS medicalHistory,
         status, COALESCE(rejection_reason, '') AS rejectionReason,
         COALESCE(login_email, '') AS loginEmail,
         approved_user_id AS approvedUserId,
         reviewed_at AS reviewedAt, created_at AS createdAt
       FROM patient_application
       ${status ? "WHERE status = ?" : ""}
       ORDER BY created_at DESC
       LIMIT 200`,
      status ? [status] : [],
    );

    const applications = applicationRows as any[];

    return Response.json({
      success: true,
      applications,
      counts: {
        pending: applications.filter((item) => item.status === "Pending")
          .length,
        approved: applications.filter((item) => item.status === "Approved")
          .length,
        rejected: applications.filter((item) => item.status === "Rejected")
          .length,
      },
    });
  } catch (error) {
    console.error("List patient requests API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the requests." },
      { status: 500 },
    );
  }
}
