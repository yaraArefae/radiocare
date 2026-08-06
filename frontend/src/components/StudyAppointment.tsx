"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { getStatusStyle } from "@/components/AppointmentCalendar";

/*
  Booking the follow-up visit of one case.

  The conversation with the patient lives in the case thread, not here:
  a second thread on the same page would split the messages, so the
  doctor could answer in one place while the patient wrote in the other.
*/

type Appointment = {
  id: string;
  studyId?: string;
  study_id?: string;
  scheduledAt?: string;
  scheduled_at?: string;
  durationMinutes?: number;
  status?: string;
  notes?: string | null;
  patientResponseNote?: string | null;
};

type Props = {
  studyId: string;
  /* Set by the report when the doctor asked for a follow-up. */
  highlight?: boolean;
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

const durationOptions = [15, 20, 30, 45, 60];

function formatDate(value?: string) {
  if (!value) return "Date not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function StudyAppointment({
  studyId,
  highlight = false,
}: Props) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isScheduling, setIsScheduling] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadAppointment = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await fetch(`${BACKEND_URL}/api/appointments`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ?? "Unable to load the appointment.",
        );
      }

      const appointments: Appointment[] = data.appointments ?? [];

      setAppointment(
        appointments.find(
          (item) =>
            item.studyId === studyId || item.study_id === studyId,
        ) ?? null,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the appointment.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void loadAppointment();
  }, [loadAppointment]);

  async function scheduleAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const selectedDate = new Date(scheduledAt);

    if (!scheduledAt || Number.isNaN(selectedDate.getTime())) {
      setErrorMessage("Please choose the follow-up date and time.");
      return;
    }

    if (selectedDate.getTime() <= Date.now()) {
      setErrorMessage("The follow-up appointment must be in the future.");
      return;
    }

    try {
      setIsScheduling(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(`${BACKEND_URL}/api/appointments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId,
          scheduledAt: selectedDate.toISOString(),
          durationMinutes,
          notes: appointmentNotes.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ?? "Unable to schedule the appointment.",
        );
      }

      setAppointment(data.appointment);
      setSuccessMessage(
        "The appointment was sent to the patient and is waiting for their approval.",
      );
      setScheduledAt("");
      setAppointmentNotes("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to schedule the appointment.",
      );
    } finally {
      setIsScheduling(false);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 text-center backdrop-blur-2xl">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
        <p className="mt-4 font-bold text-white">
          Loading the appointment...
        </p>
      </section>
    );
  }

  const style = getStatusStyle(appointment?.status ?? "Pending");

  return (
    <section
      className={[
        "rounded-3xl border p-7 shadow-xl backdrop-blur-2xl",
        highlight && !appointment
          ? "border-cyan-300/50 bg-cyan-400/10"
          : "border-white/20 bg-white/[0.07]",
      ].join(" ")}
    >
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
        Follow-up
      </p>

      <h2 className="mt-2 text-2xl font-black text-white">
        Review Appointment
      </h2>

      {highlight && !appointment && (
        <p className="mt-4 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-100">
          Your report asks for a follow-up visit. Book it here so the
          patient can approve it.
        </p>
      )}

      {!appointment ? (
        <form onSubmit={scheduleAppointment} className="mt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-slate-200">
              Date and time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
                className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 font-normal text-white outline-none focus:border-cyan-300/60"
              />
            </label>

            <label className="block text-sm font-bold text-slate-200">
              Duration
              <select
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(Number(event.target.value))
                }
                className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 font-normal text-white outline-none focus:border-cyan-300/60"
              >
                {durationOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} minutes
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="mt-5 block text-sm font-bold text-slate-200">
            Notes for the patient
            <textarea
              value={appointmentNotes}
              onChange={(event) =>
                setAppointmentNotes(event.target.value)
              }
              rows={3}
              placeholder="Bring your previous images, come 10 minutes early..."
              className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3.5 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
            />
          </label>

          <button
            type="submit"
            disabled={isScheduling}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-3.5 font-black text-white disabled:opacity-50"
          >
            {isScheduling ? "Sending..." : "Send appointment to patient"}
          </button>
        </form>
      ) : (
        <div className={`mt-6 rounded-3xl border p-5 ${style.chip}`}>
          <p className="text-sm font-bold uppercase tracking-wider">
            {appointment.status ?? "Pending"}
          </p>

          <p className="mt-3 text-xl font-black text-white">
            {formatDate(
              appointment.scheduledAt ?? appointment.scheduled_at,
            )}
          </p>

          <p className="mt-2 text-sm text-slate-300">
            {style.label}
            {appointment.durationMinutes
              ? ` · ${appointment.durationMinutes} minutes`
              : ""}
          </p>

          {appointment.notes && (
            <p className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4 leading-6 text-slate-200">
              {appointment.notes}
            </p>
          )}

          {appointment.patientResponseNote && (
            <p className="mt-3 rounded-2xl border border-white/10 bg-black/15 p-4 leading-6 text-slate-200">
              Patient reply: {appointment.patientResponseNote}
            </p>
          )}

          <Link
            href="/doctor/calendar"
            className="mt-4 inline-flex rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/15"
          >
            Manage in calendar →
          </Link>
        </div>
      )}

      {successMessage && (
        <p className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-200">
          {successMessage}
        </p>
      )}

      {errorMessage && (
        <p className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm font-bold text-rose-200">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
