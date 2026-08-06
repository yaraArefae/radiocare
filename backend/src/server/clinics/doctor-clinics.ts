import { sql } from "@/server/database/database";
import {
  clinicKeysFromProfile,
  parseClinicKeys,
  type ClinicKey,
} from "@/server/clinics/clinic-key";

export type DoctorProfileRow = {
  clinics?: unknown;
  specialty?: unknown;
  subspecialty?: unknown;
  supportedBodyRegions?: unknown;
  supported_body_regions?: unknown;
};

/*
  The clinics one doctor works in.

  The clinics column is what an admin assigned, so it wins. Doctors who
  were approved before clinics could be assigned have nothing stored, and
  for them the clinics are read out of the specialty they registered
  with, which is how the whole application used to work.
*/
export function doctorClinics(profile: DoctorProfileRow): ClinicKey[] {
  const assigned = parseClinicKeys(profile?.clinics);

  if (assigned.length > 0) return assigned;

  return clinicKeysFromProfile(
    profile?.specialty,
    profile?.subspecialty,
    profile?.supportedBodyRegions ?? profile?.supported_body_regions,
  );
}

/*
  Builds the SQL that limits rows to the clinics of a doctor. A doctor
  covering several clinics needs an IN list, and the placeholders are
  generated here so that no route builds one by hand.
*/
export function clinicScope(
  column: string,
  clinics: ClinicKey[],
): { condition: string; values: string[] } {
  if (clinics.length === 0) {
    /* A doctor with no clinic sees nothing rather than everything. */
    return { condition: "1 = 0", values: [] };
  }

  const placeholders = clinics.map(() => "?").join(", ");

  return {
    condition: `LOWER(TRIM(${column})) IN (${placeholders})`,
    values: clinics,
  };
}

export function servesClinic(
  profile: DoctorProfileRow,
  clinicKey: string,
): boolean {
  return doctorClinics(profile).includes(clinicKey as ClinicKey);
}

/*
  Loads the profile of a doctor together with the clinics they cover.
  Returns null when the account has no approved profile.
*/
export async function loadDoctorClinics(userId: string) {
  const [profileRows] = await sql.execute(
    `SELECT user_id AS userId, full_name AS fullName, specialty,
       subspecialty, clinics, supported_body_regions AS supportedBodyRegions
     FROM doctor_profile
     WHERE user_id = ? AND status = 'Active'
     LIMIT 1`,
    [userId],
  );

  const profile = (profileRows as any[])[0];

  if (!profile) return null;

  return { profile, clinics: doctorClinics(profile) };
}

/*
  Every active doctor who works in one clinic.
*/
export async function findClinicDoctors(clinicKey: string) {
  try {
    const [doctorRows] = await sql.execute(
      `SELECT dp.user_id AS doctorId, dp.full_name AS doctorName,
         dp.specialty, dp.subspecialty, dp.clinics,
         dp.supported_body_regions AS supportedBodyRegions
       FROM doctor_profile dp
       JOIN user u ON u.id = dp.user_id
       WHERE dp.status = 'Active'`,
    );

    return (doctorRows as any[]).filter((doctor) =>
      servesClinic(doctor, clinicKey),
    );
  } catch (error) {
    console.error("Unable to list the clinic doctors:", error);
    return [];
  }
}
