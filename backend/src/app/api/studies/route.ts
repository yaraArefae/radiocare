import { randomUUID } from "node:crypto";
import {
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import {
  clinicKeyFromText,
  type ClinicKey,
} from "@/server/clinics/clinic-key";
import { databaseReady, sql } from "@/server/database/database";
import {
  createNotifications,
  type NewNotification,
} from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUserWithRole = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | string[] | null;
};

type AiFinding = {
  name: string;
  probability: number;
  threshold?: number;
  detected?: boolean;
  model?: string;
};

type AiDetailsPayload = {
  schemaVersion: 2;
  triageResult: string;
  primaryFinding: string | null;
  possibleFindings: AiFinding[];
  allFindings: AiFinding[];
  aiPriority: string;
  detectedRegion: string;
  detectedClinic: string;
  message: string;
};

/*
 * The three priorities the clinics work with, and every spelling the
 * upload form or the AI service may send for them.
 */
const PRIORITY_ALIASES: Record<string, string> = {
  urgent: "Urgent",
  emergency: "Urgent",
  "needs review": "Needs Review",
  needs_review: "Needs Review",
  needsreview: "Needs Review",
  routine: "Routine",
  normal: "Routine",
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

function getFindingArray(
  formData: FormData,
  fieldName: string
): AiFinding[] {
  const rawValue = getTextValue(
    formData,
    fieldName
  );

  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue: unknown = JSON.parse(
      rawValue
    );

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((item): AiFinding | null => {
        if (
          typeof item !== "object" ||
          item === null
        ) {
          return null;
        }

        const finding =
          item as Record<string, unknown>;

        const name =
          typeof finding.name === "string"
            ? finding.name.trim()
            : "";

        const probability = Number(
          finding.probability
        );

        if (
          !name ||
          !Number.isFinite(probability)
        ) {
          return null;
        }

        const normalizedFinding: AiFinding = {
          name,
          probability: Math.min(
            100,
            Math.max(0, probability)
          ),
        };

        const threshold = Number(
          finding.threshold
        );

        if (Number.isFinite(threshold)) {
          normalizedFinding.threshold = Math.min(
            100,
            Math.max(0, threshold)
          );
        }

        if (
          typeof finding.detected === "boolean"
        ) {
          normalizedFinding.detected =
            finding.detected;
        }

        if (
          typeof finding.model === "string" &&
          finding.model.trim()
        ) {
          normalizedFinding.model =
            finding.model.trim();
        }

        return normalizedFinding;
      })
      .filter(
        (item): item is AiFinding =>
          item !== null
      );
  } catch {
    return [];
  }
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

/*
 * Tells the patient that their result is ready, and alerts every doctor
 * whose specialty maps to the clinic of an abnormal study.
 */
async function notifyAboutNewStudy(study: {
  studyId: string;
  patientId: string;
  patientName: string;
  bodyRegion: string;
  clinicKey: ClinicKey;
  triageResult: string;
  primaryFinding: string | null;
}) {
  const isAbnormal =
    study.triageResult.trim().toUpperCase() === "ABNORMAL";

  const notifications: NewNotification[] = [
    {
      userId: study.patientId,
      userRole: "patient",
      type: "new_case",
      title: isAbnormal
        ? "Your X-ray needs a doctor review"
        : "Your X-ray analysis is ready",
      body: isAbnormal
        ? `The preliminary AI analysis of your ${study.bodyRegion} image found ${
            study.primaryFinding || "a possible finding"
          }. A doctor from the matching clinic will review it.`
        : `The preliminary AI analysis of your ${study.bodyRegion} image did not detect an abnormality.`,
      link: `/studies/${study.studyId}`,
      studyId: study.studyId,
    },
  ];

  if (isAbnormal) {
    try {
      const [doctorRows] = await sql.execute(
        `SELECT dp.user_id AS userId, dp.specialty, dp.subspecialty
         FROM doctor_profile dp
         JOIN user u ON u.id = dp.user_id
         WHERE dp.status = 'Active'`,
      );

      for (const doctor of doctorRows as any[]) {
        const doctorClinicKey = clinicKeyFromText(
          `${doctor.specialty} ${doctor.subspecialty || ""}`,
        );

        if (doctorClinicKey !== study.clinicKey) continue;

        notifications.push({
          userId: doctor.userId,
          userRole: "doctor",
          type: "new_case",
          title: "New abnormal case in your clinic",
          body: `${study.patientName} uploaded a ${study.bodyRegion} image. AI result: ${
            study.primaryFinding || "abnormal"
          }.`,
          link: `/studies/${study.studyId}`,
          studyId: study.studyId,
        });
      }
    } catch (error) {
      console.error("Unable to list clinic doctors:", error);
    }
  }

  await createNotifications(notifications);
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

    const triageResult = getTextValue(
      formData,
      "triageResult"
    );

    const primaryFinding =
      getTextValue(
        formData,
        "primaryFinding"
      ) || null;

    const possibleFindings = getFindingArray(
      formData,
      "possibleFindings"
    );

    const allFindings = getFindingArray(
      formData,
      "allFindings"
    );

    const aiPriority =
      getTextValue(
        formData,
        "aiPriority"
      ) ||
      (triageResult === "ABNORMAL"
        ? "URGENT"
        : triageResult === "UNCERTAIN"
          ? "NEEDS_REVIEW"
          : "ROUTINE");

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

    /*
     * What the patient feels now and what the doctor should know about
     * their history. Both are shown to the reviewing doctor.
     */
    const symptoms = getTextValue(
      formData,
      "symptoms"
    );

    const medicalHistory = getTextValue(
      formData,
      "medicalHistory"
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

    /*
     * The AI service reports URGENT, NEEDS_REVIEW, or ROUTINE, while the
     * upload form sends Normal or Urgent. Both spellings are accepted
     * and stored as one of the three priorities the clinics use.
     */
    const normalizedPriority = PRIORITY_ALIASES[
      priority.trim().toLowerCase()
    ];

    if (!normalizedPriority) {
      return Response.json(
        {
          success: false,
          message:
            "Invalid priority value. Use Urgent, Needs Review, or Routine.",
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
      `INSERT INTO patient (id, name, age, gender, symptoms, medical_history, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Active')
       ON DUPLICATE KEY UPDATE name=VALUES(name), age=VALUES(age),
       gender=VALUES(gender),
       symptoms=COALESCE(VALUES(symptoms), symptoms),
       medical_history=COALESCE(VALUES(medical_history), medical_history),
       status='Active', updated_at=CURRENT_TIMESTAMP(3)`,
      [
        patientId,
        patientName,
        age,
        gender,
        symptoms || null,
        medicalHistory || null,
      ],
    );
    const clinicKey = clinicKeyFromText(
      detectedRegion || detectedClinic || bodyRegion,
    );

    /*
     * A case the AI could not clear goes straight into the review queue,
     * anything else waits for the doctor in the normal order.
     */
    const needsDoctorReview = [
      "ABNORMAL",
      "UNCERTAIN",
      "NOT_ANALYZED",
    ].includes(String(triageResult || "").trim().toUpperCase());

    const studyStatus = needsDoctorReview
      ? "Needs Review"
      : normalizedPriority === "Urgent"
        ? "Urgent"
        : "Waiting";

    await sql.execute(
      `INSERT INTO study
       (id, patient_id, body_region, imaging_view, priority, clinical_notes,
        symptoms, medical_history,
        image_path, original_file_name, file_type, file_size, status, uploaded_by, clinic_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studyId, patientId, bodyRegion, imagingView, normalizedPriority,
        clinicalNotes || null, symptoms || null, medicalHistory || null,
        relativeFilePath, imageFile.name,
        imageFile.type || (isDicom ? "application/dicom" : null),
        imageFile.size, studyStatus,
        sessionUser.id, clinicKey],
    );
    const savedPredictedFinding =
      predictedFinding ||
      primaryFinding ||
      triageResult;

    const aiDetails: AiDetailsPayload = {
      schemaVersion: 2,
      triageResult:
        triageResult ||
        savedPredictedFinding ||
        "NOT_ANALYZED",
      primaryFinding,
      possibleFindings,
      allFindings,
      aiPriority,
      detectedRegion:
        detectedRegion || bodyRegion,
      detectedClinic:
        detectedClinic || clinicKey,
      message: aiExplanation,
    };

    if (savedPredictedFinding) {
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
          savedPredictedFinding,
          confidence,
          modelName,
          modelVersion,
          JSON.stringify(aiDetails),
        ]
      );
    }

    await notifyAboutNewStudy({
      studyId,
      patientId,
      patientName,
      bodyRegion,
      clinicKey,
      triageResult: aiDetails.triageResult,
      primaryFinding:
        aiDetails.primaryFinding || savedPredictedFinding,
    });

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
          priority: normalizedPriority,
          status: studyStatus,
          aiResult: savedPredictedFinding
            ? {
                predictedFinding:
                  savedPredictedFinding,
                triageResult:
                  aiDetails.triageResult,
                primaryFinding:
                  aiDetails.primaryFinding,
                possibleFindings:
                  aiDetails.possibleFindings,
                allFindings:
                  aiDetails.allFindings,
                aiPriority:
                  aiDetails.aiPriority,
                detectedRegion:
                  aiDetails.detectedRegion,
                detectedClinic:
                  aiDetails.detectedClinic,
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

    /*
     * The doctor clinic page calls:
     *   /studies?clinic=chest
     *
     * When a clinic is supplied, return the studies of that clinic that
     * still need a doctor: an abnormal result, an uncertain one, or a
     * region that has no AI model yet. Only clearly normal studies stay
     * out of the queue. Requests without a clinic keep returning all
     * studies, so the patient/admin study pages continue to work.
     */
    const { searchParams } = new URL(request.url);
    const clinic = searchParams
      .get("clinic")
      ?.trim()
      .toLowerCase();

    const whereConditions: string[] = [];
    const queryValues: string[] = [];

    await databaseReady;

    /*
     * Studies are patient data, so the list is always limited to what
     * the signed in user is allowed to see: a patient sees only their
     * own studies, a doctor only the studies of their own clinic, and
     * an administrator sees all of them.
     */
    const sessionRoles = getUserRoles(
      (session.user as SessionUserWithRole).role
    );

    if (!sessionRoles.includes("admin")) {
      if (sessionRoles.includes("doctor")) {
        const [profileRows] = await sql.execute(
          `SELECT specialty, subspecialty
           FROM doctor_profile
           WHERE user_id = ?
           LIMIT 1`,
          [String(session.user?.id ?? "")]
        );

        const profile = (profileRows as any[])[0];

        if (!profile) {
          return Response.json(
            {
              success: false,
              message:
                "Doctor profile not found or not approved yet.",
            },
            {
              status: 404,
            }
          );
        }

        whereConditions.push(
          "LOWER(TRIM(s.clinic_key)) = ?"
        );
        queryValues.push(
          clinicKeyFromText(
            `${profile.specialty} ${profile.subspecialty || ""}`
          )
        );
      } else if (sessionRoles.includes("patient")) {
        whereConditions.push("s.patient_id = ?");
        queryValues.push(String(session.user?.id ?? ""));
      } else {
        return Response.json(
          {
            success: false,
            message:
              "You do not have permission to list studies.",
          },
          {
            status: 403,
          }
        );
      }
    }

    if (clinic) {
      whereConditions.push(
        "LOWER(TRIM(s.clinic_key)) = ?"
      );
      queryValues.push(clinic);

      /*
       * New records store the triage result inside the JSON explanation.
       * The predicted_finding fallback keeps older ABNORMAL records working.
       */
      whereConditions.push(
        `UPPER(TRIM(COALESCE(
          CASE
            WHEN JSON_VALID(a.explanation)
            THEN JSON_UNQUOTE(
              JSON_EXTRACT(
                a.explanation,
                '$.triageResult'
              )
            )
            ELSE NULL
          END,
          a.predicted_finding,
          'NOT_ANALYZED'
        ))) <> 'NORMAL'`
      );
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const [result] = await sql.query(
      `SELECT
         s.id,
         s.patient_id AS patientId,
         p.name AS patient,
         s.body_region AS bodyRegion,
         s.imaging_view AS view,
         DATE(s.created_at) AS date,
         s.priority,
         s.status,
         s.created_at AS createdAt,
         s.clinic_key AS clinicKey,
         COALESCE(
           CASE
             WHEN JSON_VALID(a.explanation)
             THEN JSON_UNQUOTE(
               JSON_EXTRACT(
                 a.explanation,
                 '$.triageResult'
               )
             )
             ELSE NULL
           END,
           a.predicted_finding,
           'Not analyzed yet'
         ) AS aiResult,
         a.predicted_finding AS primaryFinding,
         a.confidence
       FROM study s
       JOIN patient p
         ON p.id = s.patient_id
       LEFT JOIN ai_result a
         ON a.study_id = s.id
       ${whereClause}
       ORDER BY s.created_at DESC`,
      queryValues
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