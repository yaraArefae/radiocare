"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";

/*
  The form somebody fills in to apply for a secretary post.

  It is deliberately shorter than the doctor's. A secretary holds no
  medical licence and has no specialty, so asking for either would be
  asking for paper that does not exist. What is asked for is who they
  are, what trained them for the desk, and whatever proof of previous
  work they have.

  The doctor they will work for is not asked at all. That is the
  administration's decision, made when the application is approved.
*/

type SecretaryRequestForm = {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationalId: string;

  qualification: string;
  institute: string;
  graduationYear: string;

  yearsOfExperience: string;
  currentWorkplace: string;
  about: string;

  declarationAccepted: boolean;
};

const defaultForm: SecretaryRequestForm = {
  fullName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  nationalId: "",

  qualification: "",
  institute: "",
  graduationYear: "",

  yearsOfExperience: "",
  currentWorkplace: "",
  about: "",

  declarationAccepted: false,
};

const LANGUAGE_CHOICES = [
  "Arabic",
  "English",
  "Hebrew",
  "French",
  "Turkish",
];

type FileField =
  | "id-document"
  | "qualification-certificate"
  | "experience-certificate"
  | "cv";

const REQUIRED_FILES: FileField[] = [
  "id-document",
  "qualification-certificate",
];

export default function SecretaryRequestPage() {
  const [form, setForm] = useState<SecretaryRequestForm>(defaultForm);

  const [files, setFiles] = useState<
    Partial<Record<FileField, File | null>>
  >({});

  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");

  const [languages, setLanguages] = useState<string[]>(["Arabic"]);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField<K extends keyof SecretaryRequestForm>(
    field: K,
    value: SecretaryRequestForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setMessage("");
  }

  function handleFileSelection(
    event: ChangeEvent<HTMLInputElement>,
    field: FileField,
  ) {
    const file = event.target.files?.[0] ?? null;

    setFiles((current) => ({ ...current, [field]: file }));
    setError("");
  }

  function handlePhotoSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    setPhoto(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : "");
    setError("");
  }

  function toggleLanguage(language: string) {
    setLanguages((current) =>
      current.includes(language)
        ? current.filter((item) => item !== language)
        : [...current, language],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setMessage("");
    setApplicationId("");

    for (const field of REQUIRED_FILES) {
      if (!files[field]) {
        setError(
          "Please attach your ID document and your qualification certificate.",
        );
        return;
      }
    }

    if (!form.declarationAccepted) {
      setError("You must accept the declaration before submitting.");
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = new FormData();

      payload.append(
        "application",
        JSON.stringify({
          ...form,
          yearsOfExperience: Number(form.yearsOfExperience || 0),
          graduationYear: form.graduationYear || null,
          languages,
        }),
      );

      for (const [field, file] of Object.entries(files)) {
        if (file) payload.append(field, file);
      }

      if (photo) payload.append("profile-photo", photo);

      const response = await fetch("/api/secretary-requests", {
        method: "POST",
        body: payload,
      });

      const data = (await response.json()) as {
        message?: string;
        applicationId?: string;
      };

      if (!response.ok) {
        setError(
          data.message || "Unable to submit the secretary application.",
        );
        return;
      }

      setMessage(
        data.message || "Secretary application submitted successfully.",
      );

      setApplicationId(data.applicationId || "");
      setForm(defaultForm);
      setFiles({});
      setPhoto(null);
      setPhotoPreview("");
    } catch (submitError) {
      console.error("Failed to submit secretary application:", submitError);

      setError("Unable to connect to the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-10 h-[520px] w-[520px] rounded-full bg-blue-500/25 blur-[170px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[560px] w-[560px] rounded-full bg-cyan-400/20 blur-[180px]" />

      <header className="relative z-20 border-b border-white/15 bg-blue-950/45 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-7">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 overflow-hidden rounded-2xl border border-white/20 bg-white/10 shadow-lg">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={44}
                height={44}
                className="h-full w-full object-contain p-1"
                priority
              />
            </div>

            <div>
              <p className="font-bold text-white">RadioCare</p>
              <p className="text-xs text-cyan-200">
                Secretary Registration
              </p>
            </div>
          </Link>

          <Link
            href="/"
            className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Back to sign in
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-5 py-10 sm:px-7">
        <div className="mb-8">
          <p className="font-semibold text-cyan-300">
            Secretary application
          </p>

          <h1 className="mt-2 text-3xl font-bold sm:text-5xl">
            Apply for a secretary post
          </h1>

          <p className="mt-4 max-w-3xl leading-7 text-slate-300">
            Send your details and your certificates. An administrator
            reviews every application, decides which doctor you would work
            with, and creates your sign-in details once you are approved.
            You are not asked for a medical licence: a secretary manages
            appointments, and never reads studies or reports.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-7 rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-8"
        >
          <FormSection
            title="Personal information"
            description="Who you are and how the administration can reach you."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                label="Full legal name"
                value={form.fullName}
                onChange={(value) => updateField("fullName", value)}
                placeholder="Enter your full legal name"
              />

              <TextField
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => updateField("email", value)}
                placeholder="Where the approval will be sent"
              />

              <TextField
                label="Phone"
                value={form.phone}
                onChange={(value) => updateField("phone", value)}
                placeholder="Mobile number"
              />

              <TextField
                label="National ID or passport"
                value={form.nationalId}
                onChange={(value) => updateField("nationalId", value)}
                placeholder="Identity number"
              />

              <TextField
                label="Date of birth (optional)"
                type="date"
                required={false}
                value={form.dateOfBirth}
                onChange={(value) => updateField("dateOfBirth", value)}
                placeholder=""
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/15 bg-white/5 p-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10">
                {photoPreview ? (
                  /*
                    A local preview of a file the browser has not
                    uploaded yet, so this cannot go through next/image.
                  */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt="Selected portrait"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-3xl">🙂</span>
                )}
              </div>

              <label className="flex-1 text-sm font-semibold text-slate-200">
                Photo (optional)
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={handlePhotoSelection}
                  className="mt-2 block w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-400/15 file:px-4 file:py-2 file:font-semibold file:text-cyan-100"
                />
                <span className="mt-2 block text-xs text-slate-400">
                  Shown to the doctor you work with. Your initials are
                  used if you do not send one.
                </span>
              </label>
            </div>
          </FormSection>

          <FormSection
            title="Qualification"
            description="What trained you for this work. A secretarial, administrative, or medical-secretary qualification is what is normally expected."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                label="Qualification"
                value={form.qualification}
                onChange={(value) => updateField("qualification", value)}
                placeholder="Diploma in Medical Secretarial Studies"
              />

              <TextField
                label="College or institute"
                value={form.institute}
                onChange={(value) => updateField("institute", value)}
                placeholder="Where you studied"
              />

              <TextField
                label="Graduation year (optional)"
                type="number"
                required={false}
                min="1950"
                max="2100"
                value={form.graduationYear}
                onChange={(value) => updateField("graduationYear", value)}
                placeholder="2022"
              />
            </div>
          </FormSection>

          <FormSection
            title="Experience"
            description="Previous work is welcome but not required. An applicant with no experience is still considered."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                label="Years of experience"
                type="number"
                min="0"
                max="60"
                value={form.yearsOfExperience}
                onChange={(value) =>
                  updateField("yearsOfExperience", value)
                }
                placeholder="0"
              />

              <TextField
                label="Current or last workplace (optional)"
                required={false}
                value={form.currentWorkplace}
                onChange={(value) =>
                  updateField("currentWorkplace", value)
                }
                placeholder="Clinic or hospital"
              />
            </div>

            <div className="mt-5">
              <p className="text-sm font-semibold text-slate-200">
                Languages you speak
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {LANGUAGE_CHOICES.map((language) => {
                  const active = languages.includes(language);

                  return (
                    <button
                      key={language}
                      type="button"
                      onClick={() => toggleLanguage(language)}
                      className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-cyan-300/50 bg-cyan-400/20 text-cyan-50"
                          : "border-white/20 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      {language}
                    </button>
                  );
                })}
              </div>

              <p className="mt-2 text-xs text-slate-400">
                A patient calling to move an appointment has to be
                understood, so this is worth getting right.
              </p>
            </div>

            <label className="mt-5 block text-sm font-semibold text-slate-200">
              Anything else (optional)
              <textarea
                value={form.about}
                onChange={(event) =>
                  updateField("about", event.target.value)
                }
                rows={4}
                placeholder="Tell the administration anything that would not fit above."
                className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15"
              />
            </label>
          </FormSection>

          <FormSection
            title="Certificates"
            description="Your identity paper and your qualification are required. The other two help, and an application without them is still reviewed."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <FileField
                label="ID document or passport"
                required
                file={files["id-document"] ?? null}
                onChange={(event) =>
                  handleFileSelection(event, "id-document")
                }
              />

              <FileField
                label="Qualification certificate"
                required
                file={files["qualification-certificate"] ?? null}
                onChange={(event) =>
                  handleFileSelection(event, "qualification-certificate")
                }
              />

              <FileField
                label="Experience certificate (optional)"
                required={false}
                file={files["experience-certificate"] ?? null}
                onChange={(event) =>
                  handleFileSelection(event, "experience-certificate")
                }
              />

              <FileField
                label="CV (optional)"
                required={false}
                file={files.cv ?? null}
                onChange={(event) => handleFileSelection(event, "cv")}
              />
            </div>
          </FormSection>

          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
            The administrator decides which doctor you will work with
            after reviewing your certificates. You will be able to book,
            move and cancel appointments in that doctor&apos;s calendar,
            and nothing else: studies, AI results and reports stay out of
            this account.
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            <input
              type="checkbox"
              checked={form.declarationAccepted}
              onChange={(event) =>
                updateField("declarationAccepted", event.target.checked)
              }
              className="mt-1 h-5 w-5 accent-cyan-400"
            />

            <span>
              I confirm that the information and certificates submitted
              are accurate, and I authorize RadioCare administrators to
              verify them.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100"
            >
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-2xl border border-green-300/30 bg-green-500/20 px-4 py-4 text-sm text-green-100">
              <p className="font-semibold">{message}</p>

              {applicationId && (
                <p className="mt-2">Request ID: {applicationId}</p>
              )}

              <p className="mt-2">Status: Pending administrator review</p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3.5 font-semibold text-white shadow-[0_15px_40px_rgba(14,116,255,0.3)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
            >
              {isSubmitting
                ? "Submitting application..."
                : "Submit Secretary Application"}
            </button>

            <Link
              href="/"
              className="rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-center font-semibold text-white transition hover:bg-white/15"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
      <h2 className="text-xl font-bold text-white">{title}</h2>

      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = true,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type={type}
        value={value}
        required={required}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10"
      />
    </label>
  );
}

function FileField({
  label,
  file,
  required,
  onChange,
}: {
  label: string;
  file: File | null;
  required: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type="file"
        required={required}
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={onChange}
        className="mt-2 block w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-400/15 file:px-4 file:py-2 file:font-semibold file:text-cyan-100"
      />

      {file && (
        <span className="mt-2 block text-xs text-cyan-200">
          Selected: {file.name}
        </span>
      )}
    </label>
  );
}
