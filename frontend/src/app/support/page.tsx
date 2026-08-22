"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import SupportChat from "@/components/SupportChat";
import { authClient } from "@/client/auth/auth-client";

/*
  The one page a doctor or a patient writes to the administration from.

  Both roles get the same screen because they are asking the same desk
  the same kind of question, and both only ever see their own thread:
  the server hands them theirs and refuses to name anybody else's.
*/
export default function SupportPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const roles = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  }, [session]);

  const isAdmin = roles.includes("admin");
  const isDoctor = roles.includes("doctor");

  useEffect(() => {
    if (isPending) return;

    if (!session) {
      router.replace("/");
      return;
    }

    /*
      An administrator has no thread of their own: their side of every
      conversation lives in the administration inbox.
    */
    if (isAdmin) {
      router.replace("/admin/messages");
    }
  }, [isAdmin, isPending, router, session]);

  if (isPending || !session || isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#071a38]">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-5 font-bold text-white">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <Link
          href={isDoctor ? "/doctor/clinic" : "/patients/dashboard"}
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50 hover:bg-white/[0.12]"
        >
          ← Back
        </Link>

        <h1 className="text-3xl font-black text-white">
          Administration support
        </h1>

        <p className="mt-2 max-w-2xl leading-6 text-slate-300">
          {isDoctor
            ? "Ask about your account, the clinics you are assigned to, or a request that is still waiting. This thread is read by the administrators, not by patients."
            : "Ask about your account, a registration request, or anything the clinic cannot answer. This thread is read by the administrators, not by doctors."}
        </p>

        <p className="mt-2 text-sm text-slate-400">
          For a question about a specific X-ray, use the case conversation
          instead: it reaches the doctor who is reading it.
        </p>

        <div className="mt-7">
          <SupportChat viewerRole={isDoctor ? "doctor" : "patient"} />
        </div>
      </div>
    </main>
  );
}
