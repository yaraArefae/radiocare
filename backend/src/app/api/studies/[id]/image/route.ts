import {
  readFile,
  stat,
} from "node:fs/promises";
import path from "node:path";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { resolveCaseAccess } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ImageRow = {
  imagePath: string;
  fileType: string | null;
  originalFileName: string;
};

function getContentType(
  fileType: string | null,
  filePath: string
) {
  if (fileType) {
    return fileType;
  }

  const extension = path
    .extname(filePath)
    .toLowerCase();

  if (
    extension === ".jpg" ||
    extension === ".jpeg"
  ) {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".dcm") {
    return "application/dicom";
  }

  return "application/octet-stream";
}

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return Response.json(
        {
          success: false,
          message: "You must sign in first.",
        },
        {
          status: 401,
        }
      );
    }

    const { id } = await context.params;
    const studyId = decodeURIComponent(id).trim();

    await databaseReady;

    /*
      The X-ray itself is patient data, so it follows the same access
      rule as the study record.
    */
    const access = await resolveCaseAccess(session.user, studyId, {
      allowAdmin: true,
    });

    if (!access.allowed) {
      return Response.json(
        { success: false, message: access.message },
        { status: access.status },
      );
    }

    const [rows] = await sql.execute(
      `SELECT image_path AS imagePath, file_type AS fileType,
       original_file_name AS originalFileName FROM study WHERE id=? LIMIT 1`,
      [studyId],
    );
    const imageRecord = (rows as ImageRow[])[0];

    if (!imageRecord) {
      return Response.json(
        {
          success: false,
          message: "Study image not found.",
        },
        {
          status: 404,
        }
      );
    }

    const storageDirectory = path.resolve(
      process.cwd(),
      "storage",
      "studies"
    );

    const absoluteImagePath = path.resolve(
      process.cwd(),
      imageRecord.imagePath
    );

    const normalizedStorage =
      storageDirectory.toLowerCase();

    const normalizedImage =
      absoluteImagePath.toLowerCase();

    if (
      !normalizedImage.startsWith(
        `${normalizedStorage}${path.sep}`
      )
    ) {
      return Response.json(
        {
          success: false,
          message: "Invalid image path.",
        },
        {
          status: 403,
        }
      );
    }

    await stat(absoluteImagePath);

    const imageBuffer = await readFile(
      absoluteImagePath
    );

    const contentType = getContentType(
      imageRecord.fileType,
      absoluteImagePath
    );

    return new Response(
      new Uint8Array(imageBuffer),
      {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(
            imageBuffer.length
          ),
          "Cache-Control":
            "private, no-store, max-age=0",
          "Content-Disposition": `inline; filename="${encodeURIComponent(
            imageRecord.originalFileName
          )}"`,
        },
      }
    );
  } catch (error) {
    console.error(
      "Get study image API error:",
      error
    );

    return Response.json(
      {
        success: false,
        message:
          "Unable to load the study image.",
      },
      {
        status: 404,
      }
    );
  }
}
