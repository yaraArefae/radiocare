import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { resolveActingDoctor } from "@/server/secretaries/acting-doctor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The cases in this doctor's clinic that a visit can be booked against,
  and nothing else about them.

  Booking needs a patient and a case to attach the visit to, so a name,
  a body region and a date are returned. The AI finding, the report and
  the image are not: a secretary arranging a visit has no reason to read
  what the scan showed, and a route that returned it "because the page
  might want it" is how that access quietly becomes normal.

  A case that already has a live appointment is left out. Two visits for
  one reading is almost always a double booking rather than an
  intention, and the existing one can be moved instead.
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

    const acting = await resolveActingDoctor(session);

    if (!acting) {
      return Response.json(
        {
          success: false,
          message: "Doctor or secretary access is required.",
        },
        { status: 403 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT s.id AS studyId, s.body_region AS bodyRegion,
              s.created_at AS uploadedAt, s.status,
              p.name AS patientName,
              COALESCE(p.phone, '') AS patientPhone,
              COALESCE(s.patient_age, p.age) AS patientAge
       FROM study s
       JOIN patient p ON p.id = s.patient_id
       WHERE s.doctor_id IS NOT NULL
         AND s.doctor_id = (
           SELECT id FROM doctor_profile WHERE user_id = ? LIMIT 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM appointment a
           WHERE a.study_id = s.id
             AND a.status NOT IN ('Cancelled', 'Declined')
         )
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [acting.doctorUserId],
    );

    return Response.json({
      success: true,
      /*
        Who the calendar belongs to, so a secretary's page can say whose
        it is without being told by the browser.
      */
      doctorUserId: acting.doctorUserId,
      actedByRole: acting.actedByRole,
      studies: rows,
    });
  } catch (error) {
    console.error("Bookable studies error:", error);

    return Response.json(
      { success: false, message: "These could not be loaded." },
      { status: 500 },
    );
  }
}
