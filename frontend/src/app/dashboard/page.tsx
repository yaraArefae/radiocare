"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type Statistic = {
  title: string;
  value: string;
  description: string;
};

type Study = {
  id: string;
  patient: string;
  patientId: string;
  bodyRegion: string;
  view: string;
  clinicKey: string;
  priority: string;
  status: string;
  createdAt: string;
  aiResult: string | null;
  primaryFinding: string | null;
  confidence: number | string | null;
};

type DashboardUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};




/*
  The clinics of the application, in the order the patient sees them when
  uploading. Studies are grouped by these, so a category on the dashboard
  is always a real clinic with its own doctor, never an invented one.
*/
const CLINIC_NAMES: Record<string, string> = {
  chest: "Chest Clinic",
  shoulder: "Shoulder Clinic",
  "hand-wrist": "Hand & Wrist Clinic",
  head: "Head & Skull Clinic",
  spine: "Spine Clinic",
  pelvis: "Pelvis & Hip Clinic",
  "lower-limb": "Leg, Knee & Foot Clinic",
  general: "Unclassified",
};

const CLINIC_ORDER = Object.keys(CLINIC_NAMES);

function isFinished(status: string) {
  return ["completed", "reviewed", "approved"].some((value) =>
    String(status || "").toLowerCase().includes(value),
  );
}

function needsReview(study: Study) {
  const triage = String(study.aiResult ?? "").trim().toUpperCase();

  return triage !== "NORMAL" && !isFinished(study.status);
}

function isToday(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return false;

  return date.toDateString() === new Date().toDateString();
}

function formatConfidence(value: Study["confidence"]) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return "—";

  return `${Math.round(parsed)}%`;
}

export default function DashboardPage() {
  const router = useRouter();

  const {
    data: session,
    isPending,
  } = authClient.useSession();

  const [studies, setStudies] = useState<Study[]>([]);
  const [studiesError, setStudiesError] = useState("");

  /*
    The studies come from the API, which already limits them to what the
    signed in user may see. An administrator gets every clinic, a doctor
    only the clinics they work in.
  */
  const loadStudies = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/studies`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the studies.");
      }

      setStudies(data.studies ?? []);
      setStudiesError("");
    } catch (error) {
      setStudiesError(
        error instanceof Error ? error.message : "Unable to load the studies.",
      );
    }
  }, []);

  useEffect(() => {
    if (!session) return;

    void loadStudies();
  }, [loadStudies, session]);

  const waitingStudies = useMemo(
    () => studies.filter(needsReview),
    [studies],
  );

  const statistics: Statistic[] = useMemo(() => {
    const abnormal = studies.filter(
      (study) => String(study.aiResult ?? "").toUpperCase() === "ABNORMAL",
    ).length;

    return [
      {
        title: "New Studies",
        value: String(studies.filter((s) => isToday(s.createdAt)).length),
        description: "Uploaded today",
      },
      {
        title: "Waiting for Review",
        value: String(waitingStudies.length),
        description: "Require doctor review",
      },
      {
        title: "Abnormal Cases",
        value: String(abnormal),
        description: "Flagged by AI models",
      },
      {
        title: "Completed",
        value: String(studies.filter((s) => isFinished(s.status)).length),
        description: "Reviewed by a doctor",
      },
    ];
  }, [studies, waitingStudies]);

  /*
    One card per clinic that actually holds a case, so the categories
    match the clinics a patient can send to.
  */
  const clinicGroups = useMemo(() => {
    const counts = new Map<string, number>();

    for (const study of studies) {
      const key = study.clinicKey || "general";

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort(
        (a, b) => CLINIC_ORDER.indexOf(a[0]) - CLINIC_ORDER.indexOf(b[0]),
      )
      .map(([key, total]) => ({
        key,
        name: CLINIC_NAMES[key] ?? key,
        studies: total,
        waiting: waitingStudies.filter((s) => (s.clinicKey || "general") === key)
          .length,
      }));
  }, [studies, waitingStudies]);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (!isPending && session) {
      const currentUser = session.user as DashboardUser;

      const userRoles = (
        Array.isArray(currentUser.role)
          ? currentUser.role
          : (currentUser.role || "").split(",")
      )
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

      const isDoctor = userRoles.includes("doctor");

      if (isDoctor) {
        void router.replace("/doctor/clinic");
      }
    }
  }, [isPending, session, router]);

  /*
    How many registration requests are waiting, so the administration
    menu can show the work before it is opened.

    This has to sit above the loading and redirect returns below: a hook
    placed after them runs on some renders and not on others, which is
    exactly what React refuses.
  */
  const [pendingPatientRequests, setPendingPatientRequests] =
    useState(0);

  useEffect(() => {
    if (isPending || !session) return;

    const currentUser = session.user as DashboardUser;

    const isAdminUser = (
      Array.isArray(currentUser.role)
        ? currentUser.role
        : (currentUser.role || "").split(",")
    )
      .map((role) => role.trim().toLowerCase())
      .includes("admin");

    if (!isAdminUser) return;

    let isActive = true;

    async function loadPendingRequests() {
      try {
        const response = await fetch(
          `${
            process.env.NEXT_PUBLIC_BACKEND_URL ??
            "http://localhost:4000"
          }/api/patient-requests?status=Pending`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        if (!response.ok) return;

        const data = await response.json();

        if (isActive && data.success) {
          setPendingPatientRequests(
            (data.applications ?? []).length,
          );
        }
      } catch (error) {
        console.error(
          "Unable to load the pending patient requests:",
          error,
        );
      }
    }

    void loadPendingRequests();

    return () => {
      isActive = false;
    };
  }, [isPending, session]);

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  function getStatusStyle(status: Study["status"]) {
    if (status === "Urgent") {
      return "border-red-300/30 bg-red-500/20 text-red-100";
    }

    if (status === "Reviewed") {
      return "border-green-300/30 bg-green-500/20 text-green-100";
    }

    return "border-amber-300/30 bg-amber-400/20 text-amber-100";
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-4 font-semibold text-cyan-100">
            Loading dashboard...
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  // If signed-in user is a doctor, show a quick loading/redirecting view
  // while the client-side effect navigates to the clinics page. This
  // prevents briefly rendering the full dashboard UI.
  const _currentUserForRedirect = session.user as DashboardUser;
  const _userRolesForRedirect = (
    Array.isArray(_currentUserForRedirect.role)
      ? _currentUserForRedirect.role
      : (_currentUserForRedirect.role || "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  if (_userRolesForRedirect.includes("doctor")) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-4 font-semibold text-cyan-100">Redirecting to clinics...</p>
        </div>
      </main>
    );
  }

  const currentUser = session.user as DashboardUser;

  const rawRole = Array.isArray(currentUser.role)
    ? currentUser.role.join(", ")
    : currentUser.role || "User";

  const displayedRole = rawRole
    .split(",")
    .map((role) => {
      const trimmedRole = role.trim();
      const normalizedRole = trimmedRole.toLowerCase();

      if (normalizedRole === "doctor") {
        return "Doctor";
      }

      return (
        trimmedRole.charAt(0).toUpperCase() +
        trimmedRole.slice(1)
      );
    })
    .join(", ");

  const userRoles = (
    Array.isArray(currentUser.role)
      ? currentUser.role
      : (currentUser.role || "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = userRoles.includes("admin");
  const isDoctor = userRoles.includes("doctor");
  const isPatient = userRoles.includes("patient");

  const canCreateStudy =
    isAdmin || isPatient;

  const canReviewStudies =
    isAdmin || isDoctor;

  const canViewReports =
    isAdmin || isDoctor;

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      {/* Background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      {/* Background lighting */}
      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <div className="pointer-events-none fixed left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-[140px]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between px-5 py-4 sm:px-7">
          <div className="flex items-center">
            <div className="flex h-12 w-12 overflow-hidden rounded-[18px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={48}
                height={48}
                className="h-full w-full object-contain p-1"
                priority
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="font-semibold text-white">
                {currentUser.name}
              </p>

              <p className="text-sm font-medium text-cyan-300">
                {displayedRole}
              </p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white shadow-sm backdrop-blur-xl transition hover:border-red-300/40 hover:bg-red-500/20 hover:text-red-100"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex max-w-[1700px]">
        {/* Sidebar */}
        <aside className="sticky top-[81px] hidden h-[calc(100vh-81px)] w-72 shrink-0 overflow-y-auto border-r border-white/15 bg-blue-950/35 p-5 backdrop-blur-2xl lg:block">
          <p className="mb-4 px-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            Main Menu
          </p>

          <nav className="space-y-2">
            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="w-full rounded-xl border border-cyan-300/25 bg-cyan-300/15 px-4 py-3 text-left font-semibold text-cyan-100 shadow-[0_10px_30px_rgba(34,211,238,0.10)] backdrop-blur-xl"
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={() =>
                router.push("/studies")
              }
              className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
            >
              Studies
            </button>

            {isDoctor && (
              <button
                type="button"
                onClick={() => router.push("/doctor/clinic")}
                className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
              >
                Clinics
              </button>
            )}

            {canCreateStudy && (
              <button
                type="button"
                onClick={() =>
                  router.push("/new-study")
                }
                className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
              >
                New Study
              </button>
            )}

            {canReviewStudies && (
              <button
                type="button"
                onClick={() =>
                  router.push("/waiting-review")
                }
                className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
              >
                Waiting for Review
              </button>
            )}

            {canViewReports && (
              <button
                type="button"
                onClick={() =>
                  router.push("/reports")
                }
                className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
              >
                Reports
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                router.push("/patients")
              }
              className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
            >
              Patients
            </button>

            <button
              type="button"
              onClick={() =>
                router.push("/change-password")
              }
              className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
            >
              Change Password
            </button>

            {isAdmin && (
              <>
                <div className="my-4 border-t border-white/15" />

                <p className="px-4 pt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Administration
                </p>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/admin/overview")
                  }
                  className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  Admin Overview
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/admin/patient-requests")
                  }
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  <span>Patient Requests</span>

                  {pendingPatientRequests > 0 && (
                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-black text-white">
                      {pendingPatientRequests}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/admin/users")
                  }
                  className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  User Management
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/admin/doctor-requests")
                  }
                  className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  Doctor Requests
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/doctor-request")
                  }
                  className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  Add Doctor Request
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push("/login-attempts")
                  }
                  className="w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
                >
                  Login Attempts
                </button>
              </>
            )}
          </nav>

          {/* AI status */}
          <div className="mt-9 rounded-2xl border border-cyan-300/20 bg-white/10 p-5 shadow-[0_20px_55px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <p className="text-sm font-semibold text-white">
              AI System Status
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-green-400 shadow-[0_0_15px_rgba(74,222,128,0.8)]" />

              <span className="text-sm text-green-100">
                Models operational
              </span>
            </div>

            <div className="mt-5 space-y-2 text-xs text-slate-300">
              <p>Image router: Active</p>
              <p>General X-ray model: Active</p>
              <p>Dental model: Active</p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <section className="min-w-0 flex-1 px-5 py-8 sm:px-7">
          {/* Welcome */}
          <div>
            <p className="font-semibold text-cyan-300">
              Dashboard
            </p>

            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              Welcome back, {currentUser.name}
            </h2>

            <p className="mt-3 text-slate-300">
              Review medical X-ray studies and
              AI-assisted findings.
            </p>
          </div>

          {/* Patient registration sits next to the doctor one, so an
              administrator sees both queues on the same screen. */}
          {isAdmin && (
            <section className="mt-8 rounded-[28px] border border-cyan-300/20 bg-gradient-to-r from-blue-500/15 to-cyan-400/10 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
                <div>
                  <p className="text-sm font-semibold text-cyan-300">
                    Patient Management
                  </p>

                  <h3 className="mt-2 text-2xl font-bold text-white">
                    Registration requests
                    {pendingPatientRequests > 0 && (
                      <span className="ml-3 rounded-full bg-rose-500 px-3 py-1 align-middle text-sm font-black text-white">
                        {pendingPatientRequests} waiting
                      </span>
                    )}
                  </h3>

                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                    Review the people who asked for a patient account,
                    approve them, and send their sign-in details. You can
                    also register a walk-in patient directly.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      router.push("/admin/patient-requests")
                    }
                    className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-3 font-bold text-white"
                  >
                    Open Patient Requests
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/admin/overview")}
                    className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/15"
                  >
                    Admin Overview
                  </button>
                </div>
              </div>
            </section>
          )}

          {isAdmin && <AdminDoctorManagement />}

          {/* Statistics */}
          <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {statistics.map((item) => (
              <article
                key={item.title}
                className="rounded-2xl border border-white/15 bg-white/10 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/15"
              >
                <p className="text-sm font-semibold text-slate-300">
                  {item.title}
                </p>

                <p className="mt-3 text-4xl font-bold text-white">
                  {item.value}
                </p>

                <p className="mt-2 text-sm text-slate-300">
                  {item.description}
                </p>
              </article>
            ))}
          </div>

          {/* Imaging categories */}
          <div className="mt-9">
            <h3 className="text-xl font-bold text-white">
              Imaging categories
            </h3>

            <p className="mt-1 text-sm text-slate-300">
              Studies grouped by the clinic that received them. A case
              belongs to one clinic only, the one for its body region.
            </p>

            {clinicGroups.length === 0 ? (
              <p className="mt-5 text-slate-300">No study has arrived yet.</p>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {clinicGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => router.push(`/doctor/clinic/${group.key}`)}
                    className="rounded-2xl border border-white/15 bg-white/10 p-5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.20)] backdrop-blur-xl transition hover:border-cyan-300/30 hover:bg-white/15"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h4 className="font-bold text-white">{group.name}</h4>

                        <p className="mt-1 text-sm leading-5 text-slate-300">
                          {group.waiting} waiting for review
                        </p>
                      </div>

                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-sm font-bold text-cyan-100">
                        {group.studies}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Studies table */}
          <div className="mt-9 rounded-2xl border border-white/15 bg-white/10 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-xl font-bold text-white">
                  Studies waiting for review
                </h3>

                <p className="mt-1 text-sm text-slate-300">
                  Recent medical X-ray studies requiring
                  doctor review.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  router.push("/waiting-review")
                }
                className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold text-white shadow-[0_12px_35px_rgba(14,116,255,0.28)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
              >
                View all studies
              </button>
            </div>

            <div className="mt-6 overflow-x-auto rounded-xl border border-white/10 bg-blue-950/20 backdrop-blur-xl">
              <table className="w-full min-w-[1000px] text-left">
                <thead>
                  <tr className="bg-white/10 text-sm text-slate-200">
                    <th className="px-4 py-4 font-semibold">
                      Study ID
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      Patient
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      Body Region
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      View
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      AI Result
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      Confidence
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      Status
                    </th>

                    <th className="px-4 py-4 font-semibold">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {waitingStudies.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-slate-300"
                      >
                        {studiesError ||
                          "No study is waiting for review right now."}
                      </td>
                    </tr>
                  )}

                  {waitingStudies.slice(0, 12).map((study) => (
                    <tr
                      key={study.id}
                      className="border-t border-white/10 text-sm text-slate-200 transition hover:bg-white/10"
                    >
                      <td className="px-4 py-5 font-semibold text-white">
                        {study.id}
                      </td>

                      <td className="px-4 py-5">
                        {study.patient}
                      </td>

                      <td className="px-4 py-5">
                        <span className="rounded-lg border border-white/15 bg-white/10 px-3 py-1 font-medium text-slate-100">
                          {study.bodyRegion}
                        </span>
                      </td>

                      <td className="px-4 py-5">
                        {study.view}
                      </td>

                      <td className="px-4 py-5">
                        {study.primaryFinding ||
                          study.aiResult ||
                          "Not analysed yet"}
                      </td>

                      <td className="px-4 py-5 font-semibold text-cyan-300">
                        {formatConfidence(study.confidence)}
                      </td>

                      <td className="px-4 py-5">
                        <span
                          className={`rounded-full border px-3 py-1 font-semibold ${getStatusStyle(
                            study.status
                          )}`}
                        >
                          {study.status}
                        </span>
                      </td>

                      <td className="px-4 py-5">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/studies/${study.id}#review`)
                          }
                          className="font-semibold text-cyan-300 transition hover:text-cyan-100"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 shadow-sm backdrop-blur-xl">
            <p className="text-sm leading-6 text-cyan-50">
              AI findings are provided for
              decision-support purposes only. Final
              interpretation and diagnosis must be
              completed by an authorized medical
              professional.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}


type DoctorRequestSummary = {
  status:
    | "Pending"
    | "Under Review"
    | "Needs More Information"
    | "Approved"
    | "Rejected"
    | "Suspended";
};

function AdminDoctorManagement() {
  const router = useRouter();

  const [requests, setRequests] = useState<
    DoctorRequestSummary[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [loadError, setLoadError] =
    useState("");

  useEffect(() => {
    let isActive = true;

    async function loadDoctorRequests() {
      try {
        const response = await fetch(
          "/api/doctor-requests",
          {
            method: "GET",
            cache: "no-store",
          }
        );

        const data = (await response.json()) as {
          applications?: DoctorRequestSummary[];
          message?: string;
        };

        if (!response.ok) {
          throw new Error(
            data.message ||
              "Unable to load doctor requests."
          );
        }

        if (isActive) {
          setRequests(data.applications || []);
        }
      } catch (error) {
        console.error(
          "Failed to load doctor request summary:",
          error
        );

        if (isActive) {
          setLoadError(
            "Doctor request totals are unavailable."
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadDoctorRequests();

    return () => {
      isActive = false;
    };
  }, []);

  const pendingCount = requests.filter(
    (item) =>
      item.status === "Pending" ||
      item.status === "Under Review" ||
      item.status === "Needs More Information"
  ).length;

  const approvedCount = requests.filter(
    (item) => item.status === "Approved"
  ).length;

  return (
    <section className="mt-8 rounded-[28px] border border-cyan-300/20 bg-gradient-to-r from-blue-500/15 to-cyan-400/10 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
      <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
        <div>
          <p className="text-sm font-semibold text-cyan-300">
            Doctor Management
          </p>

          <h3 className="mt-2 text-2xl font-bold text-white">
            Registration and approval
          </h3>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Open a new doctor request, review submitted
            credentials, approve the doctor, and generate
            temporary login credentials.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              router.push("/doctor-request")
            }
            className="rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white transition hover:bg-white/15"
          >
            Add Doctor Request
          </button>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/admin/doctor-requests"
              )
            }
            className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.3)] transition hover:-translate-y-0.5"
          >
            Review Doctor Requests
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
          <p className="text-sm text-slate-300">
            Total requests
          </p>
          <p className="mt-2 text-3xl font-bold text-white">
            {isLoading ? "..." : requests.length}
          </p>
        </div>

        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
          <p className="text-sm text-amber-100">
            Waiting for action
          </p>
          <p className="mt-2 text-3xl font-bold text-white">
            {isLoading ? "..." : pendingCount}
          </p>
        </div>

        <div className="rounded-2xl border border-green-300/20 bg-green-300/10 p-4">
          <p className="text-sm text-green-100">
            Approved doctors
          </p>
          <p className="mt-2 text-3xl font-bold text-white">
            {isLoading ? "..." : approvedCount}
          </p>
        </div>
      </div>

      {loadError && (
        <p className="mt-4 text-sm text-amber-100">
          {loadError}
        </p>
      )}
    </section>
  );
}
