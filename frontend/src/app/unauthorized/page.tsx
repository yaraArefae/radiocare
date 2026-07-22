import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <section className="relative z-10 w-full max-w-md rounded-[30px] border border-white/15 bg-white/10 p-8 text-center shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-red-300/30 bg-red-500/20 text-3xl font-bold text-red-100 backdrop-blur-xl">
          !
        </div>

        <p className="mt-6 font-semibold text-red-300">
          Access denied
        </p>

        <h1 className="mt-2 text-3xl font-bold text-white">
          You do not have permission
        </h1>

        <p className="mt-4 text-sm leading-6 text-slate-300">
          Your account does not have the required role to
          access this page. Contact the system administrator
          if you believe this is a mistake.
        </p>

        <Link
          href="/dashboard"
          className="mt-8 inline-flex w-full items-center justify-center rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
        >
          Return to dashboard
        </Link>
      </section>
    </main>
  );
}