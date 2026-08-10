"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type ReportRow = {
  id: string;
  studyId: string;
  patient: string;
  patientId: string;
  bodyRegion: string;
  clinicKey: string;
  priority: string;
  finalFinding: string;
  impression: string;
  severity: string;
  aiAgreement: string;
  followUpRequired: boolean;
  doctor: string;
  status: string;
  approvedAt: string | null;
  createdAt: string;
  aiFinding: string;
};

const statusStyle: Record<string, string> = {
  Draft: "border-amber-300/30 bg-amber-400/15 text-amber-100",
  Approved: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
};

const agreementStyle: Record<string, string> = {
  Confirmed: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  Modified: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  Rejected: "border-rose-300/30 bg-rose-500/10 text-rose-100",
};

export default function ReportsPage() {
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

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadReports = useCallback(async () => {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/reports${clinicQuery}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the reports.");
      }

      setReports(data.reports ?? []);
      setErrorMessage("");
    } catch (error) {
      setReports([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the reports.",
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

    void loadReports();
  }, [isPending, loadReports, router, session]);

  const visibleReports = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return reports.filter((report) => {
      if (statusFilter !== "All" && report.status !== statusFilter) {
        return false;
      }

      if (!term) return true;

      return [
        report.id,
        report.studyId,
        report.patient,
        report.finalFinding,
        report.doctor,
        report.bodyRegion,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [reports, searchTerm, statusFilter]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading reports...</p>
      </main>
    );
  }

  if (!session) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
          >
            <span>←</span>
            <span>Back to dashboard</span>
          </Link>

          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={isLoading}
            className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Medical documentation
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Medical Reports
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Every report holds the final decision of the doctor next to the
            preliminary AI result. A report becomes visible to the patient
            once it is approved.
          </p>
        </section>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 font-bold text-rose-100">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {["All", "Draft", "Approved"].map((status) => (
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

          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search by patient, study, or finding..."
            className="min-w-56 flex-1 rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {isLoading ? (
            <p className="rounded-3xl border border-white/15 bg-white/[0.05] p-8 text-center text-slate-300 lg:col-span-2">
              Loading...
            </p>
          ) : visibleReports.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-10 text-center text-slate-300 lg:col-span-2">
              No reports match this view yet.
            </p>
          ) : (
            visibleReports.map((report) => (
              <article
                key={report.id}
                className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-2xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
                      {report.id}
                    </p>

                    <h2 className="mt-2 text-xl font-black text-white">
                      {report.patient}
                    </h2>

                    <p className="mt-1 text-sm text-slate-400">
                      {report.bodyRegion} · {report.priority} ·{" "}
                      {report.studyId}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                        statusStyle[report.status] ??
                        "border-white/20 bg-white/10 text-slate-200"
                      }`}
                    >
                      {report.status}
                    </span>

                    {report.aiAgreement && (
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                          agreementStyle[report.aiAgreement] ??
                          "border-white/20 bg-white/10 text-slate-200"
                        }`}
                      >
                        AI {report.aiAgreement}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Final finding
                  </p>

                  <p className="mt-1 font-black text-white">
                    {report.finalFinding || "—"}
                  </p>

                  {report.aiFinding && (
                    <p className="mt-2 text-xs text-slate-400">
                      Preliminary AI result: {report.aiFinding}
                    </p>
                  )}
                </div>

                {report.impression && (
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                    {report.impression}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    {report.doctor || "Unassigned doctor"}
                    {report.approvedAt
                      ? ` · ${new Date(report.approvedAt).toLocaleDateString()}`
                      : ""}
                    {report.severity ? ` · ${report.severity}` : ""}
                  </p>

                  <Link
                    href={`/studies/${encodeURIComponent(report.studyId)}`}
                    className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
                  >
                    Open case
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
