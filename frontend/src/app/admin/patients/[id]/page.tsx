"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type PatientRecord = {
  patient: {
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
    loginEmail: string | null;
    suspended: boolean;
    mustChangePassword: boolean;
  };
  applications: Array<{
    id: string;
    status: string;
    rejectionReason: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }>;
  studies: Array<{
    id: string;
    bodyRegion: string;
    imagingView: string;
    clinicKey: string;
    clinicName: string;
    priority: string;
    status: string;
    createdAt: string;
    triageResult: string;
    primaryFinding: string | null;
    messageCount: number;
    reportCount: number;
  }>;
  reports: Array<{
    id: number;
    studyId: string;
    status: string;
    finalFinding: string;
    impression: string;
    severity: string;
    doctorName: string;
    followUpRequired: boolean;
    createdAt: string;
  }>;
  appointments: Array<{
    id: number;
    studyId: string;
    scheduledAt: string;
    status: string;
    notes: string;
    doctorName: string;
  }>;
  doctorsInContact: Array<{
    doctorName: string;
    doctorEmail: string;
    messageCount: number;
    lastMessageAt: string;
  }>;
  counters: {
    studies: number;
    reports: number;
    appointments: number;
    needingReview: number;
  };
};

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function triageStyle(value: string) {
  const triage = String(value || "").toUpperCase();

  if (triage === "ABNORMAL") {
    return "border-rose-300/30 bg-rose-500/15 text-rose-100";
  }

  if (triage === "NORMAL") {
    return "border-emerald-300/30 bg-emerald-400/15 text-emerald-100";
  }

  return "border-amber-300/30 bg-amber-400/15 text-amber-100";
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-5">
      <p className="text-3xl font-black text-white">{value}</p>

      <p className="mt-1 text-sm text-slate-300">{label}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>

      <p className="mt-2 whitespace-pre-wrap break-words leading-6 text-slate-100">
        {value || "—"}
      </p>
    </div>
  );
}

/*
  Everything the application knows about one patient, on one screen.

  An administrator answering a question about a patient needs the whole
  history at once: the account, the cases and which clinic each went to,
  the reports written about them, the appointments, and the doctors they
  spoke with.
*/
export default function AdminPatientRecordPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const patientId = String(params?.id ?? "");

  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadRecord = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/admin/patients/${encodeURIComponent(patientId)}`,
        { method: "GET", credentials: "include", cache: "no-store" },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the patient.");
      }

      setRecord(data);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load the patient.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    if (isPending) return;

    if (!session || !isAdmin) {
      router.replace("/");
      return;
    }

    void loadRecord();
  }, [isAdmin, isPending, loadRecord, router, session]);

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

        <Link
          href="/admin/patients"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
        >
          <span>←</span>
          <span>All patients</span>
        </Link>

        {errorMessage && (
          <p className="mb-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-5 py-4 font-bold text-rose-100">
            {errorMessage}
          </p>
        )}

        {isLoading && !record && (
          <p className="text-slate-300">Loading the patient record...</p>
        )}

        {record && (
          <>
            <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                    Patient record
                  </p>

                  <h1 className="mt-2 text-3xl font-black text-white">
                    {record.patient.name}
                  </h1>

                  <p className="mt-1 text-slate-300">
                    {record.patient.age} years · {record.patient.gender} ·
                    registered {formatDate(record.patient.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-1.5 text-sm font-bold text-slate-200">
                    {record.patient.status}
                  </span>

                  {record.patient.suspended && (
                    <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-4 py-1.5 text-sm font-bold text-rose-100">
                      Account suspended
                    </span>
                  )}

                  {record.patient.mustChangePassword && (
                    <span className="rounded-full border border-amber-300/30 bg-amber-400/15 px-4 py-1.5 text-sm font-bold text-amber-100">
                      Temporary password
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Field label="Login email" value={record.patient.loginEmail ?? "—"} />
                <Field label="Contact email" value={record.patient.email} />
                <Field label="Phone" value={record.patient.phone} />
                <Field label="Patient id" value={record.patient.id} />
                <Field label="Current symptoms" value={record.patient.symptoms} />
                <Field
                  label="Medical history"
                  value={record.patient.medicalHistory}
                />
              </div>
            </section>

            <div className="mt-7 grid gap-4 sm:grid-cols-4">
              <Counter label="Studies" value={record.counters.studies} />
              <Counter
                label="Waiting for a doctor"
                value={record.counters.needingReview}
              />
              <Counter label="Reports" value={record.counters.reports} />
              <Counter
                label="Appointments"
                value={record.counters.appointments}
              />
            </div>

            {record.doctorsInContact.length > 0 && (
              <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
                <h2 className="text-xl font-black text-white">
                  Doctors who answered this patient
                </h2>

                <div className="mt-4 flex flex-col gap-3">
                  {record.doctorsInContact.map((doctor) => (
                    <div
                      key={doctor.doctorEmail}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-4"
                    >
                      <div>
                        <p className="font-black text-white">
                          {doctor.doctorName}
                        </p>

                        <p className="text-sm text-slate-300">
                          {doctor.doctorEmail}
                        </p>
                      </div>

                      <p className="text-sm text-cyan-200">
                        {doctor.messageCount} message
                        {doctor.messageCount === 1 ? "" : "s"} · last{" "}
                        {formatDate(doctor.lastMessageAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
              <h2 className="text-xl font-black text-white">
                Studies ({record.studies.length})
              </h2>

              {record.studies.length === 0 ? (
                <p className="mt-4 text-slate-300">
                  This patient has not uploaded any image yet.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        <th className="pb-3 pr-4">Study</th>
                        <th className="pb-3 pr-4">Clinic</th>
                        <th className="pb-3 pr-4">AI result</th>
                        <th className="pb-3 pr-4">Status</th>
                        <th className="pb-3 pr-4">Uploaded</th>
                        <th className="pb-3">Open</th>
                      </tr>
                    </thead>

                    <tbody>
                      {record.studies.map((study) => (
                        <tr
                          key={study.id}
                          className="border-t border-white/10 text-slate-200"
                        >
                          <td className="py-3 pr-4">
                            <p className="font-bold text-white">{study.id}</p>

                            <p className="text-xs text-slate-400">
                              {study.bodyRegion} · {study.imagingView}
                            </p>
                          </td>

                          <td className="py-3 pr-4">{study.clinicName}</td>

                          <td className="py-3 pr-4">
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-bold ${triageStyle(
                                study.triageResult,
                              )}`}
                            >
                              {study.triageResult || "NOT_ANALYZED"}
                            </span>

                            {study.primaryFinding && (
                              <p className="mt-1 text-xs text-slate-400">
                                {study.primaryFinding}
                              </p>
                            )}
                          </td>

                          <td className="py-3 pr-4">
                            <p>{study.status}</p>

                            <p className="text-xs text-slate-400">
                              {study.reportCount} report
                              {study.reportCount === 1 ? "" : "s"} ·{" "}
                              {study.messageCount} message
                              {study.messageCount === 1 ? "" : "s"}
                            </p>
                          </td>

                          <td className="py-3 pr-4 text-xs">
                            {formatDate(study.createdAt)}
                          </td>

                          <td className="py-3">
                            <Link
                              href={`/studies/${study.id}`}
                              className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="mt-7 grid gap-7 lg:grid-cols-2">
              <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
                <h2 className="text-xl font-black text-white">
                  Reports ({record.reports.length})
                </h2>

                {record.reports.length === 0 ? (
                  <p className="mt-4 text-slate-300">
                    No doctor has written a report yet.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {record.reports.map((report) => (
                      <div
                        key={report.id}
                        className="rounded-2xl border border-white/15 bg-white/[0.05] p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-black text-white">
                            {report.finalFinding || "No finding recorded"}
                          </p>

                          <span className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-xs font-bold text-slate-200">
                            {report.status}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-300">
                          {report.doctorName || "Unknown doctor"} ·{" "}
                          {formatDate(report.createdAt)}
                        </p>

                        {report.impression && (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                            {report.impression}
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          {report.severity && (
                            <span className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 font-bold text-slate-200">
                              {report.severity}
                            </span>
                          )}

                          {report.followUpRequired && (
                            <span className="rounded-full border border-amber-300/30 bg-amber-400/15 px-3 py-1 font-bold text-amber-100">
                              Follow-up required
                            </span>
                          )}

                          <Link
                            href={`/studies/${report.studyId}`}
                            className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 font-bold text-cyan-100"
                          >
                            {report.studyId}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
                <h2 className="text-xl font-black text-white">
                  Appointments ({record.appointments.length})
                </h2>

                {record.appointments.length === 0 ? (
                  <p className="mt-4 text-slate-300">
                    No appointment has been booked yet.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {record.appointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        className="rounded-2xl border border-white/15 bg-white/[0.05] p-5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-black text-white">
                            {formatDate(appointment.scheduledAt)}
                          </p>

                          <span className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1 text-xs font-bold text-slate-200">
                            {appointment.status}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-300">
                          {appointment.doctorName || "Unknown doctor"}
                        </p>

                        {appointment.notes && (
                          <p className="mt-2 text-sm text-slate-200">
                            {appointment.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {record.applications.length > 0 && (
              <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
                <h2 className="text-xl font-black text-white">
                  Registration requests
                </h2>

                <div className="mt-4 flex flex-col gap-3">
                  {record.applications.map((application) => (
                    <div
                      key={application.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-4"
                    >
                      <div>
                        <p className="font-bold text-white">
                          {application.status}
                        </p>

                        <p className="text-sm text-slate-300">
                          Sent {formatDate(application.createdAt)} · reviewed{" "}
                          {formatDate(application.reviewedAt)}
                        </p>
                      </div>

                      {application.rejectionReason && (
                        <p className="text-sm text-rose-200">
                          {application.rejectionReason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
