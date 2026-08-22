import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ReviewableRow = {
  studyId: string;
  patientId: string;
  reportStatus: string | null;
  doctorProfileId: string | null;
  doctorName: string | null;
  existingRating: number | null;
};

/*
  Finds the doctor a patient may rate for one study, and whether they
  already have.

  The doctor rated is the one who signed the report, not the one the
  patient picked when they uploaded. A patient who chose Dr A and was
  read by Dr B is rating the reading they received, and crediting it to
  the doctor who never saw the study would make every rating on the site
  a guess. Where no report is signed yet there is nothing to rate.
*/
async function loadReviewable(
  studyId: string,
): Promise<ReviewableRow | null> {
  const [rows] = await sql.execute(
    `SELECT s.id AS studyId, s.patient_id AS patientId,
            r.status AS reportStatus,
            COALESCE(signer.id, chosen.id) AS doctorProfileId,
            COALESCE(signer.full_name, chosen.full_name) AS doctorName,
            v.rating AS existingRating
     FROM study s
     LEFT JOIN report r ON r.study_id = s.id
     LEFT JOIN doctor_profile signer ON signer.user_id = r.radiologist_id
     LEFT JOIN doctor_profile chosen ON chosen.id = s.doctor_id
     LEFT JOIN doctor_review v ON v.study_id = s.id
     WHERE s.id = ?`,
    [studyId],
  );

  const row = (rows as any[])[0];

  if (!row) return null;

  return {
    studyId: String(row.studyId),
    patientId: String(row.patientId),
    reportStatus: row.reportStatus ? String(row.reportStatus) : null,
    doctorProfileId: row.doctorProfileId
      ? String(row.doctorProfileId)
      : null,
    doctorName: row.doctorName ? String(row.doctorName) : null,
    existingRating:
      row.existingRating === null || row.existingRating === undefined
        ? null
        : Number(row.existingRating),
  };
}

/*
  Tells the page whether this study can be rated, and by whom. The page
  asks before it draws the stars, so a patient is never shown a rating
  form for a study that has no report or that they already rated.
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

    await databaseReady;

    const study = await loadReviewable(String(id));

    if (!study) {
      return Response.json(
        { success: false, message: "This study was not found." },
        { status: 404 },
      );
    }

    const isApproved =
      String(study.reportStatus ?? "").toLowerCase() === "approved";

    return Response.json({
      success: true,
      canReview:
        isApproved &&
        study.doctorProfileId !== null &&
        study.existingRating === null,
      alreadyRated: study.existingRating !== null,
      rating: study.existingRating,
      doctorName: study.doctorName,
    });
  } catch (error) {
    console.error("Review status API error:", error);

    return Response.json(
      { success: false, message: "This could not be checked." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
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
    const body = await request.json();

    const rating = Number(body?.rating);
    const comment =
      typeof body?.comment === "string" ? body.comment.trim() : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return Response.json(
        {
          success: false,
          message: "A rating has to be a whole number from 1 to 5.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const study = await loadReviewable(String(id));

    if (!study) {
      return Response.json(
        { success: false, message: "This study was not found." },
        { status: 404 },
      );
    }

    /*
      Only the patient whose study it is may rate it. Without this check
      anyone signed in could rate any doctor as often as there are
      studies, and the average would measure nothing.

      A patient row carries the signed in user's own id as its primary
      key, which is how the studies list scopes a patient to their own
      cases. There is no separate user_id column to join through.
    */
    if (study.patientId !== String(session.user?.id ?? "")) {
      return Response.json(
        {
          success: false,
          message: "You can only rate a study of your own.",
        },
        { status: 403 },
      );
    }

    if (String(study.reportStatus ?? "").toLowerCase() !== "approved") {
      return Response.json(
        {
          success: false,
          message:
            "This study has no confirmed report yet, so there is no " +
            "reading to rate.",
        },
        { status: 400 },
      );
    }

    if (!study.doctorProfileId) {
      return Response.json(
        {
          success: false,
          message: "No doctor is recorded against this study.",
        },
        { status: 400 },
      );
    }

    if (study.existingRating !== null) {
      return Response.json(
        {
          success: false,
          message: "You have already rated this reading.",
        },
        { status: 409 },
      );
    }

    await sql.execute(
      `INSERT INTO doctor_review
         (id, doctor_id, patient_id, study_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `RV-${randomUUID().slice(0, 12).toUpperCase()}`,
        study.doctorProfileId,
        study.patientId,
        study.studyId,
        rating,
        comment || null,
      ],
    );

    return Response.json({
      success: true,
      message: "Thank you. Your rating was saved.",
    });
  } catch (error) {
    console.error("Review API error:", error);

    return Response.json(
      { success: false, message: "Your rating could not be saved." },
      { status: 500 },
    );
  }
}
