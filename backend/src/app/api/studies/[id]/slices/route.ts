import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { resolveCaseAccess } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8001";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/*
  Turns a stored volume into a picture the doctor's browser can play.

  A CT arrives as a .nii.gz or a folder of DICOM files, and a doctor
  handed one has a download they cannot open. Only the AI service knows
  how to read those formats, so the file is sent there and comes back as
  a single PNG holding every slice in a grid, which the viewer cuts up
  and plays like a reel.

  The rendered sheet is written beside the study and reused. Rendering a
  three hundred slice CT takes seconds, and a doctor scrolling back and
  forth through a case would pay it on every request.
*/
export async function GET(request: Request, context: RouteContext) {
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

    const { id } = await context.params;

    await databaseReady;

    /*
      The same access rule the image route uses. A rendered volume is
      the study itself, so it cannot be easier to reach than the file it
      was rendered from.
    */
    const access = await resolveCaseAccess(
      session.user,
      String(id),
      { allowAdmin: true },
    );

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    const [rows] = await sql.execute(
      `SELECT image_path AS imagePath, original_file_name AS originalFileName,
              study_kind AS studyKind
       FROM study WHERE id = ?`,
      [String(id)],
    );

    const study = (rows as any[])[0];

    if (!study) {
      return Response.json(
        { success: false, message: "This study was not found." },
        { status: 404 },
      );
    }

    if (String(study.studyKind) !== "VOLUME") {
      return Response.json(
        {
          success: false,
          message: "This study is a single image, not a volume.",
        },
        { status: 400 },
      );
    }

    const cacheDirectory = path.join(
      process.cwd(),
      "storage",
      "rendered-slices",
    );

    const cachePath = path.join(cacheDirectory, `${String(id)}.png`);
    const metaPath = path.join(cacheDirectory, `${String(id)}.json`);

    try {
      const [cached, meta] = await Promise.all([
        readFile(cachePath),
        readFile(metaPath, "utf-8"),
      ]);

      return new Response(new Uint8Array(cached), {
        headers: {
          "Content-Type": "image/png",
          "X-Slice-Layout": meta,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      /* Nothing rendered yet, which is the normal first visit. */
    }

    const fileBytes = await readFile(
      path.join(process.cwd(), String(study.imagePath)),
    );

    const form = new FormData();
    form.append(
      "study",
      new Blob([new Uint8Array(fileBytes)]),
      String(study.originalFileName),
    );

    const rendered = await fetch(`${AI_SERVICE_URL}/render/volume`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });

    if (!rendered.ok) {
      return Response.json(
        {
          success: false,
          message:
            "This study could not be rendered. Is the AI service running?",
        },
        { status: 503 },
      );
    }

    const png = Buffer.from(await rendered.arrayBuffer());

    const layout = JSON.stringify({
      sliceCount: Number(rendered.headers.get("X-Slice-Count") ?? 0),
      columns: Number(rendered.headers.get("X-Slice-Columns") ?? 1),
      rows: Number(rendered.headers.get("X-Slice-Rows") ?? 1),
      tileWidth: Number(rendered.headers.get("X-Tile-Width") ?? 0),
      tileHeight: Number(rendered.headers.get("X-Tile-Height") ?? 0),
      originalDepth: Number(rendered.headers.get("X-Original-Depth") ?? 0),
    });

    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachePath, png);
    await writeFile(metaPath, layout, "utf-8");

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "X-Slice-Layout": layout,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Slice rendering error:", error);

    return Response.json(
      { success: false, message: "This study could not be rendered." },
      { status: 500 },
    );
  }
}
