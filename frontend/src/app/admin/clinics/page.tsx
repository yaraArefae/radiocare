"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type Clinic = {
  key: string;
  name: string;
  description: string;
  patientRegions: string[];
  caseCount: number;
  doctorCount: number;
};

type Doctor = {
  doctorId: string;
  fullName: string;
  email: string;
  specialty: string;
  subspecialty: string;
  status: string;
  suspended: boolean;
  clinics: string[];
  clinicsAssigned: boolean;
};

/*
  The clinics of the application, and which doctor works in each one.

  A patient chooses a body region when uploading, and that region decides
  the clinic the case is sent to. This screen is where an administrator
  makes sure every one of those clinics actually has a doctor behind it,
  because a clinic without one accepts cases that nobody is told about.
*/
export default function AdminClinicsPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [draftClinics, setDraftClinics] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const loadClinics = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(`${backendBaseUrl}/api/admin/doctors`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the clinics.");
      }

      setClinics(data.clinics ?? []);
      setDoctors(data.doctors ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load the clinics.",
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
      router.replace("/");
      return;
    }

    void loadClinics();
  }, [isAdmin, isPending, loadClinics, router, session]);

  function startEditing(doctor: Doctor) {
    setEditingId(doctor.doctorId);
    setDraftClinics(doctor.clinics.filter((key) => key !== "general"));
    setSuccessMessage("");
    setErrorMessage("");
  }

  function toggleDraftClinic(key: string) {
    setDraftClinics((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  }

  async function saveClinics(doctorId: string) {
    try {
      setIsSaving(true);
      setErrorMessage("");

      const response = await fetch(`${backendBaseUrl}/api/admin/doctors`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, clinics: draftClinics }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to update the clinics.");
      }

      setSuccessMessage(data.message);
      setEditingId("");

      await loadClinics();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to update the clinics.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading clinics...</p>
      </main>
    );
  }

  if (!session || !isAdmin) {
    return null;
  }

  const emptyClinics = clinics.filter((clinic) => clinic.doctorCount === 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <AdminNav />

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/admin/overview"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
          >
            <span>←</span>
            <span>Admin overview</span>
          </Link>

          <button
            type="button"
            onClick={() => void loadClinics()}
            disabled={isLoading}
            className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {errorMessage && (
          <p className="mb-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-5 py-4 font-bold text-rose-100">
            {errorMessage}
          </p>
        )}

        {successMessage && (
          <p className="mb-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-4 font-bold text-emerald-100">
            {successMessage}
          </p>
        )}

        {emptyClinics.length > 0 && (
          <p className="mb-5 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-5 py-4 text-amber-100">
            <span className="font-black">No doctor yet:</span>{" "}
            {emptyClinics.map((clinic) => clinic.name).join(", ")}. Patients can
            still upload to these clinics, but nobody is notified about the
            cases until a doctor is assigned.
          </p>
        )}

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Clinics
          </p>

          <h1 className="mt-2 text-3xl font-black text-white">
            The clinics patients send cases to
          </h1>

          <p className="mt-2 text-slate-300">
            Each body region in the upload form belongs to exactly one clinic,
            and a case reaches only the doctors of that clinic.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {clinics.map((clinic) => {
              /*
                Every clinic opens the screen its doctors work on, so an
                administrator reads a queue the same way the clinic does
                instead of guessing from a case count. The general
                clinic has no such screen: it is where unmatched cases
                land, not a place anybody works in.
              */
              const hasClinicPage = clinic.key !== "general";

              const tileClassName = `block rounded-2xl border p-5 transition ${
                clinic.doctorCount === 0
                  ? "border-amber-300/35 bg-amber-400/10"
                  : "border-white/15 bg-white/[0.06]"
              } ${
                hasClinicPage
                  ? "hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-white/[0.1]"
                  : ""
              }`;

              const tileContent = (
                <>
                <p className="font-black text-white">{clinic.name}</p>

                <p className="mt-1 text-sm text-slate-300">
                  {clinic.patientRegions.join(" · ")}
                </p>

                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="font-bold text-cyan-200">
                    {clinic.caseCount} case
                    {clinic.caseCount === 1 ? "" : "s"}
                  </span>

                  <span
                    className={`font-bold ${
                      clinic.doctorCount === 0
                        ? "text-amber-200"
                        : "text-emerald-200"
                    }`}
                  >
                    {clinic.doctorCount} doctor
                    {clinic.doctorCount === 1 ? "" : "s"}
                  </span>
                </div>

                {hasClinicPage && (
                  <p className="mt-3 text-xs font-bold text-cyan-300">
                    Open the clinic →
                  </p>
                )}
                </>
              );

              return hasClinicPage ? (
                <Link
                  key={clinic.key}
                  href={`/doctor/clinic/${clinic.key}`}
                  className={tileClassName}
                >
                  {tileContent}
                </Link>
              ) : (
                <div key={clinic.key} className={tileClassName}>
                  {tileContent}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Doctors
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            Which clinics each doctor works in
          </h2>

          <p className="mt-2 text-slate-300">
            A doctor can work in more than one clinic. Clinics marked as
            &quot;from specialty&quot; were read from the specialty the doctor
            registered with and can be corrected here.
          </p>

          {isLoading ? (
            <p className="mt-6 text-slate-300">Loading doctors...</p>
          ) : doctors.length === 0 ? (
            <p className="mt-6 text-slate-300">No doctors yet.</p>
          ) : (
            <div className="mt-6 flex flex-col gap-4">
              {doctors.map((doctor) => (
                <div
                  key={doctor.doctorId}
                  className="rounded-2xl border border-white/15 bg-white/[0.06] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-black text-white">
                        {doctor.fullName}
                      </p>

                      <p className="text-sm text-slate-300">
                        {doctor.email} · {doctor.specialty}
                        {doctor.subspecialty ? ` · ${doctor.subspecialty}` : ""}
                      </p>

                      {doctor.suspended && (
                        <p className="mt-1 text-sm font-bold text-rose-200">
                          Account suspended — receives no cases.
                        </p>
                      )}
                    </div>

                    {editingId !== doctor.doctorId && (
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/admin/doctors/${doctor.doctorId}`}
                          className="rounded-2xl border border-white/20 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-slate-100 transition hover:border-cyan-300/40"
                        >
                          Open record
                        </Link>

                        <button
                          type="button"
                          onClick={() => startEditing(doctor)}
                          className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                        >
                          Change clinics
                        </button>
                      </div>
                    )}
                  </div>

                  {editingId === doctor.doctorId ? (
                    <div className="mt-4">
                      <div className="flex flex-wrap gap-2">
                        {clinics.map((clinic) => {
                          const isChosen = draftClinics.includes(clinic.key);

                          return (
                            <button
                              key={clinic.key}
                              type="button"
                              onClick={() => toggleDraftClinic(clinic.key)}
                              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                                isChosen
                                  ? "border-cyan-300/60 bg-cyan-400/25 text-white"
                                  : "border-white/20 bg-white/[0.05] text-slate-300 hover:border-cyan-300/40"
                              }`}
                            >
                              {isChosen ? "✓ " : ""}
                              {clinic.name}
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          disabled={isSaving || draftClinics.length === 0}
                          onClick={() => void saveClinics(doctor.doctorId)}
                          className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-2.5 font-black text-white disabled:opacity-50"
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingId("")}
                          className="rounded-2xl border border-white/20 bg-white/[0.05] px-6 py-2.5 font-bold text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>

                      {draftClinics.length === 0 && (
                        <p className="mt-3 text-sm font-bold text-amber-200">
                          Choose at least one clinic, otherwise this doctor
                          receives no cases at all.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {doctor.clinics.map((key) => {
                        const clinic = clinics.find(
                          (entry) => entry.key === key,
                        );

                        return (
                          <span
                            key={key}
                            className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-4 py-1.5 text-sm font-bold text-cyan-100"
                          >
                            {clinic?.name ?? key}
                          </span>
                        );
                      })}

                      {!doctor.clinicsAssigned && (
                        <span className="rounded-full border border-white/20 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300">
                          from specialty
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
