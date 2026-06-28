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
      `"RadiologyInsight AI" <${smtpUser}>`,

    to,

    subject: "Reset your RadiologyInsight AI password",

    text: `
Hello ${name},

We received a request to reset your RadiologyInsight AI password.

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
          RI
        </div>

        <h2 style="margin-bottom: 10px;">
          Reset your password
        </h2>

        <p>Hello ${name},</p>

        <p>
          We received a request to reset your
          RadiologyInsight AI password.
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
          RadiologyInsight AI
        </p>
      </div>
    `,
  });
}