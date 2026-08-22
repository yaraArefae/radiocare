import { randomUUID } from "node:crypto";
import {
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { resolveClinicKey, type ClinicKey } from "@/server/clinics/clinic-key";
import {
  clinicScope,
  doctorClinics,
  servesClinic,
} from "@/server/clinics/doctor-clinics";
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
  /*
   * Sent only by a model that answers normal or abnormal without naming
   * a finding, which is why its finding lists arrive empty. The hand
   * model works this way. Without these the study page cannot tell that
   * kind of reading apart from one where findings were looked for and
   * none were found, and it tells the doctor the wrong thing.
   */
  abnormalityProbability?: number;
  decisionThreshold?: number;
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

/*
 * Reads a percentage the AI service sent. Anything that is not a number
 * between 0 and 100 is treated as absent rather than stored, so a
 * malformed field cannot end up drawn on a doctor's screen as a score.
 */
function getPercentageValue(
  formData: FormData,
  fieldName: string
): number | undefined {
  const rawValue = getTextValue(
    formData,
    fieldName
  );

  if (!rawValue) {
    return undefined;
  }

  const value = Number(rawValue);

  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    return undefined;
  }

  return value;
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

/*
  The volumetric formats: a whole CT or MRI in one file rather than a
  single film.

  A browser reports no useful content type for any of them, so unlike a
  JPEG they can only be recognised by their name.
*/
const volumeExtensions = [
  ".nii.gz",
  ".nii",
  ".npy",
];

function getVolumeExtension(fileName: string) {
  const lowered = fileName.toLowerCase();

  return (
    volumeExtensions.find((extension) =>
      lowered.endsWith(extension)
    ) ?? ""
  );
}

function getFileExtension(file: File) {
  /*
    ".nii.gz" is two extensions, and path.extname sees only the ".gz",
    so the volumetric names are matched whole and before anything else.
  */
  const volumeExtension = getVolumeExtension(
    file.name
  );

  if (volumeExtension) {
    return volumeExtension;
  }

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
  const triage = study.triageResult.trim().toUpperCase();
  const isAbnormal = triage === "ABNORMAL";

  /*
    The doctors of the clinic are told about every case that is not
    clearly normal, which is the same rule their queue uses. Notifying
    only on ABNORMAL left the uncertain and the unanalysed cases sitting
    in the queue with nobody told they had arrived.
  */
  const needsDoctorReview = triage !== "NORMAL";

  /*
    A case that could not be analysed is never described as clear. Only
    a NORMAL result is reported as such, because telling a patient that
    nothing was found when nothing was examined is a false reassurance.
  */
  const patientMessage = isAbnormal
    ? `The preliminary AI analysis of your ${study.bodyRegion} image found ${
        study.primaryFinding || "a possible finding"
      }. A doctor from the matching clinic will review it.`
    : triage === "NORMAL"
      ? `The preliminary AI analysis of your ${study.bodyRegion} image did not detect an abnormality.`
      : `Your ${study.bodyRegion} image could not be judged by the preliminary AI analysis. A doctor from the matching clinic will review it.`;

  const notifications: NewNotification[] = [
    {
      userId: study.patientId,
      userRole: "patient",
      type: "new_case",
      title: needsDoctorReview
        ? "Your X-ray needs a doctor review"
        : "Your X-ray analysis is ready",
      body: patientMessage,
      link: `/studies/${study.studyId}`,
      studyId: study.studyId,
    },
  ];

  if (needsDoctorReview) {
    try {
      const [doctorRows] = await sql.execute(
        `SELECT dp.user_id AS userId, dp.specialty, dp.subspecialty, dp.clinics,
         dp.supported_body_regions AS supportedBodyRegions
         FROM doctor_profile dp
         JOIN user u ON u.id = dp.user_id
         WHERE dp.status = 'Active'`,
      );

      for (const doctor of doctorRows as any[]) {
        if (!servesClinic(doctor, study.clinicKey)) continue;

        notifications.push({
          userId: doctor.userId,
          userRole: "doctor",
          type: "new_case",
          title: isAbnormal
            ? "New abnormal case in your clinic"
            : "New case waiting in your clinic",
          body: `${study.patientName} uploaded a ${study.bodyRegion} image. AI result: ${
            study.primaryFinding || (isAbnormal ? "abnormal" : "not conclusive")
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

    const abnormalityProbability =
      getPercentageValue(
        formData,
        "abnormalityProbability"
      );

    const decisionThreshold =
      getPercentageValue(
        formData,
        "decisionThreshold"
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

    /*
      The doctor the patient picked inside the clinic, when they picked
      one. It stays optional: a patient may leave the choice to the
      clinic, and every study uploaded before doctors could be chosen
      has nobody recorded here.
    */
    const chosenDoctorId = getTextValue(
      formData,
      "doctorId",
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

    const extension =
      getFileExtension(imageFile);

    const isDicom =
      extension === ".dcm";

    /*
      A volume is a stack of hundreds of slices, so the limit that fits
      a single film would reject nearly every real CT.
    */
    const isVolume =
      volumeExtensions.includes(extension);

    const maximumFileSize = isVolume
      ? 300 * 1024 * 1024
      : 20 * 1024 * 1024;

    if (imageFile.size > maximumFileSize) {
      return Response.json(
        {
          success: false,
          message: isVolume
            ? "The study must be smaller than 300 MB."
            : "The image must be smaller than 20 MB.",
        },
        {
          status: 400,
        }
      );
    }

    const allowedImageTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    const isRegularImage =
      allowedImageTypes.includes(
        imageFile.type
      );

    if (
      !isDicom &&
      !isVolume &&
      !isRegularImage
    ) {
      return Response.json(
        {
          success: false,
          message:
            "Only JPG, PNG, WEBP, DICOM and NIfTI (.nii, .nii.gz, .npy) files are allowed.",
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
       ON DUPLICATE KEY UPDATE name=VALUES(name),
       /*
         The age and gender on the patient row are the latest known,
         and the study keeps its own copy of what was entered for it.

         They are still updated here because a person's record should
         show their current age, and a correction typed on a new upload
         is usually a correction. What changed is that this no longer
         reaches backwards: the studies already taken keep the age they
         were taken at, which is the number a doctor read them with.
       */
       age=VALUES(age),
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
    /*
      The body region is the most precise description of the anatomy, so
      it decides the clinic. The clinic reported by the AI service is a
      fallback only: a value like "orthopedic" cannot tell a wrist from
      an ankle, and those are two different clinics now.
    */
    const clinicKey = resolveClinicKey(
      bodyRegion,
      detectedRegion,
      detectedClinic,
    );

    /*
      The chosen doctor is checked against the clinic the study is
      going to, not taken on trust.

      The doctor id arrives in a form field, and a form field is
      whatever the browser sent. Storing it unchecked would let a study
      be addressed to a doctor who does not work in that clinic, or to
      an id that is not a doctor at all, and the case would then sit in
      a queue nobody opens. A mismatch is not an error the patient
      should see: the study still reaches the clinic, and the clinic
      still reads it.
    */
    let assignedDoctorId: string | null = null;

    if (chosenDoctorId) {
      const [doctorRows] = await sql.execute(
        `SELECT id, specialty, subspecialty, clinics,
                supported_body_regions AS supportedBodyRegions
         FROM doctor_profile
         WHERE id = ? AND status = 'Active'`,
        [chosenDoctorId],
      );

      const doctor = (doctorRows as any[])[0];

      if (doctor && servesClinic(doctor, clinicKey)) {
        assignedDoctorId = String(doctor.id);
      } else {
        console.warn(
          `Study upload named doctor ${chosenDoctorId}, who does not ` +
            `serve the ${clinicKey} clinic. Sending it to the clinic.`,
        );
      }
    }

    /*
     * A case the AI could not clear goes straight into the review queue,
     * anything else waits for the doctor in the normal order.
     */
    const needsDoctorReview = [
      "ABNORMAL",
      "UNCERTAIN",
      "NOT_ANALYZED",
    ].includes(String(triageResult || "").trim().toUpperCase());

    /*
     * A clear scan from somebody who is not complaining of anything does
     * not go to a doctor.
     *
     * Every upload used to land in a clinic queue, so a doctor's day
     * filled with scans the AI had already called normal and whose owner
     * had written nothing in the symptoms box. The ones that matter wait
     * behind them.
     *
     * What the patient typed is the second opinion here. The AI reads
     * the picture and nothing else; a person who says their chest hurts
     * is describing something no X-ray carries, and that alone is enough
     * to put the case in front of a doctor even when the model saw
     * nothing. Only the two together - a normal reading and no
     * complaint - close a case.
     *
     * Medical history does not count. A patient recording that they are
     * diabetic is answering "what should a doctor know about you", not
     * "what is wrong with you today".
     *
     * A closed case is not a finished one. It stays in the patient's own
     * records and they can send it to a doctor themselves at any time,
     * which is the route out of a wrong NORMAL.
     */
    const patientReportedSomething = Boolean(
      symptoms && symptoms.trim(),
    );

    const clearedWithoutComplaint =
      !needsDoctorReview && !patientReportedSomething;

    const studyStatus = needsDoctorReview
      ? "Needs Review"
      : clearedWithoutComplaint
        ? "Cleared"
        : normalizedPriority === "Urgent"
          ? "Urgent"
          : "Waiting";

    await sql.execute(
      `INSERT INTO study
       (id, patient_id, body_region, imaging_view, priority, clinical_notes,
        symptoms, medical_history,
        image_path, original_file_name, file_type, file_size, status, uploaded_by, clinic_key,
        study_kind, doctor_id, patient_age, patient_gender)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studyId, patientId, bodyRegion, imagingView, normalizedPriority,
        clinicalNotes || null, symptoms || null, medicalHistory || null,
        relativeFilePath, imageFile.name,
        imageFile.type || (isDicom ? "application/dicom" : null),
        imageFile.size, studyStatus,
        sessionUser.id, clinicKey,
        isVolume ? "VOLUME" : "IMAGE",
        assignedDoctorId,
        /*
          Recorded against this study so a later upload with a different
          age cannot rewrite what a doctor already read.
        */
        age,
        gender],
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
      abnormalityProbability,
      decisionThreshold,
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
        /*
          A closed case has to say so. A patient who uploads a scan and
          is told it was "saved successfully" reasonably expects a doctor
          to read it, and for this one nobody will unless they ask.
        */
        message: clearedWithoutComplaint
          ? "The AI found nothing on this scan and you reported no " +
            "symptoms, so it has not been sent to a doctor. It is saved " +
            "in your records, and you can send it to one whenever you " +
            "want."
          : "The patient and study were saved successfully.",
        sentToDoctor: !clearedWithoutComplaint,
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
     * still need a doctor. Only a case the server closed at upload -
     * read as normal by the AI, with no symptom reported by the patient
     * - stays out. Requests without a clinic keep returning all studies,
     * so the patient and admin study pages continue to work.
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
          `SELECT specialty, subspecialty, clinics,
         supported_body_regions AS supportedBodyRegions
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

        /*
          A doctor sees their whole clinic, including the studies a
          patient addressed to a colleague.

          Hiding those would honour the patient's choice right up to the
          day that doctor is on leave, and then the study would sit in a
          queue nobody opens. The choice is carried in doctorId instead,
          so the doctor a patient picked can be shown their own cases
          first while no case is ever invisible to the clinic that owes
          it a reading.
        */
        const scope = clinicScope("s.clinic_key", doctorClinics(profile));

        whereConditions.push(scope.condition);
        queryValues.push(...scope.values);
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
       * Whether a case belongs in a clinic queue was decided when it was
       * uploaded, out of two things: what the AI saw and what the
       * patient wrote. That decision is the status.
       *
       * This used to re-decide it here, from the AI result alone, and
       * drop every study the model had called normal. A patient who
       * typed that their chest hurts had their study saved as Waiting
       * and then filtered out of the queue on the way to the doctor, so
       * the sentence they wrote reached nobody.
       *
       * 'Cleared' is the only case the server closed: read as normal,
       * and no symptom reported. It is the only one that stays out.
       */
      whereConditions.push("s.status <> 'Cleared'");
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
         s.study_kind AS studyKind,
         s.doctor_id AS doctorId,
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