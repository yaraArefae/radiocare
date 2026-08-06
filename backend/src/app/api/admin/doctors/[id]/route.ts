import { auth } from "@/server/auth/auth";
import { getClinicDefinition } from "@/server/clinics/clinic-key";
import { clinicScope, doctorClinics } from "@/server/clinics/doctor-clinics";
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
  The whole record of one doctor, for an administrator.

  It answers the questions an administrator actually has about a doctor:
  which clinics they work in, what is waiting in those clinics, what they
  have reported and scheduled, and whether patients are waiting for an
  answer from them.
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
    const doctorId = String(id || "").trim();

    await databaseReady;

    const [profileRows] = await sql.execute(
      `SELECT dp.user_id AS doctorId, dp.full_name AS fullName, dp.phone,
         dp.specialty, COALESCE(dp.subspecialty, '') AS subspecialty,
         dp.clinics, dp.license_number AS licenseNumber,
         dp.licensing_authority AS licensingAuthority,
         dp.license_expiry_date AS licenseExpiryDate,
         dp.years_of_experience AS yearsOfExperience,
         dp.current_workplace AS currentWorkplace,
         dp.supported_body_regions AS supportedBodyRegions,
         dp.status, dp.created_at AS createdAt,
         u.email, u.createdAt AS accountCreatedAt,
         COALESCE(u.banned, FALSE) AS suspended,
         COALESCE(u.mustChangePassword, FALSE) AS mustChangePassword
       FROM doctor_profile dp
       JOIN user u ON u.id = dp.user_id
       WHERE dp.user_id = ?
       LIMIT 1`,
      [doctorId],
    );

    const profile = (profileRows as any[])[0];

    if (!profile) {
      return Response.json(
        { success: false, message: "Doctor not found." },
        { status: 404 },
      );
    }

    const clinics = doctorClinics(profile);
    const scope = clinicScope("s.clinic_key", clinics);

    /*
      What is sitting in this doctor's clinics right now, split into what
      still waits for them and what is finished.
    */
    const [caseRows] = await sql.execute(
      `SELECT s.id, s.body_region AS bodyRegion, s.clinic_key AS clinicKey,
         s.priority, s.status, s.created_at AS createdAt,
         p.name AS patientName, s.patient_id AS patientId,
         ${triageResultExpression} AS triageResult,
         a.predicted_finding AS primaryFinding,
         (SELECT COUNT(*) FROM case_message m
          WHERE m.study_id = s.id AND m.sender_role = 'patient'
            AND m.is_read = FALSE) AS unansweredMessages,
         (SELECT COUNT(*) FROM report r WHERE r.study_id = s.id)
           AS reportCount
       FROM study s
       JOIN patient p ON p.id = s.patient_id
       LEFT JOIN ai_result a ON a.study_id = s.id
       WHERE ${scope.condition}
       ORDER BY s.created_at DESC`,
      scope.values,
    );

    const [reportRows] = await sql.execute(
      `SELECT r.id, r.study_id AS studyId, r.status,
         COALESCE(r.final_finding, '') AS finalFinding,
         COALESCE(r.severity, '') AS severity,
         COALESCE(r.ai_agreement, '') AS aiAgreement,
         r.created_at AS createdAt, p.name AS patientName
       FROM report r
       JOIN study s ON s.id = r.study_id
       JOIN patient p ON p.id = s.patient_id
       WHERE r.radiologist_id = ?
       ORDER BY r.created_at DESC`,
      [doctorId],
    );

    const [appointmentRows] = await sql.execute(
      `SELECT a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
         a.status, COALESCE(a.notes, '') AS notes, p.name AS patientName
       FROM appointment a
       JOIN patient p ON p.id = a.patient_id
       WHERE a.doctor_id = ?
       ORDER BY a.scheduled_at DESC`,
      [doctorId],
    );

    const [messageRows] = await sql.execute(
      `SELECT COUNT(*) AS sent, MAX(created_at) AS lastAt
       FROM case_message
       WHERE sender_id = ? AND sender_role = 'doctor'`,
      [doctorId],
    );

    const cases = (caseRows as any[]).map((row) => ({
      ...row,
      clinicName: getClinicDefinition(row.clinicKey).name,
      unansweredMessages: Number(row.unansweredMessages ?? 0),
      reportCount: Number(row.reportCount ?? 0),
    }));

    const isFinished = (status: string) =>
      ["completed", "reviewed", "approved"].some((value) =>
        String(status || "").toLowerCase().includes(value),
      );

    const waiting = cases.filter(
      (row) =>
        String(row.triageResult || "").toUpperCase() !== "NORMAL" &&
        !isFinished(row.status),
    );

    return Response.json({
      success: true,
      doctor: {
        ...profile,
        suspended: Boolean(profile.suspended),
        mustChangePassword: Boolean(profile.mustChangePassword),
        yearsOfExperience: Number(profile.yearsOfExperience ?? 0),
      },
      clinics: clinics.map((key) => {
        const definition = getClinicDefinition(key);

        return {
          key: definition.key,
          name: definition.name,
          patientRegions: definition.patientRegions,
          caseCount: cases.filter((row) => row.clinicKey === key).length,
        };
      }),
      cases,
      waitingCases: waiting,
      reports: reportRows,
      appointments: appointmentRows,
      counters: {
        clinics: clinics.length,
        cases: cases.length,
        waiting: waiting.length,
        reports: (reportRows as unknown[]).length,
        appointments: (appointmentRows as unknown[]).length,
        messagesSent: Number((messageRows as any[])[0]?.sent ?? 0),
        /*
          Patient messages nobody has opened yet. A number above zero
          means patients in these clinics are still waiting for a reply.
        */
        unansweredMessages: cases.reduce(
          (total, row) => total + row.unansweredMessages,
          0,
        ),
      },
    });
  } catch (error) {
    console.error("Admin doctor record API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the doctor record." },
      { status: 500 },
    );
  }
}
