"use client";

import { useEffect, useState } from "react";

import PasswordChangeGate from "@/components/PasswordChangeGate";
import StudyAppointmentChat from "@/components/StudyAppointmentChat";
import { authClient } from "@/client/auth/auth-client";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Bookable = {
  studyId: string;
  bodyRegion: string;
  patientName: string;
  patientPhone: string;
  patientAge: number;
  uploadedAt: string;
};

type Appointment = {
  id: string;
  studyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
  patientName?: string;
  patientPhone?: string;
  patientAge?: number;
};

const STATUS_STYLES: Record<string, string> = {
  Pending: "border-amber-300/30 bg-amber-400/15 text-amber-200",
  Approved: "border-emerald-300/30 bg-emerald-400/15 text-emerald-200",
  Declined: "border-rose-300/30 bg-rose-400/15 text-rose-200",
  Cancelled: "border-white/20 bg-white/[0.06] text-slate-400",
  Completed: "border-cyan-300/30 bg-cyan-400/15 text-cyan-200",
};

function formatWhen(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/*
  The secretary's whole application: the calendar of the one doctor they
  work for.

  Which doctor that is never appears in this page, and cannot be chosen
  from it. The server reads it from the secretary's own row and writes
  every appointment against it, so there is no field here that could
  address a booking to somebody else's calendar.
*/
export default function SecretaryPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bookable, setBookable] = useState<Bookable[]>([]);
  const [bookingFor, setBookingFor] = useState<Bookable | null>(null);
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("30");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [openChatId, setOpenChatId] = useState("");

  async function load() {
    setLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/appointments`, {
        credentials: "include",
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.message ?? "The calendar could not be loaded.");
        return;
      }

      setAppointments(
        Array.isArray(data.appointments) ? data.appointments : [],
      );
      setError("");

      const bookableResponse = await fetch(
        `${BACKEND_URL}/api/secretary/bookable`,
        { credentials: "include" },
      );

      const bookableData = await bookableResponse.json();

      setBookable(
        bookableData.success && Array.isArray(bookableData.studies)
          ? bookableData.studies
          : [],
      );
    } catch {
      setError("The calendar could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(id: string, action: string, extra?: object) {
    setBusyId(id);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/appointments/${id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "That change could not be saved.");
      }

      setMessage(data.message ?? "Saved.");
      await load();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "That change could not be saved.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function logout() {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      /*
        Sent home whether or not the server confirmed. A failed sign out
        that leaves somebody sitting on a page full of patient names is
        worse than one extra redirect.
      */
      window.location.replace("/");
    }
  }

  async function book() {
    if (!bookingFor) return;

    const parsed = new Date(when);

    if (Number.isNaN(parsed.getTime())) {
      setMessage("Pick a date and a time first.");
      return;
    }

    setBusyId(bookingFor.studyId);
    setMessage("");

    try {
      const response = await fetch(`${BACKEND_URL}/api/appointments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyId: bookingFor.studyId,
          scheduledAt: parsed.toISOString(),
          durationMinutes: Number(duration) || 30,
          notes,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "The visit could not be booked.");
      }

      setMessage(
        `Booked for ${bookingFor.patientName}. They are asked to ` +
          "approve or decline it.",
      );
      setBookingFor(null);
      setWhen("");
      setNotes("");
      await load();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "The visit could not be booked.",
      );
    } finally {
      setBusyId("");
    }
  }

  const upcoming = appointments.filter(
    (item) => new Date(item.scheduledAt).getTime() >= Date.now(),
  );

  const past = appointments.filter(
    (item) => new Date(item.scheduledAt).getTime() < Date.now(),
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      {/*
        A secretary arrives here with the password an administrator
        issued, and this is where she is asked to replace it. The gate
        was mounted on the doctor's and the patient's landing pages only,
        so the temporary password an administrator handed a secretary
        stayed her password, and the expiry recorded against it was
        never read.
      */}
      <PasswordChangeGate />
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
          Secretary
        </p>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="mt-2 text-3xl font-black text-white">
            Doctor&apos;s calendar
          </h1>

          <button
            type="button"
            onClick={logout}
            className="mt-2 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-5 py-3 text-sm font-bold text-rose-200 transition hover:bg-rose-400/20"
          >
            Logout
          </button>
        </div>

        <p className="mt-2 max-w-2xl leading-7 text-slate-300">
          Every appointment in your doctor&apos;s calendar. You can
          cancel one or move it to another time. Patient studies and
          reports are not part of your access.
        </p>

        {message ? (
          <p className="mt-5 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 font-bold text-cyan-100">
            {message}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-8 text-slate-300">Loading...</p>
        ) : error ? (
          <p className="mt-8 rounded-3xl border border-rose-300/30 bg-rose-400/10 px-6 py-5 font-bold text-rose-200">
            {error}
          </p>
        ) : (
          <>
            {/*
              Cases in this doctor's list that have no live visit yet.
              Booking one sends the patient an invitation they approve
              or decline, which is why nothing here is confirmed by the
              secretary alone.
            */}
            <section className="mt-8">
              <h2 className="text-lg font-black text-white">
                Waiting for a visit ({bookable.length})
              </h2>

              {bookable.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-4 text-slate-400">
                  Every case already has a visit booked.
                </p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {bookable.map((item) => (
                    <article
                      key={item.studyId}
                      className="rounded-3xl border border-white/15 bg-white/[0.06] p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-black text-white">
                            {item.patientName}
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            {item.bodyRegion} · {item.patientAge} years
                            {item.patientPhone
                              ? ` · ${item.patientPhone}`
                              : ""}
                          </p>
                        </div>

                        {bookingFor?.studyId !== item.studyId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setBookingFor(item);
                              setMessage("");
                            }}
                            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-sm font-black text-white transition hover:from-cyan-400 hover:to-blue-500"
                          >
                            Book a visit
                          </button>
                        ) : null}
                      </div>

                      {bookingFor?.studyId === item.studyId ? (
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <input
                            type="datetime-local"
                            value={when}
                            onChange={(event) =>
                              setWhen(event.target.value)
                            }
                            className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white focus:border-cyan-300/50 focus:outline-none"
                          />

                          <select
                            value={duration}
                            onChange={(event) =>
                              setDuration(event.target.value)
                            }
                            className="rounded-2xl border border-white/15 bg-[#0a2450] px-4 py-3 text-white focus:border-cyan-300/50 focus:outline-none"
                          >
                            <option value="15">15 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="45">45 minutes</option>
                            <option value="60">60 minutes</option>
                          </select>

                          <input
                            value={notes}
                            onChange={(event) =>
                              setNotes(event.target.value)
                            }
                            placeholder="Note for the patient (optional)"
                            className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none sm:col-span-2"
                          />

                          <div className="flex gap-3 sm:col-span-2">
                            <button
                              type="button"
                              onClick={book}
                              disabled={busyId === item.studyId}
                              className="rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50"
                            >
                              {busyId === item.studyId
                                ? "Booking..."
                                : "Send the invitation"}
                            </button>

                            <button
                              type="button"
                              onClick={() => setBookingFor(null)}
                              className="rounded-2xl border border-white/20 px-6 py-3 font-bold text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <Section
              title={`Upcoming (${upcoming.length})`}
              appointments={upcoming}
              busyId={busyId}
              onAct={act}
              openChatId={openChatId}
              onToggleChat={setOpenChatId}
              actionable
            />

            <Section
              title={`Past (${past.length})`}
              appointments={past}
              busyId={busyId}
              onAct={act}
              openChatId={openChatId}
              onToggleChat={setOpenChatId}
            />
          </>
        )}
      </div>
    </main>
  );
}

function Section({
  title,
  appointments,
  busyId,
  onAct,
  openChatId,
  onToggleChat,
  actionable = false,
}: {
  title: string;
  appointments: Appointment[];
  busyId: string;
  onAct: (id: string, action: string, extra?: object) => void;
  openChatId: string;
  onToggleChat: (id: string) => void;
  actionable?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black text-white">{title}</h2>

      {appointments.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-4 text-slate-400">
          Nothing here.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {appointments.map((item) => (
            <article
              key={item.id}
              className="rounded-3xl border border-white/15 bg-white/[0.06] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">
                    {item.patientName ?? "Patient"}
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    {formatWhen(item.scheduledAt)} ·{" "}
                    {item.durationMinutes} min
                    {item.patientPhone ? ` · ${item.patientPhone}` : ""}
                  </p>
                </div>

                <span
                  className={`rounded-lg border px-3 py-1 text-xs font-black ${
                    STATUS_STYLES[item.status] ?? STATUS_STYLES.Cancelled
                  }`}
                >
                  {item.status}
                </span>
              </div>

              {item.notes ? (
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {item.notes}
                </p>
              ) : null}

              {/*
                The thread the doctor and the patient use to ask for a
                different time. Both write into it, and the secretary is
                the one who acts on what they say, so it belongs on this
                page rather than only on theirs.
              */}
              <button
                type="button"
                onClick={() =>
                  onToggleChat(openChatId === item.id ? "" : item.id)
                }
                className="mt-4 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2 text-sm font-bold text-cyan-200 transition hover:border-cyan-300/50"
              >
                {openChatId === item.id
                  ? "Hide messages"
                  : "Messages about this visit"}
              </button>

              {openChatId === item.id ? (
                <div className="mt-4">
                  <StudyAppointmentChat studyId={item.studyId} />
                </div>
              ) : null}

              {actionable &&
              !["Cancelled", "Declined", "Completed"].includes(
                item.status,
              ) ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      const when = window.prompt(
                        "New date and time, as YYYY-MM-DD HH:MM",
                      );

                      if (!when) return;

                      const parsed = new Date(when.replace(" ", "T"));

                      if (Number.isNaN(parsed.getTime())) {
                        window.alert("That date could not be read.");
                        return;
                      }

                      onAct(item.id, "reschedule", {
                        scheduledAt: parsed.toISOString(),
                      });
                    }}
                    className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25 disabled:opacity-50"
                  >
                    Move
                  </button>

                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Cancel this appointment? The patient is told.",
                        )
                      ) {
                        onAct(item.id, "cancel");
                      }
                    }}
                    className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
