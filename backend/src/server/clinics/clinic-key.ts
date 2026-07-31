export type ClinicKey =
  | "chest"
  | "bone"
  | "neuro"
  | "cardiac"
  | "abdominal"
  | "dental"
  | "breast"
  | "pediatric"
  | "general";

/*
  Maps a free text specialty or body region to the clinic that owns it.
*/
export function clinicKeyFromText(value: string): ClinicKey {
  const text = value.toLowerCase();

  if (
    text.includes("chest") ||
    text.includes("lung") ||
    text.includes("thoracic")
  ) {
    return "chest";
  }

  if (
    text.includes("cardio") ||
    text.includes("heart") ||
    text.includes("cardiac")
  ) {
    return "cardiac";
  }

  /*
    Every limb and joint region belongs to the orthopedic clinic. Hand
    and wrist are listed together because they share one pathway in the
    application, from the upload form to the review queue.
  */
  if (
    [
      "bone",
      "ortho",
      "fracture",
      "spine",
      "hand",
      "wrist",
      "finger",
      "thumb",
      "forearm",
      "radius",
      "ulna",
      "elbow",
      "arm",
      "humerus",
      "shoulder",
      "clavicle",
      "limb",
      "pelvis",
      "hip",
      "femur",
      "knee",
      "tibia",
      "fibula",
      "ankle",
      "foot",
      "toe",
      "leg",
      "joint",
    ].some((keyword) => text.includes(keyword))
  ) {
    return "bone";
  }

  if (
    text.includes("neuro") ||
    text.includes("brain") ||
    text.includes("head") ||
    text.includes("skull")
  ) {
    return "neuro";
  }

  if (
    text.includes("dental") ||
    text.includes("teeth") ||
    text.includes("jaw")
  ) {
    return "dental";
  }

  if (
    text.includes("abdomen") ||
    text.includes("abdominal") ||
    text.includes("pelvis") ||
    text.includes("kidney") ||
    text.includes("liver")
  ) {
    return "abdominal";
  }

  if (
    text.includes("breast") ||
    text.includes("mammography")
  ) {
    return "breast";
  }

  if (
    text.includes("pediatric") ||
    text.includes("child")
  ) {
    return "pediatric";
  }

  return "general";
}
