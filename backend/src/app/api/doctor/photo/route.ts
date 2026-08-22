import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { saveDoctorPhoto } from "@/server/documents/doctor-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  A doctor replacing their own photograph.

  The doctor is taken from the session and never from the request. A
  doctor id in the body would let any signed in doctor overwrite a
  colleague's photo, which is both a defacement and a way to put a
  stranger's face beside somebody else's licence number.
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

    const [rows] = await sql.execute(
      "SELECT id FROM doctor_profile WHERE user_id = ?",
      [String(session.user?.id ?? "")],
    );

    const doctorId = (rows as any[])[0]?.id;

    if (!doctorId) {
      return Response.json(
        {
          success: false,
          message: "Only a doctor can change a doctor photo.",
        },
        { status: 403 },
      );
    }

    const form = await request.formData();
    const photo = form.get("photo");

    if (!(photo instanceof File)) {
      return Response.json(
        { success: false, message: "Please choose a photo." },
        { status: 400 },
      );
    }

    const saved = await saveDoctorPhoto(String(doctorId), photo);

    if (!saved.ok) {
      return Response.json(
        { success: false, message: saved.message },
        { status: 400 },
      );
    }

    await sql.execute(
      "UPDATE doctor_profile SET photo_path = ? WHERE id = ?",
      [saved.relativePath, doctorId],
    );

    return Response.json({
      success: true,
      message: "Your photo was updated.",
      photoUrl: `/api/doctors/${doctorId}/photo`,
    });
  } catch (error) {
    console.error("Doctor photo API error:", error);

    return Response.json(
      { success: false, message: "Your photo could not be saved." },
      { status: 500 },
    );
  }
}
