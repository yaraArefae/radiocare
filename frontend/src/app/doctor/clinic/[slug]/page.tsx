"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

type ClinicInformation = {
  name: string;
  specialty: string;
  description: string;
  icon: string;
  imageTypes: string[];
};

const clinicData: Record<string, ClinicInformation> = {
  chest: {
    name: "Chest Clinic",
    specialty: "Pulmonology & Chest Imaging",
    description:
      "Manage chest imaging studies and review pneumonia and thoracic radiology cases.",
    icon: "🫁",
    imageTypes: ["Chest X-ray", "Pneumonia", "Thoracic Imaging"],
  },

  head: {
    name: "Head & Skull Clinic",
    specialty: "Neurology & Skull Imaging",
    description:
      "Manage head and skull radiology studies and review cranial imaging results.",
    icon: "🧠",
    imageTypes: ["Skull X-ray", "Head Imaging", "Cranial Studies"],
  },

  spine: {
    name: "Spine Clinic",
    specialty: "Spine & Cervical Imaging",
    description:
      "Manage cervical, thoracic, lumbar spine, and scoliosis imaging studies.",
    icon: "🦴",
    imageTypes: ["Cervical Spine", "Lumbar Spine", "Scoliosis"],
  },

  pelvis: {
    name: "Pelvis & Hip Clinic",
    specialty: "Pelvic and Hip Imaging",
    description:
      "Manage pelvic, hip, and developmental dysplasia imaging cases.",
    icon: "🩻",
    imageTypes: ["Pelvis X-ray", "Hip X-ray", "DDH"],
  },

  "upper-limb": {
    name: "Upper Limb Clinic",
    specialty: "Shoulder, Arm & Hand Imaging",
    description:
      "Manage shoulder, elbow, wrist, hand, and upper-limb X-ray studies.",
    icon: "💪",
    imageTypes: ["Shoulder", "Arm", "Hand"],
  },

  "lower-limb": {
    name: "Lower Limb Clinic",
    specialty: "Leg, Knee & Foot Imaging",
    description:
      "Manage leg, knee, ankle, foot, and lower-limb radiology studies.",
    icon: "🦵",
    imageTypes: ["Leg", "Knee", "Foot"],
  },
};

const clinicActions = [
  {
    title: "Clinic Patients",
    description:
      "View and manage patients assigned to this specialized clinic.",
    path: "/patients",
    icon: "👥",
  },
  {
    title: "Imaging Studies",
    description:
      "Review uploaded X-rays, AI results, and pending imaging studies.",
    path: "/studies",
    icon: "🩻",
  },
  {
    title: "New Study",
    description:
      "Create a new radiology study and assign it to a clinic patient.",
    path: "/new-study",
    icon: "➕",
  },
  {
    title: "Medical Reports",
    description:
      "Review, prepare, and manage diagnostic medical reports.",
    path: "/reports",
    icon: "📄",
  },
];

export default function ClinicDetailsPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const clinic = clinicData[slug];

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
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/doctor/clinic"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50 hover:bg-white/[0.12] hover:text-white"
          >
            <span>←</span>
            <span>Back to Clinics</span>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center justify-center rounded-2xl border border-red-300/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
          >
            Logout
          </button>
        </div>

        {/* Clinic heading */}
        <section className="relative overflow-hidden rounded-3xl border border-white/20 bg-white/[0.08] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-10">
          {/* Decorative lights */}
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

            {/* Clinic status */}
            <div className="min-w-52 rounded-3xl border border-white/20 bg-white/[0.08] p-6 text-center shadow-lg backdrop-blur-2xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-400/15">
                <span className="h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
              </div>

              <p className="mt-4 text-sm font-semibold text-slate-300">
                Clinic Status
              </p>

              <p className="mt-1 text-xl font-black text-white">Active</p>

              <p className="mt-2 text-xs text-slate-400">
                Ready to receive assigned studies
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
            <p className="mt-2 text-3xl font-black text-white">0</p>
            <p className="mt-1 text-xs text-cyan-200">Clinic patients</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              Pending Studies
            </p>
            <p className="mt-2 text-3xl font-black text-white">0</p>
            <p className="mt-1 text-xs text-cyan-200">Waiting for review</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              Completed Reports
            </p>
            <p className="mt-2 text-3xl font-black text-white">0</p>
            <p className="mt-1 text-xs text-cyan-200">Approved reports</p>
          </article>

          <article className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-lg backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-400">
              AI Review Cases
            </p>
            <p className="mt-2 text-3xl font-black text-white">0</p>
            <p className="mt-1 text-xs text-cyan-200">AI-assisted results</p>
          </article>
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
                href={`${action.path}?clinic=${slug}`}
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