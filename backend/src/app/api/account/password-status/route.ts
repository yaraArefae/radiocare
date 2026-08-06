import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Tells the application whether the signed in account is still using the
  temporary password an administrator handed out. The sign-in screen uses
  it to send the person to the change password page before anything else.
*/
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      "SELECT mustChangePassword, passwordExpiresAt FROM `user` WHERE id = ? LIMIT 1",
      [String(session.user?.id ?? "")],
    );

    const row = (rows as any[])[0];

    const mustChange = Boolean(row?.mustChangePassword);
    const expiresAt = row?.passwordExpiresAt
      ? new Date(row.passwordExpiresAt)
      : null;

    const isExpired = Boolean(
      expiresAt && expiresAt.getTime() <= Date.now(),
    );

    return Response.json({
      success: true,
      mustChangePassword: mustChange,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      expired: mustChange && isExpired,
      message: !mustChange
        ? null
        : isExpired
          ? "Your temporary password has expired. Set a new password to continue."
          : "You are still using the temporary password. Please set your own password.",
    });
  } catch (error) {
    console.error("Password status API error:", error);

    return Response.json(
      { success: false, message: "Unable to read the password status." },
      { status: 500 },
    );
  }
}

/*
  Clears the flag once the account has chosen its own password.
*/
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    await databaseReady;

    await sql.execute(
      "UPDATE `user` SET mustChangePassword = FALSE, passwordExpiresAt = NULL WHERE id = ?",
      [String(session.user?.id ?? "")],
    );

    return Response.json({ success: true });
  } catch (error) {
    console.error("Clear password flag API error:", error);

    return Response.json(
      { success: false, message: "Unable to update the password status." },
      { status: 500 },
    );
  }
}
