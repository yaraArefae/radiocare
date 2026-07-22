"use client";
import StudyAppointmentChat from "@/components/StudyAppointmentChat";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
  priority?: string;
  status?: string;
  clinicalNotes?: string | null;
  aiResult?: string | null;
  predictedFinding?: string | null;
  confidence?: number | null;
  explanation?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  createdAt?: string;
  date?: string;
};

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

  const aiResult =
    study.aiResult ??
    study.predictedFinding ??
    "Not analyzed yet";

  const patientName =
    study.patient ??
    study.patientName ??
    "RadioCare Patient";

  const imagingView =
    study.imagingView ??
    study.view ??
    "X-ray";

  const resultStyle =
    aiResult === "NORMAL"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
      : aiResult === "ABNORMAL"
        ? "border-rose-300/30 bg-rose-400/10 text-rose-200"
        : "border-amber-300/30 bg-amber-400/10 text-amber-200";

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/studies?clinic=chest"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:bg-white/[0.12]"
          >
            ← Back to Chest Studies
          </Link>

          <span
            className={`rounded-full border px-4 py-2 text-sm font-black ${resultStyle}`}
          >
            {study.status ?? "Waiting"}
          </span>
        </div>

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
              AI Result: {aiResult}
            </div>
          </div>
        </section>

        <div className="mt-7 grid gap-7 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-6 shadow-xl backdrop-blur-2xl">
            <h2 className="text-2xl font-black text-white">
              X-ray Image
            </h2>

            <div className="mt-5 flex min-h-[500px] items-center justify-center overflow-hidden rounded-3xl border border-white/15 bg-black/30 p-4">
              {!imageFailed ? (
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
              <h2 className="text-2xl font-black text-white">
                AI Analysis
              </h2>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <DetailItem
                  label="Result"
                  value={aiResult}
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

              {study.explanation && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    AI Explanation
                  </p>

                  <p className="mt-2 leading-7 text-slate-200">
                    {study.explanation}
                  </p>
                </div>
              )}
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

              {study.clinicalNotes && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Clinical Notes
                  </p>

                  <p className="mt-2 leading-7 text-slate-200">
                    {study.clinicalNotes}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
        <StudyAppointmentChat studyId={study.id} />
      </div>
    </main>
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