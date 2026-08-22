"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useClinicCapabilities } from "@/components/ClinicAiStatus";
import PasswordChangeGate from "@/components/PasswordChangeGate";
import NotificationBell from "@/components/NotificationBell";
import { authClient } from "@/client/auth/auth-client";

/*
  The clinics of the doctor are the same list the patient chooses from
  when uploading, so every one of them has its own key on the server.
*/
type ClinicKey =
  | "head"
  | "abdomen"
  | "chest"
  | "shoulder"
  | "hand-wrist"
  | "spine"
  | "pelvis"
  | "lower-limb";

type ClinicInformation = {
  name: string;
  specialty: string;
  description: string;
  icon: string;
  imageTypes: string[];
  apiClinicKey: ClinicKey;
};

type ClinicStudy = {
  id: string;
  patientId: string;
  patient: string;
  bodyRegion: string;
  view: string;
  date: string;
  priority: string;
  status: string;
  createdAt: string;
  clinicKey: string;
  aiResult: string;
  confidence: number | string | null;
};

type StudiesResponse = {
  success: boolean;
  studies?: ClinicStudy[];
  message?: string;
};

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const clinicData: Record<string, ClinicInformation> = {
  head: {
    name: "Head & Skull Clinic",
    specialty: "Neuroradiology",
    description:
      "Manage brain MRI, head vessel studies, and skull imaging cases.",
    icon: "🧠",
    imageTypes: ["Brain MRI", "Head MRA", "Skull"],
    apiClinicKey: "head",
  },

  abdomen: {
    name: "Abdomen Clinic",
    specialty: "Abdominal Radiology",
    description:
      "Manage liver, kidney, pancreas, colon and adrenal CT volumes.",
    icon: "🫀",
    imageTypes: ["Abdomen CT", "Pancreas CT", "Colon CT", "Liver CT"],
    apiClinicKey: "abdomen",
  },

  chest: {
    name: "Chest Clinic",
    specialty: "Pulmonology & Chest Imaging",
    description:
      "Manage chest imaging studies and review pneumonia and thoracic radiology cases.",
    icon: "🫁",
    imageTypes: ["Chest X-ray", "Pneumonia", "Thoracic Imaging"],
    apiClinicKey: "chest",
  },

  spine: {
    name: "Spine Clinic",
    specialty: "Spine & Cervical Imaging",
    description:
      "Manage cervical, thoracic, lumbar spine, and scoliosis imaging studies.",
    icon: "🦴",
    imageTypes: ["Cervical Spine", "Lumbar Spine", "Scoliosis"],
    apiClinicKey: "spine",
  },

  pelvis: {
    name: "Pelvis & Hip Clinic",
    specialty: "Pelvic and Hip Imaging",
    description:
      "Manage pelvic, hip, and developmental dysplasia imaging cases.",
    icon: "🩻",
    imageTypes: ["Pelvis X-ray", "Hip X-ray", "DDH"],
    apiClinicKey: "pelvis",
  },

  shoulder: {
    name: "Shoulder Clinic",
    specialty: "Shoulder Imaging",
    description:
      "Manage shoulder joint, clavicle, and upper arm X-ray studies.",
    icon: "💪",
    imageTypes: ["Shoulder X-ray", "Clavicle"],
    apiClinicKey: "shoulder",
  },

  "hand-wrist": {
    name: "Hand & Wrist Clinic",
    specialty: "Hand & Wrist Imaging",
    description:
      "Manage wrist, hand, finger, and forearm X-ray studies.",
    icon: "🤚",
    imageTypes: ["Wrist X-ray", "Hand X-ray"],
    apiClinicKey: "hand-wrist",
  },

  "lower-limb": {
    name: "Leg & Foot Clinic",
    specialty: "Leg & Foot Imaging",
    description:
      "Manage leg, ankle, foot, and lower-limb radiology studies.",
    icon: "🦵",
    imageTypes: ["Leg", "Foot"],
    apiClinicKey: "lower-limb",
  },
};

/*
  What this clinic offers besides the review queue above it.

  The queue already lists the studies that are waiting, so a card that
  opened the same list again was removed: it sent the doctor to a second
  screen showing what they were already looking at.

  Every path carries the clinic, so the destination really is this
  clinic. Without it a doctor covering more than one clinic opened these
  from the shoulder page and saw every clinic they cover.
*/
const clinicActions = [
  {
    title: "Clinic Patients",
    description:
      "Everyone with a study in this clinic, including those with nothing waiting.",
    path: "/patients",
    icon: "👥",
  },
  {
    title: "Medical Reports",
    description:
      "Every report written in this clinic, gathered in one place.",
    path: "/reports",
    icon: "📄",
  },
  {
    title: "New Study",
    description:
      "Upload for a patient who came to the clinic instead of uploading themselves.",
    path: "/new-study",
    icon: "➕",
  },
];

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/*
  A case belongs in the review queue unless the AI cleared it as normal.
  Regions that have no AI model yet report NOT_ANALYZED and still need
  the doctor, so they stay in the queue too.
*/
function needsDoctorReview(study: ClinicStudy) {
  /*
    A case leaves the queue once its report is approved, otherwise a
    finished case would sit in the list for ever and hide the new ones.
  */
  if (isCompletedStatus(study.status)) {
    return false;
  }

  /*
    Whether a case needs a doctor is decided when it is uploaded, and it
    is decided by two things: what the AI saw and what the patient said.
    A scan the AI read as normal, from somebody who wrote that their
    chest hurts, needs a doctor precisely because the model cannot hear
    them.

    This used to drop every case whose AI result was "normal", which
    threw away the second half of that decision. A patient who described
    their symptoms watched their study vanish, and no doctor ever saw
    the sentence they had written.

    'Cleared' is the one the server closed: normal, and nothing
    reported. It is the only case that belongs outside this queue.
  */
  return normalizeText(study.status) !== "cleared";
}

function isCompletedStatus(status: string) {
  const normalizedStatus = normalizeText(status);

  return (
    normalizedStatus.includes("completed") ||
    normalizedStatus.includes("reviewed") ||
    normalizedStatus.includes("approved")
  );
}

function formatConfidence(value: ClinicStudy["confidence"]) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return "—";
  }

  return `${parsedValue.toFixed(1)}%`;
}

function formatDate(value: string) {
  if (!value) {
    return "—";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ClinicDetailsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const clinic = clinicData[slug];

  const { capabilities } = useClinicCapabilities();

  /*
    The queue opens on the newest few cases. A clinic can hold dozens,
    and a wall of cards buries the sections under it; the count of what
    is hidden stays on the button so nothing disappears silently.
  */
  const [showAllCases, setShowAllCases] = useState(false);
  const capability = capabilities[slug];

  const [studies, setStudies] = useState<ClinicStudy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadClinicStudies = useCallback(async () => {
    if (!clinic) {
      setStudies([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `${backendBaseUrl}/api/studies?clinic=${encodeURIComponent(
          clinic.apiClinicKey,
        )}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const result = (await response.json()) as StudiesResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load clinic studies.");
      }

      const clinicStudies = (result.studies ?? []).filter(
        needsDoctorReview,
      );

      setStudies(clinicStudies);
    } catch (error) {
      console.error("Load clinic studies failed:", error);
      setStudies([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load clinic studies.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [clinic]);

  useEffect(() => {
    void loadClinicStudies();
  }, [loadClinicStudies]);

  const visibleStudies = showAllCases ? studies : studies.slice(0, 2);
  const hiddenCaseCount = studies.length - visibleStudies.length;

  const statistics = useMemo(() => {
    const assignedPatients = new Set(
      studies.map((study) => study.patientId).filter(Boolean),
    ).size;

    const completedReports = studies.filter((study) =>
      isCompletedStatus(study.status),
    ).length;

    const pendingStudies = studies.length - completedReports;

    return {
      assignedPatients,
      pendingStudies,
      completedReports,
      aiReviewCases: studies.length,
    };
  }, [studies]);

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  if (!clinic) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] p-6">
        <section className="w-full max-w-lg rounded-3xl border border-white/20 bg-white/[0.08] p-10 text-center shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          <div className="text-6xl">⚠️</div>

          <h1 className="mt-5 text-3xl font-black text-white">
            Clinic Not Found
          </h1>

          <p className="mt-3 text-slate-300">
            The requested radiology clinic does not exist or is unavailable.
          </p>

          <Link
            href="/doctor/clinic"
            className="mt-7 inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/20 px-6 py-3 font-bold text-white backdrop-blur-xl transition hover:border-cyan-200 hover:bg-cyan-400/30"
          >
            ← Return to Clinics
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      {/*
        A doctor with one clinic is sent here the moment they sign in
        and never sees the clinic list, so this is where the temporary
        password an administrator issued has to be replaced. The gate
        lived only on the list, which most doctors pass through without
        ever rendering.
      */}
      <PasswordChangeGate />

      <div className="mx-auto max-w-7xl">
        {/*
          There is no way back to the clinic list here on purpose: a
          doctor works in one clinic and is taken straight to it, so the
          list was a screen they never asked for. A doctor who covers
          more than one still reaches it at /doctor/clinic?all=1, which
          is the address the list itself answers on.
        */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-wrap items-center gap-3">
            <NotificationBell />

            {/* The page patients see when they pick a doctor in this
                clinic, and the only place its photo, description,
                languages and price can be changed. */}
            <Link
              href="/doctor/profile"
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              👤 My Profile
            </Link>

            <Link
              href="/doctor/messages"
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              💬 Case Messages
            </Link>

            <Link
              href="/doctor/calendar"
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              📅 Appointments Calendar
            </Link>

            <button
              type="button"
              onClick={() => void loadClinicStudies()}
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Refreshing..." : "Refresh Cases"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center rounded-2xl border border-red-300/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Clinic heading */}
        <section className="relative overflow-hidden rounded-3xl border border-white/20 bg-white/[0.08] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-blue-600/20 blur-3xl" />

          <div className="relative flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-3xl">
              <div className="flex items-center gap-5">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/20 bg-gradient-to-br from-blue-600/70 via-sky-500/60 to-cyan-400/50 text-5xl shadow-[0_15px_40px_rgba(14,165,233,0.25)] backdrop-blur-xl">
                  {clinic.icon}
                </div>

                <div>
                  <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                    Specialized Radiology Clinic
                  </p>

                  <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
                    {clinic.name}
                  </h1>
                </div>
              </div>

              <p className="mt-6 text-lg font-semibold text-blue-100">
                {clinic.specialty}
              </p>

              <p className="mt-3 max-w-2xl leading-7 text-slate-300">
                {clinic.description}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {clinic.imageTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-cyan-200 backdrop-blur-md"
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>

            <div className="min-w-52 rounded-3xl border border-white/20 bg-white/[0.08] p-6 text-center shadow-lg backdrop-blur-2xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15">
                <span className="h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
              </div>

              <p className="mt-4 text-sm font-semibold text-slate-300">
                AI support
              </p>

              <p className="mt-1 text-xl font-black text-white">
                {capability?.aiServed
                  ? capability.tier === "high"
                    ? "High accuracy"
                    : capability.tier === "moderate"
                      ? "Moderate"
                      : "Limited"
                  : "Doctor only"}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                {capability?.aiServed
                  ? "A preliminary AI result assists your reading"
                  : "Every image is read by you from the start"}
              </p>
            </div>
          </div>
        </section>

        {/* Clinic statistics */}
        <section className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              Assigned Patients
            </p>
            <p className="mt-2 text-3xl font-black text-white">
              {isLoading ? "…" : statistics.assignedPatients}
            </p>
            <p className="mt-1 text-xs text-cyan-200">Clinic patients</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              Pending Studies
            </p>
            <p className="mt-2 text-3xl font-black text-white">
              {isLoading ? "…" : statistics.pendingStudies}
            </p>
            <p className="mt-1 text-xs text-cyan-200">Waiting for review</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              Completed Reports
            </p>
            <p className="mt-2 text-3xl font-black text-white">
              {isLoading ? "…" : statistics.completedReports}
            </p>
            <p className="mt-1 text-xs text-cyan-200">Approved reports</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              AI Review Cases
            </p>
            <p className="mt-2 text-3xl font-black text-white">
              {isLoading ? "…" : statistics.aiReviewCases}
            </p>
            <p className="mt-1 text-xs text-cyan-200">
              Abnormal AI-assisted results
            </p>
          </article>
        </section>

        {/* Abnormal cases for this clinic only */}
        <section className="mt-8 rounded-3xl border border-white/15 bg-white/[0.07] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-2xl md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
                Doctor Review Queue
              </p>
              <h2 className="mt-2 text-2xl font-black text-white">
                {clinic.name} Review Queue
              </h2>
              <p className="mt-2 text-slate-400">
                A clear scan whose patient reported no symptoms stays in
                their record and does not appear here. If they described
                something, it is in this queue whatever the AI said.
              </p>
            </div>

            <Link
              href={`/studies?clinic=${encodeURIComponent(slug)}`}
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
            >
              Open All Studies →
            </Link>
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-2xl border border-red-300/25 bg-red-500/10 p-5 text-red-100">
              <p className="font-bold">Could not load clinic cases.</p>
              <p className="mt-1 text-sm text-red-100/80">{errorMessage}</p>
            </div>
          ) : null}

          {isLoading ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {[1, 2].map((item) => (
                <div
                  key={item}
                  className="h-44 animate-pulse rounded-3xl border border-white/10 bg-white/[0.05]"
                />
              ))}
            </div>
          ) : studies.length === 0 && !errorMessage ? (
            <div className="mt-6 rounded-3xl border border-dashed border-white/20 bg-white/[0.04] p-10 text-center">
              <div className="text-5xl">✅</div>
              <h3 className="mt-4 text-xl font-black text-white">
                No cases are waiting
              </h3>
              <p className="mt-2 text-slate-400">
                New studies assigned to this clinic will appear here.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {visibleStudies.map((study) => (
                <article
                  key={study.id}
                  className="rounded-3xl border border-white/15 bg-white/[0.06] p-5 transition hover:border-cyan-300/35 hover:bg-white/[0.09]"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
                        {study.id}
                      </p>
                      <h3 className="mt-2 text-xl font-black text-white">
                        {study.patient || "Unknown Patient"}
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        Patient ID: {study.patientId || "—"}
                      </p>
                    </div>

                    <span className="inline-flex w-fit rounded-full border border-red-300/30 bg-red-500/15 px-3 py-1.5 text-xs font-black text-red-100">
                      {study.aiResult || "ABNORMAL"}
                    </span>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-white/[0.05] p-3">
                      <p className="text-xs text-slate-400">Body region</p>
                      <p className="mt-1 font-bold text-white">
                        {study.bodyRegion || "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.05] p-3">
                      <p className="text-xs text-slate-400">AI confidence</p>
                      <p className="mt-1 font-bold text-white">
                        {formatConfidence(study.confidence)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.05] p-3">
                      <p className="text-xs text-slate-400">Priority</p>
                      <p className="mt-1 font-bold text-white">
                        {study.priority || "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.05] p-3">
                      <p className="text-xs text-slate-400">Uploaded</p>
                      <p className="mt-1 font-bold text-white">
                        {formatDate(study.createdAt || study.date)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-300">
                      Status: {study.status || "Waiting"}
                    </span>
                    {/* Straight into the case, where the doctor reads the
                        image, writes the report, answers the patient, and
                        books the follow-up. */}
                    <Link
                      href={`/studies/${encodeURIComponent(study.id)}`}
                      className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
                    >
                      Review Case
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          {studies.length > 2 && (
            <button
              type="button"
              onClick={() => setShowAllCases((shown) => !shown)}
              className="mt-6 w-full rounded-2xl border border-white/20 bg-white/[0.06] px-6 py-4 font-black text-cyan-100 transition hover:border-cyan-300/45 hover:bg-white/[0.10]"
            >
              {showAllCases
                ? "Show fewer cases"
                : `Show ${hiddenCaseCount} more case${
                    hiddenCaseCount === 1 ? "" : "s"
                  }`}
            </button>
          )}
        </section>

        {/* Clinic actions */}
        <section className="mt-8">
          <div className="mb-5">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
              Clinic Management
            </p>

            <h2 className="mt-2 text-2xl font-black text-white">
              Manage This Clinic
            </h2>

            <p className="mt-2 text-slate-400">
              Select an option to manage patients, studies, and reports.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {clinicActions.map((action) => (
              <Link
                key={action.title}
                href={`${action.path}?clinic=${encodeURIComponent(slug)}`}
                className="group flex min-h-64 flex-col rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-2xl transition duration-300 hover:-translate-y-2 hover:border-cyan-300/50 hover:bg-white/[0.11] hover:shadow-[0_25px_70px_rgba(14,165,233,0.22)]"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-blue-600/60 via-sky-500/50 to-cyan-400/40 text-3xl shadow-lg backdrop-blur-xl transition group-hover:scale-110">
                  {action.icon}
                </div>

                <h3 className="mt-5 text-xl font-black text-white">
                  {action.title}
                </h3>

                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {action.description}
                </p>

                <div className="mt-auto pt-6">
                  <span className="inline-flex items-center gap-2 font-bold text-cyan-200 transition group-hover:gap-3 group-hover:text-white">
                    Open
                    <span>→</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}