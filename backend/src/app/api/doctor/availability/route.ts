import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";
import { normalizeRoles } from "@/server/messaging/case-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const weekDays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
};

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

function emptyAvailability(): Record<string, DaySchedule> {
  return Object.fromEntries(
    weekDays.map((day) => [
      day,
      { enabled: false, start: "09:00", end: "15:00" },
    ]),
  );
}

/*
  Reads one day out of the request body and keeps only valid times, so a
  broken value can never end up in the calendar.
*/
function readDay(value: unknown): DaySchedule {
  const fallback = { enabled: false, start: "09:00", end: "15:00" };

  if (typeof value !== "object" || value === null) return fallback;

  const day = value as Record<string, unknown>;
  const start = String(day.start ?? "");
  const end = String(day.end ?? "");

  if (!timePattern.test(start) || !timePattern.test(end)) {
    return fallback;
  }

  if (start >= end) {
    return { ...fallback, start, end: start };
  }

  return { enabled: day.enabled === true, start, end };
}

/*
  Returns the working hours of a doctor. A doctor reads their own hours;
  a patient may read the hours of the doctor of their appointment by
  passing ?doctorId=...
*/
export async function GET(request: Request) {
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

    const roles = normalizeRoles(session.user?.role);
    const { searchParams } = new URL(request.url);
    const requestedDoctorId = String(
      searchParams.get("doctorId") ?? "",
    ).trim();

    const doctorId =
      requestedDoctorId && !roles.includes("doctor")
        ? requestedDoctorId
        : String(session.user?.id ?? "");

    if (!roles.includes("doctor") && !requestedDoctorId) {
      return Response.json(
        {
          success: false,
          message: "A doctor id is required.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [rows] = await sql.execute(
      `SELECT full_name AS fullName, specialty, current_workplace AS workplace,
         availability
       FROM doctor_profile
       WHERE user_id = ?
       LIMIT 1`,
      [doctorId],
    );

    const profile = (rows as any[])[0];

    if (!profile) {
      return Response.json(
        { success: false, message: "Doctor profile not found." },
        { status: 404 },
      );
    }

    let availability = emptyAvailability();

    if (profile.availability) {
      try {
        const stored =
          typeof profile.availability === "string"
            ? JSON.parse(profile.availability)
            : profile.availability;

        availability = {
          ...availability,
          ...Object.fromEntries(
            weekDays
              .filter((day) => day in (stored ?? {}))
              .map((day) => [day, readDay(stored[day])]),
          ),
        };
      } catch (error) {
        console.error("Invalid availability JSON:", error);
      }
    }

    return Response.json({
      success: true,
      doctor: {
        id: doctorId,
        fullName: profile.fullName,
        specialty: profile.specialty,
        workplace: profile.workplace,
      },
      availability,
    });
  } catch (error) {
    console.error("Load availability API error:", error);

    return Response.json(
      { success: false, message: "Unable to load the working hours." },
      { status: 500 },
    );
  }
}

/*
  Saves the working hours of the signed in doctor.
*/
export async function PUT(request: Request) {
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

    if (!normalizeRoles(session.user?.role).includes("doctor")) {
      return Response.json(
        { success: false, message: "Doctor access is required." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const submitted = (body?.availability ?? {}) as Record<
      string,
      unknown
    >;

    const availability = Object.fromEntries(
      weekDays.map((day) => [day, readDay(submitted[day])]),
    );

    await databaseReady;

    const [result] = await sql.execute(
      `UPDATE doctor_profile
       SET availability = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE user_id = ?`,
      [JSON.stringify(availability), String(session.user?.id ?? "")],
    );

    if ((result as any).affectedRows === 0) {
      return Response.json(
        {
          success: false,
          message: "Doctor profile not found or not approved yet.",
        },
        { status: 404 },
      );
    }

    return Response.json({ success: true, availability });
  } catch (error) {
    console.error("Save availability API error:", error);

    return Response.json(
      { success: false, message: "Unable to save the working hours." },
      { status: 500 },
    );
  }
}
