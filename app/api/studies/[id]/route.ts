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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type StudyRow = {
  id: string;
  patientId: string;
  patientName: string;
  age: number;
  gender: string;
  phone: string;
  email: string;
  bodyRegion: string;
  imagingView: string;
  priority: string;
  clinicalNotes: string;
  originalFileName: string;
  fileType: string | null;
  fileSize: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  aiResult: string;
  confidence: number | null;
  explanation: string;
  reportId: string | null;
  reportStatus: string | null;
  reportFindings: string;
  reportImpression: string;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
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

    const { id } = await context.params;
    const studyId = decodeURIComponent(id).trim();

    if (!studyId) {
      return Response.json(
        {
          success: false,
          message: "Invalid study ID.",
        },
        {
          status: 400,
        }
      );
    }

    const study = database
      .prepare(
        `
          SELECT
            study.id,
            study.patient_id AS patientId,
            patient.name AS patientName,
            patient.age,
            patient.gender,
            COALESCE(patient.phone, '') AS phone,
            COALESCE(patient.email, '') AS email,
            study.body_region AS bodyRegion,
            study.imaging_view AS imagingView,
            study.priority,
            COALESCE(
              study.clinical_notes,
              ''
            ) AS clinicalNotes,
            study.original_file_name AS originalFileName,
            study.file_type AS fileType,
            study.file_size AS fileSize,
            study.status,
            study.created_at AS createdAt,
            study.updated_at AS updatedAt,

            COALESCE(
              ai_result.predicted_finding,
              'Not analyzed yet'
            ) AS aiResult,

            ai_result.confidence,

            COALESCE(
              ai_result.explanation,
              ''
            ) AS explanation,

            report.id AS reportId,
            report.status AS reportStatus,

            COALESCE(
              report.findings,
              ''
            ) AS reportFindings,

            COALESCE(
              report.impression,
              ''
            ) AS reportImpression

          FROM study

          INNER JOIN patient
            ON patient.id = study.patient_id

          LEFT JOIN ai_result
            ON ai_result.study_id = study.id

          LEFT JOIN report
            ON report.study_id = study.id

          WHERE study.id = ?
        `
      )
      .get(studyId) as StudyRow | undefined;

    if (!study) {
      return Response.json(
        {
          success: false,
          message: "Study not found.",
        },
        {
          status: 404,
        }
      );
    }

    return Response.json({
      success: true,
      study,
    });
  } catch (error) {
    console.error(
      "Get study details API error:",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          "Unable to load the study details.",
      },
      {
        status: 500,
      }
    );
  }
}