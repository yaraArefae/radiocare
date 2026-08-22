import { readFile } from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import {
  SECRETARY_DOCUMENT_KINDS,
  SECRETARY_DOCUMENT_LABELS,
  secretaryContentTypeFor,
  type SecretaryDocumentKind,
} from "@/server/documents/secretary-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; kind: string }>;
};

function normalizeRoles(role: string | string[] | null | undefined) {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

const COLUMN_FOR_KIND: Record<SecretaryDocumentKind, string> = {
  "id-document": "id_document_path",
  "qualification-certificate": "qualification_certificate_path",
  "experience-certificate": "experience_certificate_path",
  cv: "cv_path",
};

/*
  Hands one of a secretary's certificates to an administrator.

  These are identity papers and diplomas, so they are kept out of the
  public folder and read only through here, where the role is checked
  first. The path comes from the database rather than from the address,
  so a caller cannot ask for a file of their own choosing.
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

    if (!SECRETARY_DOCUMENT_KINDS.includes(kind as SecretaryDocumentKind)) {
      return Response.json(
        { success: false, message: "Unknown document." },
        { status: 404 },
      );
    }

    const documentKind = kind as SecretaryDocumentKind;

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT ${COLUMN_FOR_KIND[documentKind]} AS storedPath,
              full_name AS fullName
       FROM secretary_application
       WHERE id = ?
       LIMIT 1`,
      [String(id || "").trim()],
    );

    const row = (rows as Array<Record<string, unknown>>)[0];

    if (!row) {
      return Response.json(
        { success: false, message: "Application not found." },
        { status: 404 },
      );
    }

    const storedPath = String(row.storedPath ?? "");

    /*
      The experience letter and the CV are optional, so an empty column
      is a normal answer rather than a fault. Saying which paper is
      missing is more use to an administrator than a broken download.
    */
    if (!storedPath.startsWith("storage/")) {
      return Response.json(
        {
          success: false,
          message: `No ${SECRETARY_DOCUMENT_LABELS[documentKind]} was attached to this application.`,
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

    const fileName = `${row.fullName ?? "secretary"} - ${
      SECRETARY_DOCUMENT_LABELS[documentKind]
    }${path.extname(storedPath)}`;

    return new Response(new Uint8Array(contents), {
      headers: {
        "Content-Type": secretaryContentTypeFor(storedPath),
        /* Shown in the browser; the administrator can still save it. */
        "Content-Disposition": `inline; filename="${fileName.replace(
          /"/g,
          "",
        )}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Secretary document API error:", error);

    return Response.json(
      { success: false, message: "Unable to open the document." },
      { status: 500 },
    );
  }
}
