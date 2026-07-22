"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/client/auth/auth-client";

export default function SetupPage() {
  const router = useRouter();

  const [name, setName] = useState("System Administrator");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setMessage("");

    if (!name.trim() || !email.trim() || !password) {
      setMessage("Please complete all fields.");
      return;
    }

    if (password.length < 8) {
      setMessage(
        "Password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        setMessage(
          error.message ||
            "The administrator account could not be created."
        );
        return;
      }

      await authClient.signOut();

      router.replace("/?setup=completed");
      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-blue-950 p-5 text-white">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-lg rounded-[30px] border border-white/15 bg-white/10 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-10"
      >
        <div className="flex h-14 w-14 overflow-hidden rounded-[18px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
          <Image
            src="/images/radiocare-icon.png"
            alt="RadioCare logo"
            width={56}
            height={56}
            className="h-full w-full object-contain p-1"
          />
        </div>

        <p className="mt-7 font-semibold text-cyan-300">
          System configuration
        </p>

        <h1 className="mt-2 text-3xl font-bold text-white">
          Initial system setup
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          Create the first administrator account for
          RadioCare.
        </p>

        <div className="mt-8 space-y-5">
          <SetupField
            label="Administrator name"
            type="text"
            value={name}
            placeholder="Enter administrator name"
            onChange={setName}
          />

          <SetupField
            label="Email address"
            type="email"
            value={email}
            placeholder="admin@example.com"
            onChange={setEmail}
          />

          <SetupField
            label="Password"
            type="password"
            value={password}
            placeholder="At least 8 characters"
            onChange={setPassword}
          />

          <SetupField
            label="Confirm password"
            type="password"
            value={confirmPassword}
            placeholder="Enter the password again"
            onChange={setConfirmPassword}
          />
        </div>

        {message && (
          <div className="mt-5 rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100 backdrop-blur-xl">
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="mt-6 w-full rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-60"
        >
          {isLoading
            ? "Creating administrator..."
            : "Create administrator account"}
        </button>

        <p className="mt-5 text-center text-xs text-slate-400">
          This page can create the first account only.
        </p>
      </form>
    </main>
  );
}

type SetupFieldProps = {
  label: string;
  type: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

function SetupField({
  label,
  type,
  value,
  placeholder,
  onChange,
}: SetupFieldProps) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type={type}
        value={value}
        required
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10"
      />
    </label>
  );
}
