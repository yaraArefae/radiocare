"use client";

import { useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

/*
  Withdraws a secretary's access, or gives it back.

  This sits beside the remove button rather than replacing it, and it is
  the one an administrator should reach for first. Removing deletes the
  login; the appointments she booked record who booked them, and a
  booking made by an id that resolves to nobody leaves a patient asking
  who moved their appointment with no answer.

  Two clicks, and the wording says what survives before the first one,
  because the question an administrator actually has at that moment is
  whether the bookings go too. They do not.
*/
export default function SecretaryAccessButton({
  secretaryId,
  name,
  doctorName,
  initialStatus = "Active",
  onChanged,
}: {
  secretaryId: string;
  name: string;
  doctorName: string | null;
  initialStatus?: string;
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  /*
    'Suspended' is not the same as 'Revoked'. The first happens on its
    own when her doctor loses access, and it comes back when he does.
    Offering to restore it here would be offering something this button
    cannot deliver.
  */
  const suspendedWithDoctor = status === "Suspended";
  const revoked = status === "Revoked";

  async function apply(action: "revoke" | "restore") {
    setBusy(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/secretaries/${secretaryId}/access`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message ?? "This could not be changed.");
      }

      setStatus(data.status);
      setConfirming(false);
      setReason("");
      setMessage(data.message);
      onChanged?.();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "This could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="w-full rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4">
        <p className="font-bold text-rose-100">
          Withdraw access for {name}?
        </p>

        <p className="mt-2 text-xs leading-5 text-rose-100/80">
          She stops being able to sign in and stops being able to book,
          move or cancel anything. The appointments she already made stay
          exactly as they are, and{" "}
          {doctorName ?? "her doctor"} keeps the calendar.
        </p>

        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (optional, kept on the account)"
          className="mt-3 w-full rounded-xl border border-white/20 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none"
        />

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => apply("revoke")}
            disabled={busy}
            className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-black text-white transition hover:bg-rose-400 disabled:opacity-50"
          >
            {busy ? "Working..." : "Yes, withdraw"}
          </button>

          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-slate-200"
          >
            Keep access
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {message ? (
        <span
          className={`text-xs font-bold ${
            failed ? "text-rose-200" : "text-emerald-200"
          }`}
        >
          {message}
        </span>
      ) : null}

      {suspendedWithDoctor ? (
        <span className="rounded-lg border border-amber-300/30 bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-100">
          Suspended with her doctor
        </span>
      ) : revoked ? (
        <>
          <span className="rounded-lg border border-rose-300/30 bg-rose-500/15 px-3 py-1 text-xs font-black text-rose-100">
            Access withdrawn
          </span>

          <button
            type="button"
            onClick={() => apply("restore")}
            disabled={busy}
            className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-100 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {busy ? "Working..." : "Restore access"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-500/20"
        >
          Withdraw access
        </button>
      )}
    </div>
  );
}
