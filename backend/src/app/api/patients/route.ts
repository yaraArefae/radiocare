import { clinicKeyFromText } from "@/server/clinics/clinic-key";
import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { normalizeRoles } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Lists the patients the signed in user is allowed to see. A doctor gets
  the patients who have a study in their own clinic, an administrator
  gets everyone, and a patient gets only their own record.
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
    const isAdmin = roles.includes("admin");
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isAdmin && !isDoctor && !isPatient) {
      return Response.json(
        { success: false, message: "You are not allowed to list patients." },
        { status: 403 },
      );
    }

    await databaseReady;

    let scopeClause = "";
    const scopeValues: string[] = [];

    if (!isAdmin && isDoctor) {
      const [profileRows] = await sql.execute(
        `SELECT specialty, subspecialty FROM doctor_profile
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

      scopeClause = `WHERE EXISTS (
        SELECT 1 FROM study s
        WHERE s.patient_id = p.id AND s.clinic_key = ?
      )`;
      scopeValues.push(
        clinicKeyFromText(
          `${profile.specialty} ${profile.subspecialty || ""}`,
        ),
      );
    } else if (!isAdmin && isPatient) {
      scopeClause = "WHERE p.id = ?";
      scopeValues.push(String(session.user?.id ?? ""));
    }

    const [patientRows] = await sql.execute(
      `SELECT p.id, p.name, p.age, p.gender,
         COALESCE(p.phone, '') AS phone, COALESCE(p.email, '') AS email,
         COALESCE(p.symptoms, '') AS symptoms,
         COALESCE(p.medical_history, '') AS medicalHistory,
         p.status, p.created_at AS createdAt,
         (SELECT COUNT(*) FROM study s WHERE s.patient_id = p.id) AS totalStudies,
         (SELECT MAX(s.created_at) FROM study s WHERE s.patient_id = p.id) AS lastStudyAt,
         (SELECT COUNT(*) FROM study s
          WHERE s.patient_id = p.id AND s.status = 'Completed') AS completedStudies,
         (SELECT COUNT(*) FROM appointment a
          WHERE a.patient_id = p.id AND a.status IN ('Pending', 'Confirmed')) AS openAppointments
       FROM patient p
       ${scopeClause}
       ORDER BY COALESCE(
         (SELECT MAX(s.created_at) FROM study s WHERE s.patient_id = p.id),
         p.created_at
       ) DESC
       LIMIT 500`,
      scopeValues,
    );

    const patients = (patientRows as any[]).map((row) => ({
      ...row,
      age: Number(row.age ?? 0),
      totalStudies: Number(row.totalStudies ?? 0),
      completedStudies: Number(row.completedStudies ?? 0),
      openAppointments: Number(row.openAppointments ?? 0),
    }));

    return Response.json({
      success: true,
      role: isAdmin ? "admin" : isDoctor ? "doctor" : "patient",
      patients,
      counts: {
        total: patients.length,
        active: patients.filter((item) => item.status === "Active").length,
        withOpenAppointment: patients.filter(
          (item) => item.openAppointments > 0,
        ).length,
        totalStudies: patients.reduce(
          (total, item) => total + item.totalStudies,
          0,
        ),
      },
    });
  } catch (error) {
    console.error("List patients API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the patients." },
      { status: 500 },
    );
  }
}
