"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type DoctorRecord = {
  doctor: {
    doctorId: string;
    fullName: string;
    phone: string;
    email: string;
    specialty: string;
    subspecialty: string;
    licenseNumber: string;
    licensingAuthority: string;
    licenseExpiryDate: string;
    yearsOfExperience: number;
    currentWorkplace: string;
    status: string;
    createdAt: string;
    suspended: boolean;
    mustChangePassword: boolean;
  };
  clinics: Array<{
    key: string;
    name: string;
    patientRegions: string[];
    caseCount: number;
  }>;
  applicationId: string | null;
  documents: Array<{
    kind: string;
    label: string;
    available: boolean;
    givenName: string;
  }>;
  waitingCases: Array<{
    id: string;
    patientId: string;
    patientName: string;
    bodyRegion: string;
    clinicName: string;
    priority: string;
    status: string;
    triageResult: string;
    primaryFinding: string | null;
    createdAt: string;
    unansweredMessages: number;
  }>;
  reports: Array<{
    id: number;
    studyId: string;
    status: string;
    finalFinding: string;
    severity: string;
    patientName: string;
    createdAt: string;
  }>;
  appointments: Array<{
    id: number;
    studyId: string;
    scheduledAt: string;
    status: string;
    notes: string;
    patientName: string;
  }>;
  counters: {
    clinics: number;
    cases: number;
    waiting: number;
    reports: number;
    appointments: number;
    messagesSent: number;
    unansweredMessages: number;
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

function Counter({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${
        warn && value > 0
          ? "border-amber-300/35 bg-amber-400/10"
          : "border-white/15 bg-white/[0.06]"
      }`}
    >
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

      <p className="mt-2 break-words leading-6 text-slate-100">
        {value || "—"}
      </p>
    </div>
  );
}

/*
  Everything the application knows about one doctor, on one screen: the
  clinics they work in, what is still waiting there, what they reported
  and scheduled, and whether patients are waiting for a reply.
*/
export default function AdminDoctorRecordPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const doctorId = String(params?.id ?? "");

  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [record, setRecord] = useState<DoctorRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadRecord = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/admin/doctors/${encodeURIComponent(doctorId)}`,
        { method: "GET", credentials: "include", cache: "no-store" },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the doctor.");
      }

      setRecord(data);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to load the doctor.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [doctorId]);

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
          href="/admin/clinics"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
        >
          <span>←</span>
          <span>Clinics and doctors</span>
        </Link>

        {errorMessage && (
          <p className="mb-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-5 py-4 font-bold text-rose-100">
            {errorMessage}
          </p>
        )}

        {isLoading && !record && (
          <p className="text-slate-300">Loading the doctor record...</p>
        )}

        {record && (
          <>
            <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                    Doctor record
                  </p>

                  <h1 className="mt-2 text-3xl font-black text-white">
                    {record.doctor.fullName}
                  </h1>

                  <p className="mt-1 text-slate-300">
                    {record.doctor.specialty}
                    {record.doctor.subspecialty
                      ? ` · ${record.doctor.subspecialty}`
                      : ""}{" "}
                    · {record.doctor.yearsOfExperience} years of experience
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-1.5 text-sm font-bold text-slate-200">
                    {record.doctor.status}
                  </span>

                  {record.doctor.suspended && (
                    <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-4 py-1.5 text-sm font-bold text-rose-100">
                      Account suspended
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <Field label="Login email" value={record.doctor.email} />
                <Field label="Phone" value={record.doctor.phone} />
                <Field label="Licence" value={record.doctor.licenseNumber} />
                <Field
                  label="Licensing authority"
                  value={record.doctor.licensingAuthority}
                />
                <Field
                  label="Licence expires"
                  value={record.doctor.licenseExpiryDate}
                />
                <Field
                  label="Workplace"
                  value={record.doctor.currentWorkplace}
                />
              </div>

              <div className="mt-6">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Clinics
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {record.clinics.map((clinic) => (
                    <span
                      key={clinic.key}
                      className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-4 py-1.5 text-sm font-bold text-cyan-100"
                    >
                      {clinic.name} · {clinic.caseCount} case
                      {clinic.caseCount === 1 ? "" : "s"}
                    </span>
                  ))}
                </div>

                <Link
                  href="/admin/clinics"
                  className="mt-3 inline-block text-sm font-bold text-cyan-300 hover:text-cyan-100"
                >
                  Change the clinics of this doctor →
                </Link>
              </div>
            </section>

            {record.documents.length > 0 && (
              <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
                <h2 className="text-xl font-black text-white">
                  Credential documents
                </h2>

                <p className="mt-2 text-slate-300">
                  The papers submitted with the application this doctor was
                  approved from.
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {record.documents.map((document) => (
                    <div
                      key={document.kind}
                      className="rounded-2xl border border-white/15 bg-white/[0.05] p-4"
                    >
                      <p className="text-sm font-bold text-white">
                        {document.label}
                      </p>

                      {document.available && record.applicationId ? (
                        <a
                          href={`${backendBaseUrl}/api/doctor-requests/${encodeURIComponent(
                            record.applicationId,
                          )}/document/${document.kind}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                        >
                          Open document ↗
                        </a>
                      ) : (
                        <p className="mt-3 break-all text-xs leading-5 text-amber-200">
                          No file uploaded
                          {document.givenName
                            ? ` (name given: ${document.givenName})`
                            : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Counter label="Cases in clinics" value={record.counters.cases} />
              <Counter
                label="Waiting for review"
                value={record.counters.waiting}
                warn
              />
              <Counter label="Reports written" value={record.counters.reports} />
              <Counter
                label="Appointments"
                value={record.counters.appointments}
              />
              <Counter
                label="Unread patient messages"
                value={record.counters.unansweredMessages}
                warn
              />
            </div>

            <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
              <h2 className="text-xl font-black text-white">
                Waiting for this doctor ({record.waitingCases.length})
              </h2>

              {record.waitingCases.length === 0 ? (
                <p className="mt-4 text-slate-300">
                  Nothing is waiting. Every case in these clinics is done.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        <th className="pb-3 pr-4">Study</th>
                        <th className="pb-3 pr-4">Patient</th>
                        <th className="pb-3 pr-4">Clinic</th>
                        <th className="pb-3 pr-4">AI result</th>
                        <th className="pb-3 pr-4">Uploaded</th>
                        <th className="pb-3">Open</th>
                      </tr>
                    </thead>

                    <tbody>
                      {record.waitingCases.map((study) => (
                        <tr
                          key={study.id}
                          className="border-t border-white/10 text-slate-200"
                        >
                          <td className="py-3 pr-4">
                            <p className="font-bold text-white">{study.id}</p>

                            <p className="text-xs text-slate-400">
                              {study.bodyRegion} · {study.priority}
                            </p>
                          </td>

                          <td className="py-3 pr-4">
                            <Link
                              href={`/admin/patients/${study.patientId}`}
                              className="font-bold text-cyan-200 hover:text-cyan-100"
                            >
                              {study.patientName}
                            </Link>

                            {study.unansweredMessages > 0 && (
                              <p className="text-xs text-amber-200">
                                {study.unansweredMessages} unread message
                                {study.unansweredMessages === 1 ? "" : "s"}
                              </p>
                            )}
                          </td>

                          <td className="py-3 pr-4">{study.clinicName}</td>

                          <td className="py-3 pr-4">
                            <p>{study.triageResult || "NOT_ANALYZED"}</p>

                            {study.primaryFinding && (
                              <p className="text-xs text-slate-400">
                                {study.primaryFinding}
                              </p>
                            )}
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
                  Reports written ({record.reports.length})
                </h2>

                {record.reports.length === 0 ? (
                  <p className="mt-4 text-slate-300">
                    This doctor has not written a report yet.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {record.reports.map((report) => (
                      <Link
                        key={report.id}
                        href={`/studies/${report.studyId}`}
                        className="rounded-2xl border border-white/15 bg-white/[0.05] p-5 transition hover:border-cyan-300/40"
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
                          {report.patientName} · {formatDate(report.createdAt)}
                          {report.severity ? ` · ${report.severity}` : ""}
                        </p>
                      </Link>
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
                    This doctor has not booked an appointment yet.
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
                          {appointment.patientName}
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
          </>
        )}
      </div>
    </main>
  );
}
