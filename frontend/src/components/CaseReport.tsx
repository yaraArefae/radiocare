"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

type ReportData = {
  id: string;
  studyId: string;
  doctorName: string;
  findings: string;
  impression: string;
  recommendations: string;
  aiAgreement: string;
  finalFinding: string;
  severity: string;
  followUpRequired: boolean;
  additionalTests: string;
  doctorNotes: string;
  status: string;
  approvedAt: string | null;
  updatedAt: string | null;
};

type Props = {
  studyId: string;
  mode: "doctor" | "patient";
  /* The preliminary AI result, shown next to the doctor decision. */
  aiResult?: string;
  onSaved?: (status: string) => void;
  /* Lets the page highlight the booking card while this is ticked. */
  onFollowUpChange?: (needsFollowUp: boolean) => void;
};

const aiAgreementOptions = [
  {
    value: "Confirmed",
    label: "Confirm the AI result",
    hint: "The AI finding matches what I see.",
  },
  {
    value: "Modified",
    label: "Modify the AI result",
    hint: "The finding is different from the AI suggestion.",
  },
  {
    value: "Rejected",
    label: "Reject the AI result",
    hint: "The AI finding is not present in this image.",
  },
];

const severityOptions = ["Low", "Moderate", "High", "Critical"];

const severityStyle: Record<string, string> = {
  Low: "border-emerald-300/30 bg-emerald-400/15 text-emerald-100",
  Moderate: "border-amber-300/30 bg-amber-400/15 text-amber-100",
  High: "border-orange-300/30 bg-orange-400/15 text-orange-100",
  Critical: "border-rose-300/30 bg-rose-500/15 text-rose-100",
};

const emptyReport: ReportData = {
  id: "",
  studyId: "",
  doctorName: "",
  findings: "",
  impression: "",
  recommendations: "",
  aiAgreement: "",
  finalFinding: "",
  severity: "",
  followUpRequired: false,
  additionalTests: "",
  doctorNotes: "",
  status: "Draft",
  approvedAt: null,
  updatedAt: null,
};

export default function CaseReport({
  studyId,
  mode,
  aiResult,
  onSaved,
  onFollowUpChange,
}: Props) {
  const [report, setReport] = useState<ReportData>(emptyReport);
  const [hasReport, setHasReport] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadReport = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/studies/${encodeURIComponent(
          studyId,
        )}/report`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the report.");
      }

      setIsPending(Boolean(data.pending));

      if (data.report) {
        setReport({ ...emptyReport, ...data.report });
        setHasReport(true);
        onFollowUpChange?.(Boolean(data.report.followUpRequired));
      } else {
        setHasReport(false);
      }

      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the report.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [onFollowUpChange, studyId]);

  useEffect(() => {
    setIsLoading(true);
    void loadReport();
  }, [loadReport]);

  async function saveReport(status: "Draft" | "Approved") {
    try {
      setIsSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/studies/${encodeURIComponent(
          studyId,
        )}/report`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...report, status }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to save the report.");
      }

      setReport((current) => ({ ...current, status }));
      setHasReport(true);

      setSuccessMessage(
        status === "Approved"
          ? "The report was approved and is now visible to the patient."
          : "The draft was saved. The patient cannot see it yet.",
      );

      onSaved?.(status);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the report.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveReport("Approved");
  }

  const isApproved = report.status === "Approved";

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 text-center backdrop-blur-2xl">
        <p className="font-bold text-slate-300">Loading the report...</p>
      </section>
    );
  }

  /*
    Patient view: read only, and only after the doctor approved it.
  */
  if (mode === "patient") {
    if (!hasReport) {
      return (
        <section className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Medical report
          </p>

          <p className="mt-3 text-slate-300">
            {isPending
              ? "Your doctor is still preparing the report for this case."
              : "No report has been written for this case yet."}
          </p>
        </section>
      );
    }

    return (
      <section className="rounded-3xl border border-emerald-300/25 bg-emerald-400/[0.07] p-6 backdrop-blur-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">
              Final medical report
            </p>

            <h3 className="mt-2 text-2xl font-black text-white">
              {report.finalFinding || "Reviewed"}
            </h3>

            <p className="mt-1 text-sm text-slate-300">
              By {report.doctorName || "your doctor"}
              {report.approvedAt
                ? ` · ${new Date(report.approvedAt).toLocaleDateString()}`
                : ""}
            </p>
          </div>

          {report.severity && (
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                severityStyle[report.severity] ??
                "border-white/20 bg-white/10 text-slate-200"
              }`}
            >
              Severity: {report.severity}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ReportField label="Findings" value={report.findings} />
          <ReportField label="Impression" value={report.impression} />
          <ReportField
            label="Recommendations"
            value={report.recommendations}
          />
          <ReportField
            label="Additional tests"
            value={report.additionalTests}
          />
        </div>

        {report.followUpRequired && (
          <p className="mt-5 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 p-4 text-sm font-bold text-cyan-100">
            Your doctor asked for a follow-up visit. Check your appointments
            section.
          </p>
        )}
      </section>
    );
  }

  /*
    Doctor view: the decision on the AI result plus the report itself.
  */
  return (
    <section className="rounded-3xl border border-white/15 bg-white/[0.06] p-6 backdrop-blur-2xl md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Doctor decision
          </p>

          <h3 className="mt-2 text-2xl font-black text-white">
            Medical report
          </h3>

          {aiResult && (
            <p className="mt-2 text-sm text-slate-400">
              Preliminary AI result:{" "}
              <span className="font-bold text-slate-200">{aiResult}</span>
            </p>
          )}
        </div>

        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-black ${
            isApproved
              ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
              : "border-amber-300/30 bg-amber-400/15 text-amber-100"
          }`}
        >
          {isApproved ? "Approved" : hasReport ? "Draft" : "Not started"}
        </span>
      </div>

      {errorMessage && (
        <p className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
          {errorMessage}
        </p>
      )}

      {successMessage && (
        <p className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100">
          {successMessage}
        </p>
      )}

      {isApproved && (
        <p className="mt-5 rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 text-sm text-slate-300">
          This report is approved and visible to the patient. Saving again
          updates it.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6">
        <fieldset>
          <legend className="text-sm font-bold text-slate-200">
            Your decision about the AI result
          </legend>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {aiAgreementOptions.map((option) => (
              <label
                key={option.value}
                className={[
                  "cursor-pointer rounded-2xl border p-4 transition",
                  report.aiAgreement === option.value
                    ? "border-cyan-300/60 bg-cyan-400/15"
                    : "border-white/15 bg-white/[0.04] hover:border-cyan-300/35",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="ai-agreement"
                  value={option.value}
                  checked={report.aiAgreement === option.value}
                  onChange={(event) =>
                    setReport((current) => ({
                      ...current,
                      aiAgreement: event.target.value,
                    }))
                  }
                  className="sr-only"
                />

                <span className="block font-black text-white">
                  {option.label}
                </span>

                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  {option.hint}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-200">
            Final finding
            <input
              type="text"
              value={report.finalFinding}
              onChange={(event) =>
                setReport((current) => ({
                  ...current,
                  finalFinding: event.target.value,
                }))
              }
              placeholder="Confirmed distal radius fracture"
              maxLength={255}
              className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
            />
          </label>

          <label className="block text-sm font-bold text-slate-200">
            Severity
            <select
              value={report.severity}
              onChange={(event) =>
                setReport((current) => ({
                  ...current,
                  severity: event.target.value,
                }))
              }
              className="mt-2 w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3 font-normal text-white outline-none focus:border-cyan-300/60"
            >
              <option value="">Not set</option>

              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block text-sm font-bold text-slate-200">
          Findings
          <textarea
            rows={3}
            value={report.findings}
            onChange={(event) =>
              setReport((current) => ({
                ...current,
                findings: event.target.value,
              }))
            }
            placeholder="What you see in the image..."
            className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />
        </label>

        <label className="mt-4 block text-sm font-bold text-slate-200">
          Impression
          <textarea
            rows={3}
            value={report.impression}
            onChange={(event) =>
              setReport((current) => ({
                ...current,
                impression: event.target.value,
              }))
            }
            placeholder="The medical conclusion for this case..."
            className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />
        </label>

        <label className="mt-4 block text-sm font-bold text-slate-200">
          Recommendations
          <textarea
            rows={2}
            value={report.recommendations}
            onChange={(event) =>
              setReport((current) => ({
                ...current,
                recommendations: event.target.value,
              }))
            }
            placeholder="Treatment, rest, referral..."
            className="mt-2 w-full resize-none rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />
        </label>

        <label className="mt-4 block text-sm font-bold text-slate-200">
          Additional tests needed
          <input
            type="text"
            value={report.additionalTests}
            onChange={(event) =>
              setReport((current) => ({
                ...current,
                additionalTests: event.target.value,
              }))
            }
            placeholder="CT scan, lateral view, blood test..."
            className="mt-2 w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 font-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
          />
        </label>

        <label className="mt-4 flex items-center gap-3 text-sm font-bold text-slate-200">
          <input
            type="checkbox"
            checked={report.followUpRequired}
            onChange={(event) => {
              setReport((current) => ({
                ...current,
                followUpRequired: event.target.checked,
              }));
              onFollowUpChange?.(event.target.checked);
            }}
            className="h-5 w-5 rounded border-white/30 bg-white/10"
          />
          A follow-up visit is required
        </label>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3.5 font-black text-white disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Approve and send to patient"}
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void saveReport("Draft")}
            className="rounded-2xl border border-white/20 bg-white/[0.07] px-6 py-3.5 font-bold text-slate-200 transition hover:text-white disabled:opacity-50"
          >
            Save draft
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-400">
          The patient only sees the report after you approve it. Your
          decision replaces the preliminary AI result.
        </p>
      </form>
    </section>
  );
}

function ReportField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  if (!value) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>

      <p className="mt-2 whitespace-pre-wrap leading-6 text-slate-100">
        {value}
      </p>
    </div>
  );
}
