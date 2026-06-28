import { randomUUID } from "node:crypto";
import {
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const databasePath = path.resolve(
  process.cwd(),
  process.env.AUTH_DATABASE_PATH ??
    "radiology-auth.db"
);

const database = new Database(databasePath);

database.pragma("foreign_keys = ON");
database.pragma("journal_mode = WAL");

type SessionUserWithRole = {
  id: string;
  role?: string | string[] | null;
};

function getUserRoles(
  role: SessionUserWithRole["role"]
) {
  const roles = Array.isArray(role)
    ? role
    : (role ?? "").split(",");

  return roles
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function getTextValue(
  formData: FormData,
  fieldName: string
) {
  const value = formData.get(fieldName);

  return typeof value === "string"
    ? value.trim()
    : "";
}

function getFileExtension(file: File) {
  const originalExtension = path
    .extname(file.name)
    .toLowerCase();

  if (
    [".jpg", ".jpeg", ".png", ".webp", ".dcm"].includes(
      originalExtension
    )
  ) {
    return originalExtension;
  }

  if (file.type === "image/jpeg") {
    return ".jpg";
  }

  if (file.type === "image/png") {
    return ".png";
  }

  if (file.type === "image/webp") {
    return ".webp";
  }

  return "";
}

export async function POST(request: Request) {
  let savedFilePath = "";

  try {
    /* Check logged-in user */
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        {
          status: 401,
        }
      );
    }

    const sessionUser =
      session.user as SessionUserWithRole;

    const userRoles = getUserRoles(
      sessionUser.role
    );

    const canCreateStudy =
      userRoles.includes("admin") ||
      userRoles.includes("technician");

    if (!canCreateStudy) {
      return Response.json(
        {
          success: false,
          message:
            "You do not have permission to create studies.",
        },
        {
          status: 403,
        }
      );
    }

    /* Read submitted form */
    const formData = await request.formData();

    const patientId = getTextValue(
      formData,
      "patientId"
    );

    const patientName = getTextValue(
      formData,
      "patientName"
    );

    const ageText = getTextValue(
      formData,
      "age"
    );

    const gender = getTextValue(
      formData,
      "gender"
    );

    const bodyRegion = getTextValue(
      formData,
      "bodyRegion"
    );

    const imagingView = getTextValue(
      formData,
      "imagingView"
    );

    const priority =
      getTextValue(formData, "priority") ||
      "Normal";

    const clinicalNotes = getTextValue(
      formData,
      "clinicalNotes"
    );

    const imageValue = formData.get("image");

    /* Validate patient and study information */
    if (
      !patientId ||
      !patientName ||
      !ageText ||
      !gender ||
      !bodyRegion ||
      !imagingView
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Please complete all required fields.",
        },
        {
          status: 400,
        }
      );
    }

    const age = Number(ageText);

    if (
      !Number.isInteger(age) ||
      age < 0 ||
      age > 120
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Patient age must be between 0 and 120.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      gender !== "Male" &&
      gender !== "Female"
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid gender value.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      priority !== "Normal" &&
      priority !== "Urgent"
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid priority value.",
        },
        {
          status: 400,
        }
      );
    }

    if (!(imageValue instanceof File)) {
      return Response.json(
        {
          success: false,
          message:
            "Please select an X-ray image.",
        },
        {
          status: 400,
        }
      );
    }

    const imageFile = imageValue;

    if (imageFile.size === 0) {
      return Response.json(
        {
          success: false,
          message:
            "The selected image file is empty.",
        },
        {
          status: 400,
        }
      );
    }

    const maximumFileSize =
      20 * 1024 * 1024;

    if (imageFile.size > maximumFileSize) {
      return Response.json(
        {
          success: false,
          message:
            "The image must be smaller than 20 MB.",
        },
        {
          status: 400,
        }
      );
    }

    const extension =
      getFileExtension(imageFile);

    const isDicom =
      extension === ".dcm";

    const allowedImageTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    const isRegularImage =
      allowedImageTypes.includes(
        imageFile.type
      );

    if (!isDicom && !isRegularImage) {
      return Response.json(
        {
          success: false,
          message:
            "Only JPG, PNG, WEBP and DICOM files are allowed.",
        },
        {
          status: 400,
        }
      );
    }

    /* Generate study and file IDs */
    const studyId = `ST-${Date.now()}-${randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

    const storedFileName =
      `${studyId}${extension}`;

    const storageDirectory = path.join(
      process.cwd(),
      "storage",
      "studies"
    );

    await mkdir(storageDirectory, {
      recursive: true,
    });

    const absoluteFilePath = path.join(
      storageDirectory,
      storedFileName
    );

    const relativeFilePath = path
      .join(
        "storage",
        "studies",
        storedFileName
      )
      .replaceAll("\\", "/");

    const imageBuffer = Buffer.from(
      await imageFile.arrayBuffer()
    );

    await writeFile(
      absoluteFilePath,
      imageBuffer
    );

    savedFilePath = absoluteFilePath;

    /* Save patient and study atomically */
    const saveStudy =
      database.transaction(() => {
        database
          .prepare(
            `
              INSERT INTO patient (
                id,
                name,
                age,
                gender,
                status,
                updated_at
              )
              VALUES (
                @id,
                @name,
                @age,
                @gender,
                'Active',
                CURRENT_TIMESTAMP
              )
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                age = excluded.age,
                gender = excluded.gender,
                updated_at = CURRENT_TIMESTAMP
            `
          )
          .run({
            id: patientId,
            name: patientName,
            age,
            gender,
          });

        database
          .prepare(
            `
              INSERT INTO study (
                id,
                patient_id,
                body_region,
                imaging_view,
                priority,
                clinical_notes,
                image_path,
                original_file_name,
                file_type,
                file_size,
                status,
                uploaded_by
              )
              VALUES (
                @id,
                @patientId,
                @bodyRegion,
                @imagingView,
                @priority,
                @clinicalNotes,
                @imagePath,
                @originalFileName,
                @fileType,
                @fileSize,
                @status,
                @uploadedBy
              )
            `
          )
          .run({
            id: studyId,
            patientId,
            bodyRegion,
            imagingView,
            priority,
            clinicalNotes:
              clinicalNotes || null,
            imagePath: relativeFilePath,
            originalFileName:
              imageFile.name,
            fileType:
              imageFile.type ||
              (isDicom
                ? "application/dicom"
                : null),
            fileSize: imageFile.size,
            status:
              priority === "Urgent"
                ? "Urgent"
                : "Waiting",
            uploadedBy: sessionUser.id,
          });
      });

    saveStudy();

    return Response.json(
      {
        success: true,
        message:
          "The patient and study were saved successfully.",
        study: {
          id: studyId,
          patientId,
          bodyRegion,
          imagingView,
          priority,
          status:
            priority === "Urgent"
              ? "Urgent"
              : "Waiting",
        },
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error(
      "Create study API error:",
      error
    );

    if (savedFilePath) {
      try {
        await unlink(savedFilePath);
      } catch {
        // Ignore cleanup errors.
      }
    }

    return Response.json(
      {
        success: false,
        message:
          "The study could not be saved. Please try again.",
      },
      {
        status: 500,
      }
    );
  }
}
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        {
          status: 401,
        }
      );
    }

    const studies = database
      .prepare(
        `
          SELECT
            study.id,
            study.patient_id AS patientId,
            patient.name AS patient,
            study.body_region AS bodyRegion,
            study.imaging_view AS view,
            DATE(study.created_at) AS date,
            study.priority,
            study.status,
            study.created_at AS createdAt,
            COALESCE(
              ai_result.predicted_finding,
              'Not analyzed yet'
            ) AS aiResult,
            ai_result.confidence AS confidence
          FROM study
          INNER JOIN patient
            ON patient.id = study.patient_id
          LEFT JOIN ai_result
            ON ai_result.study_id = study.id
          ORDER BY study.created_at DESC
        `
      )
      .all();

    return Response.json({
      success: true,
      studies,
    });
  } catch (error) {
    console.error("Get studies API error:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to load studies.",
      },
      {
        status: 500,
      }
    );
  }
}