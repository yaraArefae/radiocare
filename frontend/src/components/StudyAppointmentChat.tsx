"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

import { getStatusStyle } from "@/components/AppointmentCalendar";

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

type ChatMessage = {
  id: number | string;
  senderId: string;
  senderRole: "doctor" | "patient";
  message: string;
  createdAt: string;
};

type Props = {
  studyId: string;
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000";

export default function StudyAppointmentChat({
  studyId,
}: Props) {
  const [appointment, setAppointment] =
    useState<Appointment | null>(null);

  const [scheduledAt, setScheduledAt] =
    useState("");

  const [appointmentNotes, setAppointmentNotes] =
    useState("");

  const [messages, setMessages] =
    useState<ChatMessage[]>([]);

  const [newMessage, setNewMessage] =
    useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [isScheduling, setIsScheduling] =
    useState(false);

  const [isSending, setIsSending] =
    useState(false);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [successMessage, setSuccessMessage] =
    useState("");

  const loadMessages = useCallback(
    async (appointmentId: string) => {
      try {
        const response = await fetch(
          `${BACKEND_URL}/api/appointments/chat?appointmentId=${encodeURIComponent(
            appointmentId,
          )}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ??
              "Unable to load chat messages.",
          );
        }

        setMessages(data.messages ?? []);
      } catch (error) {
        console.error(error);
      }
    },
    [],
  );

  const loadAppointment = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await fetch(
        `${BACKEND_URL}/api/appointments`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "Unable to load appointment information.",
        );
      }

      const appointments: Appointment[] =
        data.appointments ?? [];

      const studyAppointment =
        appointments.find(
          (item) =>
            item.studyId === studyId ||
            item.study_id === studyId,
        ) ?? null;

      setAppointment(studyAppointment);

      if (studyAppointment?.id) {
        await loadMessages(studyAppointment.id);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load appointment information.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [loadMessages, studyId]);

  useEffect(() => {
    void loadAppointment();
  }, [loadAppointment]);

  useEffect(() => {
    if (!appointment?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadMessages(appointment.id);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [appointment?.id, loadMessages]);

  async function scheduleAppointment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!scheduledAt) {
      setErrorMessage(
        "Please select the follow-up date and time.",
      );
      return;
    }

    const selectedDate = new Date(scheduledAt);

    if (
      Number.isNaN(selectedDate.getTime()) ||
      selectedDate.getTime() <= Date.now()
    ) {
      setErrorMessage(
        "The follow-up appointment must be in the future.",
      );
      return;
    }

    try {
      setIsScheduling(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(
        `${BACKEND_URL}/api/appointments`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            studyId,
            scheduledAt: selectedDate.toISOString(),
            notes: appointmentNotes.trim(),
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "Unable to schedule the appointment.",
        );
      }

      setAppointment(data.appointment);
      setSuccessMessage(
        "The appointment was sent to the patient and is waiting for their approval.",
      );

      setScheduledAt("");
      setAppointmentNotes("");

      if (data.appointment?.id) {
        await loadMessages(data.appointment.id);
      }
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

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const message = newMessage.trim();

    if (!appointment?.id || !message) {
      return;
    }

    try {
      setIsSending(true);
      setErrorMessage("");

      const response = await fetch(
        `${BACKEND_URL}/api/appointments/chat`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            appointmentId: appointment.id,
            message,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ??
            "Unable to send the message.",
        );
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        data.chatMessage,
      ]);

      setNewMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to send the message.",
      );
    } finally {
      setIsSending(false);
    }
  }

  if (isLoading) {
    return (
      <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.07] p-7 text-center backdrop-blur-2xl">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

        <p className="mt-4 font-bold text-white">
          Loading appointment and chat...
        </p>
      </section>
    );
  }

  return (
    <div className="mt-7 grid gap-7 lg:grid-cols-2">
      <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-xl backdrop-blur-2xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
          Follow-up
        </p>

        <h2 className="mt-2 text-2xl font-black text-white">
          Review Appointment
        </h2>

        {!appointment ? (
          <form
            onSubmit={scheduleAppointment}
            className="mt-6"
          >
            <label
              htmlFor="scheduled-at"
              className="block text-sm font-bold text-slate-200"
            >
              Appointment date and time
            </label>

            <input
              id="scheduled-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) =>
                setScheduledAt(event.target.value)
              }
              required
              className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 text-white outline-none focus:border-cyan-300/60"
            />

            <label
              htmlFor="appointment-notes"
              className="mt-5 block text-sm font-bold text-slate-200"
            >
              Appointment notes
            </label>

            <textarea
              id="appointment-notes"
              value={appointmentNotes}
              onChange={(event) =>
                setAppointmentNotes(
                  event.target.value,
                )
              }
              rows={4}
              placeholder="Write instructions for the patient..."
              className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
            />

            <button
              type="submit"
              disabled={isScheduling}
              className="mt-5 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-3.5 font-black text-white disabled:opacity-50"
            >
              {isScheduling
                ? "Scheduling..."
                : "Schedule Follow-up"}
            </button>
          </form>
        ) : (
          <div
            className={`mt-6 rounded-3xl border p-5 ${
              getStatusStyle(appointment.status ?? "Pending").chip
            }`}
          >
            <p className="text-sm font-bold uppercase tracking-wider">
              {appointment.status ?? "Pending"}
            </p>

            <p className="mt-3 text-xl font-black text-white">
              {formatDate(
                appointment.scheduledAt ??
                  appointment.scheduled_at,
              )}
            </p>

            <p className="mt-2 text-sm text-slate-300">
              {getStatusStyle(appointment.status ?? "Pending").label}
              {appointment.durationMinutes
                ? ` · ${appointment.durationMinutes} minutes`
                : ""}
            </p>

            {appointment.notes && (
              <p className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4 leading-6 text-slate-200">
                {appointment.notes}
              </p>
            )}

            {appointment.patientResponseNote && (
              <p className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4 leading-6 text-slate-200">
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
          <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-200">
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm font-bold text-rose-200">
            {errorMessage}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-xl backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
              Private Communication
            </p>

            <h2 className="mt-2 text-2xl font-black text-white">
              Chat with Patient
            </h2>
          </div>

          <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-200">
            Private
          </span>
        </div>

        {!appointment ? (
          <div className="mt-6 flex min-h-80 flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-7 text-center">
            <span className="text-5xl">💬</span>

            <p className="mt-4 font-black text-white">
              Schedule an appointment first
            </p>

            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
              The private chat becomes available after
              scheduling the patient follow-up.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex h-80 flex-col gap-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/10 p-4">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center">
                  <div>
                    <span className="text-5xl">💬</span>

                    <p className="mt-4 font-bold text-white">
                      No messages yet
                    </p>

                    <p className="mt-2 text-sm text-slate-400">
                      Send the first message to the patient.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((chatMessage) => {
                  const isDoctor =
                    chatMessage.senderRole === "doctor";

                  return (
                    <div
                      key={chatMessage.id}
                      className={`flex ${
                        isDoctor
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                          isDoctor
                            ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white"
                            : "border border-white/15 bg-white/[0.08] text-slate-100"
                        }`}
                      >
                        <p className="text-xs font-bold opacity-75">
                          {isDoctor
                            ? "Doctor"
                            : "Patient"}
                        </p>

                        <p className="mt-1 whitespace-pre-wrap break-words leading-6">
                          {chatMessage.message}
                        </p>

                        <p className="mt-2 text-right text-[11px] opacity-65">
                          {formatDate(
                            chatMessage.createdAt,
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              onSubmit={sendMessage}
              className="mt-4 flex gap-3"
            >
              <input
                type="text"
                value={newMessage}
                onChange={(event) =>
                  setNewMessage(event.target.value)
                }
                placeholder="Write a private message..."
                maxLength={2000}
                className="min-w-0 flex-1 rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
              />

              <button
                type="submit"
                disabled={
                  isSending || !newMessage.trim()
                }
                className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3.5 font-black text-white disabled:opacity-50"
              >
                {isSending ? "..." : "Send"}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) {
    return "Date not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}