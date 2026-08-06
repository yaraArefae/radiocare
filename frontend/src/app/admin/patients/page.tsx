"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
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
  status: string;
  createdAt: string;
  accountSuspended: boolean;
  hasAccount: boolean;
  totalStudies: number;
  completedStudies: number;
  openAppointments: number;
  lastStudyAt: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

/*
  Every patient in the system, as the entry point to their full record.
*/
export default function AdminPatientsPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadPatients = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(`${backendBaseUrl}/api/patients`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the patients.");
      }

      setPatients(data.patients ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load the patients.",
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

    void loadPatients();
  }, [isAdmin, isPending, loadPatients, router, session]);

  const visiblePatients = useMemo(() => {
    const needle = search.trim().toLowerCase();

    if (!needle) return patients;

    return patients.filter((patient) =>
      [patient.name, patient.email, patient.phone, patient.id]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [patients, search]);

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
                Patients
              </p>

              <h1 className="mt-2 text-3xl font-black text-white">
                {patients.length} registered patient
                {patients.length === 1 ? "" : "s"}
              </h1>

              <p className="mt-2 text-slate-300">
                Open a patient to see their cases, reports, appointments and the
                doctors who answered them.
              </p>
            </div>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email or phone..."
              className="w-full max-w-sm rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
            />
          </div>

          {isLoading ? (
            <p className="mt-6 text-slate-300">Loading patients...</p>
          ) : visiblePatients.length === 0 ? (
            <p className="mt-6 text-slate-300">No patient matches this search.</p>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {visiblePatients.map((patient) => (
                <Link
                  key={patient.id}
                  href={`/admin/patients/${patient.id}`}
                  className="rounded-2xl border border-white/15 bg-white/[0.06] p-5 transition hover:border-cyan-300/40 hover:bg-white/[0.09]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-black text-white">
                        {patient.name}
                      </p>

                      <p className="text-sm text-slate-300">
                        {patient.age} years · {patient.gender}
                        {patient.email ? ` · ${patient.email}` : ""}
                        {patient.phone ? ` · ${patient.phone}` : ""}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {!patient.hasAccount && (
                          <span className="rounded-full border border-amber-300/30 bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-100">
                            No login account
                          </span>
                        )}

                        {patient.accountSuspended && (
                          <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-100">
                            Suspended
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right text-sm">
                      <p className="font-bold text-cyan-200">
                        {patient.totalStudies} stud
                        {patient.totalStudies === 1 ? "y" : "ies"}
                      </p>

                      <p className="text-slate-400">
                        {patient.completedStudies} completed ·{" "}
                        {patient.openAppointments} appointment
                        {patient.openAppointments === 1 ? "" : "s"}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        last upload {formatDate(patient.lastStudyAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
