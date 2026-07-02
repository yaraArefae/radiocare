"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

type StudyStatus =
  | "Waiting"
  | "Urgent"
  | "Reviewed"
  | "Approved";

type Study = {
  id: string;
  patient: string;
  patientId: string;
  bodyRegion: string;
  view: string;
  date: string;
  aiResult: string;
  confidence: number | null;
  status: StudyStatus;
  priority: string;
  createdAt: string;
};

type SessionUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

export default function StudiesPage() {
  const router = useRouter();

  const {
    data: session,
    isPending: isSessionPending,
  } = authClient.useSession();

  const [studies, setStudies] = useState<Study[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] =
    useState(true);

  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [bodyRegion, setBodyRegion] =
    useState("All");

  const [status, setStatus] = useState("All");

  useEffect(() => {
    if (!isSessionPending && !session) {
      router.replace("/");
    }
  }, [isSessionPending, session, router]);

  useEffect(() => {
    if (!session) {
      return;
    }

    async function loadStudies() {
      setIsLoadingStudies(true);
      setLoadError("");

      try {
        const response = await fetch("/api/studies", {
          method: "GET",
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "Unable to load studies."
          );
        }

        setStudies(
          Array.isArray(result.studies)
            ? result.studies
            : []
        );
      } catch (error) {
        console.error("Loading studies failed:", error);

        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load studies."
        );
      } finally {
        setIsLoadingStudies(false);
      }
    }

    loadStudies();
  }, [session]);

  const bodyRegions = useMemo(() => {
    return Array.from(
      new Set(
        studies
          .map((study) => study.bodyRegion)
          .filter(Boolean)
      )
    ).sort();
  }, [studies]);

  const filteredStudies = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    return studies.filter((study) => {
      const matchesSearch =
        !normalizedSearch ||
        study.id
          .toLowerCase()
          .includes(normalizedSearch) ||
        study.patient
          .toLowerCase()
          .includes(normalizedSearch) ||
        study.patientId
          .toLowerCase()
          .includes(normalizedSearch) ||
        study.aiResult
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesRegion =
        bodyRegion === "All" ||
        study.bodyRegion === bodyRegion;

      const matchesStatus =
        status === "All" ||
        study.status === status;

      return (
        matchesSearch &&
        matchesRegion &&
        matchesStatus
      );
    });
  }, [studies, search, bodyRegion, status]);

  if (isSessionPending) {
    return <LoadingPage message="Loading your account..." />;
  }

  if (!session) {
    return null;
  }

  const currentUser = session.user as SessionUser;

  const userRoles = (
    Array.isArray(currentUser.role)
      ? currentUser.role
      : (currentUser.role || "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const canCreateStudy =
    userRoles.includes("admin") ||
    userRoles.includes("technician");

  function getStatusStyle(
    studyStatus: StudyStatus
  ) {
    if (studyStatus === "Urgent") {
      return "border-red-300/30 bg-red-500/20 text-red-100";
    }

    if (studyStatus === "Reviewed") {
      return "border-green-300/30 bg-green-500/20 text-green-100";
    }

    if (studyStatus === "Approved") {
      return "border-cyan-300/30 bg-cyan-400/20 text-cyan-100";
    }

    return "border-amber-300/30 bg-amber-400/20 text-amber-100";
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="flex items-center text-left"
          >
            <div className="flex h-12 w-12 overflow-hidden rounded-[18px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1"
              />
            </div>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition hover:bg-white/15"
            >
              Dashboard
            </button>

            {canCreateStudy && (
              <button
                type="button"
                onClick={() => router.push("/new-study")}
                className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_35px_rgba(14,116,255,0.28)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
              >
                + New Study
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-[1600px] px-5 py-9 sm:px-7">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="font-semibold text-cyan-300">
              Study management
            </p>

            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              All X-ray Studies
            </h2>

            <p className="mt-3 text-slate-300">
              Search, filter and review all uploaded medical
              imaging studies.
            </p>
          </div>

          <div className="rounded-xl border border-white/15 bg-white/10 px-5 py-3 backdrop-blur-xl">
            <p className="text-sm text-slate-300">
              Total studies
            </p>

            <p className="mt-1 text-2xl font-bold text-white">
              {studies.length}
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-2xl md:grid-cols-3">
          <div>
            <label
              htmlFor="search"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Search
            </label>

            <input
              id="search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Study ID, patient or AI result..."
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
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none"
            >
              <option value="All">
                All body regions
              </option>

              {bodyRegions.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="status"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Status
            </label>

            <select
              id="status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value)
              }
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none"
            >
              <option value="All">
                All statuses
              </option>

              <option value="Waiting">
                Waiting
              </option>

              <option value="Urgent">
                Urgent
              </option>

              <option value="Reviewed">
                Reviewed
              </option>

              <option value="Approved">
                Approved
              </option>
            </select>
          </div>
        </div>

        {loadError && (
          <div className="mt-6 rounded-2xl border border-red-300/30 bg-red-500/20 px-5 py-4 text-red-100">
            {loadError}
          </div>
        )}

        <div className="mt-6 overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left">
              <thead>
                <tr className="border-b border-white/15 bg-white/10 text-sm text-slate-200">
                  <th className="px-5 py-4 font-semibold">
                    Study ID
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Patient
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Body Region
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    View
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Date
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    AI Result
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Confidence
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Status
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {isLoadingStudies && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-16 text-center"
                    >
                      <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

                      <p className="mt-4 text-slate-300">
                        Loading saved studies...
                      </p>
                    </td>
                  </tr>
                )}

                {!isLoadingStudies &&
                  filteredStudies.map((study) => (
                    <tr
                      key={study.id}
                      className="border-b border-white/10 text-sm text-slate-200 transition last:border-0 hover:bg-white/10"
                    >
                      <td className="px-5 py-5 font-bold text-white">
                        {study.id}
                      </td>

                      <td className="px-5 py-5">
                        <p className="font-semibold text-white">
                          {study.patient}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          {study.patientId}
                        </p>
                      </td>

                      <td className="px-5 py-5">
                        <span className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5">
                          {study.bodyRegion}
                        </span>
                      </td>

                      <td className="px-5 py-5">
                        {study.view}
                      </td>

                      <td className="px-5 py-5">
                        {study.date}
                      </td>

                      <td className="max-w-[250px] px-5 py-5">
                        {study.aiResult}
                      </td>

                      <td className="px-5 py-5 font-bold text-cyan-300">
                        {study.confidence === null
                          ? "—"
                          : `${Math.round(
                              study.confidence
                            )}%`}
                      </td>

                      <td className="px-5 py-5">
                        <span
                          className={`rounded-full border px-3 py-1.5 font-semibold ${getStatusStyle(
                            study.status
                          )}`}
                        >
                          {study.status}
                        </span>
                      </td>

                      <td className="px-5 py-5">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/studies/${study.id}`
                            )
                          }
                          className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 font-semibold text-cyan-200 transition hover:bg-cyan-300/20 hover:text-white"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}

                {!isLoadingStudies &&
                  filteredStudies.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-5 py-16 text-center"
                      >
                        <p className="font-semibold text-white">
                          No saved studies found
                        </p>

                        <p className="mt-2 text-sm text-slate-400">
                          Create a study from the New Study
                          page.
                        </p>
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}

type LoadingPageProps = {
  message: string;
};

function LoadingPage({
  message,
}: LoadingPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-blue-950">
      <div className="text-center">
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

        <p className="mt-4 font-semibold text-cyan-100">
          {message}
        </p>
      </div>
    </main>
  );
}
