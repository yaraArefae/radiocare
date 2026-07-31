"use client";

import { useCallback, useEffect, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export type DaySchedule = {
  enabled: boolean;
  start: string;
  end: string;
};

export type Availability = Record<string, DaySchedule>;

const weekDays = [
  { key: "sunday", label: "Sunday" },
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
];

export const emptyAvailability: Availability = Object.fromEntries(
  weekDays.map((day) => [
    day.key,
    { enabled: false, start: "09:00", end: "15:00" },
  ]),
);

/*
  Tells whether a chosen moment falls inside the working hours. An empty
  schedule means the doctor did not set any hours yet, so nothing is
  flagged.
*/
export function isInsideWorkingHours(
  availability: Availability,
  date: Date,
  time: string,
) {
  const hasAnyDay = Object.values(availability).some(
    (day) => day.enabled,
  );

  if (!hasAnyDay) return true;

  const day = availability[weekDays[date.getDay()].key];

  if (!day?.enabled) return false;

  return time >= day.start && time <= day.end;
}

type Props = {
  onLoaded?: (availability: Availability) => void;
};

export default function DoctorAvailability({ onLoaded }: Props) {
  const [availability, setAvailability] =
    useState<Availability>(emptyAvailability);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");

  const loadAvailability = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/doctor/availability`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) return;

      const loaded = { ...emptyAvailability, ...data.availability };
      setAvailability(loaded);
      onLoaded?.(loaded);
    } catch (error) {
      console.error("Unable to load the working hours:", error);
    }
  }, [onLoaded]);

  useEffect(() => {
    void loadAvailability();
  }, [loadAvailability]);

  function updateDay(key: string, patch: Partial<DaySchedule>) {
    setAvailability((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  }

  async function saveAvailability() {
    try {
      setIsSaving(true);
      setMessage("");
      setErrorText("");

      const response = await fetch(
        `${backendBaseUrl}/api/doctor/availability`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ availability }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to save the working hours.",
        );
      }

      setMessage("Your working hours were saved.");
      onLoaded?.(availability);
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "Unable to save the working hours.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const activeDays = weekDays.filter(
    (day) => availability[day.key]?.enabled,
  );

  return (
    <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-2xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Working hours
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            Availability
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            {activeDays.length === 0
              ? "No working days set yet."
              : activeDays
                  .map(
                    (day) =>
                      `${day.label} ${availability[day.key].start}–${
                        availability[day.key].end
                      }`,
                  )
                  .join(" · ")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
        >
          {isOpen ? "Close" : "Edit hours"}
        </button>
      </div>

      {message && (
        <p className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100">
          {message}
        </p>
      )}

      {errorText && (
        <p className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
          {errorText}
        </p>
      )}

      {isOpen && (
        <div className="mt-5">
          <div className="flex flex-col gap-2">
            {weekDays.map((day) => {
              const schedule =
                availability[day.key] ?? emptyAvailability[day.key];

              return (
                <div
                  key={day.key}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/15 p-3"
                >
                  <label className="flex min-w-32 items-center gap-2 text-sm font-bold text-slate-200">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(event) =>
                        updateDay(day.key, {
                          enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-white/30 bg-white/10"
                    />
                    {day.label}
                  </label>

                  <input
                    type="time"
                    value={schedule.start}
                    disabled={!schedule.enabled}
                    onChange={(event) =>
                      updateDay(day.key, { start: event.target.value })
                    }
                    className="rounded-xl border border-white/20 bg-[#17315a] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-40"
                  />

                  <span className="text-slate-400">→</span>

                  <input
                    type="time"
                    value={schedule.end}
                    disabled={!schedule.enabled}
                    onChange={(event) =>
                      updateDay(day.key, { end: event.target.value })
                    }
                    className="rounded-xl border border-white/20 bg-[#17315a] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void saveAvailability()}
            disabled={isSaving}
            className="mt-4 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3 font-black text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save working hours"}
          </button>

          <p className="mt-3 text-xs leading-5 text-slate-400">
            The calendar warns you when you book a visit outside these
            hours. It does not block you, so an urgent case is always
            possible.
          </p>
        </div>
      )}
    </section>
  );
}
