"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

type SessionUser = {
  name: string;
  email: string;
  role?: string | string[] | null;
};

type FormDataState = {
  patientId: string;
  patientName: string;
  age: string;
  gender: string;
  bodyRegion: string;
  imagingView: string;
  priority: string;
  clinicalNotes: string;
};

type ClassificationResponse = {
  success?: boolean;
  message?: string;
  bodyRegion?: string | null;
  confidence?: number | null;
};

const initialFormData: FormDataState = {
  patientId: "",
  patientName: "",
  age: "",
  gender: "",
  bodyRegion: "",
  imagingView: "",
  priority: "Normal",
  clinicalNotes: "",
};

const imagingViews: Record<string, string[]> = {
  Chest: ["PA", "AP", "Lateral"],
  Spine: [
    "Cervical AP",
    "Cervical Lateral",
    "Thoracic AP",
    "Thoracic Lateral",
    "Lumbar AP",
    "Lumbar Lateral",
  ],
  Shoulder: ["AP", "Axillary", "Scapular Y"],
  Elbow: ["AP", "Lateral"],
  Wrist: ["AP", "Lateral", "Oblique"],
  Hand: ["PA", "Lateral", "Oblique"],
  Hip: ["AP", "Lateral"],
  Knee: ["AP", "Lateral", "Sunrise"],
  Ankle: ["AP", "Lateral", "Mortise"],
  Foot: ["AP", "Lateral", "Oblique"],
  Dental: ["Panoramic", "Periapical", "Bitewing"],
  Pelvis: ["AP", "Lateral"],
  Skull: ["AP", "Lateral"],
};

export default function NewStudyPage() {
  const router = useRouter();

  const { data: session, isPending } =
    authClient.useSession();

  const [formData, setFormData] =
    useState<FormDataState>(initialFormData);

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [previewUrl, setPreviewUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isClassifying, setIsClassifying] =
    useState(false);

  const [
    classificationMessage,
    setClassificationMessage,
  ] = useState("");

  const [detectedRegion, setDetectedRegion] =
    useState<string | null>(null);

  const [
    detectedConfidence,
    setDetectedConfidence,
  ] = useState<number | null>(null);

  const currentUser = session?.user as
    | SessionUser
    | undefined;

  const userRoles = (
    Array.isArray(currentUser?.role)
      ? currentUser.role
      : (currentUser?.role || "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const canCreateStudy =
    userRoles.includes("admin") ||
    userRoles.includes("technician");

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (
      !isPending &&
      session &&
      !canCreateStudy
    ) {
      router.replace("/unauthorized");
    }
  }, [
    isPending,
    session,
    canCreateStudy,
    router,
  ]);

  useEffect(() => {
    const parameters = new URLSearchParams(
      window.location.search
    );

    const patientFromUrl =
      parameters.get("patient");

    if (patientFromUrl) {
      setFormData((current) => ({
        ...current,
        patientId: patientFromUrl,
      }));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function updateField(
    field: keyof FormDataState,
    value: string
  ) {
    setFormData((current) => ({
      ...current,
      [field]: value,
      ...(field === "bodyRegion"
        ? { imagingView: "" }
        : {}),
    }));

    setError("");
    setSuccess("");
  }

  async function classifySelectedImage(
    file: File
  ) {
    setIsClassifying(true);
    setClassificationMessage("");
    setDetectedRegion(null);
    setDetectedConfidence(null);

    try {
      const requestData = new FormData();

      requestData.append("image", file);

      const response = await fetch(
        "/api/ai/classify",
        {
          method: "POST",
          body: requestData,
        }
      );

      const result =
        (await response.json()) as ClassificationResponse;

      if (!response.ok) {
        throw new Error(
          result.message ||
            "The image could not be classified."
        );
      }

      if (
        typeof result.bodyRegion === "string" &&
        result.bodyRegion.trim()
      ) {
        const returnedRegion =
          result.bodyRegion.trim();

        const matchedRegion =
          Object.keys(imagingViews).find(
            (region) =>
              region.toLowerCase() ===
              returnedRegion.toLowerCase()
          ) || returnedRegion;

        setDetectedRegion(matchedRegion);

        setDetectedConfidence(
          typeof result.confidence === "number"
            ? result.confidence
            : null
        );

        if (imagingViews[matchedRegion]) {
          setFormData((current) => ({
            ...current,
            bodyRegion: matchedRegion,
            imagingView: "",
          }));
        }

        setClassificationMessage(
          `The image was classified as ${matchedRegion}. Confirm or correct the result before saving.`
        );

        return;
      }

      setClassificationMessage(
        result.message ||
          "The AI service received the image successfully. The body-region model has not been trained yet."
      );
    } catch (classificationError) {
      console.error(
        "Image classification failed:",
        classificationError
      );

      setClassificationMessage(
        classificationError instanceof Error
          ? classificationError.message
          : "Unable to connect to the AI service."
      );
    } finally {
      setIsClassifying(false);
    }
  }

  function processFile(file: File) {
    setError("");
    setSuccess("");

    const maximumSize = 20 * 1024 * 1024;

    const allowedImageTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    const fileName = file.name.toLowerCase();

    const isDicom =
      fileName.endsWith(".dcm") ||
      file.type === "application/dicom";

    const isImage =
      allowedImageTypes.includes(file.type);

    if (!isImage && !isDicom) {
      setError(
        "Please upload a JPG, PNG, WEBP or DICOM file."
      );
      return;
    }

    if (file.size > maximumSize) {
      setError(
        "The selected file must be smaller than 20 MB."
      );
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setDetectedRegion(null);
    setDetectedConfidence(null);
    setClassificationMessage("");

    if (isImage) {
      setPreviewUrl(URL.createObjectURL(file));

      void classifySelectedImage(file);
    } else {
      setPreviewUrl("");

      setClassificationMessage(
        "The DICOM file was selected successfully. Automatic DICOM classification will be added later."
      );
    }
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (file) {
      processFile(file);
    }

    event.target.value = "";
  }

  function handleDragOver(
    event: DragEvent<HTMLLabelElement>
  ) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(
    event: DragEvent<HTMLLabelElement>
  ) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(
    event: DragEvent<HTMLLabelElement>
  ) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (file) {
      processFile(file);
    }
  }

  function removeFile() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl("");
    setError("");
    setDetectedRegion(null);
    setDetectedConfidence(null);
    setClassificationMessage("");
    setIsClassifying(false);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setSuccess("");

    if (
      !formData.patientId.trim() ||
      !formData.patientName.trim() ||
      !formData.age ||
      !formData.gender ||
      !formData.bodyRegion ||
      !formData.imagingView
    ) {
      setError(
        "Please complete all required patient and study fields."
      );
      return;
    }

    const numericAge = Number(formData.age);

    if (
      !Number.isInteger(numericAge) ||
      numericAge < 0 ||
      numericAge > 120
    ) {
      setError(
        "Please enter a valid patient age between 0 and 120."
      );
      return;
    }

    if (!selectedFile) {
      setError(
        "Please upload the medical X-ray image."
      );
      return;
    }

    if (isClassifying) {
      setError(
        "Please wait until the AI Image Router finishes checking the image."
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const requestData = new FormData();

      requestData.append(
        "patientId",
        formData.patientId.trim()
      );

      requestData.append(
        "patientName",
        formData.patientName.trim()
      );

      requestData.append("age", formData.age);
      requestData.append(
        "gender",
        formData.gender
      );

      requestData.append(
        "bodyRegion",
        formData.bodyRegion
      );

      requestData.append(
        "imagingView",
        formData.imagingView
      );

      requestData.append(
        "priority",
        formData.priority
      );

      requestData.append(
        "clinicalNotes",
        formData.clinicalNotes.trim()
      );

      requestData.append(
        "image",
        selectedFile
      );

      if (detectedRegion) {
        requestData.append(
          "detectedRegion",
          detectedRegion
        );
      }

      if (detectedConfidence !== null) {
        requestData.append(
          "detectedConfidence",
          String(detectedConfidence)
        );
      }

      const response = await fetch(
        "/api/studies",
        {
          method: "POST",
          body: requestData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ||
            "The study could not be saved."
        );
      }

      setSuccess(
        `Study ${result.study.id} was saved successfully.`
      );

      setFormData(initialFormData);
      removeFile();
    } catch (submissionError) {
      console.error(
        "Study submission failed:",
        submissionError
      );

      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Unable to save the study."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await authClient.signOut();
      window.location.replace("/");
    } catch (logoutError) {
      console.error(
        "Logout failed:",
        logoutError
      );
    }
  }

  if (isPending) {
    return (
      <LoadingPage message="Loading new study..." />
    );
  }

  if (!session || !canCreateStudy) {
    return null;
  }

  const availableViews =
    imagingViews[formData.bodyRegion] || [];

  const isDicomFile =
    selectedFile?.name
      .toLowerCase()
      .endsWith(".dcm") ||
    selectedFile?.type === "application/dicom";

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />

      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />

      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <div className="pointer-events-none fixed left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400/10 blur-[140px]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() =>
              router.push("/dashboard")
            }
            className="flex items-center gap-3 text-left"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/25 bg-white/10 font-bold text-white shadow-lg backdrop-blur-xl">
              RI
            </div>

            <div>
              <h1 className="font-bold text-white">
                RadiologyInsight AI
              </h1>

              <p className="text-xs text-slate-300">
                Intelligent Medical Imaging Platform
              </p>
            </div>
          </button>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-white">
                {currentUser?.name}
              </p>

              <p className="text-xs text-cyan-300">
                New study workspace
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                router.push("/dashboard")
              }
              className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition hover:bg-white/15"
            >
              Dashboard
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-red-300/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-100 backdrop-blur-xl transition hover:bg-red-500/20"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex max-w-[1700px]">
        {/* Sidebar */}
        <aside className="sticky top-[81px] hidden h-[calc(100vh-81px)] w-72 shrink-0 overflow-y-auto border-r border-white/15 bg-blue-950/35 p-5 backdrop-blur-2xl lg:block">
          <p className="mb-4 px-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
            Main Menu
          </p>

          <nav className="space-y-2">
            <MenuButton
              label="Dashboard"
              onClick={() =>
                router.push("/dashboard")
              }
            />

            <MenuButton
              label="Studies"
              onClick={() =>
                router.push("/studies")
              }
            />

            <MenuButton
              label="New Study"
              active
              onClick={() =>
                router.push("/new-study")
              }
            />

            <MenuButton
              label="Patients"
              onClick={() =>
                router.push("/patients")
              }
            />

            <MenuButton
              label="Change Password"
              onClick={() =>
                router.push("/change-password")
              }
            />
          </nav>

          <div className="mt-9 rounded-2xl border border-cyan-300/20 bg-white/10 p-5 shadow-[0_20px_55px_rgba(0,0,0,0.22)] backdrop-blur-xl">
            <p className="text-sm font-semibold text-white">
              AI System Status
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-green-400 shadow-[0_0_15px_rgba(74,222,128,0.8)]" />

              <span className="text-sm text-green-100">
                Service connected
              </span>
            </div>

            <div className="mt-5 space-y-2 text-xs text-slate-300">
              <p>Image upload: Active</p>
              <p>Image router API: Connected</p>
              <p>Classification model: Pending training</p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <section className="min-w-0 flex-1 px-5 py-9 sm:px-7">
          <div>
            <p className="font-semibold text-cyan-300">
              Medical imaging
            </p>

            <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              Create New Study
            </h2>

            <p className="mt-3 max-w-3xl text-slate-300">
              Enter the patient information, upload the
              X-ray image and confirm its imaging details.
            </p>
          </div>

          <form
            className="mt-8"
            onSubmit={handleSubmit}
          >
            <div className="grid gap-6 xl:grid-cols-2">
              {/* Patient information */}
              <GlassCard>
                <CardHeading
                  number="1"
                  title="Patient Information"
                  description="Enter the patient’s basic information."
                />

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <FormField
                    id="patientId"
                    label="Patient ID"
                    required
                  >
                    <input
                      id="patientId"
                      type="text"
                      required
                      value={formData.patientId}
                      onChange={(event) =>
                        updateField(
                          "patientId",
                          event.target.value
                        )
                      }
                      placeholder="Example: PT-001"
                      className={inputClasses}
                    />
                  </FormField>

                  <FormField
                    id="patientName"
                    label="Patient name"
                    required
                  >
                    <input
                      id="patientName"
                      type="text"
                      required
                      value={formData.patientName}
                      onChange={(event) =>
                        updateField(
                          "patientName",
                          event.target.value
                        )
                      }
                      placeholder="Enter patient name"
                      className={inputClasses}
                    />
                  </FormField>

                  <FormField
                    id="age"
                    label="Age"
                    required
                  >
                    <input
                      id="age"
                      type="number"
                      required
                      min="0"
                      max="120"
                      value={formData.age}
                      onChange={(event) =>
                        updateField(
                          "age",
                          event.target.value
                        )
                      }
                      placeholder="Patient age"
                      className={inputClasses}
                    />
                  </FormField>

                  <FormField
                    id="gender"
                    label="Gender"
                    required
                  >
                    <select
                      id="gender"
                      required
                      value={formData.gender}
                      onChange={(event) =>
                        updateField(
                          "gender",
                          event.target.value
                        )
                      }
                      className={selectClasses}
                    >
                      <option value="">
                        Select gender
                      </option>

                      <option value="Female">
                        Female
                      </option>

                      <option value="Male">
                        Male
                      </option>
                    </select>
                  </FormField>
                </div>
              </GlassCard>

              {/* Study information */}
              <GlassCard>
                <CardHeading
                  number="2"
                  title="Study Information"
                  description="Confirm the body region and imaging view."
                />

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <FormField
                    id="bodyRegion"
                    label="Body region"
                    required
                  >
                    <select
                      id="bodyRegion"
                      required
                      value={formData.bodyRegion}
                      onChange={(event) =>
                        updateField(
                          "bodyRegion",
                          event.target.value
                        )
                      }
                      className={selectClasses}
                    >
                      <option value="">
                        Select body region
                      </option>

                      {Object.keys(imagingViews).map(
                        (region) => (
                          <option
                            key={region}
                            value={region}
                          >
                            {region}
                          </option>
                        )
                      )}
                    </select>
                  </FormField>

                  <FormField
                    id="imagingView"
                    label="Imaging view"
                    required
                  >
                    <select
                      id="imagingView"
                      required
                      disabled={
                        !formData.bodyRegion
                      }
                      value={formData.imagingView}
                      onChange={(event) =>
                        updateField(
                          "imagingView",
                          event.target.value
                        )
                      }
                      className={`${selectClasses} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <option value="">
                        {formData.bodyRegion
                          ? "Select imaging view"
                          : "Select body region first"}
                      </option>

                      {availableViews.map((view) => (
                        <option
                          key={view}
                          value={view}
                        >
                          {view}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField
                    id="priority"
                    label="Priority"
                  >
                    <select
                      id="priority"
                      value={formData.priority}
                      onChange={(event) =>
                        updateField(
                          "priority",
                          event.target.value
                        )
                      }
                      className={selectClasses}
                    >
                      <option value="Normal">
                        Normal
                      </option>

                      <option value="Urgent">
                        Urgent
                      </option>
                    </select>
                  </FormField>

                  <div className="sm:col-span-2">
                    <FormField
                      id="clinicalNotes"
                      label="Clinical notes"
                    >
                      <textarea
                        id="clinicalNotes"
                        rows={4}
                        value={
                          formData.clinicalNotes
                        }
                        onChange={(event) =>
                          updateField(
                            "clinicalNotes",
                            event.target.value
                          )
                        }
                        placeholder="Enter symptoms, injury details or additional notes..."
                        className={`${inputClasses} resize-none`}
                      />
                    </FormField>
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Image upload */}
            <div className="mt-6">
              <GlassCard>
                <CardHeading
                  number="3"
                  title="Upload X-ray Image"
                  description="Upload the image for automatic body-region checking."
                />

                {!selectedFile ? (
                  <label
                    htmlFor="xrayFile"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`mt-6 flex min-h-[310px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
                      isDragging
                        ? "border-cyan-300 bg-cyan-300/15"
                        : "border-cyan-300/30 bg-blue-950/25 hover:border-cyan-300/60 hover:bg-cyan-300/10"
                    }`}
                  >
                    <input
                      id="xrayFile"
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp,application/dicom"
                      onChange={handleFileChange}
                      className="hidden"
                    />

                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-3xl text-cyan-200">
                      ↑
                    </div>

                    <h3 className="mt-5 text-xl font-bold text-white">
                      Drop the X-ray image here
                    </h3>

                    <p className="mt-2 text-sm text-slate-300">
                      Or click to select a file from your
                      computer.
                    </p>

                    <p className="mt-4 text-xs text-slate-400">
                      JPG, PNG, WEBP or DICOM — maximum
                      size 20 MB
                    </p>
                  </label>
                ) : (
                  <div className="mt-6 grid gap-6 rounded-2xl border border-white/15 bg-blue-950/25 p-5 backdrop-blur-xl lg:grid-cols-[360px_1fr]">
                    <div className="flex min-h-[270px] items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-black/40">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Selected X-ray preview"
                          className="h-full max-h-[420px] w-full object-contain"
                        />
                      ) : (
                        <div className="p-8 text-center">
                          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 text-xl font-bold text-cyan-200">
                            DCM
                          </div>

                          <p className="mt-4 font-semibold text-white">
                            DICOM image selected
                          </p>

                          <p className="mt-2 text-sm text-slate-400">
                            Browser preview is not
                            available.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col justify-center">
                      <span className="w-fit rounded-full border border-green-300/30 bg-green-500/20 px-3 py-1.5 text-xs font-bold text-green-100">
                        File selected successfully
                      </span>

                      <h3 className="mt-5 break-all text-xl font-bold text-white">
                        {selectedFile.name}
                      </h3>

                      <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <FileInfo
                          label="File type"
                          value={
                            isDicomFile
                              ? "DICOM"
                              : selectedFile.type ||
                                "Medical image"
                          }
                        />

                        <FileInfo
                          label="File size"
                          value={formatFileSize(
                            selectedFile.size
                          )}
                        />
                      </div>

                      {/* Image Router */}
                      <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 backdrop-blur-xl">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-bold text-white">
                              AI Image Router
                            </p>

                            <p className="mt-1 text-xs leading-5 text-slate-300">
                              Checks the uploaded image
                              and detects its body region.
                            </p>
                          </div>

                          {isClassifying && (
                            <div className="h-7 w-7 shrink-0 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
                          )}
                        </div>

                        {isClassifying && (
                          <p className="mt-4 text-sm font-semibold text-cyan-100">
                            Analyzing the image...
                          </p>
                        )}

                        {!isClassifying &&
                          classificationMessage && (
                            <p className="mt-4 text-sm leading-6 text-cyan-50">
                              {
                                classificationMessage
                              }
                            </p>
                          )}

                        {!isClassifying &&
                          detectedRegion && (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <FileInfo
                                label="Detected region"
                                value={detectedRegion}
                              />

                              <FileInfo
                                label="Confidence"
                                value={
                                  detectedConfidence ===
                                  null
                                    ? "Not available"
                                    : `${detectedConfidence.toFixed(
                                        1
                                      )}%`
                                }
                              />
                            </div>
                          )}

                        <p className="mt-4 text-xs leading-5 text-slate-400">
                          Confirm or correct the body
                          region and imaging view before
                          saving the study.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          removeFile();
                          setSuccess("");
                        }}
                        className="mt-6 w-fit rounded-xl border border-red-300/25 bg-red-500/15 px-5 py-3 font-semibold text-red-100 transition hover:bg-red-500/25"
                      >
                        
                        Remove file
                      </button>
                    </div>
                  </div>
                )}
              </GlassCard>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-6 rounded-2xl border border-red-300/30 bg-red-500/20 px-5 py-4 text-sm font-semibold leading-6 text-red-100 backdrop-blur-xl"
              >
                {error}
              </div>
            )}

            {success && (
              <div
                role="status"
                className="mt-6 rounded-2xl border border-green-300/30 bg-green-500/20 px-5 py-4 text-sm font-semibold leading-6 text-green-100 backdrop-blur-xl"
              >
                {success}
              </div>
            )}

            <div className="mt-7 flex flex-col justify-end gap-4 sm:flex-row">
              <button
                type="button"
                disabled={
                  isSubmitting ||
                  isClassifying
                }
                onClick={() =>
                  router.push("/studies")
                }
                className="rounded-xl border border-white/20 bg-white/10 px-7 py-3.5 font-semibold text-white backdrop-blur-xl transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  isClassifying
                }
                className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-8 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.3)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
              >
                {isClassifying
                  ? "Checking image..."
                  : isSubmitting
                    ? "Saving study..."
                    : "Save and Analyze"}
              </button>
            </div>
          </form>

          <div className="mt-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-5 backdrop-blur-xl">
            <p className="text-sm leading-6 text-cyan-50">
              AI findings are provided for
              decision-support purposes only. Final
              interpretation and diagnosis must be
              completed by an authorized medical
              professional.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

const inputClasses =
  "w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10";

const selectClasses =
  "w-full rounded-xl border border-white/20 bg-blue-950/70 px-4 py-3.5 text-white outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10";

type LoadingPageProps = {
  message: string;
};

function LoadingPage({
  message,
}: LoadingPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-blue-950">
      <div className="text-center">
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />

        <p className="mt-4 font-semibold text-cyan-100">
          {message}
        </p>
      </div>
    </main>
  );
}

type GlassCardProps = {
  children: ReactNode;
};

function GlassCard({
  children,
}: GlassCardProps) {
  return (
    <section className="rounded-2xl border border-white/15 bg-white/10 p-6 shadow-[0_22px_65px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:p-7">
      {children}
    </section>
  );
}

type CardHeadingProps = {
  number: string;
  title: string;
  description: string;
};

function CardHeading({
  number,
  title,
  description,
}: CardHeadingProps) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/15 font-bold text-cyan-100">
        {number}
      </div>

      <div>
        <h3 className="text-xl font-bold text-white">
          {title}
        </h3>

        <p className="mt-1 text-sm leading-6 text-slate-300">
          {description}
        </p>
      </div>
    </div>
  );
}

type FormFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
};

function FormField({
  id,
  label,
  required = false,
  children,
}: FormFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-semibold text-slate-200"
      >
        {label}

        {required && (
          <span className="ml-1 text-red-300">
            *
          </span>
        )}
      </label>

      {children}
    </div>
  );
}

type MenuButtonProps = {
  label: string;
  active?: boolean;
  onClick: () => void;
};

function MenuButton({
  label,
  active = false,
  onClick,
}: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "w-full rounded-xl border border-cyan-300/25 bg-cyan-300/15 px-4 py-3 text-left font-semibold text-cyan-100 shadow-[0_10px_30px_rgba(34,211,238,0.1)] backdrop-blur-xl"
          : "w-full rounded-xl border border-transparent px-4 py-3 text-left font-medium text-slate-200 transition hover:border-white/15 hover:bg-white/10"
      }
    >
      {label}
    </button>
  );
}

type FileInfoProps = {
  label: string;
  value: string;
};

function FileInfo({
  label,
  value,
}: FileInfoProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-2 break-all text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(
      1
    )} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}