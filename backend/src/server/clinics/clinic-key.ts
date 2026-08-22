/*
  The clinics of the application.

  There is one clinic for every body region the patient can choose when
  uploading an image, and the two lists are kept identical on purpose:
  a case can never land in a clinic that no patient can send to, and a
  patient can never send to a clinic that does not exist.

  The shoulder and the hand are separate clinics even though both are
  the arm, because they are two separate choices for the patient and are
  read by two different AI models.
*/
export type ClinicKey =
  | "chest"
  | "shoulder"
  | "hand-wrist"
  | "spine"
  | "pelvis"
  | "lower-limb"
  | "head"
  | "abdomen"
  | "general";

export type ClinicDefinition = {
  key: ClinicKey;
  name: string;
  specialty: string;
  description: string;
  /* The labels the patient sees in the upload form. */
  patientRegions: string[];
  keywords: string[];
};

/*
  Ordered from the most specific clinic to the most general one. A film
  of a shoulder has to land in the shoulder clinic and never in a wider
  orthopedic bucket, so the limb keywords are tested before words such as
  "bone" are considered at all.
*/
export const CLINIC_DEFINITIONS: ClinicDefinition[] = [
  {
    key: "chest",
    name: "Chest Clinic",
    specialty: "Chest Radiology",
    description: "Chest, lungs, ribs and thoracic images.",
    patientRegions: ["Chest"],
    keywords: ["chest", "lung", "thorax", "thoracic", "pulmon", "rib"],
  },
  {
    key: "spine",
    name: "Spine Clinic",
    specialty: "Spine Imaging",
    description: "Cervical, thoracic and lumbar spine images.",
    patientRegions: ["Spine"],
    keywords: [
      "spine",
      "spinal",
      "cervical",
      "lumbar",
      "vertebra",
      "scoliosis",
      "kyphosis",
      "lordosis",
    ],
  },
  {
    key: "pelvis",
    name: "Pelvis & Hip Clinic",
    specialty: "Pelvis & Hip Imaging",
    description: "Pelvis, hip joint and sacrum images.",
    patientRegions: ["Pelvis & Hip"],
    keywords: ["pelvis", "pelvic", "hip", "ddh", "acetabul", "sacrum"],
  },
  {
    key: "shoulder",
    name: "Shoulder Clinic",
    specialty: "Shoulder Imaging",
    description: "Shoulder joint, clavicle and upper arm images.",
    patientRegions: ["Shoulder"],
    keywords: [
      "shoulder",
      "clavicle",
      "scapula",
      "glenoid",
      "humerus",
      "acromio",
    ],
  },
  {
    key: "hand-wrist",
    name: "Hand & Wrist Clinic",
    specialty: "Hand & Wrist Imaging",
    description: "Wrist, hand, finger and forearm images.",
    patientRegions: ["Hand & Wrist"],
    keywords: [
      "hand wrist",
      "wrist",
      "hand",
      "finger",
      "thumb",
      "carpal",
      "metacarp",
      "phalan",
      "forearm",
      "radius",
      "ulna",
      "elbow",
    ],
  },
  {
    key: "lower-limb",
    name: "Leg & Foot Clinic",
    specialty: "Lower Limb Imaging",
    description: "Leg, ankle and foot images.",
    patientRegions: ["Leg & Foot"],
    /*
      The knee is no longer read here. Its words stay in this list on
      purpose: a study filed as a knee before the change, or a doctor
      whose profile says "knee surgery", still has to resolve to a real
      clinic rather than falling through to the general one.
    */
    keywords: [
      "lower limb",
      "leg knee foot",
      "leg & foot",
      "leg",
      "femur",
      "knee",
      "patella",
      "tibia",
      "fibula",
      "ankle",
      "foot",
      "feet",
      "toe",
      "calcane",
      "tarsal",
    ],
  },
  {
    key: "head",
    name: "Head & Skull Clinic",
    specialty: "Neuroradiology",
    description: "Brain, skull and head vessel studies.",
    patientRegions: ["Head"],
    keywords: [
      "head",
      "skull",
      "brain",
      "cerebral",
      "cranial",
      "intracranial",
      "neuro",
      "aneurysm",
      "glioma",
    ],
  },
  {
    key: "abdomen",
    name: "Abdomen Clinic",
    specialty: "Abdominal Radiology",
    description:
      "Liver, kidney, pancreas, colon and adrenal studies, read as CT " +
      "volumes.",
    patientRegions: ["Abdomen"],
    /*
      The organ names matter as much as the word "abdomen". A study
      arrives described as a pancreas CT far more often than as an
      abdominal one, and before this clinic existed every one of them
      fell through to the general bucket.
    */
    keywords: [
      "abdomen",
      "abdominal",
      "liver",
      "hepatic",
      "kidney",
      "renal",
      "pancreas",
      "pancreatic",
      "colon",
      "colorectal",
      "bowel",
      "adrenal",
      "spleen",
      "splenic",
      "gastro",
    ],
  },
  {
    key: "general",
    name: "General Clinic",
    specialty: "General Radiology",
    description: "Images that no clinic above could be matched to.",
    patientRegions: [],
    keywords: [],
  },
];

export const CLINIC_KEYS = CLINIC_DEFINITIONS.map((clinic) => clinic.key);

/*
  The clinics that a general orthopedic specialty covers. A doctor who
  only says "Orthopedics" does not name a body part, so instead of being
  dropped from every clinic they are given all of the bone clinics.
*/
const ORTHOPEDIC_CLINICS: ClinicKey[] = [
  "spine",
  "pelvis",
  "shoulder",
  "hand-wrist",
  "lower-limb",
];

const ORTHOPEDIC_WORDS = [
  "ortho",
  "bone",
  "fracture",
  "musculoskeletal",
  "trauma",
  "joint",
];

/*
  Clinic keys the application used before, and the clinics that replaced
  them. Records written under an old key are moved with this map so that
  no case and no doctor is left pointing at a clinic that is gone.
*/
const RETIRED_CLINIC_KEYS: Record<string, ClinicKey[]> = {
  /* One key used to hold every bone case. */
  bone: ORTHOPEDIC_CLINICS,
  /* The arm was one clinic before the shoulder and the hand split. */
  "upper-limb": ["shoulder", "hand-wrist"],
  cardiac: ["chest"],
  breast: ["chest"],
  /*
    The head and skull clinic is back.

    It was removed because no model had ever been trained for it, so
    every case it received reached a doctor with no preliminary reading
    at all, and a clinic that only forwards is a queue with a name. That
    is no longer true: the brain tumour model reads a post contrast MRI
    at 0.986, and the vessel model answers on aneurysms at 0.946.

    Cases that were moved to the general clinic while it was gone stay
    where they are. Moving them back would reopen readings a doctor has
    already signed, and the general clinic is not a wrong place for a
    head study, only a less specific one.
  */
  neuro: ["head"],

  /*
    An abdominal radiologist reads the organ clinics rather than one
    named after a bone.
  */
  abdominal: ["abdomen"],
  gastro: ["abdomen"],
  dental: [],
};

export function replacementClinics(key: string): ClinicKey[] {
  return RETIRED_CLINIC_KEYS[String(key ?? "").trim().toLowerCase()] ?? [];
}

export function getClinicDefinition(key: string): ClinicDefinition {
  return (
    CLINIC_DEFINITIONS.find((clinic) => clinic.key === key) ??
    CLINIC_DEFINITIONS[CLINIC_DEFINITIONS.length - 1]
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
  Finds the one clinic a piece of text belongs to, such as a body region
  or the name of a specialty. Returns "general" when nothing matches.
*/
export function clinicKeyFromText(value: string): ClinicKey {
  const text = normalizeText(value);

  if (!text) return "general";

  for (const clinic of CLINIC_DEFINITIONS) {
    const matched = clinic.keywords.some((keyword) =>
      text.includes(normalizeText(keyword)),
    );

    if (matched) return clinic.key;
  }

  return "general";
}

/*
  Picks the clinic of a study from the most precise description that is
  available. The body region names the anatomy, so it decides; what the
  AI service reports is only a fallback, because a value such as
  "orthopedic" cannot tell a wrist from an ankle.
*/
export function resolveClinicKey(
  bodyRegion: string,
  detectedRegion?: string,
  detectedClinic?: string,
): ClinicKey {
  for (const candidate of [bodyRegion, detectedRegion, detectedClinic]) {
    if (!candidate) continue;

    const clinic = clinicKeyFromText(candidate);

    if (clinic !== "general") return clinic;
  }

  return "general";
}

/*
  Reads the clinics a doctor works in out of their profile. Every phrase
  is examined, not just the first match, because one doctor can cover
  several clinics: "Orthopedics - hand and foot surgery" is both the hand
  and wrist clinic and the leg and foot clinic.
*/
export function clinicKeysFromProfile(
  specialty: unknown,
  subspecialty?: unknown,
  supportedBodyRegions?: unknown,
): ClinicKey[] {
  const regions = Array.isArray(supportedBodyRegions)
    ? supportedBodyRegions.join(" ")
    : String(supportedBodyRegions ?? "");

  const text = normalizeText(
    `${specialty ?? ""} ${subspecialty ?? ""} ${regions}`,
  );

  const found = new Set<ClinicKey>();

  for (const clinic of CLINIC_DEFINITIONS) {
    const matched = clinic.keywords.some((keyword) =>
      text.includes(normalizeText(keyword)),
    );

    if (matched) found.add(clinic.key);
  }

  /*
    A plain orthopedic specialty only opens the bone clinics when it did
    not already name a specific limb, so a hand surgeon is not handed the
    spine queue as well.
  */
  if (found.size === 0 && ORTHOPEDIC_WORDS.some((w) => text.includes(w))) {
    ORTHOPEDIC_CLINICS.forEach((clinic) => found.add(clinic));
  }

  found.delete("general");

  return found.size > 0 ? [...found] : ["general"];
}

/*
  Keeps only the values that name a real clinic. Used wherever clinics
  arrive from outside, such as an admin assigning them to a doctor.
*/
export function parseClinicKeys(value: unknown): ClinicKey[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,\s]+/);

  const found = new Set<ClinicKey>();

  for (const entry of raw) {
    const key = String(entry ?? "").trim().toLowerCase();

    if (CLINIC_KEYS.includes(key as ClinicKey)) {
      found.add(key as ClinicKey);
    }
  }

  return [...found];
}
