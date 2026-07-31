"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import AppointmentCalendar, {
  formatTime,
  getCalendarGridRange,
  getStatusStyle,
  toDayKey,
} from "@/components/AppointmentCalendar";
import DoctorAvailability, {
  type Availability,
  emptyAvailability,
  isInsideWorkingHours,
} from "@/components/DoctorAvailability";
import NotificationBell from "@/components/NotificationBell";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type DoctorAppointment = {
  id: string;
  studyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string;
  patientResponseNote: string;
  patientRespondedAt: string | null;
  bodyRegion: string;
  imagingView: string;
  priority: string;
  patientName: string;
  patientId: string;
  patientPhone: string;
  patientAge: number | null;
  patientGender: string;
};

type ClinicCase = {
  id: string;
  patient_name: string;
  body_region: string;
  imaging_view: string;
  priority: string;
  status: string;
  predicted_finding: string;
};

const durationOptions = [15, 20, 30, 45, 60, 90];

function combineDateAndTime(day: Date, timeValue: string) {
  const [hoursText, minutesText] = timeValue.split(":");

  const combined = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number(hoursText),
    Number(minutesText),
    0,
    0,
  );

  return combined;
}

export default function DoctorCalendarPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const userRoles = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }, [session]);

  const isDoctor = userRoles.includes("doctor");

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [clinicCases, setClinicCases] = useState<ClinicCase[]>([]);
  const [clinicName, setClinicName] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [selectedStudyId, setSelectedStudyId] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("09:00");
  const [appointmentDuration, setAppointmentDuration] = useState(30);
  const [appointmentNotes, setAppointmentNotes] = useState("");

  const [rescheduleId, setRescheduleId] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("09:00");
  const [availability, setAvailability] =
    useState<Availability>(emptyAvailability);

  const isOutsideWorkingHours = !isInsideWorkingHours(
    availability,
    selectedDate,
    appointmentTime,
  );

  const loadAppointments = useCallback(async () => {
    const { gridStart, gridEnd } = getCalendarGridRange(visibleMonth);

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/appointments?from=${encodeURIComponent(
          gridStart.toISOString(),
        )}&to=${encodeURIComponent(gridEnd.toISOString())}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load appointments.");
      }

      setAppointments(data.appointments ?? []);
    } catch (error) {
      setAppointments([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load appointments.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [visibleMonth]);

  const loadClinicCases = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/doctor/clinic`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return;
      }

      setClinicCases(data.cases ?? []);
      setClinicName(data.clinic?.name ?? "");
    } catch (error) {
      console.error("Unable to load clinic cases:", error);
    }
  }, []);

  useEffect(() => {
    if (isPending) return;

    if (!session) {
      router.replace("/");
      return;
    }

    if (!isDoctor) {
      router.replace("/unauthorized");
    }
  }, [isDoctor, isPending, router, session]);

  useEffect(() => {
    if (isPending || !session || !isDoctor) return;

    void loadAppointments();
  }, [isDoctor, isPending, loadAppointments, session]);

  useEffect(() => {
    if (isPending || !session || !isDoctor) return;

    void loadClinicCases();
  }, [isDoctor, isPending, loadClinicCases, session]);

  const selectedDayAppointments = useMemo(() => {
    const dayKey = toDayKey(selectedDate);

    return appointments
      .filter((appointment) => toDayKey(appointment.scheduledAt) === dayKey)
      .sort(
        (first, second) =>
          new Date(first.scheduledAt).getTime() -
          new Date(second.scheduledAt).getTime(),
      );
  }, [appointments, selectedDate]);

  const monthStatistics = useMemo(() => {
    const counters = {
      pending: 0,
      confirmed: 0,
      declined: 0,
      total: appointments.length,
    };

    for (const appointment of appointments) {
      if (appointment.status === "Pending") counters.pending += 1;
      if (appointment.status === "Confirmed") counters.confirmed += 1;
      if (appointment.status === "Declined") counters.declined += 1;
    }

    return counters;
  }, [appointments]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedStudyId) {
      setErrorMessage("Please choose the patient case first.");
      return;
    }

    const scheduledAt = combineDateAndTime(selectedDate, appointmentTime);

    if (Number.isNaN(scheduledAt.getTime())) {
      setErrorMessage("Please choose a valid appointment time.");
      return;
    }

    if (scheduledAt.getTime() <= Date.now()) {
      setErrorMessage("The appointment must be in the future.");
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(`${backendBaseUrl}/api/appointments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId: selectedStudyId,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: appointmentDuration,
          notes: appointmentNotes.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to schedule the appointment.",
        );
      }

      setSuccessMessage(
        "The appointment was sent to the patient and is waiting for their approval.",
      );
      setSelectedStudyId("");
      setAppointmentNotes("");

      await loadAppointments();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to schedule the appointment.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function updateAppointment(
    appointmentId: string,
    payload: Record<string, unknown>,
    successText: string,
  ) {
    try {
      setIsSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/appointments/${encodeURIComponent(
          appointmentId,
        )}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to update the appointment.",
        );
      }

      setSuccessMessage(successText);
      setRescheduleId("");

      await loadAppointments();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to update the appointment.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading calendar...</p>
      </main>
    );
  }

  if (!session || !isDoctor) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/doctor/clinic"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50 hover:text-white"
          >
            <span>←</span>
            <span>Back to Clinics</span>
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <NotificationBell />

            <button
              type="button"
              onClick={() => void loadAppointments()}
              disabled={isLoading}
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
            >
              {isLoading ? "Refreshing..." : "Refresh Calendar"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-2xl border border-red-300/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
            >
              Logout
            </button>
          </div>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Doctor Schedule
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Appointments Calendar
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Pick a day, send a follow-up invitation to the patient, and track
            their approval. {clinicName ? `Cases come from the ${clinicName}.` : ""}
          </p>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Appointments this month",
              value: monthStatistics.total,
              hint: "All statuses",
            },
            {
              label: "Waiting for approval",
              value: monthStatistics.pending,
              hint: "Patient has not answered",
            },
            {
              label: "Approved",
              value: monthStatistics.confirmed,
              hint: "Confirmed by the patient",
            },
            {
              label: "Declined",
              value: monthStatistics.declined,
              hint: "Needs a new time",
            },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl"
            >
              <p className="text-sm font-semibold text-slate-400">
                {card.label}
              </p>
              <p className="mt-2 text-3xl font-black text-white">
                {isLoading ? "…" : card.value}
              </p>
              <p className="mt-1 text-xs text-cyan-200">{card.hint}</p>
            </article>
          ))}
        </section>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div className="mt-6 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 font-bold text-emerald-100">
            {successMessage}
          </div>
        )}

        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <AppointmentCalendar
              appointments={appointments.map((appointment) => ({
                id: appointment.id,
                scheduledAt: appointment.scheduledAt,
                status: appointment.status,
                title: appointment.patientName,
              }))}
              visibleMonth={visibleMonth}
              selectedDate={selectedDate}
              onVisibleMonthChange={setVisibleMonth}
              onSelectDate={setSelectedDate}
              isLoading={isLoading}
            />
          </div>

          <div className="flex flex-col gap-6">
            <DoctorAvailability onLoaded={setAvailability} />

            <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 shadow-lg backdrop-blur-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
                Selected day
              </p>

              <h2 className="mt-2 text-2xl font-black text-white">
                {selectedDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </h2>

              {selectedDayAppointments.length === 0 ? (
                <p className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/[0.04] p-5 text-sm text-slate-300">
                  No appointments on this day yet.
                </p>
              ) : (
                <div className="mt-5 flex flex-col gap-4">
                  {selectedDayAppointments.map((appointment) => {
                    const style = getStatusStyle(appointment.status);

                    return (
                      <article
                        key={appointment.id}
                        className="rounded-3xl border border-white/15 bg-white/[0.05] p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-black text-white">
                              {formatTime(appointment.scheduledAt)} ·{" "}
                              {appointment.durationMinutes} min
                            </p>
                            <p className="mt-1 font-bold text-cyan-200">
                              {appointment.patientName}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {appointment.bodyRegion} · {appointment.priority}
                            </p>
                          </div>

                          <span
                            className={`rounded-full border px-3 py-1.5 text-xs font-black ${style.chip}`}
                          >
                            {appointment.status}
                          </span>
                        </div>

                        {appointment.notes && (
                          <p className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3 text-sm leading-6 text-slate-200">
                            {appointment.notes}
                          </p>
                        )}

                        {appointment.patientResponseNote && (
                          <p className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm leading-6 text-cyan-100">
                            Patient reply: {appointment.patientResponseNote}
                          </p>
                        )}

                        {rescheduleId === appointment.id ? (
                          <div className="mt-4 rounded-2xl border border-white/15 bg-black/20 p-4">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                              New time on{" "}
                              {selectedDate.toLocaleDateString("en-US", {
                                day: "numeric",
                                month: "short",
                              })}
                            </label>

                            <input
                              type="time"
                              value={rescheduleTime}
                              onChange={(event) =>
                                setRescheduleTime(event.target.value)
                              }
                              className="mt-2 w-full rounded-xl border border-white/20 bg-[#17315a] px-3 py-2.5 text-white outline-none focus:border-cyan-300/60"
                            />

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() =>
                                  void updateAppointment(
                                    appointment.id,
                                    {
                                      action: "reschedule",
                                      scheduledAt: combineDateAndTime(
                                        selectedDate,
                                        rescheduleTime,
                                      ).toISOString(),
                                      durationMinutes:
                                        appointment.durationMinutes,
                                    },
                                    "The new time was sent to the patient for approval.",
                                  )
                                }
                                className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-400 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                              >
                                Save new time
                              </button>

                              <button
                                type="button"
                                onClick={() => setRescheduleId("")}
                                className="rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setRescheduleId(appointment.id);
                                setRescheduleTime(
                                  formatTimeInputValue(
                                    appointment.scheduledAt,
                                  ),
                                );
                              }}
                              className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
                            >
                              Reschedule
                            </button>

                            {appointment.status !== "Completed" &&
                              appointment.status !== "Cancelled" && (
                                <>
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() =>
                                      void updateAppointment(
                                        appointment.id,
                                        { action: "complete" },
                                        "The appointment was marked as completed.",
                                      )
                                    }
                                    className="rounded-xl border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-sm font-bold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
                                  >
                                    Mark completed
                                  </button>

                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() =>
                                      void updateAppointment(
                                        appointment.id,
                                        { action: "cancel" },
                                        "The appointment was cancelled.",
                                      )
                                    }
                                    className="rounded-xl border border-rose-300/30 bg-rose-400/15 px-4 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-400/25 disabled:opacity-50"
                                  >
                                    Cancel visit
                                  </button>
                                </>
                              )}

                            <Link
                              href={`/studies/${encodeURIComponent(
                                appointment.studyId,
                              )}`}
                              className="rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-300/40 hover:text-white"
                            >
                              Open case
                            </Link>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 shadow-lg backdrop-blur-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
                New appointment
              </p>

              <h2 className="mt-2 text-2xl font-black text-white">
                Invite a patient
              </h2>

              <form onSubmit={createAppointment} className="mt-5">
                <label
                  htmlFor="calendar-study"
                  className="block text-sm font-bold text-slate-200"
                >
                  Patient case
                </label>

                <select
                  id="calendar-study"
                  value={selectedStudyId}
                  onChange={(event) =>
                    setSelectedStudyId(event.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3 text-white outline-none focus:border-cyan-300/60"
                >
                  <option value="">Select a case...</option>

                  {clinicCases.map((clinicCase) => (
                    <option key={clinicCase.id} value={clinicCase.id}>
                      {clinicCase.patient_name} — {clinicCase.body_region} (
                      {clinicCase.id})
                    </option>
                  ))}
                </select>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="calendar-time"
                      className="block text-sm font-bold text-slate-200"
                    >
                      Time
                    </label>

                    <input
                      id="calendar-time"
                      type="time"
                      value={appointmentTime}
                      onChange={(event) =>
                        setAppointmentTime(event.target.value)
                      }
                      required
                      className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3 text-white outline-none focus:border-cyan-300/60"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="calendar-duration"
                      className="block text-sm font-bold text-slate-200"
                    >
                      Duration
                    </label>

                    <select
                      id="calendar-duration"
                      value={appointmentDuration}
                      onChange={(event) =>
                        setAppointmentDuration(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3 text-white outline-none focus:border-cyan-300/60"
                    >
                      {durationOptions.map((option) => (
                        <option key={option} value={option}>
                          {option} minutes
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label
                  htmlFor="calendar-notes"
                  className="mt-4 block text-sm font-bold text-slate-200"
                >
                  Notes for the patient
                </label>

                <textarea
                  id="calendar-notes"
                  rows={3}
                  value={appointmentNotes}
                  onChange={(event) =>
                    setAppointmentNotes(event.target.value)
                  }
                  placeholder="Bring your previous images, come 10 minutes early..."
                  className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
                />

                {isOutsideWorkingHours && (
                  <p className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm font-bold text-amber-100">
                    This time is outside your working hours. You can still
                    book it if the case is urgent.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSaving}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-3.5 font-black text-white disabled:opacity-50"
                >
                  {isSaving
                    ? "Sending..."
                    : `Send invitation for ${selectedDate.toLocaleDateString(
                        "en-US",
                        { day: "numeric", month: "short" },
                      )}`}
                </button>

                <p className="mt-3 text-xs leading-5 text-slate-400">
                  The patient receives the appointment on their dashboard and
                  has to approve it before it becomes confirmed.
                </p>
              </form>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatTimeInputValue(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "09:00";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
