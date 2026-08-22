"use client";

import { useEffect, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Secretary = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string;
  status: string;
};

/*
  Who the administration assigned as this doctor's secretary.

  Read only on purpose. Employing and removing staff is an
  administrative decision, and a doctor who could create logins for the
  application they work in would be minting accounts nobody reviewed.
*/
export default function SecretaryCard() {
  const [secretary, setSecretary] = useState<Secretary | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/doctor/secretary`,
        { credentials: "include" },
      );

      const data = await response.json();

      if (data.success) setSecretary(data.secretary);
    } catch {
      /* An empty card is a better failure than an error banner here. */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return null;

  return (
    <section className="mt-6 rounded-3xl border border-white/20 bg-white/[0.07] p-7 backdrop-blur-2xl">
      <h2 className="text-lg font-black text-white">Your secretary</h2>

      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        A secretary books, moves and cancels appointments in your
        calendar. They cannot open a study, an AI result or a report:
        arranging a visit never requires reading a patient&apos;s
        medical record.
      </p>

      {secretary ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/15 bg-white/[0.05] p-5">
          <div>
            <p className="font-black text-white">{secretary.fullName}</p>
            <p className="mt-1 text-sm text-slate-400">
              {secretary.email}
              {secretary.phone ? ` · ${secretary.phone}` : ""}
            </p>
          </div>

          {/*
            Removing a secretary is an administrative action, like
            employing one. A doctor sees who is assigned to them; the
            administration decides whether they stay.
          */}
          <span className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-bold text-slate-400">
            Assigned by the administration
          </span>
        </div>
      ) : (
        /*
          A doctor no longer creates this account. Employing staff is an
          administrative decision, so the page says who to ask rather
          than offering a form that would be refused by the server.
        */
        <p className="mt-5 rounded-2xl border border-white/15 bg-white/[0.05] px-5 py-4 text-sm leading-6 text-slate-300">
          No secretary is assigned to you. The administration employs
          secretaries and attaches them to a doctor, so ask them to set
          one up for you.
        </p>
      )}

    </section>
  );
}
