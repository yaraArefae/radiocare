import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { resolveCaseAccess } from "@/server/messaging/case-access";
import { createNotification } from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/*
  How the doctor judged the preliminary AI result. The medical decision
  always belongs to the doctor, so the report keeps both values.
*/
const aiAgreementValues = ["Confirmed", "Modified", "Rejected"] as const;
const severityValues = ["Low", "Moderate", "High", "Critical"] as const;
const reportStatusValues = ["Draft", "Approved"] as const;

function pickValue<T extends readonly string[]>(
  allowed: T,
  value: unknown,
): T[number] | null {
  const text = String(value ?? "").trim();

  return (allowed as readonly string[]).includes(text)
    ? (text as T[number])
    : null;
}

function readText(value: unknown, maximumLength = 4000) {
  return typeof value === "string"
    ? value.trim().slice(0, maximumLength)
    : "";
}

/*
  Returns the report of a study. The patient only receives it once the
  doctor approved it, so an unfinished draft never reaches them.
*/
export async function GET(request: Request, context: RouteContext) {
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

    const { id } = await context.params;
    const studyId = String(id || "").trim();

    await databaseReady;

    const access = await resolveCaseAccess(session.user, studyId);

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    const [reportRows] = await sql.execute(
      `SELECT r.id, r.study_id AS studyId, r.radiologist_id AS doctorId,
         COALESCE(dp.full_name, '') AS doctorName,
         COALESCE(r.findings, '') AS findings,
         COALESCE(r.impression, '') AS impression,
         COALESCE(r.recommendations, '') AS recommendations,
         COALESCE(r.ai_agreement, '') AS aiAgreement,
         COALESCE(r.final_finding, '') AS finalFinding,
         COALESCE(r.severity, '') AS severity,
         r.follow_up_required AS followUpRequired,
         COALESCE(r.additional_tests, '') AS additionalTests,
         COALESCE(r.doctor_notes, '') AS doctorNotes,
         r.status, r.approved_at AS approvedAt,
         r.created_at AS createdAt, r.updated_at AS updatedAt
       FROM report r
       LEFT JOIN doctor_profile dp ON dp.user_id = r.radiologist_id
       WHERE r.study_id = ?
       LIMIT 1`,
      [studyId],
    );

    const report = (reportRows as any[])[0] ?? null;

    if (report) {
      report.followUpRequired = Boolean(report.followUpRequired);
    }

    /*
      A draft belongs to the doctor only.
    */
    if (access.role === "patient" && report?.status !== "Approved") {
      return Response.json({
        success: true,
        report: null,
        pending: Boolean(report),
        message: report
          ? "Your doctor is still preparing the report."
          : "No report has been written for this study yet.",
      });
    }

    return Response.json({ success: true, report, pending: false });
  } catch (error) {
    console.error("Load report API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the report." },
      { status: 500 },
    );
  }
}

/*
  Creates or updates the report. Only the doctor of the clinic that owns
  the study may write it, and approving it completes the study.
*/
export async function PUT(request: Request, context: RouteContext) {
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

    const { id } = await context.params;
    const studyId = String(id || "").trim();

    const body = (await request.json()) as Record<string, unknown>;

    await databaseReady;

    const access = await resolveCaseAccess(session.user, studyId);

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    if (access.role !== "doctor") {
      return Response.json(
        {
          success: false,
          message: "Only the reviewing doctor may write the report.",
        },
        { status: 403 },
      );
    }

    const status = pickValue(reportStatusValues, body.status) ?? "Draft";
    const aiAgreement = pickValue(aiAgreementValues, body.aiAgreement);
    const severity = pickValue(severityValues, body.severity);
    const findings = readText(body.findings);
    const impression = readText(body.impression);
    const recommendations = readText(body.recommendations);
    const finalFinding = readText(body.finalFinding, 255);
    const additionalTests = readText(body.additionalTests);
    const doctorNotes = readText(body.doctorNotes);
    const followUpRequired = body.followUpRequired === true;

    /*
      An approved report is the medical decision of the case, so the
      essential fields cannot stay empty.
    */
    if (status === "Approved") {
      const missingFields = [
        !aiAgreement && "the decision about the AI result",
        !finalFinding && "the final finding",
        !impression && "the impression",
      ].filter(Boolean);

      if (missingFields.length > 0) {
        return Response.json(
          {
            success: false,
            message: `Before approving the report please fill in ${missingFields.join(
              ", ",
            )}.`,
          },
          { status: 400 },
        );
      }
    }

    const [existingRows] = await sql.execute(
      "SELECT id, status FROM report WHERE study_id = ? LIMIT 1",
      [studyId],
    );

    const existingReport = (existingRows as any[])[0];

    if (existingReport?.status === "Approved" && status === "Draft") {
      return Response.json(
        {
          success: false,
          message: "An approved report cannot be moved back to draft.",
        },
        { status: 409 },
      );
    }

    const reportId =
      existingReport?.id ??
      `RP-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;

    const values = [
      findings || null,
      impression || null,
      recommendations || null,
      aiAgreement,
      finalFinding || null,
      severity,
      followUpRequired,
      additionalTests || null,
      doctorNotes || null,
      status,
      String(session.user?.id ?? ""),
    ];

    if (existingReport) {
      await sql.execute(
        `UPDATE report
         SET findings = ?, impression = ?, recommendations = ?, ai_agreement = ?,
           final_finding = ?, severity = ?, follow_up_required = ?,
           additional_tests = ?, doctor_notes = ?, status = ?, radiologist_id = ?,
           approved_at = CASE WHEN ? = 'Approved' THEN CURRENT_TIMESTAMP(3) ELSE approved_at END,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [...values, status, reportId],
      );
    } else {
      await sql.execute(
        `INSERT INTO report
         (id, study_id, findings, impression, recommendations, ai_agreement,
          final_finding, severity, follow_up_required, additional_tests,
          doctor_notes, status, radiologist_id, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           CASE WHEN ? = 'Approved' THEN CURRENT_TIMESTAMP(3) ELSE NULL END)`,
        [reportId, studyId, ...values, status],
      );
    }

    /*
      The study moves along its lifecycle together with the report.
    */
    await sql.execute(
      "UPDATE study SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [status === "Approved" ? "Completed" : "Under Review", studyId],
    );

    if (status === "Approved") {
      await createNotification({
        userId: access.study.patientId,
        userRole: "patient",
        type: "new_case",
        title: "Your medical report is ready",
        body: `${access.doctorName ?? "Your doctor"} completed the review of your ${
          access.study.bodyRegion
        } image. Final finding: ${finalFinding}.`,
        link: "/patients/dashboard",
        studyId,
      });
    }

    return Response.json({
      success: true,
      report: {
        id: reportId,
        studyId,
        findings,
        impression,
        recommendations,
        aiAgreement,
        finalFinding,
        severity,
        followUpRequired,
        additionalTests,
        doctorNotes,
        status,
        doctorName: access.doctorName,
      },
      studyStatus: status === "Approved" ? "Completed" : "Under Review",
    });
  } catch (error) {
    console.error("Save report API error:", error);

    return Response.json(
      { success: false, message: "Unable to save the report." },
      { status: 500 },
    );
  }
}
