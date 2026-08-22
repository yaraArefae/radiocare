"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";

type DoctorRequestForm = {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  nationalId: string;

  specialty: string;
  subspecialty: string;

  licenseNumber: string;
  licensingAuthority: string;
  licenseCountry: string;
  licenseIssueDate: string;
  licenseExpiryDate: string;

  yearsOfExperience: string;
  currentWorkplace: string;
  medicalDegree: string;
  university: string;
  graduationYear: string;

  idDocumentPath: string;
  medicalLicensePath: string;
  specialtyCertificatePath: string;
  cvPath: string;

  declarationAccepted: boolean;
};

const defaultForm: DoctorRequestForm = {
  fullName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  nationalId: "",

  specialty: "",
  subspecialty: "",

  licenseNumber: "",
  licensingAuthority: "",
  licenseCountry: "",
  licenseIssueDate: "",
  licenseExpiryDate: "",

  yearsOfExperience: "",
  currentWorkplace: "",
  medicalDegree: "",
  university: "",
  graduationYear: "",

  idDocumentPath: "",
  medicalLicensePath: "",
  specialtyCertificatePath: "",
  cvPath: "",

  declarationAccepted: false,
};

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
};

export default function DoctorRequestPage() {
  const [form, setForm] =
    useState<DoctorRequestForm>(defaultForm);

  /*
    The chosen documents, kept next to the text fields so they can be
    sent with the application instead of only their names.
  */
  const [selectedFiles, setSelectedFiles] = useState<{
    idDocumentPath: File | null;
    medicalLicensePath: File | null;
    specialtyCertificatePath: File | null;
    cvPath: File | null;
  }>({
    idDocumentPath: null,
    medicalLicensePath: null,
    specialtyCertificatePath: null,
    cvPath: null,
  });

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [applicationId, setApplicationId] =
    useState("");
  const [isSubmitting, setIsSubmitting] =
    useState(false);

  function updateField<K extends keyof DoctorRequestForm>(
    field: K,
    value: DoctorRequestForm[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setError("");
    setMessage("");
  }

  /*
    The chosen file is held so it can be sent with the request. Only its
    name used to be kept, which left an administrator verifying a
    medical licence while looking at the word "licence.pdf".
  */
  function handleFileSelection(
    event: ChangeEvent<HTMLInputElement>,
    field:
      | "idDocumentPath"
      | "medicalLicensePath"
      | "specialtyCertificatePath"
      | "cvPath"
  ) {
    const file = event.target.files?.[0] ?? null;

    setSelectedFiles((current) => ({ ...current, [field]: file }));

    updateField(field, file ? file.name : "");
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setMessage("");
    setApplicationId("");

    if (
      !form.idDocumentPath ||
      !form.medicalLicensePath ||
      !form.specialtyCertificatePath ||
      !form.cvPath
    ) {
      setError(
        "Please attach all required documents."
      );
      return;
    }

    if (!form.declarationAccepted) {
      setError(
        "You must accept the declaration before submitting."
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        "/api/doctor-requests",
        {
          method: "POST",
          /*
            Sent as multipart so the documents travel with the fields.
            No Content-Type header: the browser sets it with the
            boundary that separates the parts.
          */
          body: (() => {
            const payload = new FormData();

            payload.append(
              "application",
              JSON.stringify({
                ...form,
                yearsOfExperience: Number(form.yearsOfExperience),
                graduationYear: Number(form.graduationYear),
                additionalDocuments: [],
              }),
            );

            const documentParts: Array<
              [string, keyof typeof selectedFiles]
            > = [
              ["id-document", "idDocumentPath"],
              ["medical-license", "medicalLicensePath"],
              ["specialty-certificate", "specialtyCertificatePath"],
              ["cv", "cvPath"],
            ];

            for (const [partName, field] of documentParts) {
              const file = selectedFiles[field];

              if (file) payload.append(partName, file);
            }

            return payload;
          })(),
        }
      );

      const data = (await response.json()) as {
        message?: string;
        applicationId?: string;
      };

      if (!response.ok) {
        setError(
          data.message ||
            "Unable to submit the doctor request."
        );
        return;
      }

      setMessage(
        data.message ||
          "Doctor request submitted successfully."
      );

      setApplicationId(data.applicationId || "");
      setForm(defaultForm);
    } catch (submitError) {
      console.error(
        "Failed to submit doctor request:",
        submitError
      );

      setError(
        "Unable to connect to the server. Please try again."
      );
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
          <Link
            href="/"
            className="flex items-center gap-3"
          >
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
              <p className="font-bold text-white">
                RadioCare
              </p>
              <p className="text-xs text-cyan-200">
                Doctor Registration
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

      <section className="relative z-10 mx-auto max-w-7xl px-5 py-10 sm:px-7">
        <div className="mb-8">
          <p className="font-semibold text-cyan-300">
            Doctor credentialing request
          </p>

          <h1 className="mt-2 text-3xl font-bold sm:text-5xl">
            Apply to join RadioCare
          </h1>

          <p className="mt-4 max-w-3xl leading-7 text-slate-300">
            Submit your professional information and
            supporting documents. Your request will remain
            pending until it is reviewed by an administrator.
            The administrator will assign your permitted
            imaging types and body regions after verifying
            your specialty and credentials.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-7 rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-8"
        >
          <FormSection
            title="Personal information"
            description="Basic identity and contact details."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                label="Full legal name"
                value={form.fullName}
                onChange={(value) =>
                  updateField("fullName", value)
                }
                placeholder="Enter your full legal name"
              />

              <TextField
                label="Email address"
                value={form.email}
                onChange={(value) =>
                  updateField("email", value)
                }
                placeholder="doctor@example.com"
                type="email"
              />

              <TextField
                label="Phone number"
                value={form.phone}
                onChange={(value) =>
                  updateField("phone", value)
                }
                placeholder="+970 59 000 0000"
                type="tel"
              />

              <TextField
                label="Date of birth"
                value={form.dateOfBirth}
                onChange={(value) =>
                  updateField("dateOfBirth", value)
                }
                placeholder=""
                type="date"
              />

              <TextField
                label="National ID / Passport"
                value={form.nationalId}
                onChange={(value) =>
                  updateField("nationalId", value)
                }
                placeholder="Enter ID or passport number"
              />
            </div>
          </FormSection>

          <FormSection
            title="Medical license"
            description="Information used by the administrator to verify your professional license."
          >
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <TextField
                label="Medical specialty"
                value={form.specialty}
                onChange={(value) =>
                  updateField("specialty", value)
                }
                placeholder="Radiology, Cardiology..."
              />

              <TextField
                label="Subspecialty"
                value={form.subspecialty}
                onChange={(value) =>
                  updateField("subspecialty", value)
                }
                placeholder="Chest radiology, Neuroradiology..."
                required={false}
              />

              <TextField
                label="License number"
                value={form.licenseNumber}
                onChange={(value) =>
                  updateField("licenseNumber", value)
                }
                placeholder="Medical license ID"
              />

              <TextField
                label="Licensing authority"
                value={form.licensingAuthority}
                onChange={(value) =>
                  updateField(
                    "licensingAuthority",
                    value
                  )
                }
                placeholder="Ministry of Health / Medical Council"
              />

              <TextField
                label="License country"
                value={form.licenseCountry}
                onChange={(value) =>
                  updateField("licenseCountry", value)
                }
                placeholder="Country"
                required={false}
              />

              <TextField
                label="License issue date"
                value={form.licenseIssueDate}
                onChange={(value) =>
                  updateField(
                    "licenseIssueDate",
                    value
                  )
                }
                placeholder=""
                type="date"
              />

              <TextField
                label="License expiry date"
                value={form.licenseExpiryDate}
                onChange={(value) =>
                  updateField(
                    "licenseExpiryDate",
                    value
                  )
                }
                placeholder=""
                type="date"
              />
            </div>
          </FormSection>

          <FormSection
            title="Education and experience"
            description="Academic qualifications and current workplace."
          >
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <TextField
                label="Years of experience"
                value={form.yearsOfExperience}
                onChange={(value) =>
                  updateField(
                    "yearsOfExperience",
                    value
                  )
                }
                placeholder="5"
                type="number"
                min="0"
                max="80"
              />

              <TextField
                label="Current hospital / clinic"
                value={form.currentWorkplace}
                onChange={(value) =>
                  updateField(
                    "currentWorkplace",
                    value
                  )
                }
                placeholder="Hospital or clinic name"
              />

              <TextField
                label="Medical degree"
                value={form.medicalDegree}
                onChange={(value) =>
                  updateField("medicalDegree", value)
                }
                placeholder="MD, MBBS..."
              />

              <TextField
                label="University"
                value={form.university}
                onChange={(value) =>
                  updateField("university", value)
                }
                placeholder="University name"
              />

              <TextField
                label="Graduation year"
                value={form.graduationYear}
                onChange={(value) =>
                  updateField(
                    "graduationYear",
                    value
                  )
                }
                placeholder="2020"
                type="number"
                min="1950"
                max="2100"
              />
            </div>
          </FormSection>

          <FormSection
            title="Required documents"
            description="For now the system records the selected file names. Actual file upload will be connected later."
          >
            <div className="grid gap-5 md:grid-cols-2">
              <FileField
                label="ID / Passport document"
                value={form.idDocumentPath}
                onChange={(event) =>
                  handleFileSelection(
                    event,
                    "idDocumentPath"
                  )
                }
              />

              <FileField
                label="Medical license"
                value={form.medicalLicensePath}
                onChange={(event) =>
                  handleFileSelection(
                    event,
                    "medicalLicensePath"
                  )
                }
              />

              <FileField
                label="Specialty certificate"
                value={form.specialtyCertificatePath}
                onChange={(event) =>
                  handleFileSelection(
                    event,
                    "specialtyCertificatePath"
                  )
                }
              />

              <FileField
                label="CV"
                value={form.cvPath}
                onChange={(event) =>
                  handleFileSelection(event, "cvPath")
                }
              />
            </div>
          </FormSection>

          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-6 text-cyan-50">
            The administrator will assign the imaging types
            and body regions you are permitted to review
            after verifying your license, specialty, and
            submitted documents.
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            <input
              type="checkbox"
              checked={form.declarationAccepted}
              onChange={(event) =>
                updateField(
                  "declarationAccepted",
                  event.target.checked
                )
              }
              className="mt-1 h-5 w-5 accent-cyan-400"
            />

            <span>
              I confirm that the information and documents
              submitted are accurate, and I authorize
              RadioCare administrators to verify my
              professional credentials.
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
              <p className="font-semibold">
                {message}
              </p>

              {applicationId && (
                <p className="mt-2">
                  Request ID: {applicationId}
                </p>
              )}

              <p className="mt-2">
                Status: Pending administrator review
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3.5 font-semibold text-white shadow-[0_15px_40px_rgba(14,116,255,0.3)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
            >
              {isSubmitting
                ? "Submitting request..."
                : "Submit Doctor Request"}
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
      <h2 className="text-xl font-bold text-white">
        {title}
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-300">
        {description}
      </p>

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
}: TextFieldProps) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type={type}
        value={value}
        required={required}
        min={min}
        max={max}
        onChange={(event) =>
          onChange(event.target.value)
        }
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10"
      />
    </label>
  );
}

function FileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (
    event: ChangeEvent<HTMLInputElement>
  ) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type="file"
        required
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={onChange}
        className="mt-2 block w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-400/15 file:px-4 file:py-2 file:font-semibold file:text-cyan-100"
      />

      {value && (
        <span className="mt-2 block text-xs text-cyan-200">
          Selected: {value}
        </span>
      )}
    </label>
  );
}
