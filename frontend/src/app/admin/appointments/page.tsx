"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 30000;

type Appointment = {
  id: string;
  scheduledAt: string;
  status: string;
  durationMinutes: number;
  notes: string;
  patientNote: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  doctorId: string;
  doctorName: string;
  studyId: string | null;
  bodyRegion: string;
  clinicKey: string;
  isUpcoming: boolean;
};

type Totals = {
  all: number;
  booked: number;
  pending: number;
  confirmed: number;
};

type Filter = "booked" | "all";

const STATUS_STYLES: Record<string, string> = {
  Confirmed: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
  Pending: "border-amber-300/30 bg-amber-400/15 text-amber-100",
  Declined: "border-rose-300/30 bg-rose-400/15 text-rose-100",
  Cancelled: "border-rose-300/30 bg-rose-400/15 text-rose-100",
  Completed: "border-cyan-300/30 bg-cyan-400/15 text-cyan-100",
};

function formatWhen(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCountdown(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const minutes = Math.round((date.getTime() - Date.now()) / 60000);

  if (minutes < 0) return "Past";
  if (minutes < 60) return `In ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `In ${hours} h`;

  return `In ${Math.round(hours / 24)} days`;
}

/*
  Who is meeting whom, and when.

  An appointment always joins one doctor to one patient, so that pairing
  is what each row leads with; the clinic and the study are the context
  behind it rather than the point of it.
*/
export default function AdminAppointmentsPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [filter, setFilter] = useState<Filter>("booked");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadAppointments = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/admin/appointments`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the appointments.");
      }

      setAppointments(data.appointments ?? []);
      setTotals(data.totals ?? null);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the appointments.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPending) return;

    if (!session || !isAdmin) {
      router.replace("/");
      return;
    }

    void loadAppointments();

    const intervalId = window.setInterval(() => {
      void loadAppointments();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isAdmin, isPending, loadAppointments, router, session]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return appointments
      .filter((item) => (filter === "booked" ? item.isUpcoming : true))
      .filter((item) =>
        needle
          ? [item.patientName, item.doctorName, item.bodyRegion, item.clinicKey]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          : true,
      );
  }, [appointments, filter, search]);

  if (isPending || !session || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <AdminNav />

        {errorMessage && (
          <p className="mb-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-5 py-4 font-bold text-rose-100">
            {errorMessage}
          </p>
        )}

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                Appointments
              </p>

              <h1 className="mt-2 text-3xl font-black text-white">
                {totals?.booked ?? 0} booked
              </h1>

              <p className="mt-2 text-slate-300">
                Every meeting between a doctor and a patient.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search a doctor or a patient..."
                className="w-56 rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
              />

              {(["booked", "all"] as Filter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-2xl border px-4 py-2.5 text-sm font-bold capitalize transition ${
                    filter === value
                      ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-100"
                      : "border-white/15 bg-white/[0.06] text-slate-300 hover:border-cyan-300/40"
                  }`}
                >
                  {value === "booked" ? "Booked" : "All"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            {[
              { label: "Booked", value: totals?.booked, hint: "Still to come" },
              {
                label: "Confirmed",
                value: totals?.confirmed,
                hint: "Patient accepted",
              },
              {
                label: "Waiting",
                value: totals?.pending,
                hint: "No answer yet",
              },
              { label: "All", value: totals?.all, hint: "Ever created" },
            ].map((card) => (
              <article
                key={card.label}
                className="rounded-2xl border border-white/15 bg-white/[0.06] p-4"
              >
                <p className="text-sm text-slate-300">{card.label}</p>

                <p className="mt-2 text-3xl font-black text-white">
                  {isLoading ? "…" : (card.value ?? 0)}
                </p>

                <p className="mt-1 text-xs text-cyan-200">{card.hint}</p>
              </article>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {isLoading ? (
              <p className="text-sm text-slate-400">Loading appointments...</p>
            ) : visible.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-black/15 p-8 text-center">
                <span className="text-4xl">📅</span>

                <p className="mt-3 font-bold text-white">
                  {filter === "booked"
                    ? "Nothing booked"
                    : "No appointments yet"}
                </p>

                <p className="mt-1 text-sm text-slate-400">
                  An appointment appears here as soon as a doctor invites a
                  patient.
                </p>
              </div>
            ) : (
              visible.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-white/12 bg-white/[0.05] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-white">
                          {item.doctorName}
                        </span>

                        <span className="text-slate-400">↔</span>

                        <span className="font-black text-white">
                          {item.patientName}
                        </span>
                      </div>

                      <p className="mt-2 text-sm text-slate-300">
                        {formatWhen(item.scheduledAt)} ·{" "}
                        {item.durationMinutes} min
                        {item.bodyRegion ? ` · ${item.bodyRegion}` : ""}
                        {item.patientPhone ? ` · ${item.patientPhone}` : ""}
                      </p>

                      {(item.notes || item.patientNote) && (
                        <p className="mt-2 line-clamp-2 text-sm text-slate-400">
                          {item.notes || item.patientNote}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                          STATUS_STYLES[item.status] ??
                          "border-white/20 bg-white/10 text-slate-200"
                        }`}
                      >
                        {item.status}
                      </span>

                      {item.isUpcoming && (
                        <span className="text-xs font-bold text-cyan-200">
                          {formatCountdown(item.scheduledAt)}
                        </span>
                      )}

                      {item.studyId && (
                        <a
                          href={`/studies/${item.studyId}`}
                          className="text-xs font-bold text-cyan-300 underline-offset-4 hover:underline"
                        >
                          Open study
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
