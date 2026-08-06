"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import RegisterPatientCard from "@/components/RegisterPatientCard";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type PatientApplication = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  age: number;
  gender: string;
  nationalId: string;
  symptoms: string;
  medicalHistory: string;
  status: string;
  rejectionReason: string;
  loginEmail: string;
  approvedUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type Credentials = {
  loginEmail: string;
  temporaryPassword: string;
  expiresAt: string;
};

const statusStyle: Record<string, string> = {
  Pending: "border-amber-300/30 bg-amber-400/15 text-amber-100",
  Approved: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
  Rejected: "border-rose-300/30 bg-rose-500/15 text-rose-100",
};

export default function AdminPatientRequestsPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [applications, setApplications] = useState<PatientApplication[]>([]);
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [rejectingId, setRejectingId] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const loadApplications = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/patient-requests`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the requests.");
      }

      setApplications(data.applications ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the requests.",
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

    void loadApplications();
  }, [isAdmin, isPending, loadApplications, session]);

  async function reviewApplication(
    requestId: string,
    action: "approve" | "reject",
    reason = "",
  ) {
    try {
      setErrorMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/patient-requests/manage`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, action, reason }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to process the request.");
      }

      if (data.credentials) {
        setCredentials(data.credentials);
      }

      setRejectingId("");
      setRejectionReason("");

      await loadApplications();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to process the request.",
      );
    }
  }

  const visibleApplications = applications.filter((application) =>
    statusFilter === "All" ? true : application.status === statusFilter,
  );

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading requests...</p>
      </main>
    );
  }

  if (!session || !isAdmin) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <AdminNav />

        <RegisterPatientCard onRegistered={loadApplications} />

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
            onClick={() => void loadApplications()}
            disabled={isLoading}
            className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Account requests
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Patient Registration Requests
          </h1>

          <p className="mt-3 leading-7 text-slate-300">
            Approving a request creates the patient account and a temporary
            password you hand over to the patient.
          </p>
        </section>

        {credentials && (
          <section className="mt-6 rounded-3xl border border-emerald-300/30 bg-emerald-400/10 p-6">
            <p className="text-sm font-black uppercase tracking-wider text-emerald-200">
              Account created
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="rounded-2xl border border-white/15 bg-black/20 p-4 text-sm text-white">
                Login email
                <span className="mt-1 block font-black">
                  {credentials.loginEmail}
                </span>
              </p>

              <p className="rounded-2xl border border-white/15 bg-black/20 p-4 text-sm text-white">
                Temporary password
                <span className="mt-1 block break-all font-black">
                  {credentials.temporaryPassword}
                </span>
              </p>
            </div>

            <p className="mt-3 text-xs text-emerald-100/80">
              Valid until {new Date(credentials.expiresAt).toLocaleString()}.
              It is shown only once.
            </p>

            <button
              type="button"
              onClick={() => setCredentials(null)}
              className="mt-4 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white"
            >
              Hide
            </button>
          </section>
        )}

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {["Pending", "Approved", "Rejected", "All"].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-bold transition",
                statusFilter === status
                  ? "border-cyan-300/60 bg-cyan-400/20 text-white"
                  : "border-white/15 bg-white/[0.05] text-slate-300 hover:text-white",
              ].join(" ")}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {isLoading ? (
            <p className="rounded-3xl border border-white/15 bg-white/[0.05] p-8 text-center text-slate-300">
              Loading...
            </p>
          ) : visibleApplications.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-10 text-center text-slate-300">
              No requests in this list.
            </p>
          ) : (
            visibleApplications.map((application) => (
              <article
                key={application.id}
                className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-2xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-black text-white">
                      {application.fullName}
                    </h2>

                    <p className="mt-1 text-sm text-slate-300">
                      {application.email}
                      {application.phone ? ` · ${application.phone}` : ""}
                    </p>

                    <p className="mt-1 text-sm text-slate-400">
                      {application.age} years · {application.gender}
                      {application.nationalId
                        ? ` · ID ${application.nationalId}`
                        : ""}
                    </p>
                  </div>

                  <span
                    className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                      statusStyle[application.status] ??
                      "border-white/20 bg-white/10 text-slate-200"
                    }`}
                  >
                    {application.status}
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {application.symptoms && (
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Symptoms
                      </p>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">
                        {application.symptoms}
                      </p>
                    </div>
                  )}

                  {application.medicalHistory && (
                    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Medical history
                      </p>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-200">
                        {application.medicalHistory}
                      </p>
                    </div>
                  )}
                </div>

                {application.rejectionReason && (
                  <p className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-rose-100">
                    Rejection reason: {application.rejectionReason}
                  </p>
                )}

                {application.status === "Pending" && (
                  <div className="mt-5">
                    {rejectingId === application.id ? (
                      <div className="rounded-2xl border border-white/15 bg-black/20 p-4">
                        <label className="block text-sm font-bold text-slate-200">
                          Rejection reason
                          <textarea
                            rows={2}
                            value={rejectionReason}
                            onChange={(event) =>
                              setRejectionReason(event.target.value)
                            }
                            className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
                          />
                        </label>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void reviewApplication(
                                application.id,
                                "reject",
                                rejectionReason,
                              )
                            }
                            className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-black text-white"
                          >
                            Confirm rejection
                          </button>

                          <button
                            type="button"
                            onClick={() => setRejectingId("")}
                            className="rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            void reviewApplication(application.id, "approve")
                          }
                          className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3 font-black text-white"
                        >
                          Approve and create account
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRejectingId(application.id);
                            setRejectionReason("");
                          }}
                          className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-6 py-3 font-bold text-rose-100 transition hover:bg-rose-500/20"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {application.status === "Approved" && (
                  <p className="mt-4 text-sm text-emerald-200">
                    Account created with the email{" "}
                    <span className="font-black">
                      {application.loginEmail || application.email}
                    </span>
                    .
                  </p>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
