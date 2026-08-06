import { auth } from "@/server/auth/auth";
import { getClinicDefinition } from "@/server/clinics/clinic-key";
import { databaseReady, sql } from "@/server/database/database";
import { triageResultExpression } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/*
  The whole record of one patient, for an administrator.

  Everything the application knows about the patient is gathered here:
  the account, the registration request it came from, every study with
  the clinic it went to, the reports, the appointments, and the follow-up
  conversation. Before this the administrator could approve a patient but
  could not see a single thing that happened afterwards.
*/
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const patientId = String(id || "").trim();

    await databaseReady;

    const [patientRows] = await sql.execute(
      `SELECT p.id, p.name, p.age, p.gender,
         COALESCE(p.phone, '') AS phone,
         COALESCE(p.email, '') AS email,
         COALESCE(p.symptoms, '') AS symptoms,
         COALESCE(p.medical_history, '') AS medicalHistory,
         p.status, p.created_at AS createdAt,
         u.email AS loginEmail, u.createdAt AS accountCreatedAt,
         COALESCE(u.banned, FALSE) AS suspended,
         COALESCE(u.mustChangePassword, FALSE) AS mustChangePassword,
         u.passwordExpiresAt AS passwordExpiresAt
       FROM patient p
       LEFT JOIN user u ON u.id = p.id
       WHERE p.id = ?
       LIMIT 1`,
      [patientId],
    );

    const patient = (patientRows as any[])[0];

    if (!patient) {
      return Response.json(
        { success: false, message: "Patient not found." },
        { status: 404 },
      );
    }

    const [applicationRows] = await sql.execute(
      `SELECT id, status, rejection_reason AS rejectionReason,
         reviewed_at AS reviewedAt, created_at AS createdAt
       FROM patient_application
       WHERE approved_user_id = ? OR LOWER(email) = LOWER(?)
       ORDER BY created_at DESC`,
      [patientId, patient.loginEmail ?? patient.email ?? ""],
    );

    const [studyRows] = await sql.execute(
      `SELECT s.id, s.body_region AS bodyRegion, s.imaging_view AS imagingView,
         s.clinic_key AS clinicKey, s.priority, s.status,
         s.created_at AS createdAt,
         ${triageResultExpression} AS triageResult,
         a.predicted_finding AS primaryFinding, a.confidence,
         (SELECT COUNT(*) FROM case_message m WHERE m.study_id = s.id)
           AS messageCount,
         (SELECT COUNT(*) FROM report r WHERE r.study_id = s.id)
           AS reportCount
       FROM study s
       LEFT JOIN ai_result a ON a.study_id = s.id
       WHERE s.patient_id = ?
       ORDER BY s.created_at DESC`,
      [patientId],
    );

    const [reportRows] = await sql.execute(
      `SELECT r.id, r.study_id AS studyId, r.status,
         COALESCE(r.final_finding, '') AS finalFinding,
         COALESCE(r.impression, '') AS impression,
         COALESCE(r.severity, '') AS severity,
         COALESCE(r.ai_agreement, '') AS aiAgreement,
         COALESCE(r.follow_up_required, FALSE) AS followUpRequired,
         r.created_at AS createdAt,
         COALESCE(dp.full_name, u.name, '') AS doctorName
       FROM report r
       LEFT JOIN user u ON u.id = r.radiologist_id
       LEFT JOIN doctor_profile dp ON dp.user_id = r.radiologist_id
       WHERE r.study_id IN (SELECT id FROM study WHERE patient_id = ?)
       ORDER BY r.created_at DESC`,
      [patientId],
    );

    const [appointmentRows] = await sql.execute(
      `SELECT a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
         a.status, COALESCE(a.notes, '') AS notes,
         COALESCE(dp.full_name, u.name, '') AS doctorName
       FROM appointment a
       LEFT JOIN user u ON u.id = a.doctor_id
       LEFT JOIN doctor_profile dp ON dp.user_id = a.doctor_id
       WHERE a.patient_id = ?
       ORDER BY a.scheduled_at DESC`,
      [patientId],
    );

    /*
      The doctors this patient actually dealt with, so an administrator
      answering a complaint can see who handled the case.
    */
    const [contactRows] = await sql.execute(
      `SELECT COALESCE(dp.full_name, u.name, '') AS doctorName,
         u.email AS doctorEmail, dp.clinics,
         COUNT(*) AS messageCount,
         MAX(m.created_at) AS lastMessageAt
       FROM case_message m
       JOIN study s ON s.id = m.study_id
       JOIN user u ON u.id = m.sender_id
       LEFT JOIN doctor_profile dp ON dp.user_id = m.sender_id
       WHERE s.patient_id = ? AND m.sender_role = 'doctor'
       GROUP BY doctorName, doctorEmail, dp.clinics`,
      [patientId],
    );

    const studies = (studyRows as any[]).map((study) => ({
      ...study,
      clinicName: getClinicDefinition(study.clinicKey).name,
      messageCount: Number(study.messageCount ?? 0),
      reportCount: Number(study.reportCount ?? 0),
    }));

    return Response.json({
      success: true,
      patient: {
        ...patient,
        age: Number(patient.age),
        suspended: Boolean(patient.suspended),
        mustChangePassword: Boolean(patient.mustChangePassword),
      },
      applications: applicationRows,
      studies,
      reports: (reportRows as any[]).map((report) => ({
        ...report,
        followUpRequired: Boolean(report.followUpRequired),
      })),
      appointments: appointmentRows,
      doctorsInContact: (contactRows as any[]).map((row) => ({
        ...row,
        messageCount: Number(row.messageCount ?? 0),
      })),
      counters: {
        studies: studies.length,
        reports: (reportRows as unknown[]).length,
        appointments: (appointmentRows as unknown[]).length,
        needingReview: studies.filter(
          (study) =>
            String(study.triageResult || "").toUpperCase() !== "NORMAL" &&
            !String(study.status || "")
              .toLowerCase()
              .includes("completed"),
        ).length,
      },
    });
  } catch (error) {
    console.error("Admin patient record API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the patient record." },
      { status: 500 },
    );
  }
}
