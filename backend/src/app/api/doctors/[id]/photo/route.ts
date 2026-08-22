import { readFile } from "node:fs/promises";
import path from "node:path";

import { databaseReady, sql } from "@/server/database/database";
import { photoContentType } from "@/server/documents/doctor-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/*
  A doctor's photograph, readable by anyone.

  It needs no session: a patient comparing doctors before they register
  should see the same page a registered one does. Only the path stored
  against that doctor is served, so this route cannot be pointed at any
  other file on disk.
*/
export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT photo_path AS photoPath FROM doctor_profile
       WHERE id = ? AND status = 'Active'`,
      [String(id)],
    );

    const stored = (rows as any[])[0]?.photoPath;

    if (!stored) {
      return new Response(null, { status: 404 });
    }

    const absolutePath = path.join(process.cwd(), String(stored));
    const file = await readFile(absolutePath);

    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": photoContentType(absolutePath),
        /*
          The file name never changes when a doctor replaces their
          photo, so a long cache would show the old face for a day.
        */
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
