"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/client/auth/auth-client";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  role?: string | string[] | null;
};

type AppointmentItem = {
  id: string;
  studyId: string;
  scheduledAt: string;
  status: string;
  notes: string;
  bodyRegion: string;
  priority: string;
  doctorName?: string;
  doctorId?: string;
};

type ChatMessage = {
  id: number | string;
  senderId: string;
  senderRole: "doctor" | "patient";
  message: string;
  createdAt: string;
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
    }
  }, [isPatient, isPending, router, session]);

  async function loadAppointments() {
    try {
      setIsLoadingAppointments(true);
      const response = await fetch("/api/appointments");
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

  async function loadChatMessages(appointmentId: string) {
    try {
      setChatError("");
      setIsLoadingChat(true);
      const response = await fetch(
        `/api/appointments/chat?appointmentId=${encodeURIComponent(appointmentId)}`,
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

      const response = await fetch("/api/appointments/chat", {
        method: "POST",
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

          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Sign out
          </button>
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
          <button
            type="button"
            className="rounded-[26px] border border-cyan-300/25 bg-gradient-to-br from-blue-600/80 to-cyan-500/70 p-6 text-left shadow-[0_20px_60px_rgba(14,116,255,0.25)] transition hover:-translate-y-1"
          >
            <p className="text-sm font-semibold text-cyan-100">New analysis</p>
            <h2 className="mt-3 text-2xl font-bold">Upload X-ray</h2>
            <p className="mt-3 text-sm leading-6 text-blue-50/90">
              Start a new radiology study and submit an image for preliminary AI
              analysis.
            </p>
          </button>

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

        <section className="mt-8 rounded-[30px] border border-white/10 bg-white/10 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan-200">
                Upcoming review appointments
              </p>
              <h2 className="mt-2 text-3xl font-black">Your upcoming visits</h2>
            </div>
            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
              {appointments.length} appointments
            </span>
          </div>

          {isLoadingAppointments ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-slate-300">
              Loading your appointments...
            </div>
          ) : appointments.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 text-slate-300">
              No appointments scheduled yet. Once a doctor sets a follow-up, it will appear here.
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {appointments.map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => void selectAppointment(appointment)}
                  className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 text-left text-left transition hover:border-cyan-300/40"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {appointment.status}
                  </p>
                  <h3 className="mt-3 text-xl font-black text-white">
                    {appointment.doctorName ?? "Assigned doctor"}
                  </h3>
                  <p className="mt-2 text-sm text-slate-300">
                    Follow-up: {new Date(appointment.scheduledAt).toLocaleString()}
                  </p>
                  <p className="mt-3 text-sm text-slate-300">
                    {appointment.bodyRegion} • {appointment.priority}
                  </p>
                  {appointment.notes && (
                    <p className="mt-3 text-sm text-slate-300">
                      {appointment.notes}
                    </p>
                  )}
                </button>
              ))}
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
        <div className="my-6">
  <Link
    href="/patients/upload"
    className="group flex w-full max-w-xl items-center gap-5 rounded-3xl border border-white/20 bg-white/[0.08] p-6 shadow-lg backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-300/50 hover:bg-white/[0.12]"
  >
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 text-3xl shadow-lg">
      🩻
    </div>

    <div className="min-w-0 flex-1">
      <h2 className="text-xl font-black text-white">
        Upload X-ray
      </h2>

      <p className="mt-1 text-sm leading-6 text-slate-300">
        Upload a chest X-ray and receive a preliminary AI analysis.
      </p>

      <p className="mt-3 font-bold text-cyan-300 transition group-hover:text-cyan-200">
        Upload and Analyze →
      </p>
    </div>
  </Link>
</div>
      </section>
    </main>
  );
}
