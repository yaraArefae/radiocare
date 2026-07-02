"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

type Statistic = {
  title: string;
  value: string;
  description: string;
};

type Study = {
  id: string;
  patient: string;
  bodyRegion: string;
  view: string;
  result: string;
  confidence: string;
  status: "Waiting" | "Reviewed" | "Urgent";
};

type DashboardUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

const statistics: Statistic[] = [
  {
    title: "New Studies",
    value: "18",
    description: "Uploaded today",
  },
  {
    title: "Waiting for Review",
    value: "7",
    description: "Require doctor review",
  },
  {
    title: "Abnormal Cases",
    value: "11",
    description: "Flagged by AI models",
  },
  {
    title: "Approved Reports",
    value: "24",
    description: "Completed this week",
  },
];

const bodyRegions = [
  {
    name: "Chest",
    studies: 42,
    description: "Chest and lung imaging",
  },
  {
    name: "Upper Limb",
    studies: 28,
    description: "Hand, wrist, elbow and shoulder",
  },
  {
    name: "Lower Limb",
    studies: 19,
    description: "Hip, knee, ankle and foot",
  },
  {
    name: "Dental",
    studies: 15,
    description: "Panoramic dental imaging",
  },
];

const studies: Study[] = [
  {
    id: "ST-1001",
    patient: "Patient 001",
    bodyRegion: "Chest",
    view: "PA",
    result: "Possible Cardiomegaly",
    confidence: "81%",
    status: "Waiting",
  },
  {
    id: "ST-1002",
    patient: "Patient 002",
    bodyRegion: "Wrist",
    view: "AP",
    result: "Possible Fracture",
    confidence: "87%",
    status: "Urgent",
  },
  {
    id: "ST-1003",
    patient: "Patient 003",
    bodyRegion: "Knee",
    view: "Lateral",
    result: "No Abnormality Detected",
    confidence: "92%",
    status: "Waiting",
  },
  {
    id: "ST-1004",
    patient: "Patient 004",
    bodyRegion: "Dental",
    view: "Panoramic",
    result: "Possible Deep Caries",
    confidence: "76%",
    status: "Waiting",
  },
];

export default function DashboardPage() {
  const router = useRouter();

  const {
    data: session,
    isPending,
  } = authClient.useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

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

  const currentUser = session.user as DashboardUser;

  const rawRole = Array.isArray(currentUser.role)
    ? currentUser.role.join(", ")
    : currentUser.role || "User";

  const displayedRole = rawRole
    .split(",")
    .map((role) => {
      const trimmedRole = role.trim();
      const normalizedRole = trimmedRole.toLowerCase();

      if (normalizedRole === "radiologist") {
        return "Doctor";
      }

      if (normalizedRole === "doctor") {
        return "Doctor";
      }

      if (normalizedRole === "technician") {
        return "Technician";
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
  const isDoctor =
    userRoles.includes("doctor") ||
    userRoles.includes("radiologist");
  const isTechnician =
    userRoles.includes("technician");

  const canCreateStudy =
    isAdmin || isTechnician;

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
              Studies grouped by body region and
              imaging model.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {bodyRegions.map((region) => (
                <article
                  key={region.name}
                  className="rounded-2xl border border-white/15 bg-white/10 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.20)] backdrop-blur-xl transition hover:border-cyan-300/30 hover:bg-white/15"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-bold text-white">
                        {region.name}
                      </h4>

                      <p className="mt-1 text-sm leading-5 text-slate-300">
                        {region.description}
                      </p>
                    </div>

                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-sm font-bold text-cyan-100">
                      {region.studies}
                    </span>
                  </div>
                </article>
              ))}
            </div>
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
                  {studies.map((study) => (
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
                        {study.result}
                      </td>

                      <td className="px-4 py-5 font-semibold text-cyan-300">
                        {study.confidence}
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
