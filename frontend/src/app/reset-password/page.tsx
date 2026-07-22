"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import { authClient } from "@/client/auth/auth-client";

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [isCheckingToken, setIsCheckingToken] =
    useState(true);
  const [tokenError, setTokenError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");
  const [showPassword, setShowPassword] =
    useState(false);

  const [error, setError] = useState("");
  const [isSuccess, setIsSuccess] =
    useState(false);
  const [isLoading, setIsLoading] =
    useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const searchParameters =
        new URLSearchParams(window.location.search);

      const resetToken =
        searchParameters.get("token");

      const resetError =
        searchParameters.get("error");

      if (
        resetError === "INVALID_TOKEN" ||
        !resetToken
      ) {
        setTokenError(
          "This password reset link is invalid or has expired."
        );
        setIsCheckingToken(false);
        return;
      }

      setToken(resetToken);
      setIsCheckingToken(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (!token) {
      setError(
        "This password reset link is invalid or has expired."
      );
      return;
    }

    if (newPassword.length < 8) {
      setError(
        "Password must contain at least 8 characters."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const { error: resetError } =
        await authClient.resetPassword({
          newPassword,
          token,
        });

      if (resetError) {
        console.error(
          "Reset password error:",
          resetError
        );

        setError(
          resetError.message ||
            "The reset link is invalid or has expired."
        );
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      setIsSuccess(true);
    } catch (resetException) {
      console.error(
        "Reset password request failed:",
        resetException
      );

      setError(
        "Unable to reset the password. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (isCheckingToken) {
    return (
      <GlassBackground>
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-5 font-semibold text-cyan-100">
            Checking reset link...
          </p>
        </div>
      </GlassBackground>
    );
  }

  if (tokenError) {
    return (
      <GlassBackground>
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-red-300/30 bg-red-500/20 text-3xl font-bold text-red-100 backdrop-blur-xl">
            !
          </div>

          <p className="mt-6 font-semibold text-red-300">
            Invalid reset link
          </p>

          <h1 className="mt-2 text-3xl font-bold text-white">
            Link unavailable
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            {tokenError}
          </p>

          <Link
            href="/forgot-password"
            className="mt-8 inline-flex w-full items-center justify-center rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
          >
            Request a new link
          </Link>

          <Link
            href="/"
            className="mt-5 inline-block text-sm font-semibold text-cyan-300 transition hover:text-cyan-100"
          >
            Back to sign in
          </Link>
        </div>
      </GlassBackground>
    );
  }

  if (isSuccess) {
    return (
      <GlassBackground>
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-green-300/30 bg-green-500/20 text-3xl font-bold text-green-100 backdrop-blur-xl">
            ✓
          </div>

          <p className="mt-6 font-semibold text-green-300">
            Update completed
          </p>

          <h1 className="mt-2 text-3xl font-bold text-white">
            Password updated
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            Your password has been changed successfully.
            You can now sign in using your new password.
          </p>

          <Link
            href="/"
            className="mt-8 inline-flex w-full items-center justify-center rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
          >
            Go to sign in
          </Link>
        </div>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
      <div className="flex h-14 w-14 overflow-hidden rounded-[18px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
        <Image
          src="/images/radiocare-icon.png"
          alt="RadioCare logo"
          width={56}
          height={56}
          className="h-full w-full object-contain p-1"
        />
      </div>

      <div className="mt-7">
        <p className="font-semibold text-cyan-300">
          Account security
        </p>

        <h1 className="mt-2 text-3xl font-bold text-white">
          Create a new password
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          Enter and confirm the new password for your
          RadioCare account.
        </p>
      </div>

      <form
        className="mt-8 space-y-6"
        onSubmit={handleSubmit}
      >
        <div>
          <label
            htmlFor="newPassword"
            className="mb-2 block text-sm font-semibold text-slate-200"
          >
            New password
          </label>

          <div className="relative">
            <input
              id="newPassword"
              name="newPassword"
              type={
                showPassword
                  ? "text"
                  : "password"
              }
              required
              minLength={8}
              autoComplete="new-password"
              disabled={isLoading}
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setError("");
              }}
              placeholder="At least 8 characters"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 pr-20 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            />

            <button
              type="button"
              disabled={isLoading}
              onClick={() =>
                setShowPassword(
                  (current) => !current
                )
              }
              className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-100 disabled:text-slate-500"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-2 block text-sm font-semibold text-slate-200"
          >
            Confirm new password
          </label>

          <input
            id="confirmPassword"
            name="confirmPassword"
            type={
              showPassword
                ? "text"
                : "password"
            }
            required
            minLength={8}
            autoComplete="new-password"
            disabled={isLoading}
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(
                event.target.value
              );
              setError("");
            }}
            placeholder="Enter the password again"
            className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm font-medium leading-6 text-red-100 backdrop-blur-xl"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !token}
          className="w-full rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
        >
          {isLoading
            ? "Updating password..."
            : "Update password"}
        </button>
      </form>

      <div className="mt-7 text-center">
        <Link
          href="/"
          className="text-sm font-semibold text-cyan-300 transition hover:text-cyan-100"
        >
          Back to sign in
        </Link>
      </div>
    </GlassBackground>
  );
}

type GlassBackgroundProps = {
  children: ReactNode;
};

function GlassBackground({
  children,
}: GlassBackgroundProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-[140px]" />

      <section className="relative z-10 w-full max-w-md rounded-[30px] border border-white/15 bg-white/10 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10">
        {children}
      </section>
    </main>
  );
}
