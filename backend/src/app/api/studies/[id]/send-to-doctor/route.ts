import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/*
  Sends a closed study to a doctor after all.

  A scan the AI read as normal, uploaded by somebody who reported no
  symptoms, is never put in front of a doctor. That is the right default
  and it is also the one place this application can be wrong without
  anybody noticing: the chest model is right about seven times in ten,
  so a scan it called normal is not proof that it is.

  This is the way out. The patient decides, not the model, and the
  reason they type travels with the study so the doctor opening it knows
  why a case the AI cleared is in their queue.
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reason = String((body as any)?.reason ?? "").trim();

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT id, patient_id AS patientId, uploaded_by AS uploadedBy,
              status, symptoms
       FROM study WHERE id = ?`,
      [String(id)],
    );

    const study = (rows as any[])[0];

    if (!study) {
      return Response.json(
        { success: false, message: "This study was not found." },
        { status: 404 },
      );
    }

    /*
      Only the person the study belongs to, or whoever uploaded it for
      them. An administrator has other routes into a case and does not
      need this one.
    */
    const userId = String(session.user?.id ?? "");
    const isOwner =
      String(study.patientId) === userId ||
      String(study.uploadedBy) === userId;

    if (!isOwner) {
      return Response.json(
        { success: false, message: "This study is not yours to send." },
        { status: 403 },
      );
    }

    if (String(study.status) !== "Cleared") {
      return Response.json(
        {
          success: false,
          message:
            "This study is already with a doctor. There is nothing to send.",
        },
        { status: 409 },
      );
    }

    /*
      The reason is appended rather than written over. The symptoms box
      was empty when this was uploaded, which is why the case closed, so
      in practice there is nothing to lose - but a study that had notes
      and closed for another reason must not have them replaced.
    */
    const existing = String(study.symptoms ?? "").trim();

    const combined = reason
      ? existing
        ? `${existing}\n\nSent to a doctor by the patient: ${reason}`
        : `Sent to a doctor by the patient: ${reason}`
      : existing;

    await sql.execute(
      `UPDATE study
       SET status = 'Needs Review', symptoms = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [combined || null, String(id)],
    );

    return Response.json({
      success: true,
      status: "Needs Review",
      message:
        "This study is now with the doctors of its clinic. You will be " +
        "told when it has been read.",
    });
  } catch (error) {
    console.error("Send study to doctor error:", error);

    return Response.json(
      { success: false, message: "This could not be sent." },
      { status: 500 },
    );
  }
}
