import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
} from "better-auth/api";
import { admin as adminPlugin, bearer } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";

import {
  authDatabase,
  databaseReady,
  sql,
} from "@/server/database/database";
import { sendPasswordResetEmail } from "@/server/email/email";
import { ac, roles } from "@/shared/auth/permissions";

/*
  حساب عدد المستخدمين المسجلين في النظام.
*/
async function getUserCount(): Promise<number> {
  await databaseReady;
  const [rows] = await sql.query("SELECT COUNT(*) AS count FROM `user`");
  return Number((rows as Array<{ count: number }>)[0]?.count ?? 0);
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
    Which origins may sign in.

    The library refuses a request whose Origin it does not recognise,
    which is what stops another website from signing your users in
    behind their back. The website itself is covered by baseURL; the
    mobile application needs naming because it is served from its own
    development port, and from the phone's own address when it runs on a
    handset.

    A native app sends no Origin at all, so it never reaches this check
    - only the browser preview does.
  */
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    /* Expo's development server, and the next ports it falls back to. */
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:8090",
    "http://127.0.0.1:8090",
    /* The same bundle opened from a phone on the local network. */
    "http://192.168.4.47:8090",
    /*
      The mobile application running on a phone. A native app has no web
      origin of its own, and the library refuses a request that carries
      none at all, so the app names itself with its own scheme - the one
      registered in app.json - and it is trusted here.
    */
    "radiocare://",
  ],

  /*
    قاعدة بيانات SQLite.
  */
  database: authDatabase,

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

      await databaseReady;
      const userCount = await getUserCount();

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
        const userCount = await getUserCount();

        if (userCount === 1) {
          const firstUserId =
            context.context.newSession.user.id;

          await sql.execute("UPDATE `user` SET role = ? WHERE id = ?", ["admin", firstUserId]);

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

        await sql.execute(
          `INSERT INTO login_attempt
            (email, success, ip_address, user_agent, failure_reason)
           VALUES (?, ?, ?, ?, ?)`,
          [email, loginSucceeded, ipAddress, userAgent,
            loginSucceeded ? null : "Invalid email or password"],
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
      defaultRole: "patient",
      adminRoles: ["admin"],
    }),

    /*
      Lets a caller carry its session as a bearer token instead of a
      cookie.

      The website has no use for this: a browser stores the cookie and
      sends it back on its own. A phone cannot. iOS manages cookies
      inside its own networking layer and ignores a Cookie header the
      application sets by hand, so the session was created correctly and
      then never presented again - the sign-in worked and the very next
      request came back with no user.

      With this plugin the same session can also be presented as
      "Authorization: Bearer <token>", which is a header nothing
      intercepts. Nothing about the cookie path changes, so the website
      keeps working exactly as before.
    */
    bearer(),

    /*
      يجب أن يبقى آخر Plugin.
    */
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
