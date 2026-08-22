"use client";
import CaseChat from "@/components/CaseChat";
import CaseReport from "@/components/CaseReport";
import VolumeViewer from "@/components/VolumeViewer";
import NotificationBell from "@/components/NotificationBell";
import SendToDoctorCard from "@/components/SendToDoctorCard";
import StudyAppointment from "@/components/StudyAppointment";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type AiFinding = {
  name: string;
  probability: number;
  threshold?: number;
  detected?: boolean;
  model?: string;
};

type AiDetailsPayload = {
  schemaVersion?: number;
  triageResult?: string;
  primaryFinding?: string | null;
  possibleFindings?: AiFinding[];
  allFindings?: AiFinding[];
  aiPriority?: string;
  detectedRegion?: string;
  detectedClinic?: string;
  message?: string;
  /*
    Present only when the study was read by a model that answers normal
    or abnormal without naming a finding, which is why its finding lists
    are empty. Older studies were saved before these were stored and do
    not carry them.
  */
  abnormalityProbability?: number;
  decisionThreshold?: number;
};

type StudyDetails = {
  id: string;
  patientId?: string;
  patient?: string;
  patientName?: string;
  age?: number;
  gender?: string;
  bodyRegion?: string;
  imagingView?: string;
  view?: string;
  /*
    "VOLUME" for a CT or MRI stack, "IMAGE" for a single film. A volume
    cannot be drawn in an image tag, so the page has to know which of
    the two it was handed before it tries.
  */
  studyKind?: string | null;
  originalFileName?: string | null;
  priority?: string;
  status?: string;
  clinicalNotes?: string | null;
  symptoms?: string | null;
  medicalHistory?: string | null;
  clinicKey?: string | null;
  aiResult?: string | null;
  predictedFinding?: string | null;
  triageResult?: string | null;
  primaryFinding?: string | null;
  possibleFindings?: AiFinding[];
  allFindings?: AiFinding[];
  aiPriority?: string | null;
  detectedRegion?: string | null;
  detectedClinic?: string | null;
  confidence?: number | null;
  explanation?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  createdAt?: string;
  date?: string;
};

function parseAiDetails(
  explanation?: string | null,
): AiDetailsPayload | null {
  if (!explanation) {
    return null;
  }

  try {
    const parsedValue: unknown = JSON.parse(
      explanation,
    );

    if (
      typeof parsedValue !== "object" ||
      parsedValue === null
    ) {
      return null;
    }

    return parsedValue as AiDetailsPayload;
  } catch {
    return null;
  }
}

function formatProbability(
  probability: number,
) {
  return `${Number(probability).toFixed(2)}%`;
}

/*
  Region codes come from the AI service, and the doctor reads them. The
  hand and wrist clinic has three of them, because its router separates
  a hand from a wrist and reports a film that shows both as a hand with
  the wrist. A code that is not listed is shown as it arrived.
*/
const REGION_LABELS: Record<string, string> = {
  HAND: "Hand",
  WRIST: "Wrist",
  HAND_WITH_WRIST: "Hand with wrist",
  HAND_WRIST: "Hand & Wrist",
  CHEST: "Chest",
  SHOULDER: "Shoulder",
  SPINE: "Spine",
  PELVIS_HIP: "Pelvis & Hip",
  LOWER_LIMB: "Lower Limb",
};

function formatRegion(region: string) {
  return (
    REGION_LABELS[region.toUpperCase()] ??
    region
  );
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000";

export default function StudyDetailsPage() {
  const params = useParams<{ id: string }>();
  const studyId = params.id;

  const [study, setStudy] =
    useState<StudyDetails | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [errorMessage, setErrorMessage] =
    useState("");

  const [imageFailed, setImageFailed] =
    useState(false);

  /*
    Turned on by the report when the doctor ticks "a follow-up visit is
    required", so the booking card beside it stands out.
  */
  const [needsFollowUp, setNeedsFollowUp] =
    useState(false);

  useEffect(() => {
    async function loadStudy() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const response = await fetch(
          `${BACKEND_URL}/api/studies/${studyId}`,
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ??
              "Unable to load study details.",
          );
        }

        setStudy(
          data.study ??
            data,
        );
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load study details.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    if (studyId) {
      void loadStudy();
    }
  }, [studyId]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#071a38]">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

          <p className="mt-5 font-bold text-white">
            Loading study...
          </p>
        </div>
      </main>
    );
  }

  if (errorMessage || !study) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#071a38] px-5">
        <div className="w-full max-w-xl rounded-3xl border border-rose-300/30 bg-white/[0.08] p-8 text-center backdrop-blur-2xl">
          <div className="text-5xl">⚠️</div>

          <h1 className="mt-5 text-2xl font-black text-white">
            Study could not be loaded
          </h1>

          <p className="mt-3 text-rose-200">
            {errorMessage}
          </p>

          <Link
            href="/studies?clinic=chest"
            className="mt-7 inline-flex rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3 font-black text-white"
          >
            Back to Studies
          </Link>
        </div>
      </main>
    );
  }

  const aiDetails = parseAiDetails(
    study.explanation,
  );

  const aiResult =
    study.aiResult ??
    study.predictedFinding ??
    "Not analyzed yet";

  const triageResult =
    study.triageResult ??
    aiDetails?.triageResult ??
    aiResult;

  const primaryFinding =
    study.primaryFinding ??
    aiDetails?.primaryFinding ??
    null;

  const possibleFindings =
    study.possibleFindings ??
    aiDetails?.possibleFindings ??
    [];

  const allFindings =
    study.allFindings ??
    aiDetails?.allFindings ??
    [];

  /*
    A reading that carries a score but no findings came from a model
    that answers normal or abnormal without naming a finding. It has to
    be shown differently: telling the doctor that "no supported finding
    exceeded its threshold" would describe a search that never happened.
  */
  const abnormalityProbability =
    aiDetails?.abnormalityProbability;

  const decisionThreshold =
    aiDetails?.decisionThreshold;

  const isTriageOnlyReading =
    possibleFindings.length === 0 &&
    allFindings.length === 0 &&
    abnormalityProbability !== undefined;

  const aiPriority =
    study.aiPriority ??
    aiDetails?.aiPriority ??
    study.priority ??
    "ROUTINE";

  const detectedRegionCode =
    study.detectedRegion ??
    aiDetails?.detectedRegion ??
    study.bodyRegion ??
    "";

  const detectedRegion = detectedRegionCode
    ? formatRegion(detectedRegionCode)
    : "—";

  const detectedClinic =
    study.detectedClinic ??
    aiDetails?.detectedClinic ??
    "—";

  const aiMessage =
    aiDetails?.message ??
    (
      aiDetails
        ? null
        : study.explanation
    );

  const patientName =
    study.patient ??
    study.patientName ??
    "RadioCare Patient";

  const imagingView =
    study.imagingView ??
    study.view ??
    "X-ray";

  const isVolumeStudy =
    study.studyKind === "VOLUME";

  const resultStyle =
    triageResult === "NORMAL"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
      : triageResult === "ABNORMAL"
        ? "border-rose-300/30 bg-rose-400/10 text-rose-200"
        : "border-amber-300/30 bg-amber-400/10 text-amber-200";

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href={`/studies?clinic=${encodeURIComponent(
              study.clinicKey ?? "",
            )}`}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:bg-white/[0.12]"
          >
            ← Back to Studies
          </Link>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-4 py-2 text-sm font-black ${resultStyle}`}
            >
              {study.status ?? "Waiting"}
            </span>

            <NotificationBell />
          </div>
        </div>

        {/*
          A study nobody was asked to read says so first, above its own
          details. Buried lower down it would read as a footnote to a
          result, and it is not a footnote: it is the fact that there is
          no result.
        */}
        {study.status === "Cleared" ? (
          <div className="mt-6">
            <SendToDoctorCard
              studyId={String(study.id)}
              onSent={() =>
                setStudy((current) =>
                  current ? { ...current, status: "Needs Review" } : current,
                )
              }
            />
          </div>
        ) : null}

        <section className="mt-6 rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-2xl backdrop-blur-2xl md:p-9">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Study Details
          </p>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-white md:text-4xl">
                {study.id}
              </h1>

              <p className="mt-2 text-slate-300">
                {patientName} · {study.bodyRegion ?? "CHEST"} ·{" "}
                {imagingView}
              </p>
            </div>

            <div
              className={`rounded-2xl border px-5 py-3 font-black ${resultStyle}`}
            >
              AI Result: {triageResult}
            </div>
          </div>
        </section>

        <div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-xl backdrop-blur-2xl">
            <h2 className="text-2xl font-black text-white">
              {isVolumeStudy ? "Imaging Study" : "X-ray Image"}
            </h2>

            <div className="mt-5 flex min-h-[500px] items-center justify-center overflow-hidden rounded-3xl border border-white/15 bg-black/30 p-4">
              {/*
                A CT or an MRI is a stack of slices in a single file. No
                browser draws one, so it is offered as a download for
                the viewer the doctor already reads studies in, instead
                of an image tag that could only ever fail.
              */}
              {isVolumeStudy ? (
                <div className="w-full">
                  <VolumeViewer studyId={study.id} />

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      {study.originalFileName}
                    </p>

                    {/*
                      The file is still offered. A radiologist with
                      their own viewer wants the original, and this one
                      shows the slices rather than replacing the tools
                      they measure with.
                    */}
                    <a
                      href={`${BACKEND_URL}/api/studies/${study.id}/image`}
                      className="text-xs font-bold text-cyan-300 underline"
                    >
                      Download the original file
                    </a>
                  </div>
                </div>
              ) : !imageFailed ? (
                <img
                  src={`${BACKEND_URL}/api/studies/${study.id}/image`}
                  alt={`X-ray study ${study.id}`}
                  onError={() =>
                    setImageFailed(true)
                  }
                  className="max-h-[650px] w-full rounded-2xl object-contain"
                />
              ) : (
                <div className="text-center">
                  <div className="text-6xl">🩻</div>

                  <p className="mt-4 font-bold text-slate-300">
                    The image route is not available yet.
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className="space-y-7">
            <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-xl backdrop-blur-2xl">
              <h2 className="text-2xl font-black text-white">
                Patient Information
              </h2>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailItem
                  label="Patient"
                  value={patientName}
                />

                <DetailItem
                  label="Patient ID"
                  value={study.patientId ?? "—"}
                />

                <DetailItem
                  label="Age"
                  value={
                    study.age !== undefined
                      ? String(study.age)
                      : "—"
                  }
                />

                <DetailItem
                  label="Gender"
                  value={study.gender ?? "—"}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-xl backdrop-blur-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-black text-white">
                  AI Preliminary Findings
                </h2>

                <span
                  className={`rounded-full border px-4 py-2 text-sm font-black ${resultStyle}`}
                >
                  {triageResult}
                </span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailItem
                  label="Triage Result"
                  value={triageResult}
                />

                <DetailItem
                  label="Confidence"
                  value={
                    study.confidence !== null &&
                    study.confidence !== undefined
                      ? `${Number(
                          study.confidence,
                        ).toFixed(2)}%`
                      : "—"
                  }
                />

                <DetailItem
                  label="Primary Finding"
                  value={
                    primaryFinding ??
                    "No confirmed finding"
                  }
                />

                <DetailItem
                  label="AI Priority"
                  value={aiPriority}
                />

                <DetailItem
                  label="Detected Region"
                  value={detectedRegion}
                />

                <DetailItem
                  label="Detected Clinic"
                  value={detectedClinic}
                />

                <DetailItem
                  label="Model"
                  value={
                    study.modelName ??
                    "EfficientNetB0"
                  }
                />

                <DetailItem
                  label="Version"
                  value={
                    study.modelVersion ??
                    "1.0"
                  }
                />
              </div>

              {isTriageOnlyReading ? (
                <div className="mt-6">
                  <h3 className="text-lg font-black text-white">
                    Abnormality score
                  </h3>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-3xl font-black text-white">
                        {abnormalityProbability?.toFixed(
                          1,
                        )}
                        %
                      </p>
                      <p className="text-xs text-slate-400">
                        decides at{" "}
                        {decisionThreshold?.toFixed(1) ??
                          "50.0"}
                        %
                      </p>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      This study was read by a model that
                      reports whether it looks normal or
                      abnormal. It does not name a
                      specific finding, so there is no
                      finding list for this reading.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="mt-6">
                <h3 className="text-lg font-black text-white">
                  Findings above decision thresholds
                </h3>

                {possibleFindings.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {possibleFindings.map(
                      (finding) => (
                        <FindingCard
                          key={`${finding.name}-${finding.probability}`}
                          finding={finding}
                          emphasized
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-100">
                    No supported finding clearly
                    exceeded its decision threshold.
                    A near-threshold result may still
                    require doctor review.
                  </div>
                )}
              </div>
              )}

              {allFindings.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-black text-white">
                    All AI finding probabilities
                  </h3>

                  <div className="mt-4 max-h-[430px] space-y-3 overflow-y-auto pr-2">
                    {allFindings.map(
                      (finding) => (
                        <FindingCard
                          key={`${finding.name}-${finding.probability}`}
                          finding={finding}
                        />
                      ),
                    )}
                  </div>
                </div>
              )}

              {aiMessage && (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    AI Explanation
                  </p>

                  <p className="mt-2 leading-7 text-slate-200">
                    {aiMessage}
                  </p>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-4 text-sm leading-6 text-cyan-100">
                These findings are preliminary and
                must be confirmed or edited by the
                reviewing doctor.
              </div>
            </section>

            <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-xl backdrop-blur-2xl">
              <h2 className="text-2xl font-black text-white">
                Study Information
              </h2>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailItem
                  label="Body Region"
                  value={study.bodyRegion ?? "—"}
                />

                <DetailItem
                  label="Imaging View"
                  value={imagingView}
                />

                <DetailItem
                  label="Priority"
                  value={study.priority ?? "Normal"}
                />

                <DetailItem
                  label="Status"
                  value={study.status ?? "Waiting"}
                />
              </div>

              {/* What the patient reported, shown to the reviewing doctor */}
              {[
                { label: "Symptoms", value: study.symptoms },
                {
                  label: "Medical History",
                  value: study.medicalHistory,
                },
                { label: "Clinical Notes", value: study.clinicalNotes },
              ]
                .filter((item) => item.value)
                .map((item) => (
                  <div
                    key={item.label}
                    className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-4"
                  >
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      {item.label}
                    </p>

                    <p className="mt-2 whitespace-pre-wrap leading-7 text-slate-200">
                      {item.value}
                    </p>
                  </div>
                ))}
            </section>
          </div>
        </div>
        {/* The three steps of a review: decide and write the report,
            book the follow-up when it is needed, answer the patient. */}
        {/* Named so that "Start Review" opens the page on the report. */}
        <div id="review" className="mt-7 scroll-mt-24">
          <CaseReport
            studyId={study.id}
            mode="doctor"
            aiResult={study.aiResult ?? undefined}
            onFollowUpChange={setNeedsFollowUp}
          />
        </div>

        <div className="mt-7 grid gap-7 lg:grid-cols-2">
          <StudyAppointment
            studyId={study.id}
            highlight={needsFollowUp}
          />

          <CaseChat
            studyId={study.id}
            title={`Message ${study.patientName ?? "the patient"}`}
            compact
          />
        </div>
      </div>
    </main>
  );
}

function FindingCard({
  finding,
  emphasized = false,
}: {
  finding: AiFinding;
  emphasized?: boolean;
}) {
  const probability = Math.min(
    100,
    Math.max(0, Number(finding.probability)),
  );

  const threshold =
    finding.threshold !== undefined
      ? Math.min(
          100,
          Math.max(
            0,
            Number(finding.threshold),
          ),
        )
      : null;

  const detected =
    finding.detected ??
    (
      threshold !== null
        ? probability >= threshold
        : emphasized
    );

  const statusText = detected
    ? "Above threshold"
    : threshold !== null &&
        threshold - probability <= 10
      ? "Near threshold — doctor review"
      : "Below threshold";

  return (
    <div
      className={`rounded-2xl border p-4 ${
        emphasized
          ? "border-rose-300/25 bg-rose-300/[0.07]"
          : "border-white/10 bg-white/[0.05]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-black text-white">
          {finding.name}
        </p>

        <span
          className={`rounded-full border px-3 py-1 text-sm font-black ${
            detected
              ? "border-rose-300/30 bg-rose-400/10 text-rose-200"
              : "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
          }`}
        >
          {formatProbability(probability)}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300"
          style={{
            width: `${probability}%`,
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs font-bold text-slate-400">
        <span>{statusText}</span>

        {threshold !== null && (
          <span>
            Threshold:{" "}
            {formatProbability(threshold)}
          </span>
        )}
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>

      <p className="mt-2 break-words font-black text-white">
        {value}
      </p>
    </div>
  );
}