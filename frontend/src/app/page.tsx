"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useEffect } from "react";

import { authClient } from "@/client/auth/auth-client";

type UiRole = "admin" | "doctor" | "patient";

type SessionUser = {
  role?: string | string[] | null;
};

type RoleOption = {
  value: UiRole;
  label: string;
  shortLabel: string;
  description: string;
  emailLabel: string;
  emailPlaceholder: string;
  disclaimer: string;
};

const roleOptions: RoleOption[] = [
  {
    value: "patient",
    label: "Patient",
    shortLabel: "Patient",
    description:
      "Upload scans, view preliminary results, and follow your cases.",
    emailLabel: "Email address",
    emailPlaceholder: "Enter your patient email address",
    disclaimer:
      "AI results are preliminary decision-support information and must be reviewed by a qualified physician.",
  },
  {
    value: "doctor",
    label: "Doctor",
    shortLabel: "Doctor",
    description:
      "Review referred studies, confirm findings, and manage reports.",
    emailLabel: "Work email",
    emailPlaceholder: "Enter your registered work email",
    disclaimer:
      "AI findings support clinical review and do not replace the physician's final diagnosis.",
  },
  {
    value: "admin",
    label: "Admin",
    shortLabel: "Admin",
    description:
      "Manage users, doctors, specialties, permissions, and system activity.",
    emailLabel: "Admin email",
    emailPlaceholder: "Enter your administrator email",
    disclaimer:
      "Administrative access is restricted to approved RadioCare accounts and is monitored for security.",
  },
];

export default function Home() {
  const router = useRouter();

  const [selectedRole, setSelectedRole] = useState<UiRole>("patient");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordsByEmail, setPasswordsByEmail] = useState<Record<string, string>>({});
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [promptEmailKey, setPromptEmailKey] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const activeRole = useMemo(
    () =>
      roleOptions.find((option) => option.value === selectedRole) ??
      roleOptions[0],
    [selectedRole],
  );

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      const { error: loginError } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password: password.trim(),
        rememberMe,
      });

      if (loginError) {
        console.error("Better Auth sign-in error:", loginError);

        const loginErrorObject =
          typeof loginError === "object" && loginError !== null
            ? (loginError as Record<string, unknown>)
            : null;

        const detailedError = loginErrorObject
          ? Object.getOwnPropertyNames(loginErrorObject).reduce(
              (acc, key) => ({
                ...acc,
                [key]: (loginErrorObject as any)[key],
              }),
              {} as Record<string, unknown>,
            )
          : loginError;

        const loginErrorMessage =
          (loginErrorObject?.message as string) ||
          (loginErrorObject?.statusText as string) ||
          (loginErrorObject?.status as string) ||
          (typeof detailedError === "string" ? detailedError : JSON.stringify(detailedError, null, 2)) ||
          "Unable to sign in. Please try again.";

        // Surface the error to the user instead of only logging it
        setError(loginErrorMessage);
        setIsLoading(false);
        return;
      }

      /*
       * The selected button is only a UI choice.
       * We still verify the real account role returned by the server.
       */
      const sessionResult = await authClient.getSession();
      const sessionUser = sessionResult.data?.user as SessionUser | undefined;

      const accountRoles = (
        Array.isArray(sessionUser?.role)
          ? sessionUser.role
          : (sessionUser?.role ?? "").split(",")
      )
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

      const roleMatches =
        accountRoles.includes(selectedRole);

      if (!roleMatches) {
        await authClient.signOut();

        const actualRole = accountRoles[0];

        const actualRoleText = actualRole
          ? actualRole.charAt(0).toUpperCase() + actualRole.slice(1)
          : "another role";

        setError(
          `This account is registered as ${actualRoleText}. Please select the correct role and try again.`,
        );
        setIsLoading(false);
        return;
      }

      const roleRoutes: Record<UiRole, string> = {
        patient: "/patients/dashboard",
        doctor: "/doctor/clinic",
        admin: "/dashboard",
      };

      // If user chose to remember credentials, persist password for the email
      try {
        if (rememberMe && email.trim()) {
          savePasswordForEmail(email, password);
        }
      } catch (e) {
        // ignore storage errors
      }

      window.location.replace(roleRoutes[selectedRole]);
    } catch (loginError) {
      console.error("Login failed:", loginError);

      setError("Unable to sign in. Please try again.");
      setIsLoading(false);
    }
  }

  // Persist saved passwords map to localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("savedPasswords");
      if (raw) {
        setPasswordsByEmail(JSON.parse(raw));
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("savedPasswords", JSON.stringify(passwordsByEmail));
    } catch (e) {
      // ignore
    }
  }, [passwordsByEmail]);

  function savePasswordForEmail(key: string, pwd: string) {
    const normalized = key.trim().toLowerCase();
    if (!normalized) return;
    setPasswordsByEmail((prev) => ({ ...prev, [normalized]: pwd }));
    setShowSavePrompt(false);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-100 via-blue-100 to-cyan-100 p-4 sm:p-6">
      {/* Background decorations */}
      <div className="pointer-events-none absolute -left-32 top-5 h-[430px] w-[430px] rounded-full bg-blue-500/25 blur-[140px]" />

      <div className="pointer-events-none absolute -right-32 bottom-0 h-[450px] w-[450px] rounded-full bg-cyan-400/30 blur-[150px]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300/20 blur-[120px]" />

      {/* Main container */}
      <div className="relative z-10 grid w-full max-w-6xl overflow-hidden rounded-[30px] border border-white/60 shadow-[0_30px_90px_rgba(15,50,100,0.25)] lg:grid-cols-[0.9fr_1.1fr]">
        {/* Left image section */}
        <section className="relative hidden min-h-[760px] overflow-hidden lg:block">
          <Image
            src="/images/login-radiology.png"
            alt="Radiology medical imaging"
            fill
            priority
            sizes="45vw"
            className="object-cover object-center"
          />

          {/* Image overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-blue-950/25 via-blue-950/25 to-slate-950/90" />

          <div className="absolute inset-0 flex flex-col justify-between p-9 text-white">
            {/* Brand */}
            <div className="flex items-center">
              <div className="flex h-10 w-10 overflow-hidden rounded-[14px] border border-white/25 bg-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl">
                <Image
                  src="/images/radiocare-icon.png"
                  alt="RadioCare logo"
                  width={40}
                  height={40}
                  className="h-full w-full object-contain p-[3px]"
                  priority
                />
              </div>
            </div>

            {/* Save password prompt */}
            {showSavePrompt && promptEmailKey === email.trim().toLowerCase() && (
              <div className="mt-3 flex items-center gap-3 rounded-md border border-slate-200/20 bg-white/20 px-4 py-3">
                <p className="text-sm text-slate-800">Save password for this email?</p>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => savePasswordForEmail(promptEmailKey, password)}
                    className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white"
                  >
                    Yes
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowSavePrompt(false)}
                    className="rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium text-slate-800"
                  >
                    No
                  </button>
                </div>
              </div>
            )}

            {/* Image content */}
            <div>
              <span className="inline-flex rounded-full border border-cyan-200/30 bg-cyan-100/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-100 backdrop-blur-xl">
                AI-Powered Radiology
              </span>

              <h2 className="mt-5 text-4xl font-bold leading-tight">
                Smarter radiology.
                <br />
                Clearer decisions.
              </h2>

              <p className="mt-5 max-w-md text-base leading-7 text-slate-200">
                Analyze medical X-ray images from multiple body regions with
                AI-assisted findings and visual explanations.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <span className="rounded-full border border-white/20 bg-white/15 px-4 py-2 text-sm text-white backdrop-blur-xl">
                  Multi-region analysis
                </span>

                <span className="rounded-full border border-white/20 bg-white/15 px-4 py-2 text-sm text-white backdrop-blur-xl">
                  Doctor review
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Glass login section */}
        <section className="relative flex min-h-[760px] items-center overflow-hidden border-l border-white/40 bg-white/25 p-7 backdrop-blur-2xl sm:p-12">
          {/* Glass glow */}
          <div className="pointer-events-none absolute -right-28 top-20 h-72 w-72 rounded-full bg-cyan-300/25 blur-[100px]" />

          <div className="pointer-events-none absolute -left-24 bottom-20 h-72 w-72 rounded-full bg-blue-400/20 blur-[110px]" />

          <div className="relative z-10 mx-auto w-full max-w-md">
            {/* Mobile logo */}
            <div className="mb-7 lg:hidden">
              <div className="flex items-center">
                <div className="flex h-10 w-10 overflow-hidden rounded-[14px] border border-white/60 bg-white/30 shadow-lg backdrop-blur-xl">
                  <Image
                    src="/images/radiocare-icon.png"
                    alt="RadioCare logo"
                    width={40}
                    height={40}
                    className="h-full w-full object-contain p-[3px]"
                  />
                </div>
              </div>
            </div>

            {/* Heading */}
            <div>
              <p className="font-semibold text-blue-700">Welcome back</p>

              <h2 className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">
                Sign in to your account
              </h2>

              <p className="mt-3 text-sm leading-6 text-slate-600">
                Choose your account role, then enter your registered login
                information.
              </p>
            </div>

            {/* Login form */}
            <form onSubmit={handleLogin} className="mt-7 space-y-5">
              {/* Role selector */}
              <div>
                <p className="mb-2 block text-sm font-semibold text-slate-800">
                  Sign in as
                </p>

                <div
                  className="grid grid-cols-3 gap-2"
                  role="radiogroup"
                  aria-label="Choose account role"
                >
                  {roleOptions.map((option) => {
                    const isActive = selectedRole === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        disabled={isLoading}
                        onClick={() => {
                          setSelectedRole(option.value);
                          setError("");
                        }}
                        className={`rounded-xl border px-3 py-3 text-center text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          isActive
                            ? "border-blue-600 bg-blue-600 text-white shadow-[0_10px_25px_rgba(37,99,235,0.25)]"
                            : "border-white/70 bg-white/30 text-slate-700 hover:border-blue-300 hover:bg-white/50"
                        }`}
                      >
                        {option.shortLabel}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {activeRole.description}
                </p>

                {selectedRole === "doctor" && (
                  <div className="mt-4 rounded-2xl border border-cyan-300/40 bg-cyan-100/30 p-4 shadow-sm backdrop-blur-xl">
                    <p className="text-sm font-semibold text-slate-800">
                      Do not have an approved doctor account?
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Submit your professional information first.
                      After administrator approval, RadioCare will
                      create temporary login credentials valid for
                      24 hours.
                    </p>

                    <Link
                      href="/doctor-request"
                      className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-cyan-400/40 bg-white/45 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-white/70"
                    >
                      Submit Doctor Registration Request
                    </Link>

                    <p className="mt-3 text-xs leading-5 text-slate-600">
                      Already approved? Enter the email and
                      temporary password provided by the
                      administrator below.
                    </p>
                  </div>
                )}
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  {activeRole.emailLabel}
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
                    const newEmail = event.target.value;
                    setEmail(newEmail);
                    // restore saved password for this email if available
                    const key = newEmail.trim().toLowerCase();
                    const saved = passwordsByEmail[key] || "";
                    setPassword(saved);
                    setError("");
                  }}
                  placeholder={activeRole.emailPlaceholder}
                  className="w-full rounded-xl border border-white/70 bg-white/35 px-4 py-3.5 text-slate-950 shadow-sm outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus:border-cyan-400 focus:bg-white/50 focus:ring-4 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  Password
                </label>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    disabled={isLoading}
                    value={password}
                    onChange={(event) => {
                      const newPassword = event.target.value;
                      setPassword(newPassword);
                      setError("");
                    }}
                    onBlur={() => {
                      const key = email.trim().toLowerCase();
                      if (!key) return;

                      const existing = passwordsByEmail[key];
                      if (!existing && password) {
                        setPromptEmailKey(key);
                        setShowSavePrompt(true);
                      }
                    }}
                    placeholder={`Enter your ${activeRole.label.toLowerCase()} password`}
                    className="w-full rounded-xl border border-white/70 bg-white/35 px-4 py-3.5 pr-20 text-slate-950 shadow-sm outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus:border-cyan-400 focus:bg-white/50 focus:ring-4 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-blue-700 transition hover:text-blue-950 disabled:text-slate-400"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {/* Remember and forgot password */}
              <div className="flex items-center justify-between gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    disabled={isLoading}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 accent-blue-700"
                  />
                  Remember me
                </label>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => router.push("/forgot-password")}
                  className="text-sm font-semibold text-blue-700 transition hover:text-blue-950 disabled:text-slate-400"
                >
                  Forgot password?
                </button>
              </div>

              {/* Error */}
              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-300/50 bg-red-100/60 px-4 py-3 text-sm font-medium text-red-700 backdrop-blur-xl"
                >
                  {error}
                </div>
              )}

              {/* Sign in button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full rounded-xl border border-blue-300/40 bg-gradient-to-r from-blue-700 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_15px_40px_rgba(14,116,255,0.3)] transition hover:-translate-y-0.5 hover:from-blue-600 hover:to-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-300/25 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
              >
                {isLoading ? "Signing in..." : `Sign in as ${activeRole.label}`}
              </button>
            </form>

            {/* Disclaimer */}
            <div className="mt-6 rounded-xl border border-white/60 bg-white/25 p-4 shadow-sm backdrop-blur-xl">
              <p className="text-xs leading-5 text-blue-950">
                {activeRole.disclaimer}
              </p>
            </div>

            <p className="mt-6 text-center text-xs text-slate-600">
              © 2026 RadioCare. Graduation Project.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
