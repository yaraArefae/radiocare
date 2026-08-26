"use client";

import { useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

/*
  Withdraws an approved doctor's access, or gives it back.

  Two clicks, not one. This stops somebody signing in and stops cases
  reaching them, and a button that did it on the first click sits one
  slip of the mouse away from a clinic losing a reader mid shift.

  The wording says what survives, because the question an administrator
  actually has at this moment is whether the reports go too. They do
  not: nothing is deleted, and the button says so before it is pressed.
*/
export default function DoctorAccessButton({
  userId,
  name,
  initialStatus = "Active",
}: {
  userId: string;
  name: string;
  initialStatus?: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  /*
    Where this doctor's open cases go.

    Withdrawing a doctor decides something about their patients too: a
    case only reaches the doctor it was addressed to, so leaving them
    addressed to somebody who cannot sign in takes them out of the
    application entirely. Empty means "back to the clinic", which is the
    state a case is in when nobody was chosen.
  */
  const [transferTo, setTransferTo] = useState("");
  const [colleagues, setColleagues] = useState<
    Array<{ id: string; fullName: string; specialty?: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const revoked = status === "Revoked";

  /*
    The colleagues are fetched when the dialog opens rather than on
    render: most of the time nobody is being withdrawn, and a list of
    doctors is not worth a request per row of the page.
  */
  async function openConfirm() {
    setConfirming(true);

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/doctors/${userId}/access`,
        { credentials: "include", cache: "no-store" },
      );

      const data = await response.json();

      if (data?.success) setColleagues(data.colleagues ?? []);
    } catch (error) {
      /*
        The dialog still works without the list: leaving the choice
        empty returns the cases to their clinic, which is the safe
        answer anyway.
      */
      console.error("Unable to list the colleagues:", error);
    }
  }

  async function apply(action: "revoke" | "restore") {
    setBusy(true);
    setFailed(false);
    setMessage("");

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/doctors/${userId}/access`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason,
            transferToDoctorId: transferTo,
          }),
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
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "This could not be changed.",
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
          They stop being able to sign in and stop receiving new cases,
          and any visit that had not happened yet is cancelled. Their
          signed reports stay in the patient records, and the cases they
          had already read keep their name on them.
        </p>

        <label className="mt-3 block text-xs font-bold text-rose-100/90">
          Move their open cases to
          <select
            value={transferTo}
            onChange={(event) => setTransferTo(event.target.value)}
            className="mt-1 w-full rounded-xl border border-white/20 bg-[#0a2450] px-3 py-2 text-sm font-normal text-white focus:outline-none"
          >
            <option value="">
              Back to their clinic, for whoever works there
            </option>

            {colleagues.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.fullName}
                {doctor.specialty ? ` — ${doctor.specialty}` : ""}
              </option>
            ))}
          </select>
        </label>

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

      {revoked ? (
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
          onClick={() => void openConfirm()}
          className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-xs font-bold text-rose-100 transition hover:bg-rose-500/20"
        >
          Withdraw access
        </button>
      )}
    </div>
  );
}
