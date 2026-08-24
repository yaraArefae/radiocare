import { doctorMayReadCase } from "@/server/clinics/doctor-clinics";
import { sql } from "@/server/database/database";

/* The clinic doctor lookup lives with the other clinic helpers now. */
export { findClinicDoctors } from "@/server/clinics/doctor-clinics";

export type CaseRole = "doctor" | "patient" | "admin";

export type CaseStudy = {
  id: string;
  patientId: string;
  patientName: string;
  clinicKey: string;
  /* The doctor the patient chose, when they chose one. */
  doctorId: string | null;
  bodyRegion: string;
  triageResult: string;
};

export type CaseAccessResult =
  | {
      allowed: true;
      role: CaseRole;
      study: CaseStudy;
      doctorId: string | null;
      doctorName: string | null;
    }
  | {
      allowed: false;
      status: number;
      message: string;
    };

export function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/*
  The triage result lives inside the AI explanation JSON for new records
  and inside predicted_finding for the older ones.
*/
export const triageResultExpression = `COALESCE(
  CASE
    WHEN JSON_VALID(a.explanation)
    THEN JSON_UNQUOTE(JSON_EXTRACT(a.explanation, '$.triageResult'))
    ELSE NULL
  END,
  a.predicted_finding,
  ''
)`;

export function isAbnormalTriage(value: string) {
  return String(value || "").trim().toUpperCase() === "ABNORMAL";
}

/*
  Decides whether the signed in user may read and write the follow-up
  conversation of a study. A patient reaches their own studies only, and
  a doctor reaches the studies that belong to the clinic of their
  specialty, which is the same rule the appointment API uses.
*/
export async function resolveCaseAccess(
  user: { id?: string; name?: string | null; role?: string | string[] | null },
  studyId: string,
  options: { allowAdmin?: boolean } = {},
): Promise<CaseAccessResult> {
  const roles = normalizeRoles(user?.role);
  const isDoctor = roles.includes("doctor");
  const isPatient = roles.includes("patient");

  /*
    An administrator supervises the studies but never takes part in the
    private conversation, so the callers decide whether to allow them.
  */
  const isAdmin = options.allowAdmin === true && roles.includes("admin");

  if (!isDoctor && !isPatient && !isAdmin) {
    return {
      allowed: false,
      status: 403,
      message: "You are not allowed to open this case.",
    };
  }

  const [studyRows] = await sql.execute(
    `SELECT s.id, s.patient_id AS patientId, p.name AS patientName,
       s.clinic_key AS clinicKey, s.doctor_id AS doctorId,
       s.body_region AS bodyRegion,
       ${triageResultExpression} AS triageResult
     FROM study s
     JOIN patient p ON p.id = s.patient_id
     LEFT JOIN ai_result a ON a.study_id = s.id
     WHERE s.id = ?
     LIMIT 1`,
    [studyId],
  );

  const study = (studyRows as CaseStudy[])[0];

  if (!study) {
    return { allowed: false, status: 404, message: "Study not found." };
  }

  if (isAdmin && !isDoctor && !isPatient) {
    return {
      allowed: true,
      role: "admin",
      study,
      doctorId: null,
      doctorName: null,
    };
  }

  if (!isDoctor && isPatient) {
    if (study.patientId !== user?.id) {
      return {
        allowed: false,
        status: 403,
        message: "This case belongs to another patient.",
      };
    }

    /*
      The doctor side of the conversation is whoever already replied or
      scheduled an appointment for this case.
    */
    const [doctorRows] = await sql.execute(
      `SELECT dp.user_id AS doctorId, dp.full_name AS doctorName
       FROM doctor_profile dp
       WHERE dp.user_id = (
         SELECT sender_id FROM case_message
         WHERE study_id = ? AND sender_role = 'doctor'
         ORDER BY created_at DESC LIMIT 1
       )
       LIMIT 1`,
      [studyId],
    );

    const assignedDoctor = (doctorRows as any[])[0];

    return {
      allowed: true,
      role: "patient",
      study,
      doctorId: assignedDoctor?.doctorId ?? null,
      doctorName: assignedDoctor?.doctorName ?? null,
    };
  }

  const [profileRows] = await sql.execute(
    `SELECT id, full_name AS fullName, specialty, subspecialty, clinics,
       supported_body_regions AS supportedBodyRegions
     FROM doctor_profile
     WHERE user_id = ?
     LIMIT 1`,
    [String(user?.id ?? "")],
  );

  const profile = (profileRows as any[])[0];

  if (!profile) {
    return {
      allowed: false,
      status: 404,
      message: "Doctor profile not found or not approved yet.",
    };
  }

  /*
    The same rule the clinic queue uses, applied to a case reached by its
    address.

    A doctor works in more than one clinic, so the case has to belong to
    any one of theirs. And a case a patient addressed to a colleague is
    that colleague's to read: without this check a doctor kept out of
    their own queue could still open the case by typing its URL, which
    would make the queue a suggestion rather than a rule.
  */
  if (!doctorMayReadCase(profile, study, String(profile.id ?? ""))) {
    return {
      allowed: false,
      status: 403,
      message: study.doctorId
        ? "This case was sent to another doctor."
        : "This case belongs to another clinic.",
    };
  }

  return {
    allowed: true,
    role: "doctor",
    study,
    doctorId: String(user?.id),
    doctorName: profile.fullName,
  };
}
