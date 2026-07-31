"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type LoginAttempt = {
  id: number;
  email: string;
  success: boolean;
  ipAddress: string;
  failureReason: string;
  createdAt: string;
};

type Overview = {
  studies: {
    total: number;
    normal: number;
    abnormal: number;
    uncertain: number;
    urgent: number;
    completed: number;
    underReview: number;
    waiting: number;
  };
  clinics: Array<{ clinicKey: string; total: number }>;
  accounts: {
    total: number;
    patients: number;
    doctors: number;
    admins: number;
    banned: number;
  };
  queue: {
    pendingPatients: number;
    pendingDoctors: number;
    approvedReports: number;
    draftReports: number;
    pendingAppointments: number;
  };
  security: {
    failedLastDay: number;
    attempts: LoginAttempt[];
  };
};

export default function AdminOverviewPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadOverview = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/admin/overview`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the overview.");
      }

      setOverview(data);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the overview.",
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

    if (!isAdmin) {
      router.replace("/unauthorized");
    }
  }, [isAdmin, isPending, router, session]);

  useEffect(() => {
    if (isPending || !session || !isAdmin) return;

    void loadOverview();
  }, [isAdmin, isPending, loadOverview, session]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading overview...</p>
      </main>
    );
  }

  if (!session || !isAdmin) {
    return null;
  }

  const studies = overview?.studies;
  const queue = overview?.queue;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/patient-requests"
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              🧑‍⚕️ Patient Requests
              {queue?.pendingPatients ? ` (${queue.pendingPatients})` : ""}
            </Link>

            <Link
              href="/admin/doctor-requests"
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              🩺 Doctor Requests
              {queue?.pendingDoctors ? ` (${queue.pendingDoctors})` : ""}
            </Link>

            <Link
              href="/admin/users"
              className="rounded-2xl border border-white/15 bg-white/[0.07] px-5 py-3 text-sm font-semibold text-slate-200 transition hover:text-white"
            >
              👥 Users
            </Link>
          </div>

          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={isLoading}
            className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            System administration
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            RadioCare Overview
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Case counters, account counters, and the sign-in activity log.
            The medical decision itself always stays with the doctors.
          </p>
        </section>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Total studies",
              value: studies?.total,
              hint: "All uploaded images",
            },
            {
              label: "Normal cases",
              value: studies?.normal,
              hint: "No supported finding",
            },
            {
              label: "Abnormal cases",
              value: studies?.abnormal,
              hint: "Sent to a clinic",
            },
            {
              label: "Uncertain cases",
              value: studies?.uncertain,
              hint: "Doctor review required",
            },
            {
              label: "Urgent cases",
              value: studies?.urgent,
              hint: "Highest priority",
            },
            {
              label: "Under review",
              value: studies?.underReview,
              hint: "A doctor started a report",
            },
            {
              label: "Waiting",
              value: studies?.waiting,
              hint: "Not opened yet",
            },
            {
              label: "Completed",
              value: studies?.completed,
              hint: "Report approved",
            },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur-2xl"
            >
              <p className="text-sm font-semibold text-slate-400">
                {card.label}
              </p>

              <p className="mt-2 text-3xl font-black text-white">
                {isLoading ? "…" : (card.value ?? 0)}
              </p>

              <p className="mt-1 text-xs text-cyan-200">{card.hint}</p>
            </article>
          ))}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-2xl">
            <h2 className="text-xl font-black text-white">
              Accounts and queues
            </h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                { label: "Patients", value: overview?.accounts.patients },
                { label: "Doctors", value: overview?.accounts.doctors },
                { label: "Admins", value: overview?.accounts.admins },
                {
                  label: "Suspended accounts",
                  value: overview?.accounts.banned,
                },
                {
                  label: "Pending patient requests",
                  value: queue?.pendingPatients,
                },
                {
                  label: "Pending doctor requests",
                  value: queue?.pendingDoctors,
                },
                {
                  label: "Draft reports",
                  value: queue?.draftReports,
                },
                {
                  label: "Approved reports",
                  value: queue?.approvedReports,
                },
                {
                  label: "Appointments awaiting approval",
                  value: queue?.pendingAppointments,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/10 bg-black/15 p-4"
                >
                  <p className="text-xs text-slate-400">{item.label}</p>
                  <p className="mt-1 text-2xl font-black text-white">
                    {isLoading ? "…" : (item.value ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-2xl">
            <h2 className="text-xl font-black text-white">
              Studies per clinic
            </h2>

            <div className="mt-4 flex flex-col gap-3">
              {(overview?.clinics ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">No studies yet.</p>
              ) : (
                (overview?.clinics ?? []).map((clinic) => {
                  const total = overview?.studies.total || 1;
                  const percentage = Math.round(
                    (clinic.total / total) * 100,
                  );

                  return (
                    <div key={clinic.clinicKey}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-bold capitalize text-slate-200">
                          {clinic.clinicKey}
                        </span>
                        <span className="text-slate-400">
                          {clinic.total} ({percentage}%)
                        </span>
                      </div>

                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-white/15 bg-white/[0.07] p-6 backdrop-blur-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black text-white">
              Sign-in activity
            </h2>

            {overview?.security.failedLastDay ? (
              <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-3 py-1.5 text-xs font-black text-rose-100">
                {overview.security.failedLastDay} failed attempts in 24 h
              </span>
            ) : null}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">IP address</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Time</th>
                </tr>
              </thead>

              <tbody>
                {(overview?.security.attempts ?? []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-slate-400"
                    >
                      No sign-in attempts recorded yet.
                    </td>
                  </tr>
                ) : (
                  (overview?.security.attempts ?? []).map((attempt) => (
                    <tr
                      key={attempt.id}
                      className="border-t border-white/5 text-slate-200"
                    >
                      <td className="px-3 py-2.5">{attempt.email}</td>

                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${
                            attempt.success
                              ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                              : "border-rose-300/30 bg-rose-500/15 text-rose-100"
                          }`}
                        >
                          {attempt.success ? "Success" : "Failed"}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-slate-400">
                        {attempt.ipAddress || "—"}
                      </td>

                      <td className="px-3 py-2.5 text-slate-400">
                        {attempt.failureReason || "—"}
                      </td>

                      <td className="px-3 py-2.5 text-slate-400">
                        {new Date(attempt.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
