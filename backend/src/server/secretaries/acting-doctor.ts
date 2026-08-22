import { sql } from "@/server/database/database";

export type ActingDoctor = {
  /*
    The user id every appointment is written against. For a doctor this
    is their own; for a secretary it is the doctor they work for, which
    is the whole point of the role.
  */
  doctorUserId: string;
  /* Who actually performed the action, for the audit trail. */
  actedByUserId: string;
  actedByRole: "doctor" | "secretary";
  secretaryName: string | null;
};

function normalizeRoles(role: unknown): string[] {
  const roles = Array.isArray(role)
    ? role
    : String(role ?? "").split(",");

  return roles.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/*
  Answers whose calendar the signed in person is allowed to work on.

  A doctor and their secretary reach the same appointments through the
  same routes, and those routes must not each decide for themselves what
  a secretary may do. They ask here instead and get back a single id to
  write against, so a secretary can never address an appointment to a
  doctor other than their own: there is no request field that names one.

  Returns null for anybody who is neither.
*/
export async function resolveActingDoctor(session: {
  user?: { id?: string | null; role?: unknown } | null;
} | null): Promise<ActingDoctor | null> {
  const userId = String(session?.user?.id ?? "");

  if (!userId) return null;

  const roles = normalizeRoles(session?.user?.role);

  if (roles.includes("doctor")) {
    return {
      doctorUserId: userId,
      actedByUserId: userId,
      actedByRole: "doctor",
      secretaryName: null,
    };
  }

  if (!roles.includes("secretary")) return null;

  const [rows] = await sql.execute(
    `SELECT doctor_user_id AS doctorUserId, full_name AS fullName
     FROM secretary_profile
     WHERE user_id = ? AND status = 'Active'`,
    [userId],
  );

  const secretary = (rows as any[])[0];

  /*
    A secretary whose doctor was removed, or who was deactivated, keeps
    their login and loses their calendar. Falling back to their own id
    would give them a calendar of their own, which is not a thing this
    application has.
  */
  if (!secretary) return null;

  return {
    doctorUserId: String(secretary.doctorUserId),
    actedByUserId: userId,
    actedByRole: "secretary",
    secretaryName: String(secretary.fullName),
  };
}
