"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AppointmentCalendar, {
  formatTime,
  getStatusStyle,
  toDayKey,
} from "@/components/AppointmentCalendar";
import CaseChat from "@/components/CaseChat";
import CaseReport from "@/components/CaseReport";
import RateDoctor from "@/components/RateDoctor";
import SupportInboxCard from "@/components/SupportInboxCard";
import NotificationBell from "@/components/NotificationBell";
import PasswordChangeGate from "@/components/PasswordChangeGate";
import { authClient } from "@/client/auth/auth-client";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  role?: string | string[] | null;
};

type AppointmentItem = {
  id: string;
  studyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string;
  patientResponseNote: string;
  bodyRegion: string;
  priority: string;
  doctorName?: string;
  doctorId?: string;
  doctorSpecialty?: string;
  doctorWorkplace?: string;
};

type ChatMessage = {
  id: number | string;
  senderId: string;
  senderRole: "doctor" | "patient";
  message: string;
  createdAt: string;
};

type CaseThread = {
  studyId: string;
  bodyRegion: string;
  imagingView: string;
  priority: string;
  createdAt: string;
  isAbnormal: boolean;
  primaryFinding: string | null;
  lastMessage: string;
  lastMessageRole: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

function getAppointmentReminderText(scheduledAt: string) {
  const date = new Date(scheduledAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "This appointment is happening now or has already started.";
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);

  if (diffDays > 0) {
    return `Reminder: ${diffDays} day${diffDays === 1 ? "" : "s"} to go.`;
  }

  if (diffHours > 0) {
    return `Reminder: ${diffHours} hour${diffHours === 1 ? "" : "s"} to go.`;
  }

  return `Reminder: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} to go.`;
}

export default function PatientDashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const currentUser = session?.user as SessionUser | undefined;

  const userRoles = (
    Array.isArray(currentUser?.role)
      ? currentUser.role
      : (currentUser?.role ?? "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const isPatient = userRoles.includes("patient");
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [activeAppointment, setActiveAppointment] = useState<AppointmentItem | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [isLoadingAppointments, setIsLoadingAppointments] = useState(true);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string>("");

  const [caseThreads, setCaseThreads] = useState<CaseThread[]>([]);
  /*
    The follow-up section is folded away by default. It carries a card
    per case and a whole conversation, which pushed the rest of the page
    far down; the unread count stays visible on the closed header so
    nothing is hidden without a trace.
  */
  const [isMessagesOpen, setIsMessagesOpen] = useState(false);

  /* Unread messages across all cases, shown on the closed header. */
  const unreadMessageCount = useMemo(
    () => caseThreads.reduce((total, item) => total + item.unreadCount, 0),
    [caseThreads],
  );

  /*
    An unread answer from a doctor opens the section by itself. Folding
    the page tidily is worth nothing if it buries the reply the patient
    is waiting for.
  */
  useEffect(() => {
    if (unreadMessageCount > 0) setIsMessagesOpen(true);
  }, [unreadMessageCount]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [isLoadingCases, setIsLoadingCases] = useState(true);

  const [visibleMonth, setVisibleMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [respondingId, setRespondingId] = useState<string>("");
  const [responseNote, setResponseNote] = useState<string>("");
  const [appointmentMessage, setAppointmentMessage] = useState<string>("");
  const [appointmentError, setAppointmentError] = useState<string>("");

  const pendingAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) => appointment.status === "Pending",
      ),
    [appointments],
  );

  const selectedDayAppointments = useMemo(() => {
    const dayKey = toDayKey(selectedDate);

    return appointments.filter(
      (appointment) => toDayKey(appointment.scheduledAt) === dayKey,
    );
  }, [appointments, selectedDate]);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
      return;
    }

    if (!isPending && session && !isPatient) {
      router.replace("/unauthorized");
      return;
    }

    if (!isPending && session && isPatient) {
      void loadAppointments();
      void loadCaseThreads();
    }
  }, [isPatient, isPending, router, session]);

  async function loadCaseThreads() {
    try {
      setIsLoadingCases(true);

      const response = await fetch(`${BACKEND_URL}/api/cases`, {
        credentials: "include",
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load your cases.");
      }

      setCaseThreads(result.cases || []);
    } catch (error) {
      console.error("Unable to load patient cases:", error);
      setCaseThreads([]);
    } finally {
      setIsLoadingCases(false);
    }
  }

  async function loadAppointments() {
    try {
      setIsLoadingAppointments(true);
      const response = await fetch(
        `${BACKEND_URL}/api/appointments`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to load appointments.");
      }

      setAppointments(result.appointments || []);
    } catch (error) {
      console.error("Unable to load patient appointments:", error);
      setAppointments([]);
    } finally {
      setIsLoadingAppointments(false);
    }
  }

  async function respondToAppointment(
    appointment: AppointmentItem,
    action: "confirm" | "decline",
  ) {
    try {
      setAppointmentError("");
      setAppointmentMessage("");

      const response = await fetch(
        `${BACKEND_URL}/api/appointments/${encodeURIComponent(
          appointment.id,
        )}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            responseNote:
              respondingId === appointment.id ? responseNote.trim() : "",
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to answer this appointment.",
        );
      }

      setAppointmentMessage(
        action === "confirm"
          ? "You approved the appointment. Your doctor has been notified."
          : "You declined the appointment. Your doctor will suggest another time.",
      );

      setRespondingId("");
      setResponseNote("");

      await loadAppointments();
    } catch (error) {
      setAppointmentError(
        error instanceof Error
          ? error.message
          : "Unable to answer this appointment.",
      );
    }
  }

  async function loadChatMessages(appointmentId: string) {
    try {
      setChatError("");
      setIsLoadingChat(true);
      const response = await fetch(
        `${BACKEND_URL}/api/appointments/chat?appointmentId=${encodeURIComponent(appointmentId)}`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to load chat messages.");
      }

      setChatMessages(result.messages || []);
    } catch (error) {
      setChatError(
        error instanceof Error
          ? error.message
          : "Unable to load chat messages.",
      );
    } finally {
      setIsLoadingChat(false);
    }
  }

  async function selectAppointment(appointment: AppointmentItem) {
    setActiveAppointment(appointment);
    setChatMessages([]);
    setChatInput("");
    await loadChatMessages(appointment.id);
  }

  async function sendChatMessage() {
    if (!activeAppointment) {
      return;
    }

    if (!chatInput.trim()) {
      setChatError("Please type a message before sending.");
      return;
    }

    try {
      setChatError("");
      setIsLoadingChat(true);

      const response = await fetch(`${BACKEND_URL}/api/appointments/chat`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appointmentId: activeAppointment.id,
          message: chatInput.trim(),
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "Unable to send message.");
      }

      setChatMessages((current) => [
        ...current,
        {
          id: result.chatMessage.id,
          senderId: result.chatMessage.senderId,
          senderRole: result.chatMessage.senderRole,
          message: result.chatMessage.message,
          createdAt: result.chatMessage.createdAt,
        },
      ]);
      setChatInput("");
    } catch (error) {
      setChatError(
        error instanceof Error
          ? error.message
          : "Unable to send message.",
      );
    } finally {
      setIsLoadingChat(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950 text-white">
        <p className="font-semibold text-cyan-100">
          Loading patient dashboard...
        </p>
      </main>
    );
  }

  if (!session || !isPatient) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <PasswordChangeGate />
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <header className="relative z-20 border-b border-white/15 bg-blue-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 overflow-hidden rounded-[14px] border border-white/25 bg-white/10 shadow-lg">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={40}
                height={40}
                className="h-full w-full object-contain p-[3px]"
                priority
              />
            </div>

            <div>
              <p className="font-bold text-white">RadioCare</p>
              <p className="text-xs text-cyan-200">Patient Portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <NotificationBell />

            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-10 sm:px-7">
        <p className="font-semibold text-cyan-300">Patient dashboard</p>

        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Welcome, {currentUser?.name || "Patient"}
        </h1>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          Upload your radiology image, follow its review status, and view your
          reports after a doctor confirms the result.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <Link
            href="/patients/upload"
            className="rounded-[26px] border border-cyan-300/25 bg-gradient-to-br from-blue-600/80 to-cyan-500/70 p-6 text-left shadow-[0_20px_60px_rgba(14,116,255,0.25)] transition hover:-translate-y-1"
          >
            <p className="text-sm font-semibold text-cyan-100">New analysis</p>
            {/*
              The card no longer says X-ray. A patient with a CT on a
              disc read "Upload X-ray" and had no reason to think this
              was the place for it, and the study type inside is where
              the two are actually told apart.
            */}
            <h2 className="mt-3 text-2xl font-bold">Upload a study</h2>
            <p className="mt-3 text-sm leading-6 text-blue-50/90">
              An X-ray image, or a CT or MRI study, for preliminary AI
              analysis and a doctor&apos;s reading.
            </p>
          </Link>

          <div className="rounded-[26px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-200">My studies</p>
            <p className="mt-3 text-4xl font-bold">0</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Uploaded studies and their current review status will appear here.
            </p>
          </div>

          <div className="rounded-[26px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-200">
              Doctor reports
            </p>
            <p className="mt-3 text-4xl font-bold">0</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Confirmed medical reports will become available after doctor
              review.
            </p>
          </div>
        </div>

        {/*
          The case conversation below reaches the doctor reading a study.
          This one reaches the administration, for everything that is
          about the account rather than about an X-ray. It is a tile
          rather than a link so an answer is visible from here, without
          opening anything.
        */}
        <div className="mt-6">
          <SupportInboxCard viewerRole="patient" />
        </div>

        {/* Private follow-up with the doctor for each reviewed case */}
        <section className="mt-8 rounded-[30px] border border-white/10 bg-white/10 p-6">
          <button
            type="button"
            onClick={() => setIsMessagesOpen((open) => !open)}
            aria-expanded={isMessagesOpen}
            className="flex w-full flex-wrap items-center justify-between gap-4 text-left"
          >
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                Follow up your case
              </p>
              <h2 className="mt-2 text-3xl font-black">
                Messages with your doctor
              </h2>
            </div>

            <div className="flex items-center gap-3">
              {unreadMessageCount > 0 && (
                <span className="rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1 text-xs font-bold text-cyan-100">
                  {unreadMessageCount} new messages
                </span>
              )}

              {!isMessagesOpen && caseThreads.length > 0 && (
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-slate-200">
                  {caseThreads.length}{" "}
                  {caseThreads.length === 1 ? "case" : "cases"}
                </span>
              )}

              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-lg font-black text-cyan-100">
                {isMessagesOpen ? "−" : "+"}
              </span>
            </div>
          </button>

          {!isMessagesOpen ? null : isLoadingCases ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-slate-300">
              Loading your cases...
            </div>
          ) : caseThreads.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-slate-300">
              No case needs a follow-up right now. When a scan needs a
              doctor review, you can message them from here.
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-5">
              <div className="flex flex-col gap-3 xl:col-span-2">
                {caseThreads.map((caseThread) => (
                  <button
                    key={caseThread.studyId}
                    type="button"
                    onClick={() => setSelectedCaseId(caseThread.studyId)}
                    className={[
                      "rounded-3xl border p-4 text-left transition",
                      selectedCaseId === caseThread.studyId
                        ? "border-cyan-300/60 bg-cyan-400/15"
                        : "border-white/10 bg-slate-950/80 hover:border-cyan-300/40",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-black text-white">
                          {caseThread.bodyRegion}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {new Date(
                            caseThread.createdAt,
                          ).toLocaleDateString()}{" "}
                          · {caseThread.priority}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {caseThread.isAbnormal && (
                          <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-black text-rose-100">
                            Needs review
                          </span>
                        )}

                        {caseThread.unreadCount > 0 && (
                          <span className="rounded-full bg-cyan-400 px-2 py-0.5 text-[11px] font-black text-blue-950">
                            {caseThread.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm text-slate-300">
                      {caseThread.lastMessage
                        ? `${
                            caseThread.lastMessageRole === "patient"
                              ? "You: "
                              : "Doctor: "
                          }${caseThread.lastMessage}`
                        : caseThread.primaryFinding
                          ? `AI result: ${caseThread.primaryFinding}`
                          : "No messages yet"}
                    </p>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-5 xl:col-span-3">
                {selectedCaseId ? (
                  <>
                    <CaseReport
                      studyId={selectedCaseId}
                      mode="patient"
                    />

                    {/*
                      Asks for a rating right under the report it is
                      about, and only once that report is confirmed.
                      The component asks the server whether this study
                      can be rated and draws nothing when it cannot, so
                      a patient still waiting for a reading is not shown
                      a row of stars for it.
                    */}
                    <RateDoctor studyId={selectedCaseId} />

                    <CaseChat studyId={selectedCaseId} />
                  </>
                ) : (
                  <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-8 text-center">
                    <span className="text-4xl">💬</span>
                    <p className="mt-3 font-black text-white">
                      Select a case
                    </p>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">
                      Choose one of your scans to ask the doctor about it
                      and read their answers.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="mt-8 rounded-[30px] border border-white/10 bg-white/10 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                Appointments from your doctor
              </p>
              <h2 className="mt-2 text-3xl font-black">Your visits calendar</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingAppointments.length > 0 && (
                <span className="rounded-full border border-amber-300/30 bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-100">
                  {pendingAppointments.length} waiting for your approval
                </span>
              )}
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
                {appointments.length} appointments
              </span>
            </div>
          </div>

          {appointmentError && (
            <div className="mt-5 rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm font-bold text-red-100">
              {appointmentError}
            </div>
          )}

          {appointmentMessage && (
            <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/15 px-4 py-3 text-sm font-bold text-emerald-100">
              {appointmentMessage}
            </div>
          )}

          {/* Appointments the doctor sent that still need an answer */}
          {pendingAppointments.length > 0 && (
            <div className="mt-6 rounded-3xl border border-amber-300/25 bg-amber-400/10 p-5">
              <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-200">
                Approval needed
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {pendingAppointments.map((appointment) => (
                  <article
                    key={appointment.id}
                    className="rounded-3xl border border-white/10 bg-slate-950/80 p-5"
                  >
                    <h3 className="text-xl font-black text-white">
                      {new Date(appointment.scheduledAt).toLocaleDateString(
                        undefined,
                        { weekday: "long", day: "numeric", month: "long" },
                      )}
                    </h3>

                    <p className="mt-1 text-sm font-bold text-cyan-200">
                      {formatTime(appointment.scheduledAt)} ·{" "}
                      {appointment.durationMinutes} minutes
                    </p>

                    <p className="mt-3 text-sm text-slate-300">
                      {appointment.doctorName ?? "Assigned doctor"}
                      {appointment.doctorSpecialty
                        ? ` — ${appointment.doctorSpecialty}`
                        : ""}
                    </p>

                    <p className="mt-1 text-sm text-slate-400">
                      {appointment.bodyRegion} • {appointment.priority}
                    </p>

                    {appointment.notes && (
                      <p className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-200">
                        {appointment.notes}
                      </p>
                    )}

                    {respondingId === appointment.id && (
                      <textarea
                        rows={2}
                        value={responseNote}
                        onChange={(event) =>
                          setResponseNote(event.target.value)
                        }
                        placeholder="Optional note for your doctor..."
                        className="mt-3 w-full resize-none rounded-2xl border border-white/20 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/60"
                      />
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void respondToAppointment(appointment, "confirm")
                        }
                        className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-emerald-950 transition hover:bg-emerald-300"
                      >
                        Approve appointment
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void respondToAppointment(appointment, "decline")
                        }
                        className="rounded-xl border border-rose-300/30 bg-rose-400/15 px-4 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-400/25"
                      >
                        Decline
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRespondingId(
                            respondingId === appointment.id
                              ? ""
                              : appointment.id,
                          );
                          setResponseNote("");
                        }}
                        className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-white/15"
                      >
                        {respondingId === appointment.id
                          ? "Hide note"
                          : "Add a note"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {isLoadingAppointments ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-slate-300">
              Loading your appointments...
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <AppointmentCalendar
                  appointments={appointments.map((appointment) => ({
                    id: appointment.id,
                    scheduledAt: appointment.scheduledAt,
                    status: appointment.status,
                    title: appointment.doctorName ?? "Doctor",
                  }))}
                  visibleMonth={visibleMonth}
                  selectedDate={selectedDate}
                  onVisibleMonthChange={setVisibleMonth}
                  onSelectDate={setSelectedDate}
                />
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/[0.07] p-6">
                <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                  Selected day
                </p>

                <h3 className="mt-2 text-2xl font-black text-white">
                  {selectedDate.toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </h3>

                {selectedDayAppointments.length === 0 ? (
                  <p className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/[0.04] p-5 text-sm text-slate-300">
                    Nothing scheduled on this day.
                  </p>
                ) : (
                  <div className="mt-5 flex flex-col gap-3">
                    {selectedDayAppointments.map((appointment) => {
                      const style = getStatusStyle(appointment.status);

                      return (
                        <button
                          key={appointment.id}
                          type="button"
                          onClick={() => void selectAppointment(appointment)}
                          className="rounded-3xl border border-white/10 bg-slate-950/80 p-4 text-left transition hover:border-cyan-300/40"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-black text-white">
                              {formatTime(appointment.scheduledAt)}
                            </p>

                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${style.chip}`}
                            >
                              {appointment.status}
                            </span>
                          </div>

                          <p className="mt-2 text-sm font-bold text-cyan-200">
                            {appointment.doctorName ?? "Assigned doctor"}
                          </p>

                          <p className="mt-1 text-xs text-slate-400">
                            {appointment.bodyRegion} • {appointment.priority}
                          </p>

                          <p className="mt-2 text-xs text-slate-400">
                            {getStatusStyle(appointment.status).label} · tap to
                            open the chat
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeAppointment && (
            <div className="mt-8 rounded-3xl border border-cyan-300/20 bg-slate-950/90 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                    Doctor chat
                  </p>
                  <h3 className="mt-2 text-2xl font-black text-white">
                    {activeAppointment.doctorName ?? "Your doctor"}
                  </h3>
                  <p className="mt-2 text-sm text-slate-300">
                    {getAppointmentReminderText(activeAppointment.scheduledAt)}
                  </p>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-cyan-100">
                  {new Date(activeAppointment.scheduledAt).toLocaleDateString()} {new Date(activeAppointment.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {chatError && (
                <div className="mt-6 rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100">
                  {chatError}
                </div>
              )}

              <div className="mt-6 space-y-3">
                {isLoadingChat ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 text-center text-slate-200">
                    Loading chat...
                  </div>
                ) : chatMessages.length === 0 ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5 text-slate-200">
                    No messages yet. Send a note to your doctor here.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatMessages.map((message) => (
                      <div
                        key={`${message.id}-${message.createdAt}`}
                        className={[
                          "rounded-3xl border p-4",
                          message.senderRole === "patient"
                            ? "border-cyan-300/20 bg-cyan-300/10 text-white"
                            : "border-white/10 bg-white/10 text-slate-200",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                          <span>{message.senderRole === "patient" ? "You" : "Doctor"}</span>
                          <span>{new Date(message.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-3 text-sm leading-6">
                          {message.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/90 p-5">
                <label className="block text-sm font-semibold text-slate-200">
                  Send a message to your doctor
                  <textarea
                    rows={4}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-white/20 bg-slate-900/80 px-4 py-3 text-white"
                    placeholder="Write your question or update here..."
                  />
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={sendChatMessage}
                    className="rounded-2xl bg-cyan-300 px-5 py-3 font-black text-blue-950 transition hover:bg-cyan-400"
                  >
                    Send message
                  </button>
                  <p className="text-sm text-slate-300">
                    Your doctor will receive it when they open the clinic workspace.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="mt-6 rounded-[28px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-cyan-300">
                Recent activity
              </p>
              <h2 className="mt-1 text-2xl font-bold">No studies yet</h2>
            </div>

            <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
              Patient
            </span>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            Your uploaded scans, preliminary AI results, doctor review status,
            and final reports will be shown in this section.
          </p>
        </div>
      </section>
    </main>
  );
}
