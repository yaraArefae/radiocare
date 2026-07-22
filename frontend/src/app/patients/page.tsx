"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

type PatientStatus = "Active" | "Follow-up" | "Inactive";

type Patient = {
  id: string;
  name: string;
  age: number;
  gender: "Female" | "Male";
  phone: string;
  email: string;
  lastStudy: string;
  totalStudies: number;
  status: PatientStatus;
};

type SessionUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

const patientsData: Patient[] = [
  {
    id: "PT-001",
    name: "Patient 001",
    age: 54,
    gender: "Female",
    phone: "+970 59 000 0001",
    email: "patient001@example.com",
    lastStudy: "2026-06-26",
    totalStudies: 4,
    status: "Active",
  },
  {
    id: "PT-002",
    name: "Patient 002",
    age: 31,
    gender: "Male",
    phone: "+970 59 000 0002",
    email: "patient002@example.com",
    lastStudy: "2026-06-26",
    totalStudies: 2,
    status: "Follow-up",
  },
  {
    id: "PT-003",
    name: "Patient 003",
    age: 47,
    gender: "Female",
    phone: "+970 59 000 0003",
    email: "patient003@example.com",
    lastStudy: "2026-06-25",
    totalStudies: 6,
    status: "Active",
  },
  {
    id: "PT-004",
    name: "Patient 004",
    age: 42,
    gender: "Male",
    phone: "+970 59 000 0004",
    email: "patient004@example.com",
    lastStudy: "2026-06-25",
    totalStudies: 3,
    status: "Follow-up",
  },
  {
    id: "PT-005",
    name: "Patient 005",
    age: 67,
    gender: "Female",
    phone: "+970 59 000 0005",
    email: "patient005@example.com",
    lastStudy: "2026-06-24",
    totalStudies: 8,
    status: "Active",
  },
  {
    id: "PT-006",
    name: "Patient 006",
    age: 28,
    gender: "Male",
    phone: "+970 59 000 0006",
    email: "patient006@example.com",
    lastStudy: "2026-06-20",
    totalStudies: 1,
    status: "Inactive",
  },
];

export default function PatientsPage() {
  const router = useRouter();

  const { data: session, isPending } =
    authClient.useSession();

  const [search, setSearch] = useState("");
  const [gender, setGender] = useState("All");
  const [status, setStatus] = useState("All");

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

  const filteredPatients = useMemo(() => {
    const normalizedSearch = search
      .trim()
      .toLowerCase();

    return patientsData.filter((patient) => {
      const matchesSearch =
        !normalizedSearch ||
        patient.id
          .toLowerCase()
          .includes(normalizedSearch) ||
        patient.name
          .toLowerCase()
          .includes(normalizedSearch) ||
        patient.phone
          .toLowerCase()
          .includes(normalizedSearch) ||
        patient.email
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesGender =
        gender === "All" ||
        patient.gender === gender;

      const matchesStatus =
        status === "All" ||
        patient.status === status;

      return (
        matchesSearch &&
        matchesGender &&
        matchesStatus
      );
    });
  }, [search, gender, status]);

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  function getStatusStyle(
    patientStatus: PatientStatus
  ) {
    if (patientStatus === "Active") {
      return "border-green-300/30 bg-green-500/20 text-green-100";
    }

    if (patientStatus === "Follow-up") {
      return "border-amber-300/30 bg-amber-400/20 text-amber-100";
    }

    return "border-slate-300/20 bg-slate-400/15 text-slate-200";
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-4 font-semibold text-cyan-100">
            Loading patients...
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

  const activeCount = patientsData.filter(
    (patient) => patient.status === "Active"
  ).length;

  const followUpCount = patientsData.filter(
    (patient) => patient.status === "Follow-up"
  ).length;

  const totalStudies = patientsData.reduce(
    (total, patient) =>
      total + patient.totalStudies,
    0
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <div className="pointer-events-none fixed left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-[140px]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() =>
              router.push("/dashboard")
            }
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
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-white">
                {currentUser.name}
              </p>

              <p className="text-xs text-cyan-300">
                Patient management
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

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-red-300/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-100 backdrop-blur-xl transition hover:bg-red-500/20"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-[1600px] px-5 py-9 sm:px-7">
        {/* Heading */}
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="font-semibold text-cyan-300">
              Patient records
            </p>

            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              Patients
            </h2>

            <p className="mt-3 max-w-2xl text-slate-300">
              Search patient records, review imaging
              history and create new medical studies.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              router.push("/new-study")
            }
            className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold text-white shadow-[0_12px_35px_rgba(14,116,255,0.28)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
          >
            + Create New Study
          </button>
        </div>

        {/* Statistics */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatisticCard
            title="Total Patients"
            value={String(patientsData.length)}
            description="Registered patient records"
          />

          <StatisticCard
            title="Active Patients"
            value={String(activeCount)}
            description="Currently active records"
            variant="success"
          />

          <StatisticCard
            title="Follow-up"
            value={String(followUpCount)}
            description="Require continued monitoring"
            variant="warning"
          />

          <StatisticCard
            title="Total Studies"
            value={String(totalStudies)}
            description="Studies linked to patients"
            variant="info"
          />
        </div>

        {/* Filters */}
        <div className="mt-8 grid gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-2xl md:grid-cols-3">
          <div>
            <label
              htmlFor="search"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Search patients
            </label>

            <input
              id="search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Patient ID, name, phone or email..."
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10"
            />
          </div>

          <div>
            <label
              htmlFor="gender"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Gender
            </label>

            <select
              id="gender"
              value={gender}
              onChange={(event) =>
                setGender(event.target.value)
              }
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
            >
              <option value="All">
                All genders
              </option>

              <option value="Female">
                Female
              </option>

              <option value="Male">
                Male
              </option>
            </select>
          </div>

          <div>
            <label
              htmlFor="status"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Patient status
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

              <option value="Active">
                Active
              </option>

              <option value="Follow-up">
                Follow-up
              </option>

              <option value="Inactive">
                Inactive
              </option>
            </select>
          </div>
        </div>

        {/* Patients table */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] text-left">
              <thead>
                <tr className="border-b border-white/15 bg-white/10 text-sm text-slate-200">
                  <th className="px-5 py-4 font-semibold">
                    Patient
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Age
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Gender
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Contact
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Last Study
                  </th>

                  <th className="px-5 py-4 font-semibold">
                    Studies
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
                {filteredPatients.map(
                  (patient) => (
                    <tr
                      key={patient.id}
                      className="border-b border-white/10 text-sm text-slate-200 transition last:border-0 hover:bg-white/10"
                    >
                      <td className="px-5 py-5">
                        <p className="font-bold text-white">
                          {patient.name}
                        </p>

                        <p className="mt-1 text-xs font-semibold text-cyan-300">
                          {patient.id}
                        </p>
                      </td>

                      <td className="px-5 py-5">
                        {patient.age} years
                      </td>

                      <td className="px-5 py-5">
                        {patient.gender}
                      </td>

                      <td className="px-5 py-5">
                        <p className="font-medium text-white">
                          {patient.phone}
                        </p>

                        <p className="mt-1 text-xs text-slate-400">
                          {patient.email}
                        </p>
                      </td>

                      <td className="px-5 py-5">
                        {patient.lastStudy}
                      </td>

                      <td className="px-5 py-5">
                        <span className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 font-bold text-cyan-200">
                          {patient.totalStudies}
                        </span>
                      </td>

                      <td className="px-5 py-5">
                        <span
                          className={`rounded-full border px-3 py-1.5 font-semibold ${getStatusStyle(
                            patient.status
                          )}`}
                        >
                          {patient.status}
                        </span>
                      </td>

                      <td className="px-5 py-5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/patients/${patient.id}`
                              )
                            }
                            className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 font-semibold text-cyan-200 transition hover:bg-cyan-300/20 hover:text-white"
                          >
                            View
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                `/new-study?patient=${patient.id}`
                              )
                            }
                            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 font-semibold text-white transition hover:bg-white/15"
                          >
                            New Study
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {filteredPatients.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-16 text-center"
                    >
                      <p className="font-semibold text-white">
                        No patients found
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

        {/* Privacy notice */}
        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 backdrop-blur-xl">
          <p className="text-sm leading-6 text-cyan-50">
            Patient information is confidential and must
            only be accessed for authorized clinical and
            administrative purposes.
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
    | "success"
    | "warning"
    | "info";
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
    success:
      "border-green-300/25 bg-green-500/15",
    warning:
      "border-amber-300/25 bg-amber-400/15",
    info:
      "border-cyan-300/25 bg-cyan-400/15",
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
