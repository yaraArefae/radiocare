"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

type ReportStatus =
  | "Draft"
  | "Ready"
  | "Approved";

type Report = {
  id: string;
  studyId: string;
  patient: string;
  patientId: string;
  bodyRegion: string;
  finding: string;
  radiologist: string;
  createdAt: string;
  status: ReportStatus;
};

type SessionUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

const reportsData: Report[] = [
  {
    id: "RP-2001",
    studyId: "ST-1001",
    patient: "Patient 001",
    patientId: "PT-001",
    bodyRegion: "Chest",
    finding: "Possible Cardiomegaly",
    radiologist: "Dr. Ahmad",
    createdAt: "2026-06-26",
    status: "Ready",
  },
  {
    id: "RP-2002",
    studyId: "ST-1002",
    patient: "Patient 002",
    patientId: "PT-002",
    bodyRegion: "Wrist",
    finding: "Distal Radius Fracture",
    radiologist: "Dr. Ahmad",
    createdAt: "2026-06-26",
    status: "Draft",
  },
  {
    id: "RP-2003",
    studyId: "ST-1003",
    patient: "Patient 003",
    patientId: "PT-003",
    bodyRegion: "Knee",
    finding: "No Acute Abnormality",
    radiologist: "Dr. Lina",
    createdAt: "2026-06-25",
    status: "Approved",
  },
  {
    id: "RP-2004",
    studyId: "ST-1004",
    patient: "Patient 004",
    patientId: "PT-004",
    bodyRegion: "Dental",
    finding: "Possible Deep Dental Caries",
    radiologist: "Dr. Lina",
    createdAt: "2026-06-25",
    status: "Ready",
  },
  {
    id: "RP-2005",
    studyId: "ST-1005",
    patient: "Patient 005",
    patientId: "PT-005",
    bodyRegion: "Spine",
    finding: "Lumbar Disc Space Narrowing",
    radiologist: "Dr. Ahmad",
    createdAt: "2026-06-24",
    status: "Approved",
  },
];

export default function ReportsPage() {
  const router = useRouter();

  const {
    data: session,
    isPending,
  } = authClient.useSession();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [bodyRegion, setBodyRegion] = useState("All");

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

  const filteredReports = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    return reportsData.filter((report) => {
      const matchesSearch =
        !normalizedSearch ||
        report.id
          .toLowerCase()
          .includes(normalizedSearch) ||
        report.studyId
          .toLowerCase()
          .includes(normalizedSearch) ||
        report.patient
          .toLowerCase()
          .includes(normalizedSearch) ||
        report.patientId
          .toLowerCase()
          .includes(normalizedSearch) ||
        report.finding
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesStatus =
        status === "All" ||
        report.status === status;

      const matchesRegion =
        bodyRegion === "All" ||
        report.bodyRegion === bodyRegion;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesRegion
      );
    });
  }, [search, status, bodyRegion]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-4 font-semibold text-cyan-100">
            Loading reports...
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const currentUser =
    session.user as SessionUser;

  const userRoles = (
    Array.isArray(currentUser.role)
      ? currentUser.role
      : (currentUser.role || "").split(",")
  )
    .map((role) =>
      role.trim().toLowerCase()
    )
    .filter(Boolean);

  const canViewReports =
    userRoles.includes("admin") ||
    userRoles.includes("radiologist");

  if (!canViewReports) {
    router.replace("/unauthorized");
    return null;
  }

  const approvedCount = reportsData.filter(
    (report) =>
      report.status === "Approved"
  ).length;

  const draftCount = reportsData.filter(
    (report) =>
      report.status === "Draft"
  ).length;

  const readyCount = reportsData.filter(
    (report) =>
      report.status === "Ready"
  ).length;

  function getStatusStyle(
    reportStatus: ReportStatus
  ) {
    if (reportStatus === "Approved") {
      return "border-green-300/30 bg-green-500/20 text-green-100";
    }

    if (reportStatus === "Ready") {
      return "border-cyan-300/30 bg-cyan-400/20 text-cyan-100";
    }

    return "border-amber-300/30 bg-amber-400/20 text-amber-100";
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() =>
              router.push("/dashboard")
            }
            className="flex items-center gap-3 text-left"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 font-bold shadow-lg backdrop-blur-xl">
              RI
            </div>

            <div>
              <h1 className="font-bold text-white">
                RadiologyInsight AI
              </h1>

              <p className="text-xs text-slate-300">
                Intelligent Medical Imaging Platform
              </p>
            </div>
          </button>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-white">
                {currentUser.name}
              </p>

              <p className="text-xs text-cyan-300">
                Reports workspace
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition hover:bg-white/15"
            >
              Dashboard
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-[1600px] px-5 py-9 sm:px-7">
        {/* Heading */}
        <div>
          <p className="font-semibold text-cyan-300">
            Medical documentation
          </p>

          <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Radiology Reports
          </h2>

          <p className="mt-3 max-w-2xl text-slate-300">
            Review, approve and manage medical
            imaging reports generated from completed
            X-ray studies.
          </p>
        </div>

        {/* Statistics */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatisticCard
            title="Total Reports"
            value={String(reportsData.length)}
            description="All generated reports"
          />

          <StatisticCard
            title="Draft Reports"
            value={String(draftCount)}
            description="Still being edited"
            variant="warning"
          />

          <StatisticCard
            title="Ready for Approval"
            value={String(readyCount)}
            description="Awaiting final approval"
            variant="info"
          />

          <StatisticCard
            title="Approved Reports"
            value={String(approvedCount)}
            description="Completed and approved"
            variant="success"
          />
        </div>

        {/* Filters */}
        <div className="mt-8 grid gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-2xl md:grid-cols-3">
          <div>
            <label
              htmlFor="search"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Search reports
            </label>

            <input
              id="search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Report, study or patient..."
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10"
            />
          </div>

          <div>
            <label
              htmlFor="bodyRegion"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Body region
            </label>

            <select
              id="bodyRegion"
              value={bodyRegion}
              onChange={(event) =>
                setBodyRegion(event.target.value)
              }
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
            >
              <option value="All">
                All body regions
              </option>

              <option value="Chest">
                Chest
              </option>

              <option value="Wrist">
                Wrist
              </option>

              <option value="Knee">
                Knee
              </option>

              <option value="Dental">
                Dental
              </option>

              <option value="Spine">
                Spine
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="status"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Report status
            </label>

            <select
              id="status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value)
              }
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
            >
              <option value="All">
                All statuses
              </option>

              <option value="Draft">
                Draft
              </option>

              <option value="Ready">
                Ready
              </option>

              <option value="Approved">
                Approved
              </option>
            </select>
          </div>
        </div>

        {/* Reports table */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left">
              <thead>
                <tr className="border-b border-white/15 bg-white/10 text-sm text-slate-200">
                  <th className="px-5 py-4 font-semibold">
                    Report ID
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Study
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Patient
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Body Region
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Finding
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Radiologist
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Date
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Status
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredReports.map((report) => (
                  <tr
                    key={report.id}
                    className="border-b border-white/10 text-sm text-slate-200 transition last:border-0 hover:bg-white/10"
                  >
                    <td className="px-5 py-5 font-bold text-white">
                      {report.id}
                    </td>

                    <td className="px-5 py-5 font-semibold text-cyan-300">
                      {report.studyId}
                    </td>

                    <td className="px-5 py-5">
                      <p className="font-semibold text-white">
                        {report.patient}
                      </p>

                      <p className="mt-1 text-xs text-slate-400">
                        {report.patientId}
                      </p>
                    </td>

                    <td className="px-5 py-5">
                      <span className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-slate-100">
                        {report.bodyRegion}
                      </span>
                    </td>

                    <td className="max-w-[260px] px-5 py-5 leading-6">
                      {report.finding}
                    </td>

                    <td className="px-5 py-5">
                      {report.radiologist}
                    </td>

                    <td className="px-5 py-5">
                      {report.createdAt}
                    </td>

                    <td className="px-5 py-5">
                      <span
                        className={`rounded-full border px-3 py-1.5 font-semibold ${getStatusStyle(
                          report.status
                        )}`}
                      >
                        {report.status}
                      </span>
                    </td>

                    <td className="px-5 py-5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/reports/${report.id}`
                            )
                          }
                          className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-200 transition hover:bg-cyan-300/20 hover:text-white"
                        >
                          View
                        </button>

                        <button
                          type="button"
                          className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 font-semibold text-white transition hover:bg-white/15"
                        >
                          Download
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredReports.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-16 text-center"
                    >
                      <p className="font-semibold text-white">
                        No reports found
                      </p>

                      <p className="mt-2 text-sm text-slate-400">
                        Try changing the search or
                        filter options.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 backdrop-blur-xl">
          <p className="text-sm leading-6 text-cyan-50">
            Reports must be reviewed and approved by an
            authorized radiologist before being used for
            clinical decision-making.
          </p>
        </div>
      </section>
    </main>
  );
}

type StatisticCardProps = {
  title: string;
  value: string;
  description: string;
  variant?:
    | "default"
    | "warning"
    | "info"
    | "success";
};

function StatisticCard({
  title,
  value,
  description,
  variant = "default",
}: StatisticCardProps) {
  const styles = {
    default:
      "border-white/15 bg-white/10",
    warning:
      "border-amber-300/25 bg-amber-400/15",
    info:
      "border-cyan-300/25 bg-cyan-400/15",
    success:
      "border-green-300/25 bg-green-500/15",
  };

  return (
    <article
      className={`rounded-2xl border p-6 shadow-[0_20px_55px_rgba(0,0,0,0.2)] backdrop-blur-xl ${styles[variant]}`}
    >
      <p className="text-sm font-semibold text-slate-300">
        {title}
      </p>

      <p className="mt-3 text-4xl font-bold text-white">
        {value}
      </p>

      <p className="mt-2 text-sm text-slate-300">
        {description}
      </p>
    </article>
  );
}