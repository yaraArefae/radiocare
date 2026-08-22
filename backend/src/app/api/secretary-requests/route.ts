import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { saveDoctorPhoto } from "@/server/documents/doctor-photo";
import {
  REQUIRED_SECRETARY_DOCUMENTS,
  SECRETARY_DOCUMENT_KINDS,
  SECRETARY_DOCUMENT_LABELS,
  saveSecretaryDocument,
  type SecretaryDocumentKind,
} from "@/server/documents/secretary-documents";
import { notifyAdmins } from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DatabaseConstraintError = Error & { errno?: number };

function normalizeRoles(role: unknown) {
  const values = Array.isArray(role)
    ? role
    : String(role ?? "").split(",");

  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function readRequiredText(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function readOptionalText(value: unknown) {
  if (typeof value !== "string") return null;

  return value.trim() || null;
}

function parseStoredArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/*
  POST /api/secretary-requests

  Takes an application for a secretary post and stores it. No account is
  created here and no doctor is attached: both of those are the
  administration's to decide, and this route is open to anybody on the
  sign-in page.
*/
export async function POST(request: NextRequest) {
  try {
    /*
      The certificates travel with the fields, so the request arrives as
      multipart. A plain JSON body is still read, which is what an
      automated test or a future client would send while attaching
      nothing.
    */
    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    const uploadedFiles: Partial<Record<SecretaryDocumentKind, File>> = {};
    let profilePhoto: File | null = null;
    let body: Record<string, unknown>;

    if (isMultipart) {
      const form = await request.formData();
      const fields = form.get("application");

      body = JSON.parse(
        typeof fields === "string" ? fields : "{}",
      ) as Record<string, unknown>;

      for (const kind of SECRETARY_DOCUMENT_KINDS) {
        const file = form.get(kind);

        if (file instanceof File && file.size > 0) {
          uploadedFiles[kind] = file;
        }
      }

      const photo = form.get("profile-photo");

      if (photo instanceof File && photo.size > 0) {
        profilePhoto = photo;
      }
    } else {
      body = (await request.json()) as Record<string, unknown>;
    }

    const fullName = readRequiredText(body.fullName, "Full name");
    const email = readRequiredText(body.email, "Email").toLowerCase();
    const phone = readRequiredText(body.phone, "Phone");
    const nationalId = readRequiredText(
      body.nationalId,
      "National ID or passport",
    );

    const qualification = readRequiredText(
      body.qualification,
      "Qualification",
    );

    const institute = readRequiredText(
      body.institute,
      "College or institute",
    );

    const dateOfBirth = readOptionalText(body.dateOfBirth);
    const currentWorkplace = readOptionalText(body.currentWorkplace);
    const about = readOptionalText(body.about);

    const yearsOfExperience = Number(body.yearsOfExperience ?? 0);

    if (
      !Number.isInteger(yearsOfExperience) ||
      yearsOfExperience < 0 ||
      yearsOfExperience > 60
    ) {
      return NextResponse.json(
        { message: "Years of experience must be between 0 and 60." },
        { status: 400 },
      );
    }

    /*
      A graduation year is optional, because somebody trained on the job
      has none, but a year that was typed has to be a year.
    */
    let graduationYear: number | null = null;

    if (
      body.graduationYear !== null &&
      body.graduationYear !== undefined &&
      String(body.graduationYear).trim() !== ""
    ) {
      graduationYear = Number(body.graduationYear);

      if (
        !Number.isInteger(graduationYear) ||
        graduationYear < 1950 ||
        graduationYear > 2100
      ) {
        return NextResponse.json(
          { message: "Graduation year must be a valid year." },
          { status: 400 },
        );
      }
    }

    const languages = Array.isArray(body.languages)
      ? body.languages
          .filter(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim()),
          )
          .map((item) => item.trim())
      : [];

    if (body.declarationAccepted !== true) {
      return NextResponse.json(
        {
          message:
            "The declaration must be accepted before submitting the request.",
        },
        { status: 400 },
      );
    }

    /*
      The two papers this job actually needs. Checked before anything is
      written, so a refused application leaves no half filled folder on
      disk.
    */
    for (const kind of REQUIRED_SECRETARY_DOCUMENTS) {
      if (!uploadedFiles[kind]) {
        return NextResponse.json(
          {
            message: `The ${SECRETARY_DOCUMENT_LABELS[kind]} has to be attached.`,
          },
          { status: 400 },
        );
      }
    }

    const applicationId = `SEC-REQ-${randomUUID()}`;

    const storedPaths: Partial<Record<SecretaryDocumentKind, string>> = {};

    for (const kind of SECRETARY_DOCUMENT_KINDS) {
      const file = uploadedFiles[kind];

      if (!file) continue;

      const result = await saveSecretaryDocument({
        applicationId,
        kind,
        file,
      });

      if ("error" in result) {
        return NextResponse.json({ message: result.error }, { status: 400 });
      }

      storedPaths[kind] = result.storedPath;
    }

    /*
      The photograph is written by the same helper the doctors use. It
      is named by the owner id, so an application id can never land on
      a doctor's file, and it is a portrait either way.
    */
    let photoPath: string | null = null;

    if (profilePhoto) {
      const savedPhoto = await saveDoctorPhoto(applicationId, profilePhoto);

      if (!savedPhoto.ok) {
        return NextResponse.json(
          { message: savedPhoto.message },
          { status: 400 },
        );
      }

      photoPath = savedPhoto.relativePath;
    }

    await databaseReady;

    await sql.execute(
      `INSERT INTO secretary_application
       (id, full_name, email, phone, date_of_birth, national_id,
        qualification, institute, graduation_year, years_of_experience,
        current_workplace, languages, about,
        id_document_path, qualification_certificate_path,
        experience_certificate_path, cv_path, photo_path,
        declaration_accepted, status, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', TRUE)`,
      [
        applicationId,
        fullName,
        email,
        phone,
        dateOfBirth,
        nationalId,
        qualification,
        institute,
        graduationYear,
        yearsOfExperience,
        currentWorkplace,
        JSON.stringify(languages),
        about,
        storedPaths["id-document"] ?? null,
        storedPaths["qualification-certificate"] ?? null,
        storedPaths["experience-certificate"] ?? null,
        storedPaths["cv"] ?? null,
        photoPath,
        true,
      ],
    );

    await notifyAdmins({
      type: "registration_request",
      title: "New secretary application",
      body: `${fullName} applied for a secretary post.`,
      link: "/admin/secretary-requests",
    });

    return NextResponse.json(
      {
        message: "Secretary application submitted successfully.",
        applicationId,
        status: "Pending",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to submit secretary application:", error);

    const databaseError = error as DatabaseConstraintError;

    if (databaseError.errno === 1062) {
      return NextResponse.json(
        {
          message:
            "An application already exists with this email or national ID.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit the secretary application.",
      },
      { status: 400 },
    );
  }
}

/*
  GET /api/secretary-requests

  The applications, for an administrator. The doctors come back with
  them for the same reason they do on the secretaries page: approving
  somebody means choosing who they will work for, and a doctor who
  already has a secretary must not be offered again.
*/
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return NextResponse.json(
        { message: "Authentication required." },
        { status: 401 },
      );
    }

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return NextResponse.json(
        { message: "Admin access is required." },
        { status: 403 },
      );
    }

    await databaseReady;

    const [result] = await sql.query(
      `SELECT a.*, assigned.full_name AS assignedDoctorName,
              sp.status AS secretaryStatus
       FROM secretary_application a
       LEFT JOIN doctor_profile assigned
              ON assigned.user_id = a.assigned_doctor_user_id
       LEFT JOIN secretary_profile sp ON sp.user_id = a.approved_user_id
       ORDER BY a.created_at DESC`,
    );

    const statusOrder = new Map([
      ["Pending", 1],
      ["Under Review", 2],
      ["Needs More Information", 3],
      ["Approved", 4],
      ["Rejected", 5],
      ["Suspended", 6],
    ]);

    const rows = result as Array<Record<string, unknown>>;

    rows.sort(
      (a, b) =>
        (statusOrder.get(String(a.status)) ?? 7) -
        (statusOrder.get(String(b.status)) ?? 7),
    );

    const [doctors] = await sql.execute(
      `SELECT d.user_id AS userId, d.full_name AS fullName, d.specialty,
              (SELECT COUNT(*) FROM secretary_profile s
               WHERE s.doctor_user_id = d.user_id) AS secretaryCount
       FROM doctor_profile d
       WHERE d.status = 'Active'
       ORDER BY d.full_name`,
    );

    return NextResponse.json({
      applications: rows.map((row) => ({
        ...row,
        languages: parseStoredArray(row.languages),
        declaration_accepted: Boolean(row.declaration_accepted),
        must_change_password: Boolean(row.must_change_password),
      })),
      doctors: (doctors as Array<Record<string, unknown>>).map((row) => ({
        userId: String(row.userId),
        fullName: String(row.fullName),
        specialty: String(row.specialty ?? ""),
        hasSecretary: Number(row.secretaryCount ?? 0) > 0,
      })),
    });
  } catch (error) {
    console.error("Failed to load secretary applications:", error);

    return NextResponse.json(
      { message: "Unable to load secretary applications." },
      { status: 500 },
    );
  }
}
