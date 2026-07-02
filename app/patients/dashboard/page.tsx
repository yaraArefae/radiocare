"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  role?: string | string[] | null;
};

export default function PatientDashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const currentUser = session?.user as SessionUser | undefined;

  const userRoles = (
    Array.isArray(currentUser?.role)
      ? currentUser.role
      : (currentUser?.role ?? "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const isPatient = userRoles.includes("patient");

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
      return;
    }

    if (!isPending && session && !isPatient) {
      router.replace("/unauthorized");
    }
  }, [isPatient, isPending, router, session]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950 text-white">
        <p className="font-semibold text-cyan-100">
          Loading patient dashboard...
        </p>
      </main>
    );
  }

  if (!session || !isPatient) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <header className="relative z-20 border-b border-white/15 bg-blue-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 overflow-hidden rounded-[14px] border border-white/25 bg-white/10 shadow-lg">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={40}
                height={40}
                className="h-full w-full object-contain p-[3px]"
                priority
              />
            </div>

            <div>
              <p className="font-bold text-white">RadioCare</p>
              <p className="text-xs text-cyan-200">Patient Portal</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-10 sm:px-7">
        <p className="font-semibold text-cyan-300">Patient dashboard</p>

        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Welcome, {currentUser?.name || "Patient"}
        </h1>

        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          Upload your radiology image, follow its review status, and view your
          reports after a doctor confirms the result.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <button
            type="button"
            className="rounded-[26px] border border-cyan-300/25 bg-gradient-to-br from-blue-600/80 to-cyan-500/70 p-6 text-left shadow-[0_20px_60px_rgba(14,116,255,0.25)] transition hover:-translate-y-1"
          >
            <p className="text-sm font-semibold text-cyan-100">New analysis</p>
            <h2 className="mt-3 text-2xl font-bold">Upload X-ray</h2>
            <p className="mt-3 text-sm leading-6 text-blue-50/90">
              Start a new radiology study and submit an image for preliminary AI
              analysis.
            </p>
          </button>

          <div className="rounded-[26px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-200">My studies</p>
            <p className="mt-3 text-4xl font-bold">0</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Uploaded studies and their current review status will appear here.
            </p>
          </div>

          <div className="rounded-[26px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-200">
              Doctor reports
            </p>
            <p className="mt-3 text-4xl font-bold">0</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Confirmed medical reports will become available after doctor
              review.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-[28px] border border-white/15 bg-white/10 p-6 backdrop-blur-2xl sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-cyan-300">
                Recent activity
              </p>
              <h2 className="mt-1 text-2xl font-bold">No studies yet</h2>
            </div>

            <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
              Patient
            </span>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            Your uploaded scans, preliminary AI results, doctor review status,
            and final reports will be shown in this section.
          </p>
        </div>
      </section>
    </main>
  );
}
