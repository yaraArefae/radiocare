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

/*
  The cases one doctor is meant to read.

  A patient chooses the doctor when they upload, and that choice is the
  whole reason the doctor cards exist. Before this, the choice decided
  nothing after the upload: every doctor in the clinic saw every case in
  it, so a patient who picked one doctor had their scan read by whoever
  opened the queue first.

  A case addressed to nobody still belongs to the clinic. Most of the
  studies in this system were uploaded before a doctor could be chosen
  at all, and a rule that hid them from everyone would empty the queues
  rather than tidy them. So the scope is: mine, plus the ones nobody was
  named on.

  The id compared is the doctor_profile id, not the account id: a
  patient picks from the public directory, which lists profiles, so
  that is what the study carries.

  It stays one function because the answer has to be identical in the
  clinic queue, the case list, the reports, the patients and the check
  that guards a case opened by its address. A doctor who cannot see a
  case in their queue must not reach it by typing its URL either.
*/
export function doctorCaseScope(
  clinicColumn: string,
  doctorColumn: string,
  clinics: ClinicKey[],
  doctorProfileId: string,
): { condition: string; values: string[] } {
  const clinic = clinicScope(clinicColumn, clinics);

  if (clinic.condition === "1 = 0") return clinic;

  return {
    condition:
      `${clinic.condition} ` +
      `AND (${doctorColumn} IS NULL OR ${doctorColumn} = ?)`,
    values: [...clinic.values, doctorProfileId],
  };
}

/*
  The same rule for one case that is already in hand.
*/
export function doctorMayReadCase(
  profile: DoctorProfileRow,
  study: { clinicKey?: unknown; doctorId?: unknown },
  doctorProfileId: string,
): boolean {
  if (!servesClinic(profile, String(study.clinicKey ?? ""))) return false;

  const addressedTo = study.doctorId ? String(study.doctorId) : "";

  return !addressedTo || addressedTo === doctorProfileId;
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
