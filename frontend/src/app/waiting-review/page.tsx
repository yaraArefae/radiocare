"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

type ReviewStatus = "Waiting" | "Urgent";

type ReviewStudy = {
  id: string;
  patient: string;
  patientId: string;
  age: number;
  bodyRegion: string;
  view: string;
  uploadedAt: string;
  aiResult: string;
  confidence: number;
  status: ReviewStatus;
};

type SessionUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

const reviewStudies: ReviewStudy[] = [
  {
    id: "ST-1001",
    patient: "Patient 001",
    patientId: "PT-001",
    age: 54,
    bodyRegion: "Chest",
    view: "PA",
    uploadedAt: "2026-06-26 09:15",
    aiResult: "Possible Cardiomegaly",
    confidence: 81,
    status: "Waiting",
  },
  {
    id: "ST-1002",
    patient: "Patient 002",
    patientId: "PT-002",
    age: 31,
    bodyRegion: "Wrist",
    view: "AP",
    uploadedAt: "2026-06-26 10:40",
    aiResult: "Possible Fracture",
    confidence: 87,
    status: "Urgent",
  },
  {
    id: "ST-1004",
    patient: "Patient 004",
    patientId: "PT-004",
    age: 42,
    bodyRegion: "Dental",
    view: "Panoramic",
    uploadedAt: "2026-06-25 14:10",
    aiResult: "Possible Deep Caries",
    confidence: 76,
    status: "Waiting",
  },
  {
    id: "ST-1006",
    patient: "Patient 006",
    patientId: "PT-006",
    age: 67,
    bodyRegion: "Knee",
    view: "Lateral",
    uploadedAt: "2026-06-25 15:35",
    aiResult: "Possible Joint Space Narrowing",
    confidence: 84,
    status: "Waiting",
  },
  {
    id: "ST-1007",
    patient: "Patient 007",
    patientId: "PT-007",
    age: 24,
    bodyRegion: "Chest",
    view: "AP",
    uploadedAt: "2026-06-26 12:05",
    aiResult: "Possible Pneumothorax",
    confidence: 91,
    status: "Urgent",
  },
];

export default function WaitingReviewPage() {
  const router = useRouter();

  const {
    data: session,
    isPending,
  } = authClient.useSession();

  const [search, setSearch] = useState("");
  const [bodyRegion, setBodyRegion] = useState("All");
  const [priority, setPriority] = useState("All");

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

  const filteredStudies = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return reviewStudies.filter((study) => {
      const matchesSearch =
        !normalizedSearch ||
        study.id.toLowerCase().includes(normalizedSearch) ||
        study.patient.toLowerCase().includes(normalizedSearch) ||
        study.patientId.toLowerCase().includes(normalizedSearch) ||
        study.aiResult.toLowerCase().includes(normalizedSearch);

      const matchesRegion =
        bodyRegion === "All" ||
        study.bodyRegion === bodyRegion;

      const matchesPriority =
        priority === "All" ||
        study.status === priority;

      return (
        matchesSearch &&
        matchesRegion &&
        matchesPriority
      );
    });
  }, [search, bodyRegion, priority]);

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-4 font-semibold text-cyan-100">
            Loading studies...
          </p>
        </div>
      </main>
    );
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

  const canReview =
    userRoles.includes("admin") ||
    userRoles.includes("doctor");

  if (!canReview) {
    router.replace("/unauthorized");
    return null;
  }

  const urgentCount = reviewStudies.filter(
    (study) => study.status === "Urgent"
  ).length;

  const averageConfidence = Math.round(
    reviewStudies.reduce(
      (total, study) => total + study.confidence,
      0
    ) / reviewStudies.length
  );

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
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-white">
                {currentUser.name}
              </p>

              <p className="text-xs text-cyan-300">
                Radiology review workspace
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/dashboard")}
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
            Doctor workspace
          </p>

          <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Waiting for Review
          </h2>

          <p className="mt-3 max-w-2xl text-slate-300">
            Review AI-assisted findings, inspect urgent cases,
            and complete the medical interpretation.
          </p>
        </div>

        {/* Statistics */}
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          <StatisticCard
            title="Waiting Studies"
            value={String(reviewStudies.length)}
            description="Require doctor review"
          />

          <StatisticCard
            title="Urgent Cases"
            value={String(urgentCount)}
            description="Require immediate attention"
            urgent
          />

          <StatisticCard
            title="Average Confidence"
            value={`${averageConfidence}%`}
            description="Across pending AI findings"
          />
        </div>

        {/* Filters */}
        <div className="mt-8 grid gap-4 rounded-2xl border border-white/15 bg-white/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)] backdrop-blur-2xl md:grid-cols-3">
          <div>
            <label
              htmlFor="search"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Search studies
            </label>

            <input
              id="search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Study ID, patient or finding..."
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
              <option value="All">All body regions</option>
              <option value="Chest">Chest</option>
              <option value="Wrist">Wrist</option>
              <option value="Knee">Knee</option>
              <option value="Dental">Dental</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="priority"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Priority
            </label>

            <select
              id="priority"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value)
              }
              className="w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3 text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
            >
              <option value="All">All priorities</option>
              <option value="Urgent">Urgent</option>
              <option value="Waiting">Waiting</option>
            </select>
          </div>
        </div>

        {/* Review cards */}
        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          {filteredStudies.map((study) => (
            <article
              key={study.id}
              className="rounded-2xl border border-white/15 bg-white/10 p-6 shadow-[0_22px_65px_rgba(0,0,0,0.23)] backdrop-blur-2xl transition hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/15"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-bold text-white">
                      {study.id}
                    </h3>

                    <span
                      className={
                        study.status === "Urgent"
                          ? "rounded-full border border-red-300/30 bg-red-500/20 px-3 py-1 text-xs font-bold text-red-100"
                          : "rounded-full border border-amber-300/30 bg-amber-400/20 px-3 py-1 text-xs font-bold text-amber-100"
                      }
                    >
                      {study.status}
                    </span>
                  </div>

                  <p className="mt-2 font-semibold text-slate-100">
                    {study.patient}
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    {study.patientId} · {study.age} years
                  </p>
                </div>

                <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-center">
                  <p className="text-xs text-cyan-100">
                    AI Confidence
                  </p>

                  <p className="mt-1 text-2xl font-bold text-cyan-300">
                    {study.confidence}%
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <InformationBox
                  label="Body region"
                  value={study.bodyRegion}
                />

                <InformationBox
                  label="Imaging view"
                  value={study.view}
                />

                <InformationBox
                  label="Uploaded"
                  value={study.uploadedAt}
                />

                <InformationBox
                  label="AI finding"
                  value={study.aiResult}
                  highlight
                />
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/studies/${study.id}`)
                  }
                  className="flex-1 rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white backdrop-blur-xl transition hover:bg-white/15"
                >
                  View Study
                </button>

                <button
                  type="button"
                  onClick={() =>
                    router.push(`/studies/${study.id}/review`)
                  }
                  className="flex-1 rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3 font-semibold text-white shadow-[0_12px_35px_rgba(14,116,255,0.28)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
                >
                  Start Review
                </button>
              </div>
            </article>
          ))}

          {filteredStudies.length === 0 && (
            <div className="col-span-full rounded-2xl border border-white/15 bg-white/10 px-6 py-16 text-center backdrop-blur-2xl">
              <p className="text-lg font-semibold text-white">
                No studies found
              </p>

              <p className="mt-2 text-sm text-slate-400">
                Try changing the search or filter options.
              </p>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 backdrop-blur-xl">
          <p className="text-sm leading-6 text-cyan-50">
            AI findings are decision-support information only.
            The final interpretation and diagnosis must be
            completed by an authorized doctor.
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
  urgent?: boolean;
};

function StatisticCard({
  title,
  value,
  description,
  urgent = false,
}: StatisticCardProps) {
  return (
    <article
      className={
        urgent
          ? "rounded-2xl border border-red-300/25 bg-red-500/15 p-6 shadow-[0_20px_55px_rgba(0,0,0,0.2)] backdrop-blur-xl"
          : "rounded-2xl border border-white/15 bg-white/10 p-6 shadow-[0_20px_55px_rgba(0,0,0,0.2)] backdrop-blur-xl"
      }
    >
      <p
        className={
          urgent
            ? "text-sm font-semibold text-red-200"
            : "text-sm font-semibold text-slate-300"
        }
      >
        {title}
      </p>

      <p className="mt-3 text-4xl font-bold text-white">
        {value}
      </p>

      <p
        className={
          urgent
            ? "mt-2 text-sm text-red-100"
            : "mt-2 text-sm text-slate-300"
        }
      >
        {description}
      </p>
    </article>
  );
}

type InformationBoxProps = {
  label: string;
  value: string;
  highlight?: boolean;
};

function InformationBox({
  label,
  value,
  highlight = false,
}: InformationBoxProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-blue-950/25 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p
        className={
          highlight
            ? "mt-2 text-sm font-semibold leading-6 text-cyan-200"
            : "mt-2 text-sm font-semibold leading-6 text-white"
        }
      >
        {value}
      </p>
    </div>
  );
}
