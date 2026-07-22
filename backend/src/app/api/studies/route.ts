import { randomUUID } from "node:crypto";
import {
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUserWithRole = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | string[] | null;
};

type ClinicKey =
  | "chest"
  | "bone"
  | "neuro"
  | "cardiac"
  | "abdominal"
  | "dental"
  | "breast"
  | "pediatric"
  | "general";

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

function clinicKeyFromText(value: string): ClinicKey {
  const text = value.toLowerCase();

  if (
    text.includes("chest") ||
    text.includes("lung") ||
    text.includes("thoracic")
  ) {
    return "chest";
  }

  if (
    text.includes("cardio") ||
    text.includes("heart") ||
    text.includes("cardiac")
  ) {
    return "cardiac";
  }

  if (
    text.includes("bone") ||
    text.includes("ortho") ||
    text.includes("fracture") ||
    text.includes("spine")
  ) {
    return "bone";
  }

  if (
    text.includes("neuro") ||
    text.includes("brain") ||
    text.includes("head") ||
    text.includes("skull")
  ) {
    return "neuro";
  }

  if (
    text.includes("dental") ||
    text.includes("teeth") ||
    text.includes("jaw")
  ) {
    return "dental";
  }

  if (
    text.includes("abdomen") ||
    text.includes("abdominal") ||
    text.includes("pelvis") ||
    text.includes("kidney") ||
    text.includes("liver")
  ) {
    return "abdominal";
  }

  if (
    text.includes("breast") ||
    text.includes("mammography")
  ) {
    return "breast";
  }

  if (
    text.includes("pediatric") ||
    text.includes("child")
  ) {
    return "pediatric";
  }

  return "general";
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
      userRoles.includes("patient");

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

    const predictedFinding = getTextValue(
      formData,
      "predictedFinding"
    );

    const confidenceText = getTextValue(
      formData,
      "confidence"
    );

    const modelName =
      getTextValue(formData, "modelName") ||
      "EfficientNetB0";

    const modelVersion =
      getTextValue(formData, "modelVersion") ||
      "1.0";

    const aiExplanation = getTextValue(
      formData,
      "aiExplanation"
    );

    const confidence =
      confidenceText === ""
        ? null
        : Number(confidenceText);

    if (
      confidence !== null &&
      (!Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 100)
    ) {
      return Response.json(
        {
          success: false,
          message:
            "AI confidence must be between 0 and 100.",
        },
        {
          status: 400,
        }
      );
    }

    const submittedPatientId = getTextValue(
      formData,
      "patientId"
    );

    const submittedPatientName = getTextValue(
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

    /*
     * The upload page belongs to the signed-in patient.
     * Use submitted values when an admin creates a study,
     * otherwise safely fall back to the current session.
     */
    const sessionUserName =
      typeof sessionUser.name === "string"
        ? sessionUser.name.trim()
        : "";

    const sessionUserEmail =
      typeof sessionUser.email === "string"
        ? sessionUser.email.trim()
        : "";

    const patientId =
      submittedPatientId || sessionUser.id;

    const patientName =
      submittedPatientName ||
      sessionUserName ||
      sessionUserEmail ||
      "Patient";

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

    const detectedRegion = getTextValue(
      formData,
      "detectedRegion"
    );

    const detectedClinic = getTextValue(
      formData,
      "detectedClinic"
    );

    const imageValue = formData.get("image");

    /* Validate patient and study information */
    const missingFields = [
      !patientId ? "patientId" : "",
      !patientName ? "patientName" : "",
      !ageText ? "age" : "",
      !gender ? "gender" : "",
      !bodyRegion ? "bodyRegion" : "",
      !imagingView ? "imagingView" : "",
    ].filter(Boolean);

    if (missingFields.length > 0) {
      return Response.json(
        {
          success: false,
          message:
            "Please complete all required fields.",
          missingFields,
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

    await databaseReady;
    await sql.execute(
      `INSERT INTO patient (id, name, age, gender, status)
       VALUES (?, ?, ?, ?, 'Active')
       ON DUPLICATE KEY UPDATE name=VALUES(name), age=VALUES(age),
       gender=VALUES(gender), status='Active', updated_at=CURRENT_TIMESTAMP(3)`,
      [patientId, patientName, age, gender],
    );
    const clinicKey = clinicKeyFromText(
      detectedRegion || detectedClinic || bodyRegion,
    );

    await sql.execute(
      `INSERT INTO study
       (id, patient_id, body_region, imaging_view, priority, clinical_notes,
        image_path, original_file_name, file_type, file_size, status, uploaded_by, clinic_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studyId, patientId, bodyRegion, imagingView, priority,
        clinicalNotes || null, relativeFilePath, imageFile.name,
        imageFile.type || (isDicom ? "application/dicom" : null),
        imageFile.size, priority === "Urgent" ? "Urgent" : "Waiting",
        sessionUser.id, clinicKey],
    );
    if (predictedFinding) {
      await sql.execute(
        `
          INSERT INTO ai_result
          (
            study_id,
            predicted_finding,
            confidence,
            model_name,
            model_version,
            explanation
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            predicted_finding = VALUES(predicted_finding),
            confidence = VALUES(confidence),
            model_name = VALUES(model_name),
            model_version = VALUES(model_version),
            explanation = VALUES(explanation)
        `,
        [
          studyId,
          predictedFinding,
          confidence,
          modelName,
          modelVersion,
          aiExplanation || null,
        ]
      );
    }

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
          aiResult: predictedFinding
            ? {
                predictedFinding,
                confidence,
                modelName,
                modelVersion,
              }
            : null,
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

    await databaseReady;
    const [result] = await sql.query(
      `SELECT s.id, s.patient_id AS patientId, p.name AS patient,
       s.body_region AS bodyRegion, s.imaging_view AS view,
       DATE(s.created_at) AS date, s.priority, s.status,
       s.created_at AS createdAt, s.clinic_key AS clinicKey,
       COALESCE(a.predicted_finding, 'Not analyzed yet') AS aiResult,
       a.confidence
       FROM study s JOIN patient p ON p.id=s.patient_id
       LEFT JOIN ai_result a ON a.study_id=s.id
       ORDER BY s.created_at DESC`,
    );
    const studies = result;

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