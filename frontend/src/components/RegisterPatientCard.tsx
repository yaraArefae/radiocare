"use client";

import { type FormEvent, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type RegisterForm = {
  fullName: string;
  email: string;
  phone: string;
  age: string;
  gender: string;
  symptoms: string;
  medicalHistory: string;
};

const emptyForm: RegisterForm = {
  fullName: "",
  email: "",
  phone: "",
  age: "",
  gender: "",
  symptoms: "",
  medicalHistory: "",
};

type Props = {
  onRegistered: () => void | Promise<void>;
};

/*
  Registers a patient who came to the clinic without sending a request.

  It creates the sign-in account and the clinical record together and
  emails the details. Creating a plain account instead would leave a
  patient without an age, a gender, or a history, which the doctor needs
  when the first image arrives.
*/
export default function RegisterPatientCard({ onRegistered }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<RegisterForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [result, setResult] = useState<{
    message: string;
    emailDelivered: boolean;
    credentials: {
      loginEmail: string;
      temporaryPassword: string;
      expiresAt: string;
    };
  } | null>(null);

  function update(field: keyof RegisterForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsSaving(true);
      setErrorText("");
      setResult(null);

      const response = await fetch(`${backendBaseUrl}/api/patients`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, age: Number(form.age) }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to register the patient.",
        );
      }

      setResult({
        message: data.message,
        emailDelivered: Boolean(data.emailDelivered),
        credentials: data.credentials,
      });

      setForm(emptyForm);
      await onRegistered();
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "Unable to register the patient.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-3xl border border-white/20 bg-white/[0.08] p-6 backdrop-blur-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Walk-in patient
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            Register a patient directly
          </h2>

          <p className="mt-2 text-sm text-slate-300">
            Creates the account and the clinical record, then emails the
            sign-in details to the patient.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/25"
        >
          {isOpen ? "Close" : "New patient"}
        </button>
      </div>

      {result && (
        <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-5">
          <p className="font-bold text-emerald-100">{result.message}</p>

          {!result.emailDelivered && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p className="rounded-xl border border-white/15 bg-black/20 p-3 text-sm text-white">
                Login email
                <span className="mt-1 block font-black">
                  {result.credentials.loginEmail}
                </span>
              </p>

              <p className="rounded-xl border border-white/15 bg-black/20 p-3 text-sm text-white">
                Temporary password
                <span className="mt-1 block break-all font-black">
                  {result.credentials.temporaryPassword}
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      {errorText && (
        <p className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
          {errorText}
        </p>
      )}

      {isOpen && (
        <form onSubmit={submit} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-slate-200">
              Full name *
              <input
                type="text"
                value={form.fullName}
                onChange={(event) =>
                  update("fullName", event.target.value)
                }
                required
                className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
              />
            </label>

            <label className="block text-sm font-bold text-slate-200">
              Email *
              <input
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                required
                className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
              />
            </label>

            <label className="block text-sm font-bold text-slate-200">
              Phone
              <input
                type="text"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-bold text-slate-200">
                Age *
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={form.age}
                  onChange={(event) => update("age", event.target.value)}
                  required
                  className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
                />
              </label>

              <label className="block text-sm font-bold text-slate-200">
                Gender *
                <select
                  value={form.gender}
                  onChange={(event) =>
                    update("gender", event.target.value)
                  }
                  required
                  className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
                >
                  <option value="">Select...</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
            </div>
          </div>

          <label className="mt-4 block text-sm font-bold text-slate-200">
            Current symptoms
            <textarea
              rows={2}
              value={form.symptoms}
              onChange={(event) => update("symptoms", event.target.value)}
              className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
            />
          </label>

          <label className="mt-4 block text-sm font-bold text-slate-200">
            Medical history
            <textarea
              rows={2}
              value={form.medicalHistory}
              onChange={(event) =>
                update("medicalHistory", event.target.value)
              }
              className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
            />
          </label>

          <button
            type="submit"
            disabled={isSaving}
            className="mt-5 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3.5 font-black text-white disabled:opacity-50"
          >
            {isSaving ? "Registering..." : "Register and email details"}
          </button>
        </form>
      )}
    </section>
  );
}
