import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/*
  A doctor's profile photograph.

  This is deliberately not part of doctor-documents.ts. Those files are
  a passport and a medical licence, read only through a route that
  checks for an administrator. A profile photo is the opposite: every
  patient browsing a clinic sees it. Storing them together would put one
  permission check between a stranger and somebody's identity papers.
*/
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

/* A face, not a scan. Smaller than the licence limit on purpose. */
const MAXIMUM_FILE_SIZE = 5 * 1024 * 1024;

export function photosDirectory() {
  return path.join(process.cwd(), "storage", "doctor-photos");
}

export function photoContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";

  return "image/jpeg";
}

export type PhotoResult =
  | { ok: true; relativePath: string }
  | { ok: false; message: string };

/*
  Writes one photo and returns the path recorded in the database.

  The name is the owner's id rather than the uploaded file name: a
  doctor replacing their photo should not leave the old one on disk, and
  a file named by whatever the browser sent is a path traversal waiting
  to be tried.
*/
export async function saveDoctorPhoto(
  ownerId: string,
  file: File,
): Promise<PhotoResult> {
  if (file.size === 0) {
    return { ok: false, message: "The selected photo is empty." };
  }

  if (file.size > MAXIMUM_FILE_SIZE) {
    return { ok: false, message: "The photo must be smaller than 5 MB." };
  }

  const extension = path.extname(file.name).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      message: "The photo has to be a JPG, PNG or WEBP image.",
    };
  }

  const directory = photosDirectory();
  await mkdir(directory, { recursive: true });

  const storedName = `${path.basename(ownerId)}${extension}`;
  const absolutePath = path.join(directory, storedName);

  /*
    A doctor who uploads a PNG over an old JPG would otherwise keep
    both, and the stale one would be served whenever the extension is
    guessed rather than read from the database.
  */
  for (const candidate of ALLOWED_EXTENSIONS) {
    if (candidate === extension) continue;

    try {
      await unlink(
        path.join(directory, `${path.basename(ownerId)}${candidate}`),
      );
    } catch {
      /* Nothing to remove is the normal case. */
    }
  }

  await writeFile(
    absolutePath,
    Buffer.from(await file.arrayBuffer()),
  );

  return {
    ok: true,
    relativePath: path
      .join("storage", "doctor-photos", storedName)
      .replaceAll("\\", "/"),
  };
}
