"use client";

import { useEffect, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type ReviewStatus = {
  canReview: boolean;
  alreadyRated: boolean;
  rating: number | null;
  doctorName: string | null;
};

/*
  Asks the patient what they thought of the reading they received.

  It appears only once the report is confirmed and only for the patient
  whose study it is. The server decides both of those; this component
  asks it rather than working them out from what happens to be on the
  page, so a rating form cannot be drawn for a study that has no report.

  Nothing is shown at all when there is nothing to ask. A permanent
  "rate us" box on every study would train patients to ignore it.
*/
export default function RateDoctor({ studyId }: { studyId: string }) {
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    fetch(`${BACKEND_URL}/api/studies/${studyId}/review`, {
      credentials: "include",
    })
      .then((response) => response.json())
      .then((data) => {
        if (active && data.success) setStatus(data);
      })
      .catch(() => {
        /* A rating prompt is not worth an error message of its own. */
      });

    return () => {
      active = false;
    };
  }, [studyId]);

  async function submit() {
    if (rating < 1) {
      setFailed(true);
      setMessage("Pick a number of stars first.");
      return;
    }

    setSaving(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/studies/${studyId}/review`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating, comment }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "Your rating could not be saved.");
      }

      setStatus({
        canReview: false,
        alreadyRated: true,
        rating,
        doctorName: status?.doctorName ?? null,
      });
      setMessage(data.message);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Your rating could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!status) return null;

  if (status.alreadyRated) {
    return (
      <section className="mt-6 rounded-3xl border border-emerald-300/25 bg-emerald-400/10 p-6">
        <p className="font-black text-emerald-100">
          You rated this reading
          {status.doctorName ? ` by ${status.doctorName}` : ""}
        </p>

        <p className="mt-2 text-2xl font-black text-amber-200">
          {"★".repeat(status.rating ?? 0)}
          <span className="text-white/20">
            {"★".repeat(5 - (status.rating ?? 0))}
          </span>
        </p>

        <p className="mt-2 text-sm leading-6 text-emerald-100/70">
          Your rating is part of the score other patients see on this
          doctor&apos;s profile.
        </p>
      </section>
    );
  }

  if (!status.canReview) return null;

  return (
    <section className="mt-6 rounded-3xl border border-white/20 bg-white/[0.07] p-6 backdrop-blur-2xl">
      <h2 className="text-lg font-black text-white">
        How was your reading
        {status.doctorName ? ` by ${status.doctorName}` : ""}?
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-400">
        Your rating is shown on this doctor&apos;s profile to other
        patients choosing who reads their study. You can rate a reading
        once.
      </p>

      <div className="mt-4 flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            aria-label={`${star} out of 5`}
            className={`text-3xl transition ${
              star <= (hovered || rating)
                ? "text-amber-300"
                : "text-white/20 hover:text-amber-200/60"
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Anything you want to add (optional)"
        className="mt-4 w-full rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
      />

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="mt-4 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-black text-white transition hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Send rating"}
      </button>

      {message ? (
        <p
          className={`mt-3 text-sm font-bold ${
            failed ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
