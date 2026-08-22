import { databaseReady } from "@/server/database/database";
import {
  publicDoctorById,
  reviewsForDoctor,
} from "@/server/doctors/public-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/*
  One doctor's profile, with the reviews their rating is made of.

  The reviews travel with the profile rather than behind a second
  request: a rating without the readings behind it is a number to be
  taken on trust, and the whole point of computing it from patients is
  that it does not have to be.
*/
export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;

    await databaseReady;

    const doctor = await publicDoctorById(String(id));

    if (!doctor) {
      return Response.json(
        {
          success: false,
          message: "This doctor was not found.",
        },
        { status: 404 },
      );
    }

    return Response.json({
      success: true,
      doctor,
      reviews: await reviewsForDoctor(doctor.id),
    });
  } catch (error) {
    console.error("Doctor profile API error:", error);

    return Response.json(
      {
        success: false,
        message: "This doctor profile could not be loaded.",
      },
      { status: 500 },
    );
  }
}
