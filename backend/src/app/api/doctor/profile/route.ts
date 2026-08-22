import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { publicDoctorById } from "@/server/doctors/public-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function doctorIdOf(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session) return null;

  await databaseReady;

  const [rows] = await sql.execute(
    "SELECT id FROM doctor_profile WHERE user_id = ?",
    [String(session.user?.id ?? "")],
  );

  const found = (rows as any[])[0]?.id;

  return found ? String(found) : null;
}

/*
  A doctor reading their own public profile.

  It returns exactly what a patient would see, from the same function
  the clinic list uses. A separate query here would drift, and the
  doctor would end up editing a page that does not match the one being
  shown to patients.
*/
export async function GET(request: Request) {
  try {
    const doctorId = await doctorIdOf(request);

    if (!doctorId) {
      return Response.json(
        {
          success: false,
          message: "Only a doctor has a doctor profile.",
        },
        { status: 403 },
      );
    }

    return Response.json({
      success: true,
      doctor: await publicDoctorById(doctorId),
    });
  } catch (error) {
    console.error("Doctor profile read error:", error);

    return Response.json(
      { success: false, message: "Your profile could not be loaded." },
      { status: 500 },
    );
  }
}

/*
  The three fields a doctor may change about themselves.

  Their name, licence, specialty and years of experience are not among
  them. Those were checked by an administrator when the application was
  approved, and a profile page that let a doctor rewrite their own
  licence number afterwards would make that check worthless.
*/
export async function PATCH(request: Request) {
  try {
    const doctorId = await doctorIdOf(request);

    if (!doctorId) {
      return Response.json(
        {
          success: false,
          message: "Only a doctor can edit a doctor profile.",
        },
        { status: 403 },
      );
    }

    const body = await request.json();

    const bio =
      typeof body?.bio === "string" ? body.bio.trim().slice(0, 600) : "";

    const languages = Array.isArray(body?.languages)
      ? body.languages
          .map((value: unknown) => String(value).trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];

    let price: number | null = null;

    if (body?.consultationPrice !== null && body?.consultationPrice !== undefined) {
      const value = Number(body.consultationPrice);

      if (!Number.isFinite(value) || value < 0 || value > 100000) {
        return Response.json(
          {
            success: false,
            message: "The consultation price has to be a positive number.",
          },
          { status: 400 },
        );
      }

      price = value;
    }

    await sql.execute(
      `UPDATE doctor_profile
       SET bio = ?, languages = ?, consultation_price = ?
       WHERE id = ?`,
      [
        bio || null,
        languages.length > 0 ? JSON.stringify(languages) : null,
        price,
        doctorId,
      ],
    );

    return Response.json({
      success: true,
      message: "Your profile was saved.",
    });
  } catch (error) {
    console.error("Doctor profile write error:", error);

    return Response.json(
      { success: false, message: "Your profile could not be saved." },
      { status: 500 },
    );
  }
}
