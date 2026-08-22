import { readFile } from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABELS,
  contentTypeFor,
  type DocumentKind,
} from "@/server/documents/doctor-documents";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; kind: string }>;
};

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const COLUMN_FOR_KIND: Record<DocumentKind, string> = {
  "id-document": "id_document_path",
  "medical-license": "medical_license_path",
  "specialty-certificate": "specialty_certificate_path",
  cv: "cv_path",
};

/*
  Hands one credential document to an administrator.

  These are identity papers and medical licences, so they are kept out of
  the public folder and read only through here, where the role is
  checked first. The path comes from the database rather than from the
  address, so a caller cannot ask for a file of their own choosing.
*/
export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });

    if (!session) {
      return Response.json(
        { success: false, message: "You must sign in first." },
        { status: 401 },
      );
    }

    if (!normalizeRoles(session.user?.role).includes("admin")) {
      return Response.json(
        { success: false, message: "Admin access is required." },
        { status: 403 },
      );
    }

    const { id, kind } = await context.params;

    if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) {
      return Response.json(
        { success: false, message: "Unknown document." },
        { status: 404 },
      );
    }

    const documentKind = kind as DocumentKind;

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT ${COLUMN_FOR_KIND[documentKind]} AS storedPath, full_name AS fullName
       FROM doctor_application
       WHERE id = ?
       LIMIT 1`,
      [String(id || "").trim()],
    );

    const row = (rows as any[])[0];

    if (!row) {
      return Response.json(
        { success: false, message: "Request not found." },
        { status: 404 },
      );
    }

    const storedPath = String(row.storedPath ?? "");

    /*
      Applications sent before the documents were really uploaded hold a
      file name only. Saying so plainly is better than a broken download:
      the administrator has to know the paper was never received.
    */
    if (!storedPath.startsWith("storage/")) {
      return Response.json(
        {
          success: false,
          message: `No file was uploaded for the ${DOCUMENT_LABELS[documentKind]} of this request. It was submitted before documents were stored, and only the file name "${storedPath}" was recorded.`,
        },
        { status: 404 },
      );
    }

    const absolutePath = path.join(process.cwd(), storedPath);

    let contents: Buffer;

    try {
      contents = await readFile(absolutePath);
    } catch {
      return Response.json(
        {
          success: false,
          message: "The stored file is missing from the server.",
        },
        { status: 404 },
      );
    }

    const fileName = `${row.fullName ?? "doctor"} - ${
      DOCUMENT_LABELS[documentKind]
    }${path.extname(storedPath)}`;

    return new Response(new Uint8Array(contents), {
      headers: {
        "Content-Type": contentTypeFor(storedPath),
        /* Shown in the browser; the administrator can still save it. */
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Doctor document API error:", error);

    return Response.json(
      { success: false, message: "Unable to open the document." },
      { status: 500 },
    );
  }
}
