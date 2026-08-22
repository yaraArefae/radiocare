"use client";

import SecretaryAccessButton from "@/components/SecretaryAccessButton";

import Link from "next/link";
import { useEffect, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Secretary = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string;
  status: string;
  doctorName: string | null;
};

type DoctorOption = {
  userId: string;
  fullName: string;
  specialty: string;
  hasSecretary: boolean;
};

/*
  Employing a secretary and attaching them to a doctor.

  This lives with the administration rather than in a doctor's own
  pages: an account that can move appointments is staff, and staff are
  hired by the people who run the clinic. A doctor sees who was assigned
  to them and cannot create the login themselves.
*/
export default function AdminSecretariesPage() {
  const [secretaries, setSecretaries] = useState<Secretary[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [removingId, setRemovingId] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [doctorUserId, setDoctorUserId] = useState("");

  async function load() {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/secretaries`,
        { credentials: "include" },
      );

      const data = await response.json();

      if (!data.success) {
        setFailed(true);
        setMessage(data.message ?? "This could not be loaded.");
        return;
      }

      setSecretaries(data.secretaries ?? []);
      setDoctors(data.doctors ?? []);
    } catch {
      setFailed(true);
      setMessage("This could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/secretaries`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName,
            email,
            phone,
            password,
            doctorUserId,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "The account could not be created.");
      }

      setMessage(data.message);
      setFullName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setDoctorUserId("");
      await load();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The account could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(secretaryId: string) {
    setBusy(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/secretaries`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secretaryId }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "The account could not be removed.");
      }

      setMessage(data.message);
      setRemovingId("");
      await load();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The account could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const available = doctors.filter((doctor) => !doctor.hasSecretary);

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50"
        >
          ← Back to the administration
        </Link>

        <h1 className="text-3xl font-black text-white">Secretaries</h1>

        <p className="mt-2 max-w-3xl leading-7 text-slate-300">
          A secretary works for exactly one doctor and manages that
          doctor&apos;s calendar: booking, moving and cancelling
          appointments. They cannot open a study, an AI result or a
          report.
        </p>

        <section className="mt-7 rounded-3xl border border-white/20 bg-white/[0.07] p-7 backdrop-blur-2xl">
          <h2 className="text-lg font-black text-white">
            Employ a secretary
          </h2>

          {available.length === 0 && !loading ? (
            <p className="mt-3 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-4 text-slate-300">
              Every active doctor already has a secretary. Remove one
              below to assign somebody else.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold text-slate-200">
                  Works for
                </label>
                <select
                  value={doctorUserId}
                  onChange={(event) => setDoctorUserId(event.target.value)}
                  className="w-full rounded-2xl border border-white/15 bg-[#0a2450] px-4 py-3 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  <option value="">Choose a doctor</option>
                  {available.map((doctor) => (
                    <option key={doctor.userId} value={doctor.userId}>
                      {doctor.fullName}
                      {doctor.specialty ? ` — ${doctor.specialty}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Full name"
                className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />

              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="Email they sign in with"
                className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />

              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Phone (optional)"
                className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />

              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="Password, at least 8 characters"
                className="rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />

              <div className="sm:col-span-2">
                {/*
                  Handed over in person rather than emailed. A password
                  sent to whatever address was typed is a password sent
                  to whoever owns that address.
                */}
                <p className="text-xs leading-5 text-slate-400">
                  Give this password to the secretary yourself. It is not
                  emailed anywhere.
                </p>

                <button
                  type="button"
                  onClick={create}
                  disabled={busy}
                  className="mt-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50"
                >
                  {busy ? "Creating..." : "Create the account"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-lg font-black text-white">
            Employed ({secretaries.length})
          </h2>

          {loading ? (
            <p className="mt-3 text-slate-300">Loading...</p>
          ) : secretaries.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-4 text-slate-400">
              No secretary has been employed yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-4">
              {secretaries.map((secretary) => (
                <article
                  key={secretary.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/15 bg-white/[0.06] p-5"
                >
                  <div>
                    <p className="font-black text-white">
                      {secretary.fullName}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {secretary.email}
                      {secretary.phone ? ` · ${secretary.phone}` : ""}
                    </p>
                    <p className="mt-1 text-sm font-bold text-cyan-200">
                      Works for {secretary.doctorName ?? "a removed doctor"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <SecretaryAccessButton
                      secretaryId={secretary.id}
                      name={secretary.fullName}
                      doctorName={secretary.doctorName ?? null}
                      initialStatus={secretary.status}
                      onChanged={() => void load()}
                    />
                  </div>

                  {removingId === secretary.id ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-rose-200">
                        Remove and delete their login?
                      </span>

                      <button
                        type="button"
                        onClick={() => remove(secretary.id)}
                        disabled={busy}
                        className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-black text-white transition hover:bg-rose-400 disabled:opacity-50"
                      >
                        Yes, remove
                      </button>

                      <button
                        type="button"
                        onClick={() => setRemovingId("")}
                        className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-slate-300"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRemovingId(secretary.id)}
                      className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-200 transition hover:bg-rose-400/20"
                    >
                      Remove
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {message ? (
          <p
            className={`mt-6 font-bold ${
              failed ? "text-rose-300" : "text-emerald-300"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
