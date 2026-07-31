import { clinicKeyFromText } from "@/server/clinics/clinic-key";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import {
  isAbnormalTriage,
  normalizeRoles,
  triageResultExpression,
} from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Lists the follow-up conversations of the signed in user. A case shows up
  when the AI flagged it as abnormal, or when somebody already wrote a
  message about it.
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

    const roles = normalizeRoles(session.user?.role);
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isDoctor && !isPatient) {
      return Response.json(
        {
          success: false,
          message: "Doctor or patient access is required.",
        },
        { status: 403 },
      );
    }

    await databaseReady;

    const viewerRole = isDoctor ? "doctor" : "patient";

    let scopeCondition = "s.patient_id = ?";
    let scopeValue = String(session.user?.id ?? "");

    if (isDoctor) {
      const [profileRows] = await sql.execute(
        `SELECT specialty, subspecialty
         FROM doctor_profile
         WHERE user_id = ?
         LIMIT 1`,
        [session.user?.id],
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

      scopeCondition = "s.clinic_key = ?";
      scopeValue = clinicKeyFromText(
        `${profile.specialty} ${profile.subspecialty || ""}`,
      );
    }

    const [caseRows] = await sql.execute(
      `SELECT s.id AS studyId, s.patient_id AS patientId, p.name AS patientName,
         s.body_region AS bodyRegion, s.imaging_view AS imagingView,
         s.priority, s.status, s.created_at AS createdAt,
         ${triageResultExpression} AS triageResult,
         a.predicted_finding AS primaryFinding, a.confidence,
         (SELECT m.message FROM case_message m
          WHERE m.study_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
         (SELECT m.sender_role FROM case_message m
          WHERE m.study_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessageRole,
         (SELECT m.created_at FROM case_message m
          WHERE m.study_id = s.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessageAt,
         (SELECT COUNT(*) FROM case_message m
          WHERE m.study_id = s.id AND m.is_read = FALSE
            AND m.sender_role <> ?) AS unreadCount
       FROM study s
       JOIN patient p ON p.id = s.patient_id
       LEFT JOIN ai_result a ON a.study_id = s.id
       WHERE ${scopeCondition}
       HAVING UPPER(TRIM(triageResult)) IN ('ABNORMAL', 'UNCERTAIN', 'NOT_ANALYZED')
         OR lastMessageAt IS NOT NULL
       ORDER BY COALESCE(lastMessageAt, s.created_at) DESC
       LIMIT 100`,
      [viewerRole, scopeValue],
    );

    const cases = (caseRows as any[]).map((row) => ({
      studyId: row.studyId,
      patientId: row.patientId,
      patientName: row.patientName,
      bodyRegion: row.bodyRegion,
      imagingView: row.imagingView,
      priority: row.priority,
      status: row.status,
      createdAt: row.createdAt,
      triageResult: row.triageResult,
      isAbnormal: isAbnormalTriage(row.triageResult),
      primaryFinding: row.primaryFinding,
      confidence: row.confidence,
      lastMessage: row.lastMessage ?? "",
      lastMessageRole: row.lastMessageRole ?? "",
      lastMessageAt: row.lastMessageAt,
      unreadCount: Number(row.unreadCount ?? 0),
    }));

    return Response.json({
      success: true,
      role: viewerRole,
      cases,
      unreadTotal: cases.reduce(
        (total, item) => total + item.unreadCount,
        0,
      ),
    });
  } catch (error) {
    console.error("Load cases API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the case list." },
      { status: 500 },
    );
  }
}
