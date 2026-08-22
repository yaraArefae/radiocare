"use client";

import { useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

/*
  The way out of a scan the AI closed.

  A study the model read as normal, uploaded by somebody who reported no
  symptoms, never reaches a doctor. That keeps a clinic queue for the
  cases that need one, and it is also the single place this application
  can be wrong with nobody watching: the chest model is right about
  seven times in ten, so a normal reading is not proof of a normal
  chest.

  So the card says the number out loud rather than reassuring. A patient
  who feels unwell should not be talked out of asking, and the decision
  is theirs, not the model's.
*/
export default function SendToDoctorCard({
  studyId,
  onSent,
}: {
  studyId: string;
  onSent?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/studies/${studyId}/send-to-doctor`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "This could not be sent.");
      }

      setSent(true);
      onSent?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "This could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-3xl border border-emerald-300/25 bg-emerald-400/10 p-5">
        <p className="font-black text-emerald-50">
          This study is now with a doctor
        </p>

        <p className="mt-2 text-sm leading-6 text-emerald-100/80">
          It has joined the queue of its clinic. You will be told when it
          has been read.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/15 bg-white/[0.06] p-5">
      <p className="font-black text-white">
        No doctor has read this study
      </p>

      <p className="mt-2 text-sm leading-6 text-slate-300">
        The AI found nothing on the image, and you did not report any
        symptoms when you uploaded it, so it was not sent to anybody.
      </p>

      <p className="mt-3 text-sm leading-6 text-amber-100/90">
        The AI reads the picture and nothing else. If something is
        bothering you, say so here and a doctor will read it, whatever
        the AI said.
      </p>

      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={3}
        placeholder="What is bothering you? Pain, cough, shortness of breath, how long it has been going on..."
        className="mt-4 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15"
      />

      {error ? (
        <p className="mt-3 text-sm font-bold text-rose-200">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={() => void send()}
        disabled={busy}
        className="mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3 font-black text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Sending..." : "Send this study to a doctor"}
      </button>

      <p className="mt-3 text-xs leading-5 text-slate-400">
        You can send it with the box empty. Nothing here is required.
      </p>
    </div>
  );
}
