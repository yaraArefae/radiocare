"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useState,
} from "react";

type BodyRegion =
  | "CHEST"
  | "SHOULDER"
  | "HAND_WRIST"
  | "HEAD_SKULL"
  | "SPINE"
  | "PELVIS_HIP"
  | "LOWER_LIMB";

/*
  NOT_ANALYZED means no AI model is installed for that region yet, so
  the image goes straight to the specialist doctor.
*/
type ResultStatus =
  | "NORMAL"
  | "ABNORMAL"
  | "UNCERTAIN"
  | "NOT_ANALYZED";

type Finding = {
  name: string;
  probability: number;
  threshold: number;
  detected: boolean;
};

type AnalysisResult = {
  success: boolean;
  fileName: string;
  contentType: string;
  width: number;
  height: number;
  bodyRegion: BodyRegion;
  result: ResultStatus;
  triageResult?: ResultStatus;
  confidence: number;
  normalProbability?: number;
  abnormalProbability?: number;
  primaryFinding?: string | null;
  possibleFindings?: Finding[];
  allFindings?: Finding[];
  priority?: string;
  detectedClinic?: string;
  needsDoctorReview: boolean;
  message: string;
  disclaimer: string;
  modelName?: string;
  modelVersion?: string;
};

type RegionConfig = {
  label: string;
  endpoint: string;
  imagingView: string;
  clinicSlug: string;
  clinicName: string;
  clinicalNotes: string;
};

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ??
  "http://localhost:8000";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  "http://localhost:4000";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const allowedImageTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const REGION_CONFIG: Record<BodyRegion, RegionConfig> = {
  CHEST: {
    label: "Chest",
    endpoint: "/predict/chest/findings",
    imagingView: "Chest X-ray",
    clinicSlug: "chest",
    clinicName: "Chest Clinic",
    clinicalNotes:
      "Chest X-ray uploaded by the patient for multi-label AI analysis.",
  },
  SHOULDER: {
    label: "Shoulder",
    endpoint: "/predict/shoulder",
    imagingView: "Shoulder X-ray",
    clinicSlug: "upper-limb",
    clinicName: "Upper Limb Clinic",
    clinicalNotes:
      "Shoulder X-ray uploaded by the patient for preliminary AI analysis.",
  },
  /*
    Hand and wrist are one anatomical unit, so they share a single upload
    option, a single AI endpoint, and the same review queue.
  */
  HAND_WRIST: {
    label: "Hand & Wrist",
    endpoint: "/predict/hand-wrist",
    imagingView: "Hand & Wrist X-ray",
    clinicSlug: "upper-limb",
    clinicName: "Upper Limb Clinic",
    clinicalNotes:
      "Hand or wrist X-ray uploaded by the patient for preliminary AI analysis.",
  },
  /*
    The regions below share one generic endpoint. Each of them reaches
    its own clinic, and each starts using AI as soon as a model for it
    is installed in the AI service.
  */
  HEAD_SKULL: {
    label: "Head & Skull",
    endpoint: "/predict/region/head",
    imagingView: "Head & Skull X-ray",
    clinicSlug: "head",
    clinicName: "Head & Skull Clinic",
    clinicalNotes:
      "Head or skull X-ray uploaded by the patient for doctor review.",
  },
  SPINE: {
    label: "Spine",
    endpoint: "/predict/region/spine",
    imagingView: "Spine X-ray",
    clinicSlug: "spine",
    clinicName: "Spine Clinic",
    clinicalNotes:
      "Spine X-ray uploaded by the patient for doctor review.",
  },
  PELVIS_HIP: {
    label: "Pelvis & Hip",
    endpoint: "/predict/region/pelvis",
    imagingView: "Pelvis & Hip X-ray",
    clinicSlug: "pelvis",
    clinicName: "Pelvis & Hip Clinic",
    clinicalNotes:
      "Pelvis or hip X-ray uploaded by the patient for doctor review.",
  },
  LOWER_LIMB: {
    label: "Leg, Knee & Foot",
    endpoint: "/predict/region/lower-limb",
    imagingView: "Lower Limb X-ray",
    clinicSlug: "lower-limb",
    clinicName: "Lower Limb Clinic",
    clinicalNotes:
      "Leg, knee, ankle, or foot X-ray uploaded by the patient for doctor review.",
  },
};

export default function PatientUploadPage() {
  const [bodyRegion, setBodyRegion] =
    useState<BodyRegion>("CHEST");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [medicalHistory, setMedicalHistory] = useState("");
  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);
  const [previewUrl, setPreviewUrl] =
    useState<string | null>(null);
  const [analysisResult, setAnalysisResult] =
    useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] =
    useState(false);
  const [errorMessage, setErrorMessage] =
    useState("");
  const [saveMessage, setSaveMessage] =
    useState("");

  const regionConfig = REGION_CONFIG[bodyRegion];
  const resultStatus =
    analysisResult?.triageResult ?? analysisResult?.result;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function resetImageAndResult() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setErrorMessage("");
    setSaveMessage("");
  }

  function handleRegionChange(
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    resetImageAndResult();
    setBodyRegion(event.target.value as BodyRegion);
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    setErrorMessage("");
    setSaveMessage("");
    setAnalysisResult(null);

    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    if (!allowedImageTypes.includes(file.type)) {
      setErrorMessage(
        "Please choose a JPG, PNG, or WEBP image.",
      );
      event.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage(
        "The image must be smaller than 20 MB.",
      );
      event.target.value = "";
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleAnalyze(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!age || !gender) {
      setErrorMessage(
        "Please enter your age and select your gender.",
      );
      return;
    }

    if (!selectedFile) {
      setErrorMessage(
        `Please choose a ${regionConfig.label.toLowerCase()} X-ray image first.`,
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage("");
    setSaveMessage("");
    setAnalysisResult(null);

    try {
      const aiFormData = new FormData();
      aiFormData.append("image", selectedFile);

      const aiResponse = await fetch(
        `${AI_SERVICE_URL}${regionConfig.endpoint}`,
        {
          method: "POST",
          body: aiFormData,
        },
      );

      const aiData = await aiResponse.json();

      if (!aiResponse.ok) {
        throw new Error(
          aiData.detail ?? "The image analysis failed.",
        );
      }

      const result = aiData as AnalysisResult;
      const triageResult =
        result.triageResult ?? result.result;
      const possibleFindings =
        result.possibleFindings ?? [];
      const allFindings = result.allFindings ?? [];
      const primaryFinding =
        result.primaryFinding ??
        (triageResult === "ABNORMAL"
          ? `${regionConfig.label} abnormality`
          : null);

      setAnalysisResult(result);

      const studyFormData = new FormData();
      studyFormData.append("age", age);
      studyFormData.append("gender", gender);
      studyFormData.append("symptoms", symptoms.trim());
      studyFormData.append(
        "medicalHistory",
        medicalHistory.trim(),
      );
      studyFormData.append("image", selectedFile);
      studyFormData.append(
        "bodyRegion",
        result.bodyRegion ?? bodyRegion,
      );
      studyFormData.append(
        "imagingView",
        regionConfig.imagingView,
      );
      /*
        The AI service already classifies the case as URGENT,
        NEEDS_REVIEW, or ROUTINE, so its own priority is sent through.
      */
      studyFormData.append(
        "priority",
        result.priority ??
          (result.needsDoctorReview ? "Needs Review" : "Routine"),
      );
      studyFormData.append(
        "clinicalNotes",
        regionConfig.clinicalNotes,
      );
      studyFormData.append(
        "detectedRegion",
        result.bodyRegion ?? bodyRegion,
      );
      studyFormData.append(
        "detectedClinic",
        result.detectedClinic ?? regionConfig.clinicSlug,
      );
      studyFormData.append(
        "predictedFinding",
        primaryFinding ?? triageResult,
      );
      studyFormData.append(
        "triageResult",
        triageResult,
      );
      studyFormData.append(
        "primaryFinding",
        primaryFinding ?? "",
      );
      studyFormData.append(
        "possibleFindings",
        JSON.stringify(possibleFindings),
      );
      studyFormData.append(
        "allFindings",
        JSON.stringify(allFindings),
      );
      studyFormData.append(
        "aiPriority",
        result.priority ??
          (result.needsDoctorReview
            ? "NEEDS_REVIEW"
            : "ROUTINE"),
      );
      studyFormData.append(
        "confidence",
        String(result.confidence),
      );
      studyFormData.append(
        "modelName",
        result.modelName ??
          `${bodyRegion.toLowerCase()}_model.keras`,
      );
      studyFormData.append(
        "modelVersion",
        result.modelVersion ?? "2.0",
      );
      studyFormData.append(
        "aiExplanation",
        result.message,
      );

      const saveResponse = await fetch(
        `${BACKEND_URL}/api/studies`,
        {
          method: "POST",
          credentials: "include",
          body: studyFormData,
        },
      );

      const saveData = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(
          saveData.message ??
            saveData.detail ??
            "The study could not be saved.",
        );
      }

      setSaveMessage(
        `The study was saved successfully and sent to the ${regionConfig.clinicName}.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The operation failed.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function getResultStyles() {
    if (resultStatus === "NORMAL") {
      return {
        container:
          "border-emerald-300/30 bg-emerald-400/10",
        badge:
          "border-emerald-300/30 bg-emerald-400/20 text-emerald-200",
        icon: "✓",
      };
    }

    if (resultStatus === "ABNORMAL") {
      return {
        container:
          "border-rose-300/30 bg-rose-400/10",
        badge:
          "border-rose-300/30 bg-rose-400/20 text-rose-200",
        icon: "!",
      };
    }

    /* No AI model for this region yet: the doctor reviews it directly. */
    if (resultStatus === "NOT_ANALYZED") {
      return {
        container:
          "border-cyan-300/30 bg-cyan-400/10",
        badge:
          "border-cyan-300/30 bg-cyan-400/20 text-cyan-100",
        icon: "🩺",
      };
    }

    return {
      container:
        "border-amber-300/30 bg-amber-400/10",
      badge:
        "border-amber-300/30 bg-amber-400/20 text-amber-200",
      icon: "?",
    };
  }

  const resultStyles = getResultStyles();

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-5 py-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/patients/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-2.5 font-bold text-cyan-200 backdrop-blur-xl transition hover:border-cyan-300/50 hover:bg-white/[0.12]"
        >
          ← Back to Dashboard
        </Link>

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 shadow-[0_25px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl md:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
            RadioCare AI
          </p>

          <h1 className="mt-3 text-3xl font-black text-white md:text-4xl">
            X-ray Analysis
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Chest images receive multi-label preliminary findings.
            Shoulder images receive preliminary fracture triage. All
            results must be reviewed by a doctor.
          </p>
        </section>

        <div className="mt-8 grid gap-7 lg:grid-cols-2">
          <form
            onSubmit={handleAnalyze}
            className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
          >
            <h2 className="text-2xl font-black text-white">
              Upload X-ray
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Supported formats: JPG, PNG and WEBP. Maximum size:
              20 MB.
            </p>

            <div className="mt-6">
              <label
                htmlFor="body-region"
                className="mb-2 block text-sm font-bold text-slate-200"
              >
                Body Region
              </label>

              <select
                id="body-region"
                value={bodyRegion}
                onChange={handleRegionChange}
                disabled={isAnalyzing}
                className="w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
              >
                {(
                  Object.keys(REGION_CONFIG) as BodyRegion[]
                ).map((region) => (
                  <option key={region} value={region}>
                    {REGION_CONFIG[region].label}
                  </option>
                ))}
              </select>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                {regionConfig.label} images are reviewed in the{" "}
                {regionConfig.clinicName}.
              </p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="patient-age"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Age
                </label>

                <input
                  id="patient-age"
                  type="number"
                  min="1"
                  max="120"
                  value={age}
                  onChange={(event) =>
                    setAge(event.target.value)
                  }
                  placeholder="Enter your age"
                  required
                  className="w-full rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>

              <div>
                <label
                  htmlFor="patient-gender"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Gender
                </label>

                <select
                  id="patient-gender"
                  value={gender}
                  onChange={(event) =>
                    setGender(event.target.value)
                  }
                  required
                  className="w-full rounded-2xl border border-white/20 bg-[#17315a] px-4 py-3.5 text-white outline-none focus:border-cyan-300/60"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </div>

            {/* What the reviewing doctor needs to know about this scan */}
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="patient-symptoms"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Current symptoms
                </label>

                <textarea
                  id="patient-symptoms"
                  rows={3}
                  value={symptoms}
                  onChange={(event) =>
                    setSymptoms(event.target.value)
                  }
                  placeholder="Pain, swelling, since when..."
                  className="w-full resize-none rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>

              <div>
                <label
                  htmlFor="patient-history"
                  className="mb-2 block text-sm font-bold text-slate-200"
                >
                  Medical history
                </label>

                <textarea
                  id="patient-history"
                  rows={3}
                  value={medicalHistory}
                  onChange={(event) =>
                    setMedicalHistory(event.target.value)
                  }
                  placeholder="Chronic illnesses, previous surgeries, medication..."
                  className="w-full resize-none rounded-2xl border border-white/20 bg-white/[0.08] px-4 py-3.5 text-white outline-none backdrop-blur-xl placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>
            </div>

            <label className="mt-6 flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-cyan-300/30 bg-white/[0.05] p-5 text-center transition hover:border-cyan-300/70 hover:bg-white/[0.09]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`Selected ${regionConfig.label.toLowerCase()} X-ray preview`}
                  className="max-h-72 w-full rounded-2xl object-contain"
                />
              ) : (
                <>
                  <span className="text-6xl">🩻</span>
                  <p className="mt-5 text-lg font-black text-white">
                    Choose a {regionConfig.label.toLowerCase()} X-ray
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    Click here to browse your files
                  </p>
                </>
              )}

              <input
                key={bodyRegion}
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {selectedFile && (
              <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.06] p-4">
                <p className="text-sm font-bold text-white">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            )}

            {errorMessage && (
              <div className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm font-semibold text-rose-200">
                {errorMessage}
              </div>
            )}

            {saveMessage && (
              <div className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-200">
                {saveMessage}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="submit"
                disabled={!selectedFile || isAnalyzing}
                className="flex flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 px-5 py-3.5 font-black text-white shadow-[0_12px_35px_rgba(14,165,233,0.25)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAnalyzing
                  ? "Analyzing..."
                  : `Analyze ${regionConfig.label} X-ray`}
              </button>

              <button
                type="button"
                onClick={resetImageAndResult}
                disabled={isAnalyzing}
                className="rounded-2xl border border-white/20 bg-white/[0.08] px-5 py-3.5 font-bold text-white transition hover:bg-white/[0.14] disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </form>

          <section className="rounded-3xl border border-white/20 bg-white/[0.07] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
            <h2 className="text-2xl font-black text-white">
              Analysis Result
            </h2>

            {!analysisResult && !isAnalyzing && (
              <div className="mt-6 flex min-h-96 flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <span className="text-6xl">🔬</span>
                <p className="mt-5 text-lg font-black text-white">
                  No analysis yet
                </p>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
                  Choose a matching X-ray image and press Analyze to
                  view the preliminary result.
                </p>
              </div>
            )}

            {isAnalyzing && (
              <div className="mt-6 flex min-h-96 flex-col items-center justify-center rounded-3xl border border-cyan-300/20 bg-cyan-400/[0.06] p-8 text-center">
                <div className="h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
                <p className="mt-6 text-lg font-black text-white">
                  Analyzing the image
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Please wait while the AI model processes the{" "}
                  {regionConfig.label.toLowerCase()} X-ray.
                </p>
              </div>
            )}

            {analysisResult && !isAnalyzing && (
              <div
                className={`mt-6 rounded-3xl border p-6 ${resultStyles.container}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-300">
                      AI Preliminary Result
                    </p>
                    <h3 className="mt-2 text-3xl font-black text-white">
                      {resultStatus}
                    </h3>
                  </div>

                  <span
                    className={`flex h-16 w-16 items-center justify-center rounded-full border text-3xl font-black ${resultStyles.badge}`}
                  >
                    {resultStyles.icon}
                  </span>
                </div>

                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  <ResultItem
                    label="Confidence"
                    value={`${analysisResult.confidence}%`}
                  />
                  <ResultItem
                    label="Body Region"
                    value={analysisResult.bodyRegion}
                  />
                  <ResultItem
                    label="Priority"
                    value={
                      analysisResult.priority ??
                      (analysisResult.needsDoctorReview
                        ? "Needs Review"
                        : "Routine")
                    }
                  />
                  <ResultItem
                    label="Clinic"
                    value={
                      analysisResult.detectedClinic ??
                      regionConfig.clinicName
                    }
                  />
                </div>

                {/* Chest, hand/wrist, and the regional models return
                    multi-label findings, the shoulder model returns two
                    probabilities, and a region without a model has no
                    findings to show at all. */}
                {analysisResult.result === "NOT_ANALYZED" ? null : bodyRegion ===
                  "SHOULDER" ? (
                  <ShoulderProbabilities result={analysisResult} />
                ) : (
                  <MultiLabelFindingsResult result={analysisResult} />
                )}

                <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-4">
                  <p className="text-sm leading-6 text-slate-200">
                    {analysisResult.message}
                  </p>
                </div>

                {analysisResult.needsDoctorReview && (
                  <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm font-bold text-amber-200">
                    Doctor review is required for this result.
                  </div>
                )}

                <p className="mt-5 text-xs leading-5 text-slate-400">
                  {analysisResult.disclaimer}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/*
  Renders the findings of any multi-label model: chest, hand, and wrist.
*/
function MultiLabelFindingsResult({
  result,
}: {
  result: AnalysisResult;
}) {
  const detectedFindings = result.possibleFindings ?? [];
  const allFindings = result.allFindings ?? [];

  return (
    <>
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Primary Finding
        </p>
        <p className="mt-2 text-lg font-black text-white">
          {result.primaryFinding ?? "No confirmed finding"}
        </p>
      </div>

      <div className="mt-5">
        <h4 className="text-base font-black text-white">
          Findings above their decision thresholds
        </h4>

        {detectedFindings.length > 0 ? (
          <div className="mt-3 space-y-3">
            {detectedFindings.map((finding) => (
              <FindingCard
                key={finding.name}
                finding={finding}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4 text-sm leading-6 text-slate-300">
            No supported finding clearly exceeded its decision
            threshold. A near-threshold result may still require
            doctor review.
          </div>
        )}
      </div>

      {allFindings.length > 0 && (
        <div className="mt-6">
          <h4 className="text-base font-black text-white">
            All AI finding probabilities
          </h4>
          <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
            {allFindings.map((finding) => (
              <FindingCard
                key={finding.name}
                finding={finding}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ShoulderProbabilities({
  result,
}: {
  result: AnalysisResult;
}) {
  if (
    result.normalProbability === undefined ||
    result.abnormalProbability === undefined
  ) {
    return null;
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <ResultItem
        label="Normal Probability"
        value={`${result.normalProbability}%`}
      />
      <ResultItem
        label="Abnormal Probability"
        value={`${result.abnormalProbability}%`}
      />
    </div>
  );
}

function FindingCard({
  finding,
  compact = false,
}: {
  finding: Finding;
  compact?: boolean;
}) {
  const nearThreshold =
    !finding.detected &&
    finding.threshold - finding.probability <= 10;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-black text-white">
            {finding.name}
          </p>
          {!compact && (
            <p className="mt-1 text-xs text-slate-400">
              Decision threshold: {finding.threshold}%
            </p>
          )}
        </div>

        <span
          className={`rounded-full border px-3 py-1 text-xs font-black ${
            finding.detected
              ? "border-rose-300/30 bg-rose-400/15 text-rose-200"
              : nearThreshold
                ? "border-amber-300/30 bg-amber-400/15 text-amber-200"
                : "border-white/10 bg-white/[0.06] text-slate-300"
          }`}
        >
          {finding.probability}%
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300"
          style={{
            width: `${Math.min(
              100,
              Math.max(0, finding.probability),
            )}%`,
          }}
        />
      </div>

      <p className="mt-2 text-xs font-semibold text-slate-400">
        {finding.detected
          ? "Above threshold — possible finding"
          : nearThreshold
            ? "Near threshold — doctor review"
            : "Below threshold"}
      </p>
    </div>
  );
}

function ResultItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-2 break-words text-lg font-black text-white">
        {value}
      </p>
    </div>
  );
}