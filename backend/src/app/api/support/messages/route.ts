import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import {
  createNotification,
  notifyAdmins,
} from "@/server/notifications/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  One thread between a doctor or a patient and the administration.

  Whose thread it is decides everything here. A doctor and a patient
  only ever reach their own; an administrator reaches any of them by
  naming it, because the administration answers all of them.
*/

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

type Viewer = {
  id: string;
  name: string;
  isAdmin: boolean;
  role: "admin" | "doctor" | "patient";
};

async function readViewer(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user?.id) return null;

  const roles = normalizeRoles(session.user.role);
  const isAdmin = roles.includes("admin");

  const role: Viewer["role"] = isAdmin
    ? "admin"
    : roles.includes("doctor")
      ? "doctor"
      : "patient";

  return {
    id: session.user.id,
    name: session.user.name ?? "",
    isAdmin,
    role,
  } satisfies Viewer;
}

/*
  Which thread this request is about, and whether the viewer may open
  it. An administrator has to name the thread; everybody else is only
  ever allowed into their own, whatever they ask for.
*/
function resolveThreadOwner(viewer: Viewer, requested: string | null) {
  if (!viewer.isAdmin) return viewer.id;

  const owner = (requested ?? "").trim();

  return owner || null;
}

export async function GET(request: Request) {
  try {
    const viewer = await readViewer(request);

    if (!viewer) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const ownerId = resolveThreadOwner(viewer, url.searchParams.get("userId"));

    if (!ownerId) {
      return Response.json(
        { success: false, message: "userId is required." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [ownerRows] = await sql.execute(
      "SELECT id, name, email, role FROM `user` WHERE id = ? LIMIT 1",
      [ownerId],
    );

    const owner = (ownerRows as any[])[0];

    if (!owner) {
      return Response.json(
        { success: false, message: "The account was not found." },
        { status: 404 },
      );
    }

    if (normalizeRoles(owner.role).includes("admin")) {
      return Response.json(
        {
          success: false,
          message: "Administrators do not have a support thread.",
        },
        { status: 400 },
      );
    }

    const [messageRows] = await sql.execute(
      `SELECT id, sender_id AS senderId, sender_role AS senderRole,
              message, is_read AS isRead, created_at AS createdAt
       FROM support_message
       WHERE user_id = ?
       ORDER BY created_at ASC`,
      [ownerId],
    );

    /*
      Opening the thread is what marks it read, and only the messages
      written by the other side: a viewer never marks their own.
    */
    if (viewer.isAdmin) {
      await sql.execute(
        `UPDATE support_message SET is_read = TRUE
         WHERE user_id = ? AND sender_role <> 'admin' AND is_read = FALSE`,
        [ownerId],
      );
    } else {
      await sql.execute(
        `UPDATE support_message SET is_read = TRUE
         WHERE user_id = ? AND sender_role = 'admin' AND is_read = FALSE`,
        [ownerId],
      );
    }

    return Response.json({
      success: true,
      thread: {
        userId: owner.id,
        userName: owner.name,
        userEmail: owner.email,
        userRole: normalizeRoles(owner.role)[0] ?? "patient",
      },
      messages: messageRows as any[],
    });
  } catch (error) {
    console.error("Load support messages API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the messages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await readViewer(request);

    if (!viewer) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as unknown;
    const text =
      typeof body === "object" && body !== null
        ? String((body as any).message ?? "").trim()
        : "";

    if (!text) {
      return Response.json(
        { success: false, message: "The message is required." },
        { status: 400 },
      );
    }

    const requested =
      typeof body === "object" && body !== null
        ? String((body as any).userId ?? "")
        : "";

    const ownerId = resolveThreadOwner(viewer, requested);

    if (!ownerId) {
      return Response.json(
        { success: false, message: "userId is required." },
        { status: 400 },
      );
    }

    await databaseReady;

    const [ownerRows] = await sql.execute(
      "SELECT id, name, role FROM `user` WHERE id = ? LIMIT 1",
      [ownerId],
    );

    const owner = (ownerRows as any[])[0];

    if (!owner) {
      return Response.json(
        { success: false, message: "The account was not found." },
        { status: 404 },
      );
    }

    const ownerRoles = normalizeRoles(owner.role);

    if (ownerRoles.includes("admin")) {
      return Response.json(
        {
          success: false,
          message: "Administrators do not have a support thread.",
        },
        { status: 400 },
      );
    }

    const [insertResult] = await sql.execute(
      `INSERT INTO support_message
         (user_id, sender_id, sender_role, message)
       VALUES (?, ?, ?, ?)`,
      [ownerId, viewer.id, viewer.role, text],
    );

    /*
      The other side is told about the message, so neither has to keep
      the page open to find out. A message to the administration goes to
      all of them, since any of them can answer it.
    */
    if (viewer.isAdmin) {
      await createNotification({
        userId: ownerId,
        userRole: ownerRoles.includes("doctor") ? "doctor" : "patient",
        type: "support_message",
        title: "New message from the administration",
        body: text.slice(0, 300),
        link: "/support",
      });
    } else {
      await notifyAdmins({
        type: "support_message",
        title: `New message from ${viewer.name || "a user"}`,
        body: text.slice(0, 300),
        link: `/admin/messages?userId=${ownerId}`,
      });
    }

    return Response.json({
      success: true,
      supportMessage: {
        id: (insertResult as any).insertId,
        senderId: viewer.id,
        senderRole: viewer.role,
        message: text,
        isRead: false,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Send support message API error:", error);

    return Response.json(
      { success: false, message: "Unable to send the message." },
      { status: 500 },
    );
  }
}
