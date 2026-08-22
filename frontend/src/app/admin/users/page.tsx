"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AdminNav from "@/components/AdminNav";
import { authClient } from "@/client/auth/auth-client";

type UiRole = "admin" | "doctor" | "patient";

type UserDraft = {
  id: string;
  role: UiRole;
  name: string;
  email: string;
  phone: string;
  summary: string;
  createdAt: string;
};

type DraftForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: UiRole;
  adminDepartment: string;
  adminScope: string;
  doctorSpecialty: string;
  doctorLicense: string;
  doctorClinic: string;
  patientDob: string;
  patientGender: string;
  patientNationalId: string;
  patientEmergencyContact: string;
};

type SessionUser = {
  role?: string | string[] | null;
};

type ListedAuthUser = {
  id: string;
  email: string;
};

type ListUsersPayload =
  | { users?: ListedAuthUser[] }
  | ListedAuthUser[]
  | null;

const roleOptions: Array<{
  value: UiRole;
  label: string;
  description: string;
}> = [
  {
    value: "admin",
    label: "Admin",
    description: "Platform control, user management and audit access.",
  },
  {
    value: "doctor",
    label: "Doctor",
    description: "Reviews studies, approves reports and follows cases.",
  },
  {
    value: "patient",
    label: "Patient",
    description: "Uploads scans, views results and follows treatment.",
  },
];

const defaultForm: DraftForm = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "patient",
  adminDepartment: "",
  adminScope: "",
  doctorSpecialty: "",
  doctorLicense: "",
  doctorClinic: "",
  patientDob: "",
  patientGender: "",
  patientNationalId: "",
  patientEmergencyContact: "",
};

const localStorageKey = "radiocare-user-drafts";

const roleDetailHints: Record<UiRole, string[]> = {
  admin: ["Department or team", "Access scope", "Employee or staff ID"],
  doctor: ["Medical specialty", "License number", "Clinic or hospital"],
  patient: ["Date of birth", "Emergency contact", "National ID or file number"],
};

export default function AdminUsersPage() {
  const router = useRouter();

  const { data: session, isPending } = authClient.useSession();

  const [form, setForm] = useState<DraftForm>(defaultForm);
  const [drafts, setDrafts] = useState<UserDraft[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/");
    }
  }, [isPending, router, session]);

  const currentUser = session?.user as SessionUser | undefined;

  const userRoles = (
    Array.isArray(currentUser?.role)
      ? currentUser.role
      : (currentUser?.role || "").split(",")
  )
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  const isAdmin = userRoles.includes("admin");

  useEffect(() => {
    if (!isPending && session && !isAdmin) {
      router.replace("/unauthorized");
    }
  }, [isAdmin, isPending, router, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(localStorageKey);

        if (stored) {
          const parsed = JSON.parse(stored) as UserDraft[];
          setDrafts(Array.isArray(parsed) ? parsed : []);
        }
      } catch (storageError) {
        console.error("Failed to read drafts:", storageError);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(localStorageKey, JSON.stringify(drafts));
    } catch (storageError) {
      console.error("Failed to save drafts:", storageError);
    }
  }, [drafts]);

  const activeRoleOption = useMemo(
    () =>
      roleOptions.find((option) => option.value === form.role) ||
      roleOptions[0],
    [form.role],
  );

  const commonFields = [
    {
      id: "name",
      label: "Full name",
      placeholder: "Enter full name",
      value: form.name,
    },
    {
      id: "email",
      label: "Email address",
      placeholder: "user@example.com",
      value: form.email,
    },
    {
      id: "phone",
      label: "Phone number",
      placeholder: "+970 59 000 0000",
      value: form.phone,
    },
    {
      id: "password",
      label: "Password",
      placeholder: "At least 8 characters",
      value: form.password,
    },
  ] as const;

  function updateField<K extends keyof DraftForm>(
    field: K,
    value: DraftForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));

    setMessage("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage("");
    setError("");

    const trimmedName = form.name.trim();
    const trimmedEmail = form.email.trim().toLowerCase();
    const trimmedPhone = form.phone.trim();
    const trimmedPassword = form.password.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone || !trimmedPassword) {
      setError("Please complete the common account fields.");
      return;
    }

    if (trimmedPassword.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    const roleSpecificReady =
      form.role === "admin"
        ? Boolean(form.adminDepartment.trim() && form.adminScope.trim())
        : form.role === "doctor"
          ? Boolean(
              form.doctorSpecialty.trim() &&
              form.doctorLicense.trim() &&
              form.doctorClinic.trim(),
            )
          : Boolean(
              form.patientDob.trim() &&
              form.patientGender.trim() &&
              form.patientEmergencyContact.trim(),
            );

    if (!roleSpecificReady) {
      setError("Please complete the fields that match the selected role.");
      return;
    }

    const baseSummary =
      form.role === "admin"
        ? `${form.adminDepartment} · ${form.adminScope}`
        : form.role === "doctor"
          ? `${form.doctorSpecialty} · ${form.doctorClinic}`
          : `${form.patientDob} · ${form.patientEmergencyContact}`;

    setIsSaving(true);

    try {
      const { error: createUserError } = await authClient.admin.createUser({
        name: trimmedName,
        email: trimmedEmail,
        password: trimmedPassword,
        role: form.role,
      });

      const createErrorMessage =
        createUserError?.message?.trim() || "";
      const userAlreadyExists = /already exists|user exists/i.test(
        createErrorMessage,
      );

      if (createUserError && !userAlreadyExists) {
        setError(createErrorMessage || "Unable to create the account.");
        return;
      }

      /*
       * Find the user and explicitly set the role and password.
       * This also repairs an existing user whose credential account
       * was not created correctly by the admin create-user endpoint.
       */
      const { data: usersData, error: listUsersError } =
        await authClient.admin.listUsers({
          query: {
            searchValue: trimmedEmail,
            searchField: "email",
            searchOperator: "contains",
            limit: 10,
            offset: 0,
          },
        });

      if (listUsersError) {
        setError(
          listUsersError.message ||
            "The account was created, but it could not be verified.",
        );
        return;
      }

      const usersPayload = usersData as ListUsersPayload;
      const users = Array.isArray(usersPayload)
        ? usersPayload
        : usersPayload?.users ?? [];

      const createdUser = users.find(
        (user) => user.email.trim().toLowerCase() === trimmedEmail,
      );

      if (!createdUser) {
        setError(
          "The account was created, but the user could not be found to finish password setup.",
        );
        return;
      }

      const { error: roleError } = await authClient.admin.setRole({
        userId: createdUser.id,
        role: form.role,
      });

      if (roleError) {
        setError(
          roleError.message ||
            "The user was found, but the selected role could not be saved.",
        );
        return;
      }

      const { error: passwordError } =
        await authClient.admin.setUserPassword({
          userId: createdUser.id,
          newPassword: trimmedPassword,
        });

      if (passwordError) {
        setError(
          passwordError.message ||
            "The user was found, but the password could not be activated.",
        );
        return;
      }

      const draft: UserDraft = {
        id: `USR-${Date.now()}`,
        role: form.role,
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        summary: baseSummary,
        createdAt: new Date().toISOString(),
      };

      setDrafts((current) => [
        draft,
        ...current.filter(
          (savedDraft) =>
            savedDraft.email.trim().toLowerCase() !== trimmedEmail,
        ),
      ]);

      setMessage(
        userAlreadyExists
          ? `${activeRoleOption.label} login repaired successfully.`
          : `${activeRoleOption.label} account created successfully.`,
      );

      setForm({
        ...defaultForm,
        role: form.role,
      });
    } catch (createError) {
      console.error("Failed to create user:", createError);

      setError("Unable to create the account. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-blue-950 text-white">
        <p className="font-semibold text-cyan-100">
          Loading user management...
        </p>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-blue-950 text-white">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950" />
      <div className="pointer-events-none fixed -left-40 top-16 h-[500px] w-[500px] rounded-full bg-blue-500/25 blur-[160px]" />
      <div className="pointer-events-none fixed -right-40 bottom-0 h-[540px] w-[540px] rounded-full bg-cyan-400/20 blur-[170px]" />

      <header className="sticky top-0 z-40 border-b border-white/15 bg-blue-950/45 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
        {/*
          The logo opens the bar and the menu follows it; the way back
          sits at the far end, where a leave action is expected.
        */}
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-3 px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="flex items-center"
          >
            <div className="flex h-9 w-9 overflow-hidden rounded-[14px] border border-white/25 bg-white/10 shadow-lg backdrop-blur-xl">
              <Image
                src="/images/radiocare-icon.png"
                alt="RadioCare logo"
                width={36}
                height={36}
                className="h-full w-full object-contain p-[2px]"
                priority
              />
            </div>
          </button>

          <div className="min-w-0 flex-1">
            <AdminNav compact />
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="ml-auto rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-sm backdrop-blur-xl transition hover:bg-white/15"
          >
            Back to dashboard
          </button>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid max-w-[1700px] gap-6 px-5 py-8 lg:grid-cols-[1.1fr_0.9fr] sm:px-7">
        <div className="rounded-[30px] border border-white/15 bg-white/10 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-8">
          <p className="font-semibold text-cyan-300">User Management</p>

          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            Create account by role
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Select the role first, then fill only the information that really
            matters for that user. Admins need access details, doctors need
            credential and specialty details, and patients need identity and
            contact details.
          </p>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <section className="grid gap-4 md:grid-cols-3">
              {roleOptions.map((option) => {
                const isActive = form.role === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isSaving}
                    onClick={() => updateField("role", option.value)}
                    className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive
                        ? "border-cyan-300/40 bg-cyan-300/15 shadow-[0_15px_40px_rgba(34,211,238,0.12)]"
                        : "border-white/15 bg-white/5 hover:border-white/25 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-sm font-semibold text-cyan-200">
                      {option.label}
                    </div>

                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              {commonFields.map((field) => (
                <label
                  key={field.id}
                  className="block text-sm font-semibold text-slate-200"
                >
                  {field.label}

                  <input
                    type={field.id === "password" ? "password" : "text"}
                    value={field.value}
                    onChange={(event) =>
                      updateField(
                        field.id as keyof DraftForm,
                        event.target.value as DraftForm[keyof DraftForm],
                      )
                    }
                    required
                    disabled={isSaving}
                    placeholder={field.placeholder}
                    className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              ))}
            </section>

            {form.role === "admin" && (
              <section className="grid gap-5 md:grid-cols-2">
                <TextField
                  label="Department"
                  value={form.adminDepartment}
                  onChange={(value) => updateField("adminDepartment", value)}
                  placeholder="IT, Operations, or Management"
                  disabled={isSaving}
                />

                <TextField
                  label="Access scope"
                  value={form.adminScope}
                  onChange={(value) => updateField("adminScope", value)}
                  placeholder="Full access, limited access, reports only"
                  disabled={isSaving}
                />
              </section>
            )}

            {form.role === "doctor" && (
              <section className="grid gap-5 md:grid-cols-3">
                <TextField
                  label="Specialty"
                  value={form.doctorSpecialty}
                  onChange={(value) => updateField("doctorSpecialty", value)}
                  placeholder="Radiology, Cardiology..."
                  disabled={isSaving}
                />

                <TextField
                  label="License number"
                  value={form.doctorLicense}
                  onChange={(value) => updateField("doctorLicense", value)}
                  placeholder="Medical license ID"
                  disabled={isSaving}
                />

                <TextField
                  label="Clinic / hospital"
                  value={form.doctorClinic}
                  onChange={(value) => updateField("doctorClinic", value)}
                  placeholder="Hospital or clinic name"
                  disabled={isSaving}
                />
              </section>
            )}

            {form.role === "patient" && (
              <section className="grid gap-5 md:grid-cols-2">
                <TextField
                  label="Date of birth"
                  value={form.patientDob}
                  onChange={(value) => updateField("patientDob", value)}
                  placeholder="YYYY-MM-DD"
                  disabled={isSaving}
                />

                <TextField
                  label="Gender"
                  value={form.patientGender}
                  onChange={(value) => updateField("patientGender", value)}
                  placeholder="Male / Female"
                  disabled={isSaving}
                />

                <TextField
                  label="National ID / file number"
                  value={form.patientNationalId}
                  onChange={(value) => updateField("patientNationalId", value)}
                  placeholder="Optional but useful"
                  disabled={isSaving}
                  required={false}
                />

                <TextField
                  label="Emergency contact"
                  value={form.patientEmergencyContact}
                  onChange={(value) =>
                    updateField("patientEmergencyContact", value)
                  }
                  placeholder="Name and phone number"
                  disabled={isSaving}
                />
              </section>
            )}

            {error && (
              <div className="rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-3 text-sm text-red-100 backdrop-blur-xl">
                {error}
              </div>
            )}

            {message && (
              <div className="rounded-xl border border-green-300/30 bg-green-500/20 px-4 py-3 text-sm text-green-100 backdrop-blur-xl">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={isSaving}
              className="rounded-xl border border-cyan-300/20 bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 font-semibold text-white shadow-[0_14px_40px_rgba(14,116,255,0.30)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60"
            >
              {isSaving
                ? "Creating account..."
                : `Create ${activeRoleOption.label} account`}
            </button>
          </form>
        </div>

        <aside className="space-y-6">
          <div className="rounded-[30px] border border-white/15 bg-white/10 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-300">
              Recommended fields
            </p>

            <h2 className="mt-2 text-2xl font-bold text-white">
              What each role should provide
            </h2>

            <div className="mt-5 space-y-4">
              {roleOptions.map((option) => (
                <div
                  key={option.value}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-white">{option.label}</h3>

                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
                      {option.value === "doctor" ? "doctor" : option.value}
                    </span>
                  </div>

                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
                    {roleDetailHints[option.value].map((hint) => (
                      <li key={hint}>• {hint}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-white/15 bg-white/10 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
            <p className="text-sm font-semibold text-cyan-300">
              Created accounts
            </p>

            <h2 className="mt-2 text-2xl font-bold text-white">
              Recent created profiles
            </h2>

            <div className="mt-5 space-y-3">
              {drafts.length === 0 ? (
                <p className="text-sm leading-6 text-slate-300">
                  No accounts created yet.
                </p>
              ) : (
                drafts.map((draft) => (
                  <article
                    key={draft.id}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-semibold text-white">
                          {draft.name}
                        </h3>

                        <p className="text-sm text-slate-300">{draft.email}</p>
                      </div>

                      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100 capitalize">
                        {draft.role}
                      </span>
                    </div>

                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {draft.summary}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        </aside>
      </section>

      <AccountManagement />
    </main>
  );
}

type ManagedAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  createdAt: string;
};

/*
  Management of the accounts that already exist: change the role,
  suspend or reactivate an account, and issue a new password.
*/
function AccountManagement() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);

  /*
    The account list is folded away by default. It grows with every
    patient and doctor, and the numbers an administrator reads at a
    glance stay on the closed header, so nothing is hidden silently.
  */
  const [isAccountsOpen, setIsAccountsOpen] = useState(false);

  const suspendedCount = accounts.filter(
    (account) => account.banned,
  ).length;
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [passwordFor, setPasswordFor] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function loadAccounts() {
    try {
      setIsLoading(true);

      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 200 },
      });

      if (error) {
        throw new Error(error.message || "Unable to load the accounts.");
      }

      const payload = data as unknown as
        | { users?: ManagedAccount[] }
        | ManagedAccount[]
        | null;

      const list = Array.isArray(payload)
        ? payload
        : (payload?.users ?? []);

      setAccounts(
        list.map((user) => ({
          id: String(user.id),
          name: String(user.name ?? ""),
          email: String(user.email ?? ""),
          role: String(user.role ?? "patient"),
          banned: Boolean(user.banned),
          createdAt: String(user.createdAt ?? ""),
        })),
      );

      setErrorText("");
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : "Unable to load the accounts.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function runAction(
    accountId: string,
    action: () => Promise<{ error?: { message?: string } | null }>,
    successText: string,
  ) {
    try {
      setBusyId(accountId);
      setMessage("");
      setErrorText("");

      const { error } = await action();

      if (error) {
        throw new Error(error.message || "The action failed.");
      }

      setMessage(successText);
      await loadAccounts();
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : "The action failed.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="mx-auto mt-8 w-full max-w-7xl px-6 pb-10">
      <div className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setIsAccountsOpen((open) => !open)}
            aria-expanded={isAccountsOpen}
            className="flex flex-1 items-center gap-4 text-left"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-lg font-black text-cyan-100">
              {isAccountsOpen ? "−" : "+"}
            </span>

            <span>
              <span className="block text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                Existing accounts
              </span>

              <span className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-black text-white">
                  Manage Accounts
                </h2>

                {accounts.length > 0 && (
                  <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-100">
                    {accounts.length} account
                    {accounts.length === 1 ? "" : "s"}
                  </span>
                )}

                {suspendedCount > 0 && (
                  <span className="rounded-full border border-rose-300/30 bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-100">
                    {suspendedCount} suspended
                  </span>
                )}
              </span>

              <span className="mt-2 block text-slate-300">
                Change a role, suspend an account, or issue a new password.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => void loadAccounts()}
            disabled={isLoading}
            className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {message && (
          <p className="mt-5 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-100">
            {message}
          </p>
        )}

        {errorText && (
          <p className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
            {errorText}
          </p>
        )}

        {isAccountsOpen && (
        <div className="mt-6 flex flex-col gap-3">
          {isLoading ? (
            <p className="rounded-2xl border border-white/15 bg-white/[0.05] p-6 text-center text-slate-300">
              Loading accounts...
            </p>
          ) : accounts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/20 bg-white/[0.04] p-8 text-center text-slate-300">
              No accounts found.
            </p>
          ) : (
            accounts.map((account) => (
              <article
                key={account.id}
                className="rounded-2xl border border-white/15 bg-white/[0.05] p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-white">
                      {account.name || "Unnamed account"}
                    </p>
                    <p className="mt-1 truncate text-sm text-slate-400">
                      {account.email}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-300/15 px-3 py-1 text-xs font-bold capitalize text-cyan-100">
                      {account.role}
                    </span>

                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        account.banned
                          ? "border-rose-300/30 bg-rose-500/15 text-rose-100"
                          : "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                      }`}
                    >
                      {account.banned ? "Suspended" : "Active"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select
                    value={account.role}
                    disabled={busyId === account.id}
                    onChange={(event) =>
                      void runAction(
                        account.id,
                        () =>
                          authClient.admin.setRole({
                            userId: account.id,
                            role: event.target
                              .value as unknown as UiRole,
                          }),
                        "The role was updated.",
                      )
                    }
                    className="rounded-xl border border-white/20 bg-[#17315a] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                  >
                    <option value="admin">admin</option>
                    <option value="doctor">doctor</option>
                    <option value="patient">patient</option>
                  </select>

                  {account.banned ? (
                    <button
                      type="button"
                      disabled={busyId === account.id}
                      onClick={() =>
                        void runAction(
                          account.id,
                          () =>
                            authClient.admin.unbanUser({
                              userId: account.id,
                            }),
                          "The account was reactivated.",
                        )
                      }
                      className="rounded-xl border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-sm font-bold text-emerald-100 transition hover:bg-emerald-400/25 disabled:opacity-50"
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === account.id}
                      onClick={() =>
                        void runAction(
                          account.id,
                          () =>
                            authClient.admin.banUser({
                              userId: account.id,
                              banReason:
                                "Suspended by an administrator.",
                            }),
                          "The account was suspended.",
                        )
                      }
                      className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-2 text-sm font-bold text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setPasswordFor(
                        passwordFor === account.id ? "" : account.id,
                      );
                      setNewPassword("");
                    }}
                    className="rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2 text-sm font-bold text-slate-200 transition hover:text-white"
                  >
                    Reset password
                  </button>
                </div>

                {passwordFor === account.id && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(event) =>
                        setNewPassword(event.target.value)
                      }
                      placeholder="New password (at least 8 characters)"
                      className="min-w-56 flex-1 rounded-xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
                    />

                    <button
                      type="button"
                      disabled={
                        busyId === account.id ||
                        newPassword.trim().length < 8
                      }
                      onClick={() =>
                        void runAction(
                          account.id,
                          () =>
                            authClient.admin.setUserPassword({
                              userId: account.id,
                              newPassword: newPassword.trim(),
                            }),
                          "The new password is active.",
                        ).then(() => {
                          setPasswordFor("");
                          setNewPassword("");
                        })
                      }
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50"
                    >
                      Save password
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
        )}
      </div>
    </section>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
};

function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  required = true,
}: TextFieldProps) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      {label}

      <input
        type="text"
        value={value}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3.5 text-white outline-none backdrop-blur-xl transition placeholder:text-slate-400 focus:border-cyan-300 focus:bg-white/15 focus:ring-4 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}
