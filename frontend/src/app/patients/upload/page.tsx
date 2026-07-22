"use client";

import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useState,
} from "react";

type AnalysisResult = {
  success: boolean;
  fileName: string;
  contentType: string;
  width: number;
  height: number;
  bodyRegion: string;
  result: "NORMAL" | "ABNORMAL" | "UNCERTAIN";
  confidence: number;
  normalProbability: number;
  abnormalProbability: number;
  needsDoctorReview: boolean;
  message: string;
  disclaimer: string;
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

export default function PatientUploadPage() {
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
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
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
    if (!age || !gender) {
  setErrorMessage(
    "Please enter your age and select your gender.",
  );
  return;
}
  event.preventDefault();

  if (!selectedFile) {
    setErrorMessage(
      "Please choose a chest X-ray image first.",
    );
    return;
  }

  setIsAnalyzing(true);
  setErrorMessage("");
  setSaveMessage("");
  setAnalysisResult(null);

  try {
    /*
     * الخطوة الأولى:
     * إرسال الصورة إلى AI Service للتحليل.
     */
    const aiFormData = new FormData();

    aiFormData.append(
      "image",
      selectedFile,
    );

    const aiResponse = await fetch(
      `${AI_SERVICE_URL}/classify`,
      {
        method: "POST",
        body: aiFormData,
      },
    );

    const aiData = await aiResponse.json();

    if (!aiResponse.ok) {
      throw new Error(
        aiData.detail ??
          "The image analysis failed.",
      );
    }

    const result =
      aiData as AnalysisResult;

    setAnalysisResult(result);

    /*
     * الخطوة الثانية:
     * حفظ الصورة ونتيجة التحليل في Backend.
     */
    const studyFormData = new FormData();
    studyFormData.append(
  "age",
  age,
);

studyFormData.append(
  "gender",
  gender,
);

    studyFormData.append(
      "image",
      selectedFile,
    );

    studyFormData.append(
      "bodyRegion",
      "CHEST",
    );

    studyFormData.append(
      "imagingView",
      "Chest X-ray",
    );

    studyFormData.append(
      "priority",
      result.result === "ABNORMAL"
        ? "Urgent"
        : "Normal",
    );

    studyFormData.append(
      "clinicalNotes",
      "Chest X-ray uploaded by the patient.",
    );

    studyFormData.append(
      "detectedRegion",
      "CHEST",
    );

    studyFormData.append(
      "detectedClinic",
      "chest",
    );

    studyFormData.append(
      "predictedFinding",
      result.result,
    );

    studyFormData.append(
      "confidence",
      String(result.confidence),
    );

    studyFormData.append(
      "modelName",
      "EfficientNetB0",
    );

    studyFormData.append(
      "modelVersion",
      "1.0",
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

    const saveData =
      await saveResponse.json();

    if (!saveResponse.ok) {
      throw new Error(
        saveData.message ??
          saveData.detail ??
          "The study could not be saved.",
      );
    }

    setSaveMessage(
      "The study was saved successfully and sent to the Chest Clinic.",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The operation failed.";

    setErrorMessage(message);
  } finally {
    setIsAnalyzing(false);
  }
}

  function clearImage() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setSaveMessage("");
    }

    setSelectedFile(null);

    setPreviewUrl(null);
    setAnalysisResult(null);
    setErrorMessage("");
  }

  function getResultStyles() {
    if (analysisResult?.result === "NORMAL") {
      return {
        container:
          "border-emerald-300/30 bg-emerald-400/10",
        badge:
          "border-emerald-300/30 bg-emerald-400/20 text-emerald-200",
        icon: "✓",
      };
    }

    if (analysisResult?.result === "ABNORMAL") {
      return {
        container:
          "border-rose-300/30 bg-rose-400/10",
        badge:
          "border-rose-300/30 bg-rose-400/20 text-rose-200",
        icon: "!",
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
            Chest X-ray Analysis
          </h1>

          <p className="mt-3 max-w-3xl leading-7 text-slate-300">
            Upload a chest X-ray image to receive a
            preliminary AI result. The final diagnosis must
            be confirmed by a doctor.
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
              Supported formats: JPG, PNG and WEBP. Maximum
              size: 20 MB.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
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

            <label className="mt-6 flex min-h-72 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-cyan-300/30 bg-white/[0.05] p-5 text-center transition hover:border-cyan-300/70 hover:bg-white/[0.09]">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Selected chest X-ray preview"
                  className="max-h-72 w-full rounded-2xl object-contain"
                />
              ) : (
                <>
                  <span className="text-6xl">🩻</span>

                  <p className="mt-5 text-lg font-black text-white">
                    Choose a chest X-ray
                  </p>

                  <p className="mt-2 text-sm text-slate-400">
                    Click here to browse your files
                  </p>
                </>
              )}

              <input
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
                  {(selectedFile.size / 1024 / 1024).toFixed(
                    2,
                  )}{" "}
                  MB
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
                disabled={
                  !selectedFile || isAnalyzing
                }
                className="flex flex-1 items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 px-5 py-3.5 font-black text-white shadow-[0_12px_35px_rgba(14,165,233,0.25)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAnalyzing
                  ? "Analyzing..."
                  : "Analyze X-ray"}
              </button>

              <button
                type="button"
                onClick={clearImage}
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
                  Select an image and press Analyze X-ray to
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
                  Please wait while the AI model processes
                  the chest X-ray.
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
                      {analysisResult.result}
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
                    label="Normal Probability"
                    value={`${analysisResult.normalProbability}%`}
                  />

                  <ResultItem
                    label="Abnormal Probability"
                    value={`${analysisResult.abnormalProbability}%`}
                  />
                </div>

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

      <p className="mt-2 text-lg font-black text-white">
        {value}
      </p>
    </div>
  );
}