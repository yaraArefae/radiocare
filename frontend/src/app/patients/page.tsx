"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import NotificationBell from "@/components/NotificationBell";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type PatientRow = {
  id: string;
  name: string;
  age: number;
  gender: string;
  phone: string;
  email: string;
  symptoms: string;
  medicalHistory: string;
  status: string;
  createdAt: string;
  totalStudies: number;
  lastStudyAt: string | null;
  completedStudies: number;
  openAppointments: number;
};

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PatientsPage() {
  const router = useRouter();

  /*
    A clinic passed in the address narrows this page to that one clinic.
    The server only ever narrows within what the doctor already covers,
    so the link focuses the view and cannot widen it.
  */
  const searchParams = useSearchParams();
  const clinicFilter = searchParams.get("clinic") ?? "";
  const clinicQuery = clinicFilter
    ? `?clinic=${encodeURIComponent(clinicFilter)}`
    : "";
  const { data: session, isPending } = authClient.useSession();

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [viewerRole, setViewerRole] = useState("patient");
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState("All");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedId, setExpandedId] = useState("");

  const loadPatients = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/patients${clinicQuery}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the patients.");
      }

      setPatients(data.patients ?? []);
      setViewerRole(data.role ?? "patient");
      setErrorMessage("");
    } catch (error) {
      setPatients([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the patients.",
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

    void loadPatients();
  }, [isPending, loadPatients, router, session]);

  const visiblePatients = useMemo(() => {
    const term = search.trim().toLowerCase();

    return patients.filter((patient) => {
      if (gender !== "All" && patient.gender !== gender) return false;

      if (!term) return true;

      return [patient.id, patient.name, patient.phone, patient.email]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [gender, patients, search]);

  const statistics = useMemo(
    () => ({
      total: patients.length,
      active: patients.filter((item) => item.status === "Active").length,
      withAppointment: patients.filter(
        (item) => item.openAppointments > 0,
      ).length,
      studies: patients.reduce(
        (total, item) => total + item.totalStudies,
        0,
      ),
    }),
    [patients],
  );

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading patients...</p>
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link
            href={viewerRole === "doctor" ? "/doctor/clinic" : "/dashboard"}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
          >
            <span>←</span>
            <span>Back</span>
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <NotificationBell />

            <button
              type="button"
              onClick={() => void loadPatients()}
              disabled={isLoading}
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Patient records
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Patients
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            {viewerRole === "doctor"
              ? "The patients who have a study in your clinic, with their symptoms and their medical history."
              : viewerRole === "admin"
                ? "Every patient registered in RadioCare."
                : "Your own patient record."}
          </p>
        </section>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Patients", value: statistics.total },
            { label: "Active", value: statistics.active },
            {
              label: "With an open appointment",
              value: statistics.withAppointment,
            },
            { label: "Total studies", value: statistics.studies },
          ].map((card) => (
            <article
              key={card.label}
              className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 backdrop-blur-2xl"
            >
              <p className="text-sm font-semibold text-slate-400">
                {card.label}
              </p>
              <p className="mt-2 text-3xl font-black text-white">
                {isLoading ? "…" : card.value}
              </p>
            </article>
          ))}
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, id, phone, or email..."
            className="min-w-56 flex-1 rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />

          <select
            value={gender}
            onChange={(event) => setGender(event.target.value)}
            className="rounded-xl border border-white/20 bg-[#17315a] px-4 py-2.5 text-white outline-none focus:border-cyan-300/60"
          >
            <option value="All">All genders</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {isLoading ? (
            <p className="rounded-3xl border border-white/15 bg-white/[0.05] p-8 text-center text-slate-300">
              Loading...
            </p>
          ) : visiblePatients.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-10 text-center text-slate-300">
              No patients match this view.
            </p>
          ) : (
            visiblePatients.map((patient) => (
              <article
                key={patient.id}
                className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-2xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-white">
                      {patient.name}
                    </h2>

                    <p className="mt-1 text-sm text-slate-400">
                      {patient.age} years · {patient.gender}
                      {patient.phone ? ` · ${patient.phone}` : ""}
                      {patient.email ? ` · ${patient.email}` : ""}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      ID: {patient.id}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {patient.openAppointments > 0 && (
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1.5 text-xs font-black text-cyan-100">
                        {patient.openAppointments} appointment
                        {patient.openAppointments === 1 ? "" : "s"}
                      </span>
                    )}

                    <span
                      className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                        patient.status === "Active"
                          ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                          : "border-white/20 bg-white/10 text-slate-300"
                      }`}
                    >
                      {patient.status}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <p className="text-xs text-slate-400">Studies</p>
                    <p className="mt-1 font-bold text-white">
                      {patient.totalStudies}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <p className="text-xs text-slate-400">Completed</p>
                    <p className="mt-1 font-bold text-white">
                      {patient.completedStudies}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <p className="text-xs text-slate-400">Last study</p>
                    <p className="mt-1 font-bold text-white">
                      {formatDate(patient.lastStudyAt)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.05] p-3">
                    <p className="text-xs text-slate-400">Registered</p>
                    <p className="mt-1 font-bold text-white">
                      {formatDate(patient.createdAt)}
                    </p>
                  </div>
                </div>

                {(patient.symptoms || patient.medicalHistory) && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(
                        expandedId === patient.id ? "" : patient.id,
                      )
                    }
                    className="mt-4 rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200 transition hover:text-white"
                  >
                    {expandedId === patient.id
                      ? "Hide clinical details"
                      : "Show symptoms and history"}
                  </button>
                )}

                {expandedId === patient.id && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {patient.symptoms && (
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          Symptoms
                        </p>
                        <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">
                          {patient.symptoms}
                        </p>
                      </div>
                    )}

                    {patient.medicalHistory && (
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                          Medical history
                        </p>
                        <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">
                          {patient.medicalHistory}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
