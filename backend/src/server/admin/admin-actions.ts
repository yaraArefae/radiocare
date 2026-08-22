import { randomBytes } from "node:crypto";

import { databaseReady, sql } from "@/server/database/database";
import { sendAccountCredentialsEmail } from "@/server/email/email";

export const TEMPORARY_PASSWORD_VALIDITY_MS = 24 * 60 * 60 * 1000;

/*
  A random password that always contains a capital letter, a digit, and a
  symbol, so it satisfies the usual password rules.
*/
export function generateTemporaryPassword() {
  return `Rc!${randomBytes(10).toString("base64url")}7A`;
}

/*
  Records what an administrator did. Approving an account, changing a
  role, or resetting a password are decisions that need a trace in a
  medical system, so every one of them is written here.
*/
export async function recordAdminAction(entry: {
  adminId?: string | null;
  adminEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: string | null;
}) {
  try {
    await databaseReady;

    await sql.execute(
      `INSERT INTO admin_audit
       (admin_id, admin_email, action, target_type, target_id,
        target_label, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.adminId ?? null,
        entry.adminEmail ?? null,
        entry.action.slice(0, 80),
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.targetLabel?.slice(0, 255) ?? null,
        entry.details?.slice(0, 2000) ?? null,
      ],
    );
  } catch (error) {
    /*
      The audit trail must never block the action it describes.
    */
    console.error("Unable to write the admin audit entry:", error);
  }
}

/*
  Marks a freshly created account so the first sign in has to replace the
  temporary password, and records when that password stops working.
*/
export async function markTemporaryPassword(
  userId: string,
  expiresAt: Date,
) {
  await sql.execute(
    "UPDATE `user` SET mustChangePassword = TRUE, passwordExpiresAt = ? WHERE id = ?",
    [expiresAt, userId],
  );
}

/*
  Sends the sign-in details to the address the person registered with.
  The result is returned so the admin screen can say whether the email
  actually went out or has to be handed over in person.
*/
export async function deliverCredentials(options: {
  to: string;
  name: string;
  loginEmail: string;
  temporaryPassword: string;
  expiresAt: Date;
  role: "patient" | "doctor" | "secretary";
}) {
  const signInUrl =
    process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";

  return sendAccountCredentialsEmail({
    ...options,
    signInUrl,
  });
}
