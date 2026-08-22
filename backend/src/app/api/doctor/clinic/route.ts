import { auth } from "@/server/auth/auth";
import {
  CLINIC_DEFINITIONS,
  getClinicDefinition,
  type ClinicKey,
} from "@/server/clinics/clinic-key";
import { clinicScope, doctorClinics } from "@/server/clinics/doctor-clinics";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUser = {
  id?: string;
  role?: string | string[] | null;
};

function normalizeRoles(
  role: SessionUser["role"]
): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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

    const roles = normalizeRoles(session.user?.role);

    if (!roles.includes("doctor")) {
      return Response.json(
        {
          success: false,
          message: "Doctor access is required.",
        },
        {
          status: 403,
        }
      );
    }

    await databaseReady;

    const [doctorRows] = await sql.execute(
      `SELECT full_name, specialty, subspecialty, current_workplace,
         clinics, supported_body_regions AS supportedBodyRegions
       FROM doctor_profile
       WHERE user_id = ?
       LIMIT 1`,
      [session.user?.id],
    );

    const doctorProfile = (doctorRows as any[])[0];

    if (!doctorProfile) {
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
      A doctor can work in several clinics, so the workspace covers all
      of them. The first one names the page; the full list is returned so
      the doctor can see which clinics they are responsible for.
    */
    const assignedClinics = doctorClinics(doctorProfile);
    const clinic = getClinicDefinition(assignedClinics[0]);
    const caseScope = clinicScope("s.clinic_key", assignedClinics);
    const statScope = clinicScope("clinic_key", assignedClinics);

    const [casesRows] = await sql.execute(
      `SELECT s.id, p.name AS patient_name,
       COALESCE(s.patient_age, p.age) AS patient_age,
       COALESCE(s.patient_gender, p.gender) AS patient_gender,
       s.body_region, s.imaging_view,
       s.priority, s.status, COALESCE(a.predicted_finding, 'Not analyzed yet') AS predicted_finding,
       s.clinical_notes, s.original_file_name, s.created_at
       FROM study s
       JOIN patient p ON p.id = s.patient_id
       LEFT JOIN ai_result a ON a.study_id = s.id
       WHERE ${caseScope.condition}
       ORDER BY s.created_at DESC`,
      caseScope.values,
    );

    const cases = (casesRows as any[]).map((caseRow) => ({
      ...caseRow,
      patient_age: Number(caseRow.patient_age),
    }));

    const [statsRows] = await sql.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'Urgent' THEN 1 ELSE 0 END) AS urgent,
         SUM(CASE WHEN status = 'Waiting' THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN status = 'Reviewed' THEN 1 ELSE 0 END) AS reviewed
       FROM study
       WHERE ${statScope.condition}`,
      statScope.values,
    );

    const stats = (statsRows as any[])[0] || {
      total: 0,
      urgent: 0,
      waiting: 0,
      reviewed: 0,
    };

    const [appointmentsRows] = await sql.execute(
      `SELECT a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
       a.status, COALESCE(a.notes, '') AS notes,
       p.name AS patient_name, s.priority
       FROM appointment a
       JOIN study s ON s.id = a.study_id
       JOIN patient p ON p.id = a.patient_id
       WHERE a.doctor_id = ?
       ORDER BY a.scheduled_at ASC
       LIMIT 10`,
      [session.user?.id],
    );

    return Response.json({
      success: true,
      profile: {
        full_name: doctorProfile.full_name,
        specialty: doctorProfile.specialty,
        subspecialty: doctorProfile.subspecialty,
        current_workplace: doctorProfile.current_workplace,
        status: "Active",
      },
      clinic,
      clinics: assignedClinics.map((key) => {
        const definition = getClinicDefinition(key);

        return {
          key: definition.key,
          name: definition.name,
          description: definition.description,
        };
      }),
      cases,
      stats: {
        total: Number(stats.total ?? 0),
        urgent: Number(stats.urgent ?? 0),
        waiting: Number(stats.waiting ?? 0),
        reviewed: Number(stats.reviewed ?? 0),
      },
      appointments: appointmentsRows as any[],
    });
  } catch (error) {
    console.error("Doctor clinic API error:", error);

    return Response.json(
      {
        success: false,
        message:
          "Unable to load the doctor clinic workspace.",
      },
      {
        status: 500,
      }
    );
  }
}
