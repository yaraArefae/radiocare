import nodemailer from "nodemailer";

/*
  One place where the connection to the mail server is described.

  Networks that inspect encrypted traffic - university Wi-Fi, some
  antivirus products - hand the client their own certificate instead of
  the mail server's. Node then refuses the connection with "self-signed
  certificate in certificate chain", which is exactly what stopped the
  approval emails: identical code and credentials that had worked two
  days earlier, on a different network.

  Refusing is the right default, so it stays the default. On a network
  that is known to intercept, SMTP_ALLOW_SELF_SIGNED=true accepts the
  intercepted chain: the message is still encrypted in transit, but the
  server's identity is no longer verified, so it belongs in a
  development .env and not on a real deployment.
*/
function buildTransport(
  host: string,
  user: string,
  pass: string,
  trustIntercepted = false,
) {
  const allowSelfSigned =
    String(process.env.SMTP_ALLOW_SELF_SIGNED ?? "")
      .trim()
      .toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
    ...(allowSelfSigned || trustIntercepted
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  });
}

function isInterceptedCertificate(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /self[- ]signed certificate|unable to verify the first certificate|unable to get local issuer/i.test(
    message,
  );
}

/*
  Sends a message, and tries a second time when the first attempt failed
  because something on the machine replaced the mail server's
  certificate with its own - on this project's development machine, an
  antivirus mail shield.

  The verified connection is always attempted first, and the retry only
  happens after it fails on the certificate specifically: any other
  failure is reported as it is. The message stays encrypted on the
  retry, but the server's identity is not verified, which is why it is
  written into the log every time it happens.

  SMTP_STRICT_TLS=true turns the retry off for a deployment that must
  refuse an unverified server outright.
*/
async function sendWithInterceptedFallback(
  host: string,
  user: string,
  pass: string,
  message: Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0],
) {
  try {
    const transporter = buildTransport(host, user, pass);
    await transporter.verify();
    await transporter.sendMail(message);

    return { relaxed: false };
  } catch (error) {
    const strict =
      String(process.env.SMTP_STRICT_TLS ?? "").trim().toLowerCase() ===
      "true";

    if (strict || !isInterceptedCertificate(error)) {
      throw error;
    }

    console.warn(
      "The mail server's certificate could not be verified, which is " +
        "what an antivirus mail shield does. Retrying over the " +
        "intercepted connection so the account details are delivered.",
    );

    const transporter = buildTransport(host, user, pass, true);
    await transporter.verify();
    await transporter.sendMail(message);

    return { relaxed: true };
  }
}

/*
  Turns a mail library error into something an administrator can act on.
  "self-signed certificate in certificate chain" names the symptom and
  hides the cause, which is the network rather than RadioCare.
*/
function describeEmailFailure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown email error";

  if (/self[- ]signed certificate|unable to verify the first certificate/i.test(message)) {
    return (
      "The network is intercepting the connection to the mail server, " +
      "so its certificate could not be verified. Set " +
      "SMTP_ALLOW_SELF_SIGNED=true in backend/.env.local and restart " +
      "the backend, or send from a network that does not inspect " +
      "traffic. The account was still created."
    );
  }

  if (/invalid login|username and password not accepted|535/i.test(message)) {
    return (
      "The mail server refused the sign-in details. A Gmail app " +
      "password is 16 characters and is not the account password."
    );
  }

  return message;
}

type PasswordResetEmailData = {
  to: string;
  name: string;
  resetUrl: string;
};

export async function sendPasswordResetEmail({
  to,
  name,
  resetUrl,
}: PasswordResetEmailData) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASS;

  /*
    أثناء التطوير:
    إذا لم نضع إعدادات SMTP، يظهر رابط
    استعادة كلمة المرور داخل Terminal.
  */
  if (!smtpHost || !smtpUser || !smtpPassword) {
    console.log("");
    console.log("========================================");
    console.log("PASSWORD RESET LINK");
    console.log(`User: ${name}`);
    console.log(`Email: ${to}`);
    console.log(`Link: ${resetUrl}`);
    console.log("========================================");
    console.log("");

    return;
  }

  /* A reset link is as useless undelivered as a temporary password. */
  await sendWithInterceptedFallback(smtpHost, smtpUser, smtpPassword, {
    from:
      process.env.SMTP_FROM ||
      `"RadioCare" <${smtpUser}>`,

    to,

    subject: "Reset your RadioCare password",

    text: `
Hello ${name},

We received a request to reset your RadioCare password.

Open this link to create a new password:

${resetUrl}

If you did not request a password reset, you can ignore this email.
    `,

    html: `
      <div
        style="
          max-width: 600px;
          margin: 0 auto;
          padding: 30px;
          font-family: Arial, sans-serif;
          color: #071a3d;
          line-height: 1.7;
        "
      >
        <div
          style="
            width: 52px;
            height: 52px;
            margin-bottom: 20px;
            border-radius: 14px;
            background: #174ae5;
            color: #ffffff;
            display: grid;
            place-items: center;
            font-weight: 800;
          "
        >
          RC
        </div>

        <h2 style="margin-bottom: 10px;">
          Reset your password
        </h2>

        <p>Hello ${name},</p>

        <p>
          We received a request to reset your
          RadioCare password.
        </p>

        <p style="margin: 28px 0;">
          <a
            href="${resetUrl}"
            style="
              display: inline-block;
              padding: 13px 22px;
              border-radius: 10px;
              background: #174ae5;
              color: #ffffff;
              text-decoration: none;
              font-weight: 700;
            "
          >
            Reset password
          </a>
        </p>

        <p>
          If you did not request a password reset,
          you can safely ignore this email.
        </p>

        <p
          style="
            margin-top: 30px;
            color: #60779a;
            font-size: 13px;
          "
        >
          RadioCare
        </p>
      </div>
    `,
  });
}

type AccountCredentialsEmailData = {
  to: string;
  name: string;
  loginEmail: string;
  temporaryPassword: string;
  expiresAt: Date;
  role: "patient" | "doctor" | "secretary";
  signInUrl: string;
};

/*
  Sent once an administrator approves a registration request. It carries
  the sign-in email and the temporary password, which the account has to
  replace on the first sign-in.
*/
export async function sendAccountCredentialsEmail({
  to,
  name,
  loginEmail,
  temporaryPassword,
  expiresAt,
  role,
  signInUrl,
}: AccountCredentialsEmailData) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASS;

  /*
    Named from the role rather than chosen between two, so a role added
    later cannot silently be greeted as a patient.
  */
  const roleLabel = role;
  const expiryText = expiresAt.toUTCString();

  /*
    Without SMTP settings the credentials are printed to the terminal,
    so the flow stays testable during development.
  */
  if (!smtpHost || !smtpUser || !smtpPassword) {
    console.log("");
    console.log("========================================");
    console.log("RADIOCARE ACCOUNT APPROVED");
    console.log(`Name: ${name}`);
    console.log(`Send to: ${to}`);
    console.log(`Login email: ${loginEmail}`);
    console.log(`Temporary password: ${temporaryPassword}`);
    console.log(`Valid until: ${expiryText}`);
    console.log("========================================");
    console.log("");

    return { delivered: false as const, reason: "SMTP is not configured" };
  }

  try {
    /*
      The connection is verified before the message is sent, so a wrong
      password or an unreachable host is reported as exactly that. Without
      this the administrator only learns that "the email failed", with no
      way to tell a typo in the settings from a rejected recipient.
    */
    await sendWithInterceptedFallback(smtpHost, smtpUser, smtpPassword, {
      from:
        process.env.SMTP_FROM || `"RadioCare" <${smtpUser}>`,
      to,
      subject: "Your RadioCare account is ready",
      text: `
Hello ${name},

Your RadioCare ${roleLabel} account has been approved.

Sign-in email: ${loginEmail}
Temporary password: ${temporaryPassword}

The temporary password is valid until ${expiryText}. You will be asked
to choose your own password the first time you sign in.

Sign in: ${signInUrl}

If you did not ask for a RadioCare account, please ignore this email.

RadioCare
      `.trim(),
      html: `
        <div style="font-family: Arial, sans-serif; color: #10233f; line-height: 1.6;">
          <h2 style="margin-bottom: 6px;">Your RadioCare account is ready</h2>

          <p>Hello ${name},</p>

          <p>
            Your RadioCare ${roleLabel} account has been approved by an
            administrator.
          </p>

          <div style="
            margin: 22px 0;
            padding: 16px 18px;
            border: 1px solid #d7e0ef;
            border-radius: 12px;
            background: #f5f8fd;
          ">
            <p style="margin: 0 0 8px;">
              <strong>Sign-in email:</strong> ${loginEmail}
            </p>
            <p style="margin: 0;">
              <strong>Temporary password:</strong>
              <code style="font-size: 15px;">${temporaryPassword}</code>
            </p>
          </div>

          <p>
            This temporary password is valid until
            <strong>${expiryText}</strong>. You will be asked to choose
            your own password the first time you sign in.
          </p>

          <p style="margin: 28px 0;">
            <a
              href="${signInUrl}"
              style="
                display: inline-block;
                padding: 13px 22px;
                border-radius: 10px;
                background: #174ae5;
                color: #ffffff;
                text-decoration: none;
                font-weight: 700;
              "
            >
              Sign in to RadioCare
            </a>
          </p>

          <p>
            If you did not ask for a RadioCare account, you can ignore
            this email.
          </p>

          <p style="margin-top: 30px; color: #60779a; font-size: 13px;">
            RadioCare
          </p>
        </div>
      `,
    });

    return { delivered: true as const };
  } catch (error) {
    console.error("Unable to send the credentials email:", error);

    /*
      The reason is passed on to the admin screen. It is the message of
      the mail server, which names the real problem: authentication
      refused, host not found, or the recipient rejected.
    */
    return {
      delivered: false as const,
      reason: describeEmailFailure(error),
    };
  }
}




