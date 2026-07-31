import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { triageResultExpression } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/*
  Administrative overview: case counters per triage result and status,
  account counters, and the latest sign-in attempts.
*/
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

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      );
    }

    await databaseReady;

    const [studyRows] = await sql.execute(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN UPPER(TRIM(${triageResultExpression})) = 'NORMAL' THEN 1 ELSE 0 END) AS normalCases,
         SUM(CASE WHEN UPPER(TRIM(${triageResultExpression})) = 'ABNORMAL' THEN 1 ELSE 0 END) AS abnormalCases,
         SUM(CASE WHEN UPPER(TRIM(${triageResultExpression})) = 'UNCERTAIN' THEN 1 ELSE 0 END) AS uncertainCases,
         SUM(CASE WHEN s.priority = 'Urgent' THEN 1 ELSE 0 END) AS urgentCases,
         SUM(CASE WHEN s.status = 'Completed' THEN 1 ELSE 0 END) AS completedCases,
         SUM(CASE WHEN s.status = 'Under Review' THEN 1 ELSE 0 END) AS underReviewCases,
         SUM(CASE WHEN s.status IN ('Waiting', 'Needs Review', 'Urgent') THEN 1 ELSE 0 END) AS waitingCases
       FROM study s
       LEFT JOIN ai_result a ON a.study_id = s.id`,
    );

    const studyStats = (studyRows as any[])[0] ?? {};

    const [clinicRows] = await sql.execute(
      `SELECT s.clinic_key AS clinicKey, COUNT(*) AS total
       FROM study s
       GROUP BY s.clinic_key
       ORDER BY total DESC`,
    );

    const [accountRows] = await sql.execute(
      `SELECT
         SUM(CASE WHEN role LIKE '%patient%' THEN 1 ELSE 0 END) AS patients,
         SUM(CASE WHEN role LIKE '%doctor%' THEN 1 ELSE 0 END) AS doctors,
         SUM(CASE WHEN role LIKE '%admin%' THEN 1 ELSE 0 END) AS admins,
         SUM(CASE WHEN banned = TRUE THEN 1 ELSE 0 END) AS banned,
         COUNT(*) AS total
       FROM user`,
    );

    const [requestRows] = await sql.execute(
      `SELECT
         (SELECT COUNT(*) FROM patient_application WHERE status = 'Pending') AS pendingPatients,
         (SELECT COUNT(*) FROM doctor_application WHERE status = 'Pending') AS pendingDoctors,
         (SELECT COUNT(*) FROM report WHERE status = 'Approved') AS approvedReports,
         (SELECT COUNT(*) FROM report WHERE status = 'Draft') AS draftReports,
         (SELECT COUNT(*) FROM appointment WHERE status = 'Pending') AS pendingAppointments`,
    );

    const [loginRows] = await sql.execute(
      `SELECT id, email, success, COALESCE(ip_address, '') AS ipAddress,
         COALESCE(failure_reason, '') AS failureReason, created_at AS createdAt
       FROM login_attempt
       ORDER BY created_at DESC
       LIMIT 50`,
    );

    const [failedRows] = await sql.execute(
      `SELECT COUNT(*) AS failedLastDay
       FROM login_attempt
       WHERE success = FALSE AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)`,
    );

    const toNumber = (value: unknown) => Number(value ?? 0);

    return Response.json({
      success: true,
      studies: {
        total: toNumber(studyStats.total),
        normal: toNumber(studyStats.normalCases),
        abnormal: toNumber(studyStats.abnormalCases),
        uncertain: toNumber(studyStats.uncertainCases),
        urgent: toNumber(studyStats.urgentCases),
        completed: toNumber(studyStats.completedCases),
        underReview: toNumber(studyStats.underReviewCases),
        waiting: toNumber(studyStats.waitingCases),
      },
      clinics: (clinicRows as any[]).map((row) => ({
        clinicKey: row.clinicKey,
        total: toNumber(row.total),
      })),
      accounts: {
        total: toNumber((accountRows as any[])[0]?.total),
        patients: toNumber((accountRows as any[])[0]?.patients),
        doctors: toNumber((accountRows as any[])[0]?.doctors),
        admins: toNumber((accountRows as any[])[0]?.admins),
        banned: toNumber((accountRows as any[])[0]?.banned),
      },
      queue: {
        pendingPatients: toNumber(
          (requestRows as any[])[0]?.pendingPatients,
        ),
        pendingDoctors: toNumber((requestRows as any[])[0]?.pendingDoctors),
        approvedReports: toNumber(
          (requestRows as any[])[0]?.approvedReports,
        ),
        draftReports: toNumber((requestRows as any[])[0]?.draftReports),
        pendingAppointments: toNumber(
          (requestRows as any[])[0]?.pendingAppointments,
        ),
      },
      security: {
        failedLastDay: toNumber((failedRows as any[])[0]?.failedLastDay),
        attempts: (loginRows as any[]).map((row) => ({
          ...row,
          success: Boolean(row.success),
        })),
      },
    });
  } catch (error) {
    console.error("Admin overview API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the admin overview." },
      { status: 500 },
    );
  }
}
