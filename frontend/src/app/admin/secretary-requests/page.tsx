"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/*
  Where an administrator reads a secretary's application and decides.

  Approving is not a single button here, and that is deliberate: a
  secretary account only means something once it is pointed at a doctor,
  so the doctor is chosen on this page before the approval is sent. The
  list of doctors comes back with the applications and already excludes
  anybody who has a secretary, because a second one on the same calendar
  could undo the first one's bookings.
*/

type SecretaryApplication = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string | null;
  national_id: string;

  qualification: string;
  institute: string;
  graduation_year: number | null;

  years_of_experience: number;
  current_workplace: string | null;
  languages: string[];
  about: string | null;

  id_document_path: string | null;
  qualification_certificate_path: string | null;
  experience_certificate_path: string | null;
  cv_path: string | null;
  photo_path: string | null;

  status:
    | "Pending"
    | "Under Review"
    | "Needs More Information"
    | "Approved"
    | "Rejected"
    | "Suspended";

  rejection_reason: string | null;
  requested_more_info: string | null;
  login_email: string | null;
  approved_user_id: string | null;
  assignedDoctorName: string | null;
  secretaryStatus: string | null;
  created_at: string;
};

type DoctorChoice = {
  userId: string;
  fullName: string;
  specialty: string;
  hasSecretary: boolean;
};

type Credentials = {
  email: string;
  temporaryPassword: string;
  expiresAt: string;
  validForHours: number;
};

const DOCUMENTS: Array<{
  kind: string;
  label: string;
  field: keyof SecretaryApplication;
}> = [
  { kind: "id-document", label: "ID document", field: "id_document_path" },
  {
    kind: "qualification-certificate",
    label: "Qualification certificate",
    field: "qualification_certificate_path",
  },
  {
    kind: "experience-certificate",
    label: "Experience certificate",
    field: "experience_certificate_path",
  },
  { kind: "cv", label: "CV", field: "cv_path" },
];

export default function AdminSecretaryRequestsPage() {
  const [applications, setApplications] = useState<SecretaryApplication[]>(
    [],
  );

  const [doctors, setDoctors] = useState<DoctorChoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/secretary-requests", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await response.json()) as {
        applications?: SecretaryApplication[];
        doctors?: DoctorChoice[];
        message?: string;
      };

      if (!response.ok) {
        setError(data.message || "Unable to load the applications.");
        return;
      }

      setApplications(data.applications || []);
      setDoctors(data.doctors || []);
    } catch (loadError) {
      console.error("Failed to load secretary applications:", loadError);
      setError("Unable to connect to the server.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      total: applications.length,
      pending: applications.filter((item) => item.status === "Pending")
        .length,
      moreInfo: applications.filter(
        (item) => item.status === "Needs More Information",
      ).length,
      approved: applications.filter((item) => item.status === "Approved")
        .length,
    }),
    [applications],
  );

  const availableDoctors = useMemo(
    () => doctors.filter((doctor) => !doctor.hasSecretary),
    [doctors],
  );

  async function act(
    requestId: string,
    action: "approve" | "reject" | "request-info",
    extra: Record<string, string> = {},
  ) {
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/secretary-requests/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, ...extra }),
      });

      const data = (await response.json()) as {
        message?: string;
        credentials?: Credentials;
      };

      if (!response.ok) {
        setError(data.message || "This could not be done.");
        return;
      }

      setNotice(data.message || "Done.");

      if (data.credentials) setCredentials(data.credentials);

      await load();
    } catch (actionError) {
      console.error("Secretary application action failed:", actionError);
      setError("Unable to connect to the server.");
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-12 h-[520px] w-[520px] rounded-full bg-blue-500/25 blur-[170px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-cyan-400/20 blur-[180px]" />

      <header className="relative z-20 border-b border-white/15 bg-blue-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-3 px-5 py-4 sm:px-7">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-11 w-11 overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-lg">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={44}
                height={44}
                className="h-full w-full object-contain p-1"
                priority
              />
            </div>

            <div>
              <p className="font-bold">RadioCare</p>
              <p className="text-xs text-cyan-200">Admin Portal</p>
            </div>
          </Link>

          <div className="min-w-0 flex-1">
            <AdminNav compact />
          </div>

          <Link
            href="/dashboard"
            className="ml-auto rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-[1700px] px-5 py-9 sm:px-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="font-semibold text-cyan-300">Staffing</p>

            <h1 className="mt-2 text-3xl font-bold sm:text-5xl">
              Secretary applications
            </h1>

            <p className="mt-4 max-w-3xl leading-7 text-slate-300">
              Check the identity paper and the qualification, choose the
              doctor this person will work for, then approve. The
              sign-in details are emailed to the address on the
              application and are valid for 24 hours.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/secretaries"
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold transition hover:bg-white/15"
            >
              Current secretaries
            </Link>

            <button
              type="button"
              onClick={() => void load()}
              disabled={isLoading}
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total applications" value={counts.total} />
          <StatCard label="Pending" value={counts.pending} />
          <StatCard label="Needs information" value={counts.moreInfo} />
          <StatCard label="Approved" value={counts.approved} />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100"
          >
            {error}
          </div>
        )}

        {notice && (
          <div className="mt-6 rounded-2xl border border-green-300/30 bg-green-500/20 px-4 py-3 text-sm text-green-100">
            {notice}
          </div>
        )}

        {credentials && (
          <div className="mt-6 rounded-3xl border border-cyan-300/30 bg-cyan-400/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-black text-cyan-50">
                  Sign-in details for the new secretary
                </p>

                <p className="mt-2 text-sm text-cyan-100">
                  Email:{" "}
                  <span className="font-mono">{credentials.email}</span>
                </p>

                <p className="mt-1 text-sm text-cyan-100">
                  Temporary password:{" "}
                  <span className="font-mono">
                    {credentials.temporaryPassword}
                  </span>
                </p>

                <p className="mt-2 text-xs text-cyan-200/80">
                  Valid for {credentials.validForHours} hours. It has to
                  be replaced on the first sign in.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCredentials(null)}
                className="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-bold text-white"
              >
                Hide
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="mt-10 text-slate-300">Loading applications...</p>
        ) : applications.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-white/15 bg-white/5 p-10 text-center">
            <span className="text-5xl">🗂️</span>

            <p className="mt-4 font-bold text-slate-200">
              No secretary applications yet.
            </p>

            <p className="mt-2 text-sm text-slate-400">
              Applications arrive from the Secretary tab on the sign-in
              page.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            {applications.map((application) => (
              <ApplicationCard
                key={application.id}
                application={application}
                doctors={availableDoctors}
                onAct={act}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ApplicationCard({
  application,
  doctors,
  onAct,
}: {
  application: SecretaryApplication;
  doctors: DoctorChoice[];
  onAct: (
    requestId: string,
    action: "approve" | "reject" | "request-info",
    extra?: Record<string, string>,
  ) => Promise<void>;
}) {
  const [doctorUserId, setDoctorUserId] = useState("");
  const [reason, setReason] = useState("");
  const [askMode, setAskMode] = useState<"" | "reject" | "info">("");
  const [busy, setBusy] = useState(false);

  const decided =
    application.status === "Approved" ||
    application.status === "Rejected";

  async function run(
    action: "approve" | "reject" | "request-info",
    extra: Record<string, string> = {},
  ) {
    setBusy(true);
    await onAct(application.id, action, extra);
    setBusy(false);
    setAskMode("");
    setReason("");
  }

  return (
    <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 text-xl font-black text-cyan-100">
          {application.photo_path ? (
            /* Admin only, and served through the backend. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${backendBaseUrl}/api/secretary-requests/${encodeURIComponent(
                application.id,
              )}/photo`}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            initialsOf(application.full_name)
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-black">{application.full_name}</h2>

            <StatusPill status={application.status} />
          </div>

          <p className="mt-1 text-sm text-slate-300">
            {application.qualification} — {application.institute}
            {application.graduation_year
              ? ` (${application.graduation_year})`
              : ""}
          </p>

          <p className="mt-1 text-sm text-slate-400">
            {application.email} · {application.phone} · ID{" "}
            {application.national_id}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Detail
          label="Experience"
          value={`${application.years_of_experience} year${
            application.years_of_experience === 1 ? "" : "s"
          }${
            application.current_workplace
              ? ` · ${application.current_workplace}`
              : ""
          }`}
        />

        <Detail
          label="Languages"
          value={
            application.languages.length > 0
              ? application.languages.join(", ")
              : "Not stated"
          }
        />

        <Detail
          label="Applied"
          value={new Date(application.created_at).toLocaleDateString()}
        />
      </div>

      {application.about && (
        <p className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
          {application.about}
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DOCUMENTS.map((document) => {
          const stored = application[document.field];
          const hasFile =
            typeof stored === "string" && stored.startsWith("storage/");

          return (
            <div
              key={document.kind}
              className="rounded-2xl border border-white/10 bg-white/5 p-3"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {document.label}
              </p>

              {hasFile ? (
                <a
                  href={`${backendBaseUrl}/api/secretary-requests/${encodeURIComponent(
                    application.id,
                  )}/document/${document.kind}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                >
                  Open ↗
                </a>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Not attached
                </p>
              )}
            </div>
          );
        })}
      </div>

      {application.status === "Approved" && (
        <div className="mt-5 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-sm text-emerald-50">
          Works for{" "}
          <span className="font-black">
            {application.assignedDoctorName ?? "a doctor"}
          </span>
          {application.login_email ? (
            <>
              {" "}
              · signs in as{" "}
              <span className="font-mono">{application.login_email}</span>
            </>
          ) : null}
        </div>
      )}

      {application.rejection_reason && (
        <div className="mt-5 rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-rose-100">
          Rejected: {application.rejection_reason}
        </div>
      )}

      {application.requested_more_info && (
        <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-4 text-sm text-amber-100">
          Waiting on: {application.requested_more_info}
        </div>
      )}

      {!decided && (
        <div className="mt-6 border-t border-white/10 pt-5">
          {askMode === "" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 text-sm font-semibold text-slate-200">
                Doctor this secretary will work for
                <select
                  value={doctorUserId}
                  onChange={(event) =>
                    setDoctorUserId(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-white/20 bg-[#0a2450] px-4 py-3 text-white outline-none focus:border-cyan-300"
                >
                  <option value="">Choose a doctor...</option>

                  {doctors.map((doctor) => (
                    <option key={doctor.userId} value={doctor.userId}>
                      {doctor.fullName}
                      {doctor.specialty ? ` — ${doctor.specialty}` : ""}
                    </option>
                  ))}
                </select>
                {doctors.length === 0 && (
                  <span className="mt-2 block text-xs text-amber-200">
                    Every active doctor already has a secretary. Remove
                    one on the secretaries page first.
                  </span>
                )}
              </label>

              <button
                type="button"
                disabled={busy || !doctorUserId}
                onClick={() => void run("approve", { doctorUserId })}
                className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-3 font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50"
              >
                {busy ? "Working..." : "Approve and hire"}
              </button>

              <button
                type="button"
                onClick={() => setAskMode("info")}
                className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-5 py-3 text-sm font-bold text-amber-100 transition hover:bg-amber-400/20"
              >
                Ask for more
              </button>

              <button
                type="button"
                onClick={() => setAskMode("reject")}
                className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-5 py-3 text-sm font-bold text-rose-100 transition hover:bg-rose-500/20"
              >
                Reject
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 text-sm font-semibold text-slate-200">
                {askMode === "reject"
                  ? "Why is this being rejected?"
                  : "What else is needed?"}
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={
                    askMode === "reject"
                      ? "Kept on the application"
                      : "Sent to the applicant"
                  }
                  className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-slate-400 focus:border-cyan-300"
                />
              </label>

              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(
                    askMode === "reject" ? "reject" : "request-info",
                    askMode === "reject"
                      ? { reason }
                      : { requestedInfo: reason },
                  )
                }
                className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-black text-white transition disabled:opacity-50"
              >
                {busy ? "Working..." : "Send"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setAskMode("");
                  setReason("");
                }}
                className="rounded-xl border border-white/20 px-5 py-3 text-sm font-bold text-slate-200"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Approved"
      ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
      : status === "Rejected"
        ? "border-rose-300/30 bg-rose-500/15 text-rose-100"
        : status === "Needs More Information"
          ? "border-amber-300/30 bg-amber-400/15 text-amber-100"
          : "border-cyan-300/30 bg-cyan-400/15 text-cyan-100";

  return (
    <span
      className={`rounded-lg border px-3 py-1 text-xs font-black ${tone}`}
    >
      {status}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-3xl border border-white/15 bg-white/[0.07] p-5">
      <p className="text-sm font-semibold text-slate-300">{label}</p>
      <p className="mt-2 text-4xl font-black text-white">{value}</p>
    </div>
  );
}
