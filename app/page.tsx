"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function Home() {
  const router = useRouter();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      const { error: loginError } =
        await authClient.signIn.email({
          email: email.trim().toLowerCase(),
          password,
          rememberMe,
        });

      if (loginError) {
        setError(
          loginError.message ||
            "Incorrect email address or password."
        );

        setIsLoading(false);
        return;
      }

      window.location.replace("/dashboard");
    } catch (loginError) {
      console.error("Login failed:", loginError);

      setError(
        "Unable to sign in. Please try again."
      );

      setIsLoading(false);
    }
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
        <section className="relative hidden min-h-[700px] overflow-hidden lg:block">
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
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/15 font-bold shadow-lg backdrop-blur-xl">
                RI
              </div>

              <div>
                <h1 className="text-xl font-bold">
                  RadiologyInsight AI
                </h1>

                <p className="text-sm text-slate-200">
                  Intelligent Medical Imaging Platform
                </p>
              </div>
            </div>

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
                Analyze medical X-ray images from multiple
                body regions with AI-assisted findings and
                visual explanations.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <span className="rounded-full border border-white/20 bg-white/15 px-4 py-2 text-sm text-white backdrop-blur-xl">
                  Multi-region analysis
                </span>

                <span className="rounded-full border border-white/20 bg-white/15 px-4 py-2 text-sm text-white backdrop-blur-xl">
                  Radiologist review
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Glass login section */}
        <section className="relative flex min-h-[700px] items-center overflow-hidden border-l border-white/40 bg-white/25 p-7 backdrop-blur-2xl sm:p-12">
          {/* Glass glow */}
          <div className="pointer-events-none absolute -right-28 top-20 h-72 w-72 rounded-full bg-cyan-300/25 blur-[100px]" />

          <div className="pointer-events-none absolute -left-24 bottom-20 h-72 w-72 rounded-full bg-blue-400/20 blur-[110px]" />

          <div className="relative z-10 mx-auto w-full max-w-md">
            {/* Mobile logo */}
            <div className="mb-9 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/60 bg-white/30 font-bold text-blue-900 shadow-lg backdrop-blur-xl">
                  RI
                </div>

                <div>
                  <h1 className="font-bold text-slate-900">
                    RadiologyInsight AI
                  </h1>

                  <p className="text-xs text-slate-600">
                    Intelligent Medical Imaging Platform
                  </p>
                </div>
              </div>
            </div>

            {/* Heading */}
            <div>
              <p className="font-semibold text-blue-700">
                Welcome back
              </p>

              <h2 className="mt-2 text-3xl font-bold text-slate-950 sm:text-4xl">
                Sign in to your account
              </h2>

              <p className="mt-4 text-sm leading-6 text-slate-600">
                Enter your email address and password to
                access the radiology analysis platform.
              </p>
            </div>

            {/* Login form */}
            <form
              onSubmit={handleLogin}
              className="mt-9 space-y-6"
            >
              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-semibold text-slate-800"
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
                    setError("");
                  }}
                  placeholder="Enter your email address"
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
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    required
                    autoComplete="current-password"
                    disabled={isLoading}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-white/70 bg-white/35 px-4 py-3.5 pr-20 text-slate-950 shadow-sm outline-none backdrop-blur-xl transition placeholder:text-slate-500 focus:border-cyan-400 focus:bg-white/50 focus:ring-4 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />

                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() =>
                      setShowPassword(
                        (current) => !current
                      )
                    }
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
                    onChange={(event) =>
                      setRememberMe(
                        event.target.checked
                      )
                    }
                    className="h-4 w-4 accent-blue-700"
                  />

                  Remember me
                </label>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() =>
                    router.push("/forgot-password")
                  }
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
                {isLoading
                  ? "Signing in..."
                  : "Sign in"}
              </button>
            </form>

            {/* Disclaimer */}
            <div className="mt-8 rounded-xl border border-white/60 bg-white/25 p-4 shadow-sm backdrop-blur-xl">
              <p className="text-xs leading-5 text-blue-950">
                This platform is intended for authorized
                healthcare professionals. AI results are
                decision-support information and do not
                replace clinical diagnosis.
              </p>
            </div>

            <p className="mt-8 text-center text-xs text-slate-600">
              © 2026 RadiologyInsight AI. Graduation Project.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}