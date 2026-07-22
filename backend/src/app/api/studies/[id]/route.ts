import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  clinicKey: string;
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

    await databaseReady;
    const [rows] = await sql.execute(
      `SELECT s.id, s.patient_id AS patientId, p.name AS patientName,
       p.age, p.gender, COALESCE(p.phone,'') AS phone, COALESCE(p.email,'') AS email,
       s.body_region AS bodyRegion, s.imaging_view AS imagingView, s.priority,
       COALESCE(s.clinical_notes,'') AS clinicalNotes,
       s.original_file_name AS originalFileName, s.file_type AS fileType,
       s.file_size AS fileSize, s.status, s.clinic_key AS clinicKey, s.created_at AS createdAt,
       s.updated_at AS updatedAt,
       COALESCE(a.predicted_finding,'Not analyzed yet') AS aiResult,
       a.confidence, COALESCE(a.explanation,'') AS explanation,
       r.id AS reportId, r.status AS reportStatus,
       COALESCE(r.findings,'') AS reportFindings,
       COALESCE(r.impression,'') AS reportImpression
       FROM study s JOIN patient p ON p.id=s.patient_id
       LEFT JOIN ai_result a ON a.study_id=s.id
       LEFT JOIN report r ON r.study_id=s.id WHERE s.id=? LIMIT 1`,
      [studyId],
    );
    const study = (rows as StudyRow[])[0];

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
