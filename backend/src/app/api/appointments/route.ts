import { randomUUID } from "node:crypto";

import { auth } from "@/server/auth/auth";
import { databaseReady, sql } from "@/server/database/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUser = {
  id?: string;
  role?: string | string[] | null;
};

type ClinicKey =
  | "chest"
  | "bone"
  | "neuro"
  | "cardiac"
  | "abdominal"
  | "dental"
  | "breast"
  | "pediatric"
  | "general";

function normalizeRoles(
  role: SessionUser["role"]
): string[] {
  const values = Array.isArray(role)
    ? role
    : String(role || "").split(",");

  return values
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function clinicKeyFromText(value: string): ClinicKey {
  const text = value.toLowerCase();

  if (
    text.includes("chest") ||
    text.includes("lung") ||
    text.includes("thoracic")
  ) {
    return "chest";
  }

  if (
    text.includes("cardio") ||
    text.includes("heart") ||
    text.includes("cardiac")
  ) {
    return "cardiac";
  }

  if (
    text.includes("bone") ||
    text.includes("ortho") ||
    text.includes("fracture") ||
    text.includes("spine")
  ) {
    return "bone";
  }

  if (
    text.includes("neuro") ||
    text.includes("brain") ||
    text.includes("head") ||
    text.includes("skull")
  ) {
    return "neuro";
  }

  if (
    text.includes("dental") ||
    text.includes("teeth") ||
    text.includes("jaw")
  ) {
    return "dental";
  }

  if (
    text.includes("abdomen") ||
    text.includes("abdominal") ||
    text.includes("pelvis") ||
    text.includes("kidney") ||
    text.includes("liver")
  ) {
    return "abdominal";
  }

  if (
    text.includes("breast") ||
    text.includes("mammography")
  ) {
    return "breast";
  }

  if (
    text.includes("pediatric") ||
    text.includes("child")
  ) {
    return "pediatric";
  }

  return "general";
}

function formatDateTimeForSql(date: Date) {
  const pad = (value: number) =>
    String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

export async function GET(request: Request) {
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
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);
    const isDoctor = roles.includes("doctor");
    const isPatient = roles.includes("patient");

    if (!isDoctor && !isPatient) {
      return Response.json(
        {
          success: false,
          message: "Doctor or patient access is required.",
        },
        { status: 403 },
      );
    }

    await databaseReady;

    const query = isDoctor
      ? `SELECT a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
         a.status, COALESCE(a.notes, '') AS notes,
         p.name AS patientName, p.id AS patientId,
         s.body_region AS bodyRegion, s.priority
         FROM appointment a
         JOIN study s ON s.id = a.study_id
         JOIN patient p ON p.id = a.patient_id
         WHERE a.doctor_id = ?
         ORDER BY a.scheduled_at ASC`
      : `SELECT a.id, a.study_id AS studyId, a.scheduled_at AS scheduledAt,
         a.status, COALESCE(a.notes, '') AS notes,
         dp.full_name AS doctorName, dp.user_id AS doctorId,
         s.body_region AS bodyRegion, s.priority
         FROM appointment a
         JOIN study s ON s.id = a.study_id
         LEFT JOIN doctor_profile dp ON dp.user_id = a.doctor_id
         WHERE a.patient_id = ?
         ORDER BY a.scheduled_at ASC`;

    const [appointmentsRows] = await sql.execute(query, [session.user?.id]);

    return Response.json({
      success: true,
      appointments: appointmentsRows as any[],
    });
  } catch (error) {
    console.error("Appointment list API error:", error);

    return Response.json(
      {
        success: false,
        message: "Unable to load appointments.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
        { status: 401 },
      );
    }

    const roles = normalizeRoles(session.user?.role);

    if (!roles.includes("doctor")) {
      return Response.json(
        {
          success: false,
          message: "Doctor access is required.",
        },
        { status: 403 },
      );
    }

    const body = (await request.json()) as unknown;

    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as any).studyId !== "string" ||
      !((body as any).studyId as string).trim() ||
      typeof (body as any).scheduledAt !== "string" ||
      !((body as any).scheduledAt as string).trim()
    ) {
      return Response.json(
        {
          success: false,
          message:
            "studyId and scheduledAt are required to create an appointment.",
        },
        { status: 400 },
      );
    }

    const studyId = ((body as any).studyId as string).trim();
    const scheduledAtText = ((body as any).scheduledAt as string).trim();
    const notes =
      typeof (body as any).notes === "string"
        ? (body as any).notes.trim()
        : "";

    const scheduledAt = new Date(scheduledAtText);

    if (Number.isNaN(scheduledAt.getTime())) {
      return Response.json(
        {
          success: false,
          message: "The appointment date and time are invalid.",
        },
        { status: 400 },
      );
    }

    await databaseReady;

    const [doctorRows] = await sql.execute(
      `SELECT specialty, subspecialty
       FROM doctor_profile
       WHERE user_id = ?
       LIMIT 1`,
      [session.user?.id],
    );

    const doctorProfile = (doctorRows as any[])[0];

    if (!doctorProfile) {
      return Response.json(
        {
          success: false,
          message:
            "Doctor profile not found or not approved yet.",
        },
        { status: 404 },
      );
    }

    const assignedClinicKey = clinicKeyFromText(
      `${doctorProfile.specialty} ${doctorProfile.subspecialty || ""}`,
    );

    const [studyRows] = await sql.execute(
      `SELECT id, patient_id AS patientId, clinic_key AS clinicKey
       FROM study
       WHERE id = ?
       LIMIT 1`,
      [studyId],
    );

    const study = (studyRows as any[])[0];

    if (!study) {
      return Response.json(
        {
          success: false,
          message: "Study not found.",
        },
        { status: 404 },
      );
    }

    if (study.clinicKey !== assignedClinicKey) {
      return Response.json(
        {
          success: false,
          message:
            "You may only schedule appointments for studies in your assigned clinic.",
        },
        { status: 403 },
      );
    }

    const appointmentId = `AP-${Date.now()}-${randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

    const scheduledAtSql = formatDateTimeForSql(scheduledAt);

    await sql.execute(
      `INSERT INTO appointment
       (id, study_id, patient_id, doctor_id, scheduled_at, status, notes)
       VALUES (?, ?, ?, ?, ?, 'Scheduled', ?)`,
      [
        appointmentId,
        studyId,
        study.patientId,
        session.user?.id,
        scheduledAtSql,
        notes || null,
      ],
    );

    return Response.json({
      success: true,
      appointment: {
        id: appointmentId,
        studyId,
        patientId: study.patientId,
        doctorId: session.user?.id,
        scheduledAt: scheduledAtSql,
        status: "Scheduled",
        notes,
      },
    });
  } catch (error) {
    console.error("Create appointment API error:", error);

    return Response.json(
      {
        success: false,
        message:
          "Unable to schedule the appointment. Please try again.",
      },
      { status: 500 },
    );
  }
}
