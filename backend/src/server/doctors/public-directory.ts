import { sql } from "@/server/database/database";
import { doctorClinics } from "@/server/clinics/doctor-clinics";
import {
  getClinicDefinition,
  type ClinicKey,
} from "@/server/clinics/clinic-key";

/*
  What a patient is shown about a doctor before choosing one.

  Everything here is either something the doctor registered and an
  administrator approved, or something patients wrote. There is no field
  a rating can be typed into: a number an administrator picked would
  look, on the card, exactly like one earned from thirty readings, and
  a patient deciding who reads their X-ray would have no way to tell.
*/
export type PublicDoctor = {
  id: string;
  name: string;
  specialty: string;
  subspecialty: string | null;
  bio: string | null;
  yearsOfExperience: number;
  languages: string[];
  consultationPrice: number | null;
  clinics: ClinicKey[];
  clinicNames: string[];
  /*
    Null until somebody has rated a reading by this doctor. A card shows
    "No ratings yet" for that, which is the truth and is also what a new
    doctor deserves rather than a default of zero stars.
  */
  rating: number | null;
  reviewCount: number;
  licenseNumber: string;
  licensingAuthority: string;
  currentWorkplace: string;
  /*
    The letters drawn in the circle on the card. Photographs are not
    collected yet, and initials are honest about that in a way a stock
    portrait of a stranger would not be.
  */
  initials: string;
  /*
    Null when the doctor never uploaded one, and the initials are drawn
    instead. An address is returned rather than the bytes so a list of
    eight doctors stays one small response.
  */
  photoUrl: string | null;
};

type DoctorRow = {
  id: string;
  fullName: string;
  specialty: string;
  subspecialty: string | null;
  bio: string | null;
  languages: unknown;
  consultationPrice: unknown;
  yearsOfExperience: number;
  licenseNumber: string;
  licensingAuthority: string;
  currentWorkplace: string;
  photoPath: unknown;
  clinics: unknown;
  supportedBodyRegions: unknown;
  ratingAverage: unknown;
  reviewCount: unknown;
};

function initialsOf(name: string): string {
  const words = String(name)
    .replace(/^\s*(dr\.?|doctor)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "?";

  const letters = [words[0], words[words.length - 1]]
    .map((word) => word[0] ?? "")
    .join("");

  return letters.toUpperCase() || "?";
}

function parseLanguages(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      /*
        A doctor approved before this column existed may hold a plain
        comma separated string. Reading it is cheaper than a migration
        that would rewrite rows nobody has looked at yet.
      */
      return raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function toPublicDoctor(row: DoctorRow): PublicDoctor {
  const clinics = doctorClinics({
    clinics: row.clinics,
    specialty: row.specialty,
    subspecialty: row.subspecialty,
    supportedBodyRegions: row.supportedBodyRegions,
  });

  const reviewCount = Number(row.reviewCount ?? 0);
  const average = Number(row.ratingAverage ?? 0);

  return {
    id: String(row.id),
    name: String(row.fullName),
    specialty: String(row.specialty),
    subspecialty: row.subspecialty ? String(row.subspecialty) : null,
    bio: row.bio ? String(row.bio) : null,
    yearsOfExperience: Number(row.yearsOfExperience ?? 0),
    languages: parseLanguages(row.languages),
    consultationPrice:
      row.consultationPrice === null || row.consultationPrice === undefined
        ? null
        : Number(row.consultationPrice),
    clinics,
    clinicNames: clinics.map((key) => getClinicDefinition(key).name),
    rating: reviewCount > 0 ? Math.round(average * 10) / 10 : null,
    reviewCount,
    licenseNumber: String(row.licenseNumber ?? ""),
    licensingAuthority: String(row.licensingAuthority ?? ""),
    currentWorkplace: String(row.currentWorkplace ?? ""),
    initials: initialsOf(String(row.fullName)),
    photoUrl: row.photoPath ? `/api/doctors/${row.id}/photo` : null,
  };
}

/*
  The columns every public view of a doctor needs, with the rating
  joined in as an aggregate rather than fetched per doctor. A page
  listing eight doctors would otherwise run nine queries.
*/
const DOCTOR_SELECT = `
  SELECT d.id, d.full_name AS fullName, d.specialty, d.subspecialty,
         d.bio, d.languages, d.consultation_price AS consultationPrice,
         d.years_of_experience AS yearsOfExperience,
         d.license_number AS licenseNumber,
         d.licensing_authority AS licensingAuthority,
         d.current_workplace AS currentWorkplace,
         d.photo_path AS photoPath,
         d.clinics, d.supported_body_regions AS supportedBodyRegions,
         COALESCE(r.average, 0) AS ratingAverage,
         COALESCE(r.total, 0) AS reviewCount
  FROM doctor_profile d
  LEFT JOIN (
    SELECT doctor_id, AVG(rating) AS average, COUNT(*) AS total
    FROM doctor_review GROUP BY doctor_id
  ) r ON r.doctor_id = d.id
  WHERE d.status = 'Active'
`;

/*
  The doctors of one clinic.

  Clinic membership is not a column that can be filtered in SQL: a
  doctor approved before clinics were assigned has it derived from their
  specialty. The rows are therefore read and then filtered through the
  same function the rest of the application uses, so a patient and a
  doctor never disagree about who belongs where.
*/
export async function doctorsInClinic(
  clinicKey: ClinicKey,
): Promise<PublicDoctor[]> {
  const [rows] = await sql.execute(`${DOCTOR_SELECT} ORDER BY d.full_name`);

  return (rows as DoctorRow[])
    .map(toPublicDoctor)
    .filter((doctor) => doctor.clinics.includes(clinicKey));
}

export async function publicDoctorById(
  id: string,
): Promise<PublicDoctor | null> {
  const [rows] = await sql.execute(`${DOCTOR_SELECT} AND d.id = ?`, [id]);
  const found = (rows as DoctorRow[])[0];

  return found ? toPublicDoctor(found) : null;
}

export type DoctorReview = {
  rating: number;
  comment: string | null;
  createdAt: string;
  patientName: string;
};

/*
  The written reviews shown under a doctor's profile.

  Only the patient's first name is returned. A full name beside a
  complaint about a reading identifies a patient to anyone who knows
  them, and nothing on the page needs it.
*/
export async function reviewsForDoctor(
  id: string,
  limit = 20,
): Promise<DoctorReview[]> {
  const [rows] = await sql.execute(
    `SELECT v.rating, v.comment, v.created_at AS createdAt,
            COALESCE(p.name, 'A patient') AS patientName
     FROM doctor_review v
     LEFT JOIN patient p ON p.id = v.patient_id
     WHERE v.doctor_id = ?
     ORDER BY v.created_at DESC
     LIMIT ?`,
    [id, limit],
  );

  return (rows as any[]).map((row) => ({
    rating: Number(row.rating),
    comment: row.comment ? String(row.comment) : null,
    createdAt: String(row.createdAt),
    patientName: String(row.patientName).split(/\s+/)[0] ?? "A patient",
  }));
}
