"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ClinicAiStatus, {
  useClinicCapabilities,
} from "@/components/ClinicAiStatus";
import NotificationBell from "@/components/NotificationBell";
import PasswordChangeGate from "@/components/PasswordChangeGate";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const clinics = [
  {
    slug: "chest",
    name: "Chest Clinic",
    specialty: "Pulmonology & Chest Imaging",
    description:
      "Review chest X-rays, pneumonia cases, and thoracic imaging studies.",
    icon: "🫁",
    imageTypes: ["Chest X-ray", "Pneumonia"],
  },
  {
    slug: "head",
    name: "Head & Skull Clinic",
    specialty: "Neurology & Skull Imaging",
    description:
      "Review skull and head X-rays and assess cranial imaging studies.",
    icon: "🧠",
    imageTypes: ["Skull X-ray", "Head Imaging"],
  },
  {
    slug: "spine",
    name: "Spine Clinic",
    specialty: "Spine & Cervical Imaging",
    description:
      "Review cervical, thoracic, and lumbar spine radiology studies.",
    icon: "🦴",
    imageTypes: ["Cervical Spine", "Lumbar Spine", "Scoliosis"],
  },
  {
    slug: "pelvis",
    name: "Pelvis & Hip Clinic",
    specialty: "Pelvic and Hip Imaging",
    description:
      "Review pelvic X-rays, hip abnormalities, and developmental conditions.",
    icon: "🩻",
    imageTypes: ["Pelvis X-ray", "Hip X-ray", "DDH"],
  },
  {
    slug: "shoulder",
    name: "Shoulder Clinic",
    specialty: "Shoulder Imaging",
    description:
      "Review shoulder joint, clavicle, and upper arm X-ray studies.",
    icon: "💪",
    imageTypes: ["Shoulder X-ray", "Clavicle"],
  },
  {
    slug: "hand-wrist",
    name: "Hand & Wrist Clinic",
    specialty: "Hand & Wrist Imaging",
    description:
      "Review wrist, hand, finger, and forearm X-ray studies.",
    icon: "🤚",
    imageTypes: ["Wrist X-ray", "Hand X-ray"],
  },
  {
    slug: "lower-limb",
    name: "Leg, Knee & Foot Clinic",
    specialty: "Leg, Knee & Foot Imaging",
    description:
      "Review leg, knee, ankle, and foot X-rays for fractures and abnormalities.",
    icon: "🦵",
    imageTypes: ["Leg", "Knee", "Foot"],
  },
];

export default function DoctorClinicsPage() {
  const router = useRouter();
  const { capabilities } = useClinicCapabilities();

  /*
    The clinics this doctor works in. A doctor is responsible for their
    own clinics only, so the other ones are not offered to them: opening
    one would show an empty queue and suggest they are covering a body
    region that is not theirs.
  */
  const [myClinics, setMyClinics] = useState<string[]>([]);
  const [isLoadingClinics, setIsLoadingClinics] = useState(true);

  const loadMyClinics = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/doctor/clinic`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMyClinics(
          (data.clinics ?? []).map((clinic: { key: string }) => clinic.key),
        );
      }
    } catch (error) {
      console.error("Unable to load the doctor clinics:", error);
    } finally {
      setIsLoadingClinics(false);
    }
  }, []);

  useEffect(() => {
    void loadMyClinics();
  }, [loadMyClinics]);

  /*
    Clinics are shown in the order the AI can actually support them, so a
    doctor sees at a glance where the preliminary result is dependable
    and where the whole reading is on them.
  */
  const tierOrder = { high: 0, moderate: 1, limited: 2, none: 3 };

  /*
    A doctor sees the clinics they are responsible for and nothing else.
    The other clinics hold no case for them, so offering those would only
    lead to an empty queue and suggest they cover a body region that is
    not theirs.

    An account with no clinic of its own, such as an administrator, sees
    all of them instead of an empty page.
  */
  const visibleClinics = isLoadingClinics
    ? []
    : myClinics.length > 0
      ? clinics.filter((clinic) => myClinics.includes(clinic.slug))
      : clinics;

  const orderedClinics = [...visibleClinics].sort((first, second) => {
    const firstCapability = capabilities[first.slug];
    const secondCapability = capabilities[second.slug];

    const firstRank = firstCapability?.aiServed
      ? (tierOrder[firstCapability.tier] ?? 9)
      : 9;
    const secondRank = secondCapability?.aiServed
      ? (tierOrder[secondCapability.tier] ?? 9)
      : 9;

    return firstRank - secondRank;
  });

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <PasswordChangeGate />
      <div className="mx-auto max-w-7xl">
        {/* Page heading */}
        <section className="mb-10 rounded-3xl border border-white/20 bg-white/[0.08] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                Doctor Workspace
              </p>

              <h1 className="text-3xl font-black text-white md:text-4xl">
                Radiology Clinics
              </h1>

              <p className="mt-3 max-w-3xl text-slate-300">
                Select a specialized clinic to review patients, imaging studies,
                AI results, and medical reports.
              </p>
            </div>

            <div className="flex h-fit flex-wrap items-center gap-3">
              <NotificationBell />

              <Link
                href="/doctor/messages"
                className="inline-flex rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
              >
                💬 Case Messages
              </Link>

              <Link
                href="/doctor/calendar"
                className="inline-flex rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
              >
                📅 Appointments Calendar
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex rounded-2xl border border-red-300/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                Logout
              </button>
            </div>
          </div>
        </section>

        {isLoadingClinics && (
          <p className="text-center font-bold text-cyan-100">
            Loading your clinic...
          </p>
        )}

        {/* Clinics */}
        <section className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
          {orderedClinics.map((clinic) => (
            <article
              key={clinic.slug}
              className="group flex min-h-[470px] flex-col overflow-hidden rounded-3xl border border-white/20 bg-white/[0.07] shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl transition duration-300 hover:-translate-y-2 hover:border-cyan-300/50 hover:bg-white/[0.11] hover:shadow-[0_25px_70px_rgba(14,165,233,0.25)]"
            >
              {/* Clinic top section */}
              <div className="border-b border-white/15 bg-gradient-to-r from-blue-600/75 via-sky-500/65 to-cyan-400/55 p-7 text-white backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <span className="text-5xl drop-shadow-lg">
                    {clinic.icon}
                  </span>

                  <ClinicAiStatus
                    capability={capabilities[clinic.slug]}
                    compact
                  />
                </div>

                <h2 className="mt-6 text-2xl font-black text-white">
                  {clinic.name}
                </h2>

                <p className="mt-1 text-sm font-medium text-blue-50">
                  {clinic.specialty}
                </p>

              </div>

              {/* Clinic information */}
              <div className="flex flex-1 flex-col p-7">
                <p className="min-h-16 text-sm leading-7 text-slate-300">
                  {clinic.description}
                </p>

                <div className="mt-5">
                  <ClinicAiStatus capability={capabilities[clinic.slug]} />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {clinic.imageTypes.map((type) => (
                    <span
                      key={type}
                      className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-cyan-200 backdrop-blur-md"
                    >
                      {type}
                    </span>
                  ))}
                </div>

                <Link
                  href={`/doctor/clinic/${clinic.slug}`}
                  className="mt-auto flex w-full items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-4 py-3.5 font-bold text-white shadow-lg backdrop-blur-xl transition duration-300 hover:border-cyan-300/60 hover:bg-cyan-400/20 hover:shadow-[0_10px_35px_rgba(34,211,238,0.2)]"
                >
                  Open Clinic
                </Link>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}