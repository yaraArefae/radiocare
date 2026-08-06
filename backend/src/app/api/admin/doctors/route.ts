import { auth } from "@/server/auth/auth";
import {
  CLINIC_DEFINITIONS,
  parseClinicKeys,
} from "@/server/clinics/clinic-key";
import { doctorClinics } from "@/server/clinics/doctor-clinics";
import { databaseReady, sql } from "@/server/database/database";
import { recordAdminAction } from "@/server/admin/admin-actions";
import { createNotification } from "@/server/notifications/notifications";

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

async function requireAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return {
      error: Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      ),
    };
  }

  if (!normalizeRoles(session.user?.role).includes("admin")) {
    return {
      error: Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      ),
    };
  }

  return { session };
}

/*
  Lists every doctor with the clinics they work in, next to the list of
  clinics that exist and how many cases are waiting in each one.

  The admin needs this because the clinics are guessed from the specialty
  a doctor typed when registering. A specialty such as "Radiology" names
  no body region, so that doctor would be left out of every clinic and
  would never receive a case until the admin assigns their clinics here.
*/
export async function GET(request: Request) {
  try {
    const guard = await requireAdmin(request);

    if (guard.error) return guard.error;

    await databaseReady;

    const [doctorRows] = await sql.execute(
      `SELECT dp.user_id AS doctorId, dp.full_name AS fullName,
         dp.specialty, dp.subspecialty, dp.clinics, dp.status,
         dp.supported_body_regions AS supportedBodyRegions,
         u.email, COALESCE(u.banned, FALSE) AS suspended
       FROM doctor_profile dp
       JOIN user u ON u.id = dp.user_id
       ORDER BY dp.full_name ASC`,
    );

    const doctors = (doctorRows as any[]).map((doctor) => ({
      doctorId: doctor.doctorId,
      fullName: doctor.fullName,
      email: doctor.email,
      specialty: doctor.specialty,
      subspecialty: doctor.subspecialty ?? "",
      status: doctor.status,
      suspended: Boolean(doctor.suspended),
      clinics: doctorClinics(doctor),
      /*
        Tells the admin whether the clinics were chosen by hand or are
        still only guessed from the specialty text.
      */
      clinicsAssigned: parseClinicKeys(doctor.clinics).length > 0,
    }));

    const [caseRows] = await sql.execute(
      `SELECT clinic_key AS clinicKey, COUNT(*) AS total
       FROM study
       GROUP BY clinic_key`,
    );

    const caseCounts = new Map<string, number>(
      (caseRows as any[]).map((row) => [
        String(row.clinicKey),
        Number(row.total),
      ]),
    );

    const clinics = CLINIC_DEFINITIONS.filter(
      (clinic) => clinic.key !== "general",
    ).map((clinic) => ({
      key: clinic.key,
      name: clinic.name,
      description: clinic.description,
      patientRegions: clinic.patientRegions,
      caseCount: caseCounts.get(clinic.key) ?? 0,
      doctorCount: doctors.filter(
        (doctor) =>
          doctor.status === "Active" &&
          !doctor.suspended &&
          doctor.clinics.includes(clinic.key),
      ).length,
    }));

    return Response.json({
      success: true,
      doctors,
      clinics,
      /*
        A clinic with no doctor still accepts uploads, so the cases sent
        there wait with nobody to see them. The admin is shown these
        first.
      */
      clinicsWithoutDoctor: clinics
        .filter((clinic) => clinic.doctorCount === 0)
        .map((clinic) => clinic.key),
    });
  } catch (error) {
    console.error("Admin doctors API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the doctors." },
      { status: 500 },
    );
  }
}

/*
  Assigns the clinics of one doctor.
*/
export async function PATCH(request: Request) {
  try {
    const guard = await requireAdmin(request);

    if (guard.error) return guard.error;

    const body = (await request.json()) as Record<string, unknown>;
    const doctorId = String(body?.doctorId ?? "").trim();
    const clinics = parseClinicKeys(body?.clinics);

    if (!doctorId) {
      return Response.json(
        { success: false, message: "The doctor is required." },
        { status: 400 },
      );
    }

    if (clinics.length === 0) {
      return Response.json(
        {
          success: false,
          message:
            "Choose at least one clinic. A doctor with no clinic receives no cases.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [profileRows] = await sql.execute(
      `SELECT full_name AS fullName, clinics
       FROM doctor_profile
       WHERE user_id = ?
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

    await sql.execute(
      "UPDATE doctor_profile SET clinics = ?, updated_at = NOW(3) WHERE user_id = ?",
      [clinics.join(","), doctorId],
    );

    const clinicNames = clinics
      .map(
        (key) =>
          CLINIC_DEFINITIONS.find((clinic) => clinic.key === key)?.name ?? key,
      )
      .join(", ");

    await recordAdminAction({
      adminId: String(guard.session!.user?.id ?? ""),
      action: "assign_doctor_clinics",
      targetType: "doctor",
      targetId: doctorId,
      details: `Clinics set to: ${clinics.join(", ")} (was: ${
        String(profile.clinics ?? "") || "not assigned"
      })`,
    });

    await createNotification({
      userId: doctorId,
      userRole: "doctor",
      type: "account_updated",
      title: "Your clinics were updated",
      body: `You now receive cases from: ${clinicNames}.`,
      link: "/doctor/dashboard",
    });

    return Response.json({
      success: true,
      message: `${profile.fullName} now works in: ${clinicNames}.`,
      clinics,
    });
  } catch (error) {
    console.error("Assign doctor clinics API error:", error);

    return Response.json(
      { success: false, message: "Unable to update the clinics." },
      { status: 500 },
    );
  }
}
