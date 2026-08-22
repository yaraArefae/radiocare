import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth/auth";
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABELS,
  saveDoctorDocument,
  type DocumentKind,
} from "@/server/documents/doctor-documents";
import { saveDoctorPhoto } from "@/server/documents/doctor-photo";
import { databaseReady, sql } from "@/server/database/database";
import { notifyAdmins } from "@/server/notifications/notifications";

export const runtime = "nodejs";

type SessionUser = {
  role?: string | string[] | null;
};

type DoctorRequestBody = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  dateOfBirth?: unknown;
  nationalId?: unknown;

  specialty?: unknown;
  subspecialty?: unknown;

  licenseNumber?: unknown;
  licensingAuthority?: unknown;
  licenseCountry?: unknown;
  licenseIssueDate?: unknown;
  licenseExpiryDate?: unknown;

  yearsOfExperience?: unknown;
  currentWorkplace?: unknown;
  medicalDegree?: unknown;
  university?: unknown;
  graduationYear?: unknown;

  idDocumentPath?: unknown;
  medicalLicensePath?: unknown;
  specialtyCertificatePath?: unknown;
  cvPath?: unknown;
  additionalDocuments?: unknown;

  declarationAccepted?: unknown;
};

type DatabaseConstraintError = Error & {
  errno?: number;
};

function readRequiredText(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRoles(
  role: SessionUser["role"]
): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
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

function serializeApplicationRow(
  row: Record<string, unknown>
) {
  return {
    ...row,
    supported_imaging_types: parseStoredArray(
      row.supported_imaging_types
    ),
    supported_body_regions: parseStoredArray(
      row.supported_body_regions
    ),
    additional_documents: parseStoredArray(
      row.additional_documents
    ),
    declaration_accepted: Boolean(row.declaration_accepted),
    must_change_password: Boolean(row.must_change_password),
  };
}

/*
  POST /api/doctor-requests

  يحفظ طلب الطبيب فقط.
  لا ينشئ حساب دخول، ولا يسمح للطبيب بتحديد
  أنواع الأشعة أو مناطق الجسم بنفسه.
  الأدمن يحدد هذه الصلاحيات عند الموافقة.
*/
export async function POST(request: NextRequest) {
  try {
    /*
      The form sends the credential documents as files, so the request
      arrives as multipart. Older callers that send plain JSON are still
      accepted; their applications simply carry a file name and no file,
      which is what every application looked like before.
    */
    const contentType = request.headers.get("content-type") ?? "";
    const isMultipart = contentType.includes("multipart/form-data");

    let uploadedFiles: Partial<Record<DocumentKind, File>> = {};
    let profilePhoto: File | null = null;
    let body: DoctorRequestBody;

    if (isMultipart) {
      const form = await request.formData();

      const fields = form.get("application");

      body = JSON.parse(
        typeof fields === "string" ? fields : "{}",
      ) as DoctorRequestBody;

      for (const kind of DOCUMENT_KINDS) {
        const file = form.get(kind);

        if (file instanceof File && file.size > 0) {
          uploadedFiles[kind] = file;
        }
      }

      /*
        The profile photograph, which is not a credential document and is
        not stored with them. A patient sees it; an administrator never
        has to verify it.
      */
      const photo = form.get("profile-photo");

      if (photo instanceof File && photo.size > 0) {
        profilePhoto = photo;
      }
    } else {
      body = (await request.json()) as DoctorRequestBody;
    }

    const fullName = readRequiredText(
      body.fullName,
      "Full name"
    );

    const email = readRequiredText(
      body.email,
      "Email"
    ).toLowerCase();

    const phone = readRequiredText(
      body.phone,
      "Phone"
    );

    const dateOfBirth = readRequiredText(
      body.dateOfBirth,
      "Date of birth"
    );

    const nationalId = readRequiredText(
      body.nationalId,
      "National ID or passport"
    );

    const specialty = readRequiredText(
      body.specialty,
      "Specialty"
    );

    const subspecialty = readOptionalText(
      body.subspecialty
    );

    const licenseNumber = readRequiredText(
      body.licenseNumber,
      "License number"
    );

    const licensingAuthority = readRequiredText(
      body.licensingAuthority,
      "Licensing authority"
    );

    const licenseCountry = readOptionalText(
      body.licenseCountry
    );

    const licenseIssueDate = readRequiredText(
      body.licenseIssueDate,
      "License issue date"
    );

    const licenseExpiryDate = readRequiredText(
      body.licenseExpiryDate,
      "License expiry date"
    );

    const yearsOfExperience = Number(
      body.yearsOfExperience
    );

    const graduationYear = Number(
      body.graduationYear
    );

    if (
      !Number.isInteger(yearsOfExperience) ||
      yearsOfExperience < 0 ||
      yearsOfExperience > 80
    ) {
      return NextResponse.json(
        {
          message:
            "Years of experience must be between 0 and 80.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(graduationYear) ||
      graduationYear < 1950 ||
      graduationYear > 2100
    ) {
      return NextResponse.json(
        {
          message:
            "Graduation year must be a valid year.",
        },
        { status: 400 }
      );
    }

    const currentWorkplace = readRequiredText(
      body.currentWorkplace,
      "Current workplace"
    );

    const medicalDegree = readRequiredText(
      body.medicalDegree,
      "Medical degree"
    );

    const university = readRequiredText(
      body.university,
      "University"
    );

    const idDocumentPath = readRequiredText(
      body.idDocumentPath,
      "ID document"
    );

    const medicalLicensePath = readRequiredText(
      body.medicalLicensePath,
      "Medical license document"
    );

    const specialtyCertificatePath = readRequiredText(
      body.specialtyCertificatePath,
      "Specialty certificate"
    );

    const cvPath = readRequiredText(
      body.cvPath,
      "CV"
    );

    const additionalDocuments = Array.isArray(
      body.additionalDocuments
    )
      ? body.additionalDocuments.filter(
          (item): item is string =>
            typeof item === "string" &&
            Boolean(item.trim())
        )
      : [];

    if (body.declarationAccepted !== true) {
      return NextResponse.json(
        {
          message:
            "The declaration must be accepted before submitting the request.",
        },
        { status: 400 }
      );
    }

    const applicationId = `DOC-REQ-${randomUUID()}`;

    /*
      The uploaded documents are written before the row is inserted, so
      an application never claims to hold a licence that was rejected on
      its way to disk.
    */
    const storedPaths: Partial<Record<DocumentKind, string>> = {};

    for (const kind of DOCUMENT_KINDS) {
      const file = uploadedFiles[kind];

      if (!file) continue;

      const result = await saveDoctorDocument({
        applicationId,
        kind,
        file,
      });

      if ("error" in result) {
        return NextResponse.json({ message: result.error }, { status: 400 });
      }

      storedPaths[kind] = result.storedPath;
    }

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
      `INSERT INTO doctor_application
       (id, full_name, email, phone, date_of_birth, national_id, specialty,
        subspecialty, license_number, licensing_authority, license_country,
        license_issue_date, license_expiry_date, years_of_experience,
        current_workplace, medical_degree, university, graduation_year,
        supported_imaging_types, supported_body_regions, id_document_path,
        medical_license_path, specialty_certificate_path, cv_path,
        additional_documents, declaration_accepted, photo_path, status, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', TRUE)`,
      [applicationId, fullName, email, phone, dateOfBirth, nationalId,
        specialty, subspecialty, licenseNumber, licensingAuthority,
        licenseCountry, licenseIssueDate, licenseExpiryDate, yearsOfExperience,
        currentWorkplace, medicalDegree, university, graduationYear,
        JSON.stringify([]), JSON.stringify([]),
        storedPaths["id-document"] ?? idDocumentPath,
        storedPaths["medical-license"] ?? medicalLicensePath,
        storedPaths["specialty-certificate"] ?? specialtyCertificatePath,
        storedPaths["cv"] ?? cvPath,
        JSON.stringify(additionalDocuments), true, photoPath],
    );

    await notifyAdmins({
      type: "registration_request",
      title: "New doctor registration request",
      body: `${fullName} (${specialty}) applied for a doctor account.`,
      link: "/admin/doctor-requests",
    });

    return NextResponse.json(
      {
        message:
          "Doctor request submitted successfully.",
        applicationId,
        status: "Pending",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(
      "Failed to submit doctor request:",
      error
    );

    const databaseError = error as DatabaseConstraintError;

    if (
      databaseError.errno === 1062
    ) {
      return NextResponse.json(
        {
          message:
            "A request already exists with this email, national ID, or license number.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to submit the doctor request.",
      },
      { status: 400 }
    );
  }
}

/*
  GET /api/doctor-requests

  يعرض طلبات الأطباء للأدمن فقط.
*/
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json(
        { message: "Authentication required." },
        { status: 401 }
      );
    }

    const roles = normalizeRoles(
      (session.user as SessionUser).role
    );

    if (!roles.includes("admin")) {
      return NextResponse.json(
        { message: "Admin access is required." },
        { status: 403 }
      );
    }

    const statusOrder = new Map([
      ["Pending", 1], ["Under Review", 2],
      ["Needs More Information", 3], ["Approved", 4],
      ["Rejected", 5], ["Suspended", 6],
    ]);
    await databaseReady;
    /*
      The doctor profile status travels with the application so the
      administration can see, on the same card that approved somebody,
      whether their access has since been withdrawn. Without it the
      page would offer to withdraw an account that already is.
    */
    const [result] = await sql.query(
      `SELECT a.*, dp.status AS doctor_status
       FROM doctor_application a
       LEFT JOIN doctor_profile dp ON dp.user_id = a.approved_user_id
       ORDER BY a.created_at DESC`,
    );
    const rows = result as Array<Record<string, unknown>>;
    rows.sort((a, b) =>
      (statusOrder.get(String(a.status)) ?? 7) -
      (statusOrder.get(String(b.status)) ?? 7)
    );

    return NextResponse.json({
      applications: rows.map(
        serializeApplicationRow
      ),
    });
  } catch (error) {
    console.error(
      "Failed to load doctor requests:",
      error
    );

    return NextResponse.json(
      {
        message:
          "Unable to load doctor requests.",
      },
      { status: 500 }
    );
  }
}
