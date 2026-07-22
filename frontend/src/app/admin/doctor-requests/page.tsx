"use client";

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type DoctorRequest = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  national_id: string;

  specialty: string;
  subspecialty: string | null;

  license_number: string;
  licensing_authority: string;
  license_country: string | null;
  license_issue_date: string;
  license_expiry_date: string;

  years_of_experience: number;
  current_workplace: string;
  medical_degree: string;
  university: string;
  graduation_year: number;

  id_document_path: string;
  medical_license_path: string;
  specialty_certificate_path: string;
  cv_path: string;

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
  created_at: string;
};

type Credentials = {
  email: string;
  temporaryPassword: string;
  issuedAt: string;
  expiresAt: string;
  validForHours: number;
};

export default function AdminDoctorRequestsPage() {
  const [requests, setRequests] = useState<
    DoctorRequest[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] = useState("");

  const [credentials, setCredentials] =
    useState<Credentials | null>(null);

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(
        "/api/doctor-requests",
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data = (await response.json()) as {
        applications?: DoctorRequest[];
        message?: string;
      };

      if (!response.ok) {
        setError(
          data.message ||
            "Unable to load doctor requests."
        );
        return;
      }

      setRequests(data.applications || []);
    } catch (loadError) {
      console.error(
        "Failed to load doctor requests:",
        loadError
      );

      setError(
        "Unable to connect to the server."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const counts = useMemo(() => {
    return {
      total: requests.length,

      pending: requests.filter(
        (item) => item.status === "Pending"
      ).length,

      moreInfo: requests.filter(
        (item) =>
          item.status ===
          "Needs More Information"
      ).length,

      approved: requests.filter(
        (item) => item.status === "Approved"
      ).length,
    };
  }, [requests]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-12 h-[520px] w-[520px] rounded-full bg-blue-500/25 blur-[170px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-cyan-400/20 blur-[180px]" />

      <header className="relative z-20 border-b border-white/15 bg-blue-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between px-5 py-4 sm:px-7">
          <Link
            href="/dashboard"
            className="flex items-center gap-3"
          >
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
              <p className="font-bold">
                RadioCare
              </p>

              <p className="text-xs text-cyan-200">
                Admin Portal
              </p>
            </div>
          </Link>

          <Link
            href="/dashboard"
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15"
          >
            Back to dashboard
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-[1700px] px-5 py-9 sm:px-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="font-semibold text-cyan-300">
              Doctor credentialing
            </p>

            <h1 className="mt-2 text-3xl font-bold sm:text-5xl">
              Doctor requests
            </h1>

            <p className="mt-4 max-w-3xl leading-7 text-slate-300">
              Verify the doctor&apos;s identity,
              license, specialty, and submitted
              documents, then approve, reject, or
              request more information.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/doctor-request"
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold transition hover:bg-white/15"
            >
              Add another doctor
            </Link>

            <button
              type="button"
              onClick={() => void loadRequests()}
              disabled={isLoading}
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading
                ? "Refreshing..."
                : "Refresh requests"}
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total requests"
            value={counts.total}
          />

          <StatCard
            label="Pending"
            value={counts.pending}
          />

          <StatCard
            label="Needs information"
            value={counts.moreInfo}
          />

          <StatCard
            label="Approved"
            value={counts.approved}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-7 rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-red-100"
          >
            {error}
          </div>
        )}

        <div className="mt-7 space-y-6">
          {isLoading ? (
            <div className="rounded-3xl border border-white/15 bg-white/10 p-8 text-slate-300 backdrop-blur-2xl">
              Loading doctor requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-3xl border border-white/15 bg-white/10 p-8 text-slate-300 backdrop-blur-2xl">
              No doctor requests have been
              submitted yet.
            </div>
          ) : (
            requests.map((requestItem) => (
              <DoctorRequestCard
                key={requestItem.id}
                requestItem={requestItem}
                onUpdated={loadRequests}
                onCredentials={setCredentials}
              />
            ))
          )}
        </div>
      </section>

      {credentials && (
        <CredentialsModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
    </main>
  );
}

function DoctorRequestCard({
  requestItem,
  onUpdated,
  onCredentials,
}: {
  requestItem: DoctorRequest;
  onUpdated: () => Promise<void>;
  onCredentials: (
    credentials: Credentials
  ) => void;
}) {
  const [adminText, setAdminText] =
    useState("");

  const [isSaving, setIsSaving] =
    useState(false);

  const [localError, setLocalError] =
    useState("");

  async function submitAction(
    event: FormEvent,
    action:
      | "approve"
      | "reject"
      | "request-info"
  ) {
    event.preventDefault();

    setLocalError("");

    if (
      action !== "approve" &&
      !adminText.trim()
    ) {
      setLocalError(
        action === "reject"
          ? "Write the rejection reason."
          : "Write the information required from the doctor."
      );
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(
        "/api/doctor-requests/manage",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requestId: requestItem.id,
            action,
            reason: adminText,
            requestedInfo: adminText,
          }),
        }
      );

      const data = (await response.json()) as {
        message?: string;
        credentials?: Credentials;
      };

      if (!response.ok) {
        setLocalError(
          data.message ||
            "Unable to update the request."
        );
        return;
      }

      if (data.credentials) {
        onCredentials(data.credentials);
      }

      setAdminText("");
      await onUpdated();
    } catch (actionError) {
      console.error(
        "Failed to update doctor request:",
        actionError
      );

      setLocalError(
        "Unable to connect to the server."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const canReview =
    requestItem.status !== "Approved" &&
    requestItem.status !== "Rejected";

  return (
    <article className="rounded-[30px] border border-white/15 bg-white/10 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold">
              {requestItem.full_name}
            </h2>

            <StatusBadge
              status={requestItem.status}
            />
          </div>

          <p className="mt-2 text-cyan-200">
            {requestItem.specialty}

            {requestItem.subspecialty
              ? ` · ${requestItem.subspecialty}`
              : ""}
          </p>

          <p className="mt-2 text-sm text-slate-400">
            Request ID: {requestItem.id}
          </p>
        </div>

        <div className="text-sm text-slate-300">
          Submitted:{" "}
          {new Date(
            requestItem.created_at
          ).toLocaleString()}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoBox
          label="Email"
          value={requestItem.email}
        />

        <InfoBox
          label="Phone"
          value={requestItem.phone}
        />

        <InfoBox
          label="Date of birth"
          value={requestItem.date_of_birth}
        />

        <InfoBox
          label="National ID"
          value={requestItem.national_id}
        />

        <InfoBox
          label="License"
          value={`${requestItem.license_number} · ${requestItem.licensing_authority}`}
        />

        <InfoBox
          label="License country"
          value={
            requestItem.license_country ||
            "Not provided"
          }
        />

        <InfoBox
          label="License period"
          value={`${requestItem.license_issue_date} → ${requestItem.license_expiry_date}`}
        />

        <InfoBox
          label="Experience"
          value={`${requestItem.years_of_experience} years`}
        />

        <InfoBox
          label="Workplace"
          value={requestItem.current_workplace}
        />

        <InfoBox
          label="Education"
          value={`${requestItem.medical_degree} · ${requestItem.university} (${requestItem.graduation_year})`}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DocumentBox
          label="ID document"
          value={requestItem.id_document_path}
        />

        <DocumentBox
          label="Medical license"
          value={requestItem.medical_license_path}
        />

        <DocumentBox
          label="Specialty certificate"
          value={
            requestItem.specialty_certificate_path
          }
        />

        <DocumentBox
          label="CV"
          value={requestItem.cv_path}
        />
      </div>

      {requestItem.requested_more_info && (
        <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
          Requested information:{" "}
          {requestItem.requested_more_info}
        </div>
      )}

      {requestItem.rejection_reason && (
        <div className="mt-6 rounded-2xl border border-red-300/30 bg-red-500/15 p-4 text-sm text-red-100">
          Rejection reason:{" "}
          {requestItem.rejection_reason}
        </div>
      )}

      {requestItem.status === "Approved" &&
        requestItem.login_email && (
          <div className="mt-6 rounded-2xl border border-green-300/30 bg-green-500/15 p-4 text-sm text-green-100">
            Approved login email:{" "}
            {requestItem.login_email}
          </div>
        )}

      {canReview && (
        <form className="mt-7 space-y-6">
          <section className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-5">
            <h3 className="text-lg font-bold">
              Automatic account creation
            </h3>

            <p className="mt-2 text-sm leading-6 text-cyan-50">
              When you approve this request, RadioCare
              automatically creates a unique doctor login
              email and a secure temporary password. The
              temporary credentials remain valid for 24
              hours and are displayed immediately after
              approval.
            </p>
          </section>

          <label className="block text-sm font-semibold text-slate-200">
            Rejection reason or required information

            <textarea
              value={adminText}
              disabled={isSaving}
              onChange={(event) =>
                setAdminText(
                  event.target.value
                )
              }
              rows={3}
              placeholder="Write a reason when rejecting, or explain what additional information is required..."
              className="mt-2 w-full resize-y rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {localError && (
            <div
              role="alert"
              className="rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100"
            >
              {localError}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isSaving}
              onClick={(event) =>
                void submitAction(
                  event,
                  "approve"
                )
              }
              className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
            >
              {isSaving
                ? "Processing..."
                : "Approve & create account"}
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={(event) =>
                void submitAction(
                  event,
                  "request-info"
                )
              }
              className="rounded-xl border border-amber-300/30 bg-amber-300/15 px-5 py-3 font-semibold text-amber-100 transition hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Request more information
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={(event) =>
                void submitAction(
                  event,
                  "reject"
                )
              }
              className="rounded-xl border border-red-300/30 bg-red-500/15 px-5 py-3 font-semibold text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reject request
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-2xl">
      <p className="text-sm text-slate-300">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>
    </div>
  );
}

function InfoBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-cyan-200">
        {label}
      </p>

      <p className="mt-2 break-words text-sm leading-6 text-slate-200">
        {value}
      </p>
    </div>
  );
}

function DocumentBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-semibold text-white">
        {label}
      </p>

      <p className="mt-2 break-all text-xs leading-5 text-cyan-200">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: DoctorRequest["status"];
}) {
  const styles: Record<
    DoctorRequest["status"],
    string
  > = {
    Pending:
      "border-amber-300/30 bg-amber-300/15 text-amber-100",

    "Under Review":
      "border-blue-300/30 bg-blue-300/15 text-blue-100",

    "Needs More Information":
      "border-orange-300/30 bg-orange-300/15 text-orange-100",

    Approved:
      "border-green-300/30 bg-green-300/15 text-green-100",

    Rejected:
      "border-red-300/30 bg-red-500/15 text-red-100",

    Suspended:
      "border-slate-300/30 bg-slate-300/15 text-slate-100",
  };

  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-bold ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: Credentials;
  onClose: () => void;
}) {
  const [copied, setCopied] =
    useState(false);

  const [isMounted, setIsMounted] =
    useState(false);

  useEffect(() => {
    setIsMounted(true);

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow =
        previousOverflow;
    };
  }, []);

  async function copyCredentials() {
    await navigator.clipboard.writeText(
      `RadioCare doctor login\nEmail: ${credentials.email}\nTemporary password: ${credentials.temporaryPassword}`
    );

    setCopied(true);
  }

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="flex items-center justify-center overflow-y-auto p-5 backdrop-blur-lg"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        zIndex: 2147483647,
        backgroundColor: "rgba(2, 6, 23, 0.94)",
        isolation: "isolate",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="my-auto w-full max-w-lg rounded-[28px] border border-white/20 bg-blue-950 p-6 text-white shadow-[0_35px_100px_rgba(0,0,0,0.65)]"
        style={{
          position: "relative",
          zIndex: 2147483647,
        }}
      >
        <p className="font-semibold text-green-300">
          Doctor approved
        </p>

        <h2 className="mt-2 text-2xl font-bold">
          Temporary login credentials
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          Give these credentials to the approved doctor.
          They are valid for 24 hours. The doctor must log
          in and change the temporary password before it
          expires.
        </p>

        <div className="mt-6 space-y-4 rounded-2xl border border-white/15 bg-white/10 p-5">
          <div>
            <p className="text-xs uppercase tracking-wider text-cyan-200">
              Doctor login email
            </p>

            <p className="mt-1 break-all font-semibold">
              {credentials.email}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-cyan-200">
              Temporary password
            </p>

            <p className="mt-1 break-all font-mono text-lg font-bold">
              {credentials.temporaryPassword}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-cyan-200">
              Valid until
            </p>

            <p className="mt-1 font-semibold">
              {new Date(
                credentials.expiresAt
              ).toLocaleString()}
            </p>

            <p className="mt-1 text-xs text-slate-300">
              Valid for {credentials.validForHours} hours
              from approval.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              void copyCredentials()
            }
            className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold"
          >
            {copied
              ? "Credentials copied"
              : "Copy credentials"}
          </button>

          <Link
            href="/doctor-request"
            className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-5 py-3 font-semibold text-cyan-100"
          >
            Add another doctor
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
