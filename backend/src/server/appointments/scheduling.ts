import { sql } from "@/server/database/database";

const MINIMUM_DURATION_MINUTES = 10;
const MAXIMUM_DURATION_MINUTES = 240;
const DEFAULT_DURATION_MINUTES = 30;

/*
  The connection pool reads DATETIME values as UTC (timezone: "Z"),
  so we also have to write them using UTC parts. Otherwise the time
  the doctor picks would drift when the patient reads it back.
*/
export function formatDateTimeForSql(date: Date) {
  const pad = (value: number) =>
    String(value).padStart(2, "0");

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}`;
}

export function normalizeDurationMinutes(value: unknown) {
  const duration = Number(value);

  if (!Number.isFinite(duration)) {
    return DEFAULT_DURATION_MINUTES;
  }

  return Math.min(
    MAXIMUM_DURATION_MINUTES,
    Math.max(MINIMUM_DURATION_MINUTES, Math.round(duration)),
  );
}

/*
  Two appointments of the same doctor may not overlap in time.
  Returns the conflicting appointment when the slot is already taken.
*/
export async function findConflictingAppointment(options: {
  doctorId: string;
  startsAt: Date;
  durationMinutes: number;
  ignoreAppointmentId?: string;
}) {
  const startSql = formatDateTimeForSql(options.startsAt);

  const [conflictRows] = await sql.execute(
    `SELECT a.id, a.scheduled_at AS scheduledAt, a.duration_minutes AS durationMinutes,
       p.name AS patientName
     FROM appointment a
     JOIN patient p ON p.id = a.patient_id
     WHERE a.doctor_id = ?
       AND a.status IN ('Pending', 'Confirmed')
       AND a.id <> ?
       AND a.scheduled_at < DATE_ADD(?, INTERVAL ? MINUTE)
       AND DATE_ADD(a.scheduled_at, INTERVAL a.duration_minutes MINUTE) > ?
     LIMIT 1`,
    [
      options.doctorId,
      options.ignoreAppointmentId ?? "",
      startSql,
      options.durationMinutes,
      startSql,
    ],
  );

  return (conflictRows as any[])[0] ?? null;
}
