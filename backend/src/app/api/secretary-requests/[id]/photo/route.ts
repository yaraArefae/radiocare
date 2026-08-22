import { readFile } from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { photoContentType } from "@/server/documents/doctor-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/*
  The portrait attached to a secretary application.

  Unlike a doctor's photo this one is not public. A doctor's face is on a
  directory patients browse before they even have an account; an
  applicant for a desk job has sent a picture to the administration and
  nobody else, and it stays that way until they are hired.
*/
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (
      !session ||
      !normalizeRoles(session.user?.role).includes("admin")
    ) {
      return new Response(null, { status: 403 });
    }

    const { id } = await context.params;

    await databaseReady;

    const [rows] = await sql.execute(
      "SELECT photo_path AS photoPath FROM secretary_application WHERE id = ?",
      [String(id)],
    );

    const stored = (rows as Array<{ photoPath: string | null }>)[0]
      ?.photoPath;

    if (!stored) {
      return new Response(null, { status: 404 });
    }

    const absolutePath = path.join(process.cwd(), String(stored));
    const file = await readFile(absolutePath);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": photoContentType(absolutePath),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
