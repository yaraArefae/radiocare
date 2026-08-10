/*
  Checks the mail settings and sends one test message.

  Run it after filling the SMTP values in .env.local:

      node scripts/check-email.mjs you@example.com

  It reports which step failed, so a wrong password is never mistaken
  for an unreachable server.
*/
import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

function loadEnvironmentFile(fileName) {
  try {
    const contents = readFileSync(
      path.join(process.cwd(), fileName),
      "utf8",
    );

    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);

      if (!match) continue;

      const [, key, rawValue] = match;

      if (process.env[key]) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* The file is optional: the values may come from the environment. */
  }
}

loadEnvironmentFile(".env.local");
loadEnvironmentFile(".env");

const recipient = process.argv[2];

if (!recipient) {
  console.error("Usage: node scripts/check-email.mjs you@example.com");
  process.exit(1);
}

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

const missing = [
  !host && "SMTP_HOST",
  !user && "SMTP_USER",
  !pass && "SMTP_PASS",
].filter(Boolean);

if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  console.error("Nothing can be sent until these are filled in.");
  process.exit(1);
}

const port = Number(process.env.SMTP_PORT || 587);
const secure = process.env.SMTP_SECURE === "true";

console.log(`Host      ${host}:${port} (secure: ${secure})`);
console.log(`User      ${user}`);
console.log(`Recipient ${recipient}`);
console.log("");

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

try {
  await transporter.verify();
  console.log("Connection and sign in: OK");
} catch (error) {
  console.error("Connection or sign in FAILED");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  console.error(
    "For Gmail this usually means the value in SMTP_PASS is the account\n" +
      "password rather than a 16 character app password, or that two step\n" +
      "verification is not switched on for the account.",
  );
  process.exit(1);
}

try {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `"RadioCare" <${user}>`,
    to: recipient,
    subject: "RadioCare mail settings test",
    text:
      "This is a test message from RadioCare.\n\n" +
      "If you are reading it, approving a patient will now deliver their\n" +
      "sign in details by email.",
  });

  console.log(`Message sent: ${info.messageId}`);
  console.log(`Accepted for: ${(info.accepted || []).join(", ")}`);

  if ((info.rejected || []).length > 0) {
    console.log(`Rejected: ${info.rejected.join(", ")}`);
  }
} catch (error) {
  console.error("The message was NOT sent");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
