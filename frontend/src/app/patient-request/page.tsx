"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type FormState = {
  fullName: string;
  email: string;
  phone: string;
  nationalId: string;
  age: string;
  gender: string;
  symptoms: string;
  medicalHistory: string;
};

const emptyForm: FormState = {
  fullName: "",
  email: "",
  phone: "",
  nationalId: "",
  age: "",
  gender: "",
  symptoms: "",
  medicalHistory: "",
};

export default function PatientRequestPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSent, setIsSent] = useState(false);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsSending(true);
      setErrorMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/patient-requests`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, age: Number(form.age) }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to send the request.");
      }

      setIsSent(true);
      setForm(emptyForm);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to send the request.",
      );
    } finally {
      setIsSending(false);
    }
  }

  if (isSent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] p-6">
        <section className="w-full max-w-lg rounded-3xl border border-white/20 bg-white/[0.08] p-10 text-center shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          <div className="text-6xl">✅</div>

          <h1 className="mt-5 text-3xl font-black text-white">
            Request sent
          </h1>

          <p className="mt-3 leading-7 text-slate-300">
            An administrator will review your information and create your
            account. You will receive your sign-in details by email.
          </p>

          <Link
            href="/"
            className="mt-7 inline-flex rounded-2xl border border-cyan-300/30 bg-cyan-400/20 px-6 py-3 font-bold text-white transition hover:bg-cyan-400/30"
          >
            Back to home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 transition hover:border-cyan-300/50 hover:text-white"
        >
          <span>←</span>
          <span>Back to home</span>
        </Link>

        <section className="mt-6 rounded-3xl border border-white/20 bg-white/[0.08] p-8 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            Patient registration
          </p>

          <h1 className="mt-2 text-3xl font-black text-white md:text-4xl">
            Request a patient account
          </h1>

          <p className="mt-3 leading-7 text-slate-300">
            Fill in your information and your symptoms. An administrator
            reviews the request and then sends you the sign-in details.
          </p>

          {errorMessage && (
            <p className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 font-bold text-rose-100">
              {errorMessage}
            </p>
          )}

          <form onSubmit={submitRequest} className="mt-7">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Full name"
                value={form.fullName}
                onChange={(value) => updateField("fullName", value)}
                required
              />

              <Field
                label="Email address"
                type="email"
                value={form.email}
                onChange={(value) => updateField("email", value)}
                required
              />

              <Field
                label="Phone number"
                value={form.phone}
                onChange={(value) => updateField("phone", value)}
              />

              <Field
                label="National ID"
                value={form.nationalId}
                onChange={(value) => updateField("nationalId", value)}
              />

              <Field
                label="Age"
                type="number"
                value={form.age}
                onChange={(value) => updateField("age", value)}
                required
              />

              <label className="block text-sm font-bold text-slate-200">
                Gender
                <select
                  value={form.gender}
                  onChange={(event) =>
                    updateField("gender", event.target.value)
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

            <label className="mt-5 block text-sm font-bold text-slate-200">
              Current symptoms
              <textarea
                rows={3}
                value={form.symptoms}
                onChange={(event) =>
                  updateField("symptoms", event.target.value)
                }
                placeholder="Pain in the right wrist after a fall, swelling for three days..."
                className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
              />
            </label>

            <label className="mt-5 block text-sm font-bold text-slate-200">
              Medical history
              <textarea
                rows={3}
                value={form.medicalHistory}
                onChange={(event) =>
                  updateField("medicalHistory", event.target.value)
                }
                placeholder="Chronic illnesses, previous surgeries, medication, allergies..."
                className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
              />
            </label>

            <button
              type="submit"
              disabled={isSending}
              className="mt-7 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-4 font-black text-white disabled:opacity-50"
            >
              {isSending ? "Sending..." : "Send registration request"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-bold text-slate-200">
      {label}
      {required && <span className="text-cyan-300"> *</span>}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
      />
    </label>
  );
}
