import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/database";

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

type SQLiteConstraintError = Error & {
  code?: string;
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
    declaration_accepted:
      Number(row.declaration_accepted) === 1,
    must_change_password:
      Number(row.must_change_password) === 1,
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
    const body =
      (await request.json()) as DoctorRequestBody;

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

    db.prepare(`
      INSERT INTO doctor_application (
        id,
        full_name,
        email,
        phone,
        date_of_birth,
        national_id,
        specialty,
        subspecialty,
        license_number,
        licensing_authority,
        license_country,
        license_issue_date,
        license_expiry_date,
        years_of_experience,
        current_workplace,
        medical_degree,
        university,
        graduation_year,
        id_document_path,
        medical_license_path,
        specialty_certificate_path,
        cv_path,
        additional_documents,
        declaration_accepted,
        status
      )
      VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        1,
        'Pending'
      )
    `).run(
      applicationId,
      fullName,
      email,
      phone,
      dateOfBirth,
      nationalId,
      specialty,
      subspecialty,
      licenseNumber,
      licensingAuthority,
      licenseCountry,
      licenseIssueDate,
      licenseExpiryDate,
      yearsOfExperience,
      currentWorkplace,
      medicalDegree,
      university,
      graduationYear,
      idDocumentPath,
      medicalLicensePath,
      specialtyCertificatePath,
      cvPath,
      JSON.stringify(additionalDocuments)
    );

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

    const databaseError =
      error as SQLiteConstraintError;

    if (
      databaseError.code ===
      "SQLITE_CONSTRAINT_UNIQUE"
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

    const rows = db
      .prepare(`
        SELECT *
        FROM doctor_application
        ORDER BY
          CASE status
            WHEN 'Pending' THEN 1
            WHEN 'Under Review' THEN 2
            WHEN 'Needs More Information' THEN 3
            WHEN 'Approved' THEN 4
            WHEN 'Rejected' THEN 5
            WHEN 'Suspended' THEN 6
            ELSE 7
          END,
          created_at DESC
      `)
      .all() as Array<Record<string, unknown>>;

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
