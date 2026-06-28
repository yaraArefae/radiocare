"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");
    setError("");
    setIsLoading(true);

    try {
      const normalizedEmail = email
        .trim()
        .toLowerCase();

      const { error: requestError } =
        await authClient.requestPasswordReset({
          email: normalizedEmail,
          redirectTo: `${window.location.origin}/reset-password`,
        });

      if (requestError) {
        console.error(
          "Password reset request error:",
          requestError
        );

        setError(
          requestError.message ||
            "Unable to process the request."
        );

        return;
      }

      setMessage(
        "If an account exists for this email address, a password reset link has been sent."
      );
    } catch (requestException) {
      console.error(
        "Password reset request failed:",
        requestException
      );

      setError(
        "Unable to process the request. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      {/* Dark glass background */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-[140px]" />

      {/* Glass card */}
      <section className="relative z-10 w-full max-w-md rounded-[30px] border border-white/15 bg-white/10 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10">
        {/* Logo */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 bg-white/10 text-lg font-bold text-white shadow-lg backdrop-blur-xl">
          RI
        </div>

        {/* Heading */}
        <div className="mt-7">
          <p className="font-semibold text-cyan-300">
            Account recovery
          </p>

          <h1 className="mt-2 text-3xl font-bold text-white">
            Forgot your password?
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-300">
            Enter your registered email address and we will
            send you a link to create a new password.
          </p>
        </div>

        {/* Form */}
        <form
          className="mt-8 space-y-6"
          onSubmit={handleSubmit}
        >
          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-semibold text-slate-200"
            >
              Email address
            </label>

            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={isLoading}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMessage("");
                setError("");
              }}
              placeholder="Enter your email address"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm font-medium leading-6 text-red-100 backdrop-blur-xl"
            >
              {error}
            </div>
          )}

          {/* Success */}
          {message && (
            <div
              role="status"
              className="rounded-xl border border-green-300/30 bg-green-500/20 px-4 py-3 text-sm font-medium leading-6 text-green-100 backdrop-blur-xl"
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
          >
            {isLoading
              ? "Sending reset link..."
              : "Send reset link"}
          </button>
        </form>

        {/* Back link */}
        <div className="mt-7 text-center">
          <Link
            href="/"
            className="text-sm font-semibold text-cyan-300 transition hover:text-cyan-100"
          >
            Back to sign in
          </Link>
        </div>

        {/* Information */}
        <div className="mt-8 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4 backdrop-blur-xl">
          <p className="text-xs leading-5 text-cyan-50">
            For security reasons, the reset link is temporary
            and can only be used once.
          </p>
        </div>
      </section>
    </main>
  );
}