import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
} from "better-auth/api";
import { admin as adminPlugin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";

import { db } from "./database";
import { sendPasswordResetEmail } from "./email";
import { ac, roles } from "./permissions";

type UserCountResult = {
  count: number;
};

/*
  حساب عدد المستخدمين المسجلين في النظام.
*/
function getUserCount(): number {
  const result = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM "user"
    `)
    .get() as UserCountResult;

  return Number(result.count);
}

/*
  قراءة عنوان IP للمستخدم.
*/
function getRequestIp(headers?: Headers): string | null {
  if (!headers) {
    return null;
  }

  const forwardedFor = headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return headers.get("x-real-ip");
}

/*
  قراءة الإيميل من طلب تسجيل الدخول.
*/
function getEmailFromBody(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
  ) {
    return body.email.trim().toLowerCase();
  }

  return "unknown";
}

export const auth = betterAuth({
  appName: "RadioCare",

  /*
    عنوان وSecret المصادقة من .env.local
  */
  baseURL:
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000",

  secret: process.env.BETTER_AUTH_SECRET,

  /*
    قاعدة بيانات SQLite.
  */
  database: db,

  /*
    تسجيل الدخول بالإيميل وكلمة المرور.
  */
  emailAndPassword: {
    enabled: true,

    /*
      أول حساب فقط يستطيع التسجيل من صفحة Setup.
      سنمنع الحسابات التالية باستخدام Hook.
    */
    disableSignUp: false,
    autoSignIn: true,

    minPasswordLength: 8,
    maxPasswordLength: 128,

    /*
      إغلاق الجلسات القديمة بعد استعادة كلمة المرور.
    */
    revokeSessionsOnPasswordReset: true,

    /*
      رابط استعادة كلمة المرور صالح لمدة 30 دقيقة.
    */
    resetPasswordTokenExpiresIn: 60 * 30,

    sendResetPassword: async ({ user, url }) => {
      /*
        لا ننتظر إرسال الإيميل داخل طلب الاستعادة.
      */
      void sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: url,
      }).catch((error: unknown) => {
        console.error(
          "Failed to send password reset email:",
          error,
        );
      });
    },

    onPasswordReset: async ({ user }) => {
      console.log(
        `Password reset completed for: ${user.email}`,
      );
    },
  },

  /*
    الجلسة تستمر 30 دقيقة ويتم تحديثها
    أثناء استخدام النظام كل 5 دقائق.
  */
  session: {
    expiresIn: 60 * 30,
    updateAge: 60 * 5,
    freshAge: 60 * 5,
  },

  hooks: {
    /*
      منع التسجيل العام بعد إنشاء أول مستخدم.
    */
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-up/email") {
        return;
      }

      const userCount = getUserCount();

      if (userCount > 0) {
        throw new APIError("FORBIDDEN", {
          message:
            "Public registration is disabled. Users must be created by an administrator.",
        });
      }
    }),

    after: createAuthMiddleware(async (context) => {
      /*
        جعل أول مستخدم Admin تلقائيًا.
      */
      if (
        context.path === "/sign-up/email" &&
        context.context.newSession
      ) {
        const userCount = getUserCount();

        if (userCount === 1) {
          const firstUserId =
            context.context.newSession.user.id;

          db.prepare(`
            UPDATE "user"
            SET role = ?
            WHERE id = ?
          `).run("admin", firstUserId);

          console.log(
            "First account created as administrator.",
          );
        }
      }

      /*
        تسجيل جميع محاولات الدخول
        الناجحة والفاشلة.
      */
      if (context.path === "/sign-in/email") {
        const email = getEmailFromBody(context.body);

        const loginSucceeded = Boolean(
          context.context.newSession,
        );

        const ipAddress = getRequestIp(
          context.headers,
        );

        const userAgent =
          context.headers?.get("user-agent") || null;

        db.prepare(`
          INSERT INTO login_attempt (
            email,
            success,
            ip_address,
            user_agent,
            failure_reason
          )
          VALUES (?, ?, ?, ?, ?)
        `).run(
          email,
          loginSucceeded ? 1 : 0,
          ipAddress,
          userAgent,
          loginSucceeded
            ? null
            : "Invalid email or password",
        );
      }
    }),
  },

  plugins: [
    /*
      إضافة الأدوار والصلاحيات.
    */
    adminPlugin({
      ac,
      roles,
      defaultRole: "radiologist",
      adminRoles: ["admin"],
    }),

    /*
      يجب أن يبقى آخر Plugin.
    */
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
