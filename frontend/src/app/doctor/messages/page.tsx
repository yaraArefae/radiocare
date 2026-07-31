"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import CaseChat from "@/components/CaseChat";
import NotificationBell from "@/components/NotificationBell";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 15000;

type CaseThread = {
  studyId: string;
  patientId: string;
  patientName: string;
  bodyRegion: string;
  imagingView: string;
  priority: string;
  status: string;
  createdAt: string;
  triageResult: string;
  isAbnormal: boolean;
  primaryFinding: string | null;
  confidence: number | string | null;
  lastMessage: string;
  lastMessageRole: string;
  lastMessageAt: string | null;
  unreadCount: number;
};

type CaseFilter = "all" | "unread" | "abnormal";

function formatRelative(value: string | null) {
  if (!value) return "No messages yet";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const minutes = Math.round((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return date.toLocaleDateString();
}

export default function DoctorMessagesPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isDoctor = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("doctor");
  }, [session]);

  const [cases, setCases] = useState<CaseThread[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState("");
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadCases = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/cases`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the case list.");
      }

      setCases(data.cases ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the case list.",
      );
    } finally {
      setIsLoading(false);
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

    void loadCases();

    const intervalId = window.setInterval(() => {
      void loadCases();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isDoctor, isPending, loadCases, session]);

  const visibleCases = useMemo(() => {
    if (caseFilter === "unread") {
      return cases.filter((item) => item.unreadCount > 0);
    }

    if (caseFilter === "abnormal") {
      return cases.filter((item) => item.isAbnormal);
    }

    return cases;
  }, [caseFilter, cases]);

  const selectedCase = cases.find(
    (item) => item.studyId === selectedStudyId,
  );

  const unreadTotal = cases.reduce(
    (total, item) => total + item.unreadCount,
    0,
  );

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading messages...</p>
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

            <Link
              href="/doctor/calendar"
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              📅 Calendar
            </Link>
          </div>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Patient Follow-up
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Case Messages
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Every abnormal case in your clinic opens a private conversation
            with the patient, so you can follow the case without waiting for
            an appointment.
            {unreadTotal > 0
              ? ` You have ${unreadTotal} unread message${unreadTotal === 1 ? "" : "s"}.`
              : ""}
          </p>
        </section>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur-2xl">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: "all", label: "All cases" },
                    { key: "unread", label: "Unread" },
                    { key: "abnormal", label: "Abnormal" },
                  ] as Array<{ key: CaseFilter; label: string }>
                ).map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setCaseFilter(filter.key)}
                    className={[
                      "rounded-xl border px-4 py-2 text-sm font-bold transition",
                      caseFilter === filter.key
                        ? "border-cyan-300/60 bg-cyan-400/20 text-white"
                        : "border-white/15 bg-white/[0.05] text-slate-300 hover:text-white",
                    ].join(" ")}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
                {isLoading ? (
                  <p className="py-10 text-center text-sm text-slate-400">
                    Loading cases...
                  </p>
                ) : visibleCases.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-white/20 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
                    No cases in this list yet.
                  </p>
                ) : (
                  visibleCases.map((caseThread) => (
                    <button
                      key={caseThread.studyId}
                      type="button"
                      onClick={() => setSelectedStudyId(caseThread.studyId)}
                      className={[
                        "rounded-2xl border p-4 text-left transition",
                        selectedStudyId === caseThread.studyId
                          ? "border-cyan-300/60 bg-cyan-400/15"
                          : "border-white/10 bg-white/[0.04] hover:border-cyan-300/35 hover:bg-white/[0.08]",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-black text-white">
                            {caseThread.patientName}
                          </p>

                          <p className="mt-1 text-xs text-slate-400">
                            {caseThread.bodyRegion} · {caseThread.priority}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {caseThread.isAbnormal && (
                            <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-2.5 py-1 text-[11px] font-black text-rose-100">
                              Abnormal
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
                              caseThread.lastMessageRole === "doctor"
                                ? "You: "
                                : ""
                            }${caseThread.lastMessage}`
                          : caseThread.primaryFinding
                            ? `AI result: ${caseThread.primaryFinding}`
                            : "No messages yet"}
                      </p>

                      <p className="mt-2 text-[11px] text-slate-500">
                        {formatRelative(caseThread.lastMessageAt)}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="lg:col-span-3">
            {selectedCase ? (
              <div className="flex flex-col gap-5">
                <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-2xl">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                        {selectedCase.studyId}
                      </p>

                      <h2 className="mt-2 text-2xl font-black text-white">
                        {selectedCase.patientName}
                      </h2>

                      <p className="mt-1 text-sm text-slate-400">
                        {selectedCase.bodyRegion} ·{" "}
                        {selectedCase.imagingView} ·{" "}
                        {selectedCase.priority}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/studies/${encodeURIComponent(
                          selectedCase.studyId,
                        )}`}
                        className="rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200 transition hover:border-cyan-300/40 hover:text-white"
                      >
                        Open case
                      </Link>

                      <Link
                        href="/doctor/calendar"
                        className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
                      >
                        Book appointment
                      </Link>
                    </div>
                  </div>

                  {selectedCase.primaryFinding && (
                    <p className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-6 text-slate-200">
                      AI result: {selectedCase.primaryFinding}
                      {selectedCase.confidence
                        ? ` · confidence ${Number(
                            selectedCase.confidence,
                          ).toFixed(1)}%`
                        : ""}
                    </p>
                  )}
                </section>

                <CaseChat
                  studyId={selectedCase.studyId}
                  title={`Conversation with ${selectedCase.patientName}`}
                />
              </div>
            ) : (
              <section className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-10 text-center">
                <span className="text-5xl">💬</span>

                <h2 className="mt-4 text-xl font-black text-white">
                  Select a case
                </h2>

                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                  Pick a patient from the list to read the conversation and
                  answer their follow-up questions.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
