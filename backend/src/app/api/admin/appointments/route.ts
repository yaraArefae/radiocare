import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Every appointment in the system, for the administration.

  The doctor's calendar shows one doctor's day and the patient's shows
  their own visits. Neither answers the question an administrator has,
  which is whether the clinics are booked at all and who is waiting on
  whom, so this reads them all in one list.
*/

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
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

    await databaseReady;

    /*
      Booked first and in the order they will happen, because the next
      appointment is the one an administrator is asked about. What has
      already been and gone follows, newest first.
    */
    const [rows] = await sql.execute(
      `SELECT
         a.id,
         a.scheduled_at AS scheduledAt,
         a.status,
         a.duration_minutes AS durationMinutes,
         a.notes,
         a.patient_response_note AS patientNote,
         a.created_at AS createdAt,
         p.id AS patientId,
         p.name AS patientName,
         p.phone AS patientPhone,
         d.id AS doctorId,
         d.name AS doctorName,
         s.id AS studyId,
         s.body_region AS bodyRegion,
         s.clinic_key AS clinicKey,
         (
           a.status IN ('Pending', 'Confirmed')
           AND a.scheduled_at >= CURRENT_TIMESTAMP(3)
         ) AS isUpcoming
       FROM appointment a
       LEFT JOIN patient p ON p.id = a.patient_id
       LEFT JOIN \`user\` d ON d.id = a.doctor_id
       LEFT JOIN study s ON s.id = a.study_id
       ORDER BY isUpcoming DESC,
                CASE WHEN (
                  a.status IN ('Pending', 'Confirmed')
                  AND a.scheduled_at >= CURRENT_TIMESTAMP(3)
                ) THEN a.scheduled_at END ASC,
                a.scheduled_at DESC
       LIMIT 300`,
    );

    const appointments = (rows as any[]).map((row) => ({
      id: row.id,
      scheduledAt: row.scheduledAt,
      status: row.status,
      durationMinutes: Number(row.durationMinutes ?? 30),
      notes: row.notes ?? "",
      patientNote: row.patientNote ?? "",
      createdAt: row.createdAt,
      patientId: row.patientId,
      patientName: row.patientName ?? "Unknown patient",
      patientPhone: row.patientPhone ?? "",
      doctorId: row.doctorId,
      doctorName: row.doctorName ?? "Unknown doctor",
      studyId: row.studyId,
      bodyRegion: row.bodyRegion ?? "",
      clinicKey: row.clinicKey ?? "general",
      isUpcoming: Number(row.isUpcoming ?? 0) === 1,
    }));

    return Response.json({
      success: true,
      appointments,
      totals: {
        all: appointments.length,
        booked: appointments.filter((item) => item.isUpcoming).length,
        pending: appointments.filter((item) => item.status === "Pending")
          .length,
        confirmed: appointments.filter(
          (item) => item.status === "Confirmed",
        ).length,
      },
    });
  } catch (error) {
    console.error("Admin appointments API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the appointments." },
      { status: 500 },
    );
  }
}
