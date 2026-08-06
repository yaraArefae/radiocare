"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

export default function ChangePasswordPage() {
  const router = useRouter();

  const {
    data: session,
    isPending: isSessionPending,
  } = authClient.useSession();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] =
    useState(false);

  const [showNewPassword, setShowNewPassword] =
    useState(false);

  const [revokeOtherSessions, setRevokeOtherSessions] =
    useState(true);

  const [error, setError] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isSessionPending && !session) {
      router.replace("/");
    }
  }, [isSessionPending, session, router]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setIsSuccess(false);

    if (!currentPassword) {
      setError("Please enter your current password.");
      return;
    }

    if (newPassword.length < 8) {
      setError(
        "The new password must contain at least 8 characters."
      );
      return;
    }

    if (newPassword === currentPassword) {
      setError(
        "The new password must be different from the current password."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const { error: changePasswordError } =
        await authClient.changePassword({
          currentPassword,
          newPassword,
          revokeOtherSessions,
        });

      if (changePasswordError) {
        setError(
          "The current password is incorrect or the password could not be changed."
        );
        return;
      }

      /*
        The account is no longer on the temporary password an
        administrator issued, so the flag that forces this screen is
        cleared.
      */
      try {
        await fetch(
          `${
            process.env.NEXT_PUBLIC_BACKEND_URL ??
            "http://localhost:4000"
          }/api/account/password-status`,
          { method: "POST", credentials: "include" },
        );
      } catch (statusError) {
        console.error(
          "Unable to clear the temporary password flag:",
          statusError,
        );
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsSuccess(true);
    } catch (requestError) {
      console.error(
        "Change password request failed:",
        requestError
      );

      setError(
        "Unable to change the password. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    window.location.replace("/");
  }

  if (isSessionPending) {
    return (
      <GlassBackground>
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-5 font-semibold text-cyan-100">
            Loading your account...
          </p>
        </div>
      </GlassBackground>
    );
  }

  if (!session) {
    return null;
  }

  if (isSuccess) {
    return (
      <GlassBackground>
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-green-300/30 bg-green-500/20 text-3xl font-bold text-green-100 backdrop-blur-xl">
            ✓
          </div>

          <p className="mt-6 font-semibold text-green-300">
            Account security
          </p>

          <h1 className="mt-2 text-3xl font-bold text-white">
            Password changed
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            Your password has been changed successfully.
            You can continue using your current session.
          </p>

          {revokeOtherSessions && (
            <div className="mt-6 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4 backdrop-blur-xl">
              <p className="text-sm leading-6 text-cyan-50">
                Other active sessions for your account have
                been signed out.
              </p>
            </div>
          )}

          <Link
            href="/dashboard"
            className="mt-7 inline-flex w-full items-center justify-center rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400"
          >
            Return to dashboard
          </Link>

          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 w-full rounded-xl border border-white/20 bg-white/10 px-5 py-3 font-semibold text-white backdrop-blur-xl transition hover:bg-white/15"
          >
            Sign out and test new password
          </button>
        </div>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground maxWidth="max-w-lg">
      <div className="flex items-center justify-between gap-5">
        <div className="flex h-14 w-14 overflow-hidden rounded-[18px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
          <Image
            src="/images/radiocare-icon.png"
            alt="RadioCare logo"
            width={56}
            height={56}
            className="h-full w-full object-contain p-1"
          />
        </div>

        <Link
          href="/dashboard"
          className="text-sm font-semibold text-cyan-300 transition hover:text-cyan-100"
        >
          Back to dashboard
        </Link>
      </div>

      <div className="mt-8">
        <p className="font-semibold text-cyan-300">
          Account security
        </p>

        <h1 className="mt-2 text-3xl font-bold text-white">
          Change your password
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          Enter your current password, then choose a new
          secure password for your account.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
        <p className="text-sm font-semibold text-white">
          {session.user.name}
        </p>

        <p className="mt-1 text-sm text-slate-300">
          {session.user.email}
        </p>
      </div>

      <form
        className="mt-8 space-y-6"
        onSubmit={handleSubmit}
      >
        <PasswordField
          id="currentPassword"
          label="Current password"
          value={currentPassword}
          showPassword={showCurrentPassword}
          disabled={isLoading}
          placeholder="Enter your current password"
          onChange={(value) => {
            setCurrentPassword(value);
            setError("");
          }}
          onToggle={() =>
            setShowCurrentPassword((current) => !current)
          }
        />

        <PasswordField
          id="newPassword"
          label="New password"
          value={newPassword}
          showPassword={showNewPassword}
          disabled={isLoading}
          placeholder="At least 8 characters"
          onChange={(value) => {
            setNewPassword(value);
            setError("");
          }}
          onToggle={() =>
            setShowNewPassword((current) => !current)
          }
        />

        <div>
          <label
            htmlFor="confirmPassword"
            className="mb-2 block text-sm font-semibold text-slate-200"
          >
            Confirm new password
          </label>

          <input
            id="confirmPassword"
            type={showNewPassword ? "text" : "password"}
            required
            minLength={8}
            disabled={isLoading}
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setError("");
            }}
            placeholder="Enter the new password again"
            className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:opacity-60"
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
          <input
            type="checkbox"
            checked={revokeOtherSessions}
            disabled={isLoading}
            onChange={(event) =>
              setRevokeOtherSessions(event.target.checked)
            }
            className="mt-1 h-4 w-4 accent-cyan-400"
          />

          <span>
            <span className="block text-sm font-semibold text-white">
              Sign out other devices
            </span>

            <span className="mt-1 block text-xs leading-5 text-slate-300">
              End other active sessions after changing the
              password.
            </span>
          </span>
        </label>

        {error && (
          <div className="rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm font-medium text-red-100 backdrop-blur-xl">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading
            ? "Changing password..."
            : "Change password"}
        </button>
      </form>
    </GlassBackground>
  );
}

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  showPassword: boolean;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onToggle: () => void;
};

function PasswordField({
  id,
  label,
  value,
  showPassword,
  disabled,
  placeholder,
  onChange,
  onToggle,
}: PasswordFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-semibold text-slate-200"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          required
          minLength={8}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 pr-20 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:opacity-60"
        />

        <button
          type="button"
          disabled={disabled}
          onClick={onToggle}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-cyan-300 hover:text-cyan-100"
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

type GlassBackgroundProps = {
  children: React.ReactNode;
  maxWidth?: string;
};

function GlassBackground({
  children,
  maxWidth = "max-w-md",
}: GlassBackgroundProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <section
        className={`relative z-10 w-full ${maxWidth} rounded-[30px] border border-white/15 bg-white/10 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10`}
      >
        {children}
      </section>
    </main>
  );
}
