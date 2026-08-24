import type { ClinicKey } from "@/server/clinics/clinic-key";
import { doctorCaseScope, doctorClinics } from "@/server/clinics/doctor-clinics";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { normalizeRoles } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Lists the medical reports the signed in user may see:
  a doctor sees the reports of their own clinic, a patient sees only the
  approved reports of their own studies, and an admin sees all of them.
*/
/*
  Narrows a doctor to one of their own clinics when the screen asks for
  it. The requested clinic is intersected with what the doctor already
  covers, never added to it: a link can focus the view, it can never
  widen what the doctor is allowed to see.
*/
function narrowToRequestedClinic(
  clinics: ClinicKey[],
  requested: string | null,
) {
  const wanted = String(requested ?? "").trim().toLowerCase();

  if (!wanted) return clinics;

  return clinics.filter((clinic) => clinic === wanted);
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isAdmin = roles.includes("admin");
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isAdmin && !isDoctor && !isPatient) {
      return Response.json(
        { success: false, message: "You are not allowed to see reports." },
        { status: 403 },
      );
    }

    await databaseReady;

    let scopeClause = "";
    const scopeValues: string[] = [];

    if (!isAdmin && isDoctor) {
      const [profileRows] = await sql.execute(
        `SELECT id, specialty, subspecialty, clinics,
           supported_body_regions AS supportedBodyRegions
         FROM doctor_profile
         WHERE user_id = ? LIMIT 1`,
        [String(session.user?.id ?? "")],
      );

      const profile = (profileRows as any[])[0];

      if (!profile) {
        return Response.json(
          {
            success: false,
            message: "Doctor profile not found or not approved yet.",
          },
          { status: 404 },
        );
      }

      const scope = doctorCaseScope(
        "s.clinic_key",
        "s.doctor_id",
        narrowToRequestedClinic(
          doctorClinics(profile),
          new URL(request.url).searchParams.get("clinic"),
        ),
        String(profile.id ?? ""),
      );

      scopeClause = `WHERE ${scope.condition}`;
      scopeValues.push(...scope.values);
    } else if (!isAdmin && isPatient) {
      scopeClause = "WHERE s.patient_id = ? AND r.status = 'Approved'";
      scopeValues.push(String(session.user?.id ?? ""));
    }

    const [reportRows] = await sql.execute(
      `SELECT r.id, r.study_id AS studyId, p.name AS patient,
         s.patient_id AS patientId, s.body_region AS bodyRegion,
         s.clinic_key AS clinicKey, s.priority,
         COALESCE(r.final_finding, '') AS finalFinding,
         COALESCE(r.impression, '') AS impression,
         COALESCE(r.severity, '') AS severity,
         COALESCE(r.ai_agreement, '') AS aiAgreement,
         r.follow_up_required AS followUpRequired,
         COALESCE(dp.full_name, '') AS doctor,
         r.status, r.approved_at AS approvedAt, r.created_at AS createdAt,
         COALESCE(a.predicted_finding, '') AS aiFinding
       FROM report r
       JOIN study s ON s.id = r.study_id
       JOIN patient p ON p.id = s.patient_id
       LEFT JOIN doctor_profile dp ON dp.user_id = r.radiologist_id
       LEFT JOIN ai_result a ON a.study_id = s.id
       ${scopeClause}
       ORDER BY r.updated_at DESC
       LIMIT 200`,
      scopeValues,
    );

    const reports = (reportRows as any[]).map((row) => ({
      ...row,
      followUpRequired: Boolean(row.followUpRequired),
    }));

    return Response.json({
      success: true,
      role: isAdmin ? "admin" : isDoctor ? "doctor" : "patient",
      reports,
      counts: {
        total: reports.length,
        draft: reports.filter((item) => item.status === "Draft").length,
        approved: reports.filter((item) => item.status === "Approved")
          .length,
      },
    });
  } catch (error) {
    console.error("List reports API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the reports." },
      { status: 500 },
    );
  }
}
