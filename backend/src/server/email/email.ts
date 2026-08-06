import nodemailer from "nodemailer";

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

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",

    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  await transporter.sendMail({
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
  role: "patient" | "doctor";
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

  const roleLabel = role === "doctor" ? "doctor" : "patient";
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
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPassword },
    });

    await transporter.sendMail({
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

    return {
      delivered: false as const,
      reason:
        error instanceof Error ? error.message : "Unknown email error",
    };
  }
}




