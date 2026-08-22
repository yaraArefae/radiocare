"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import AdminNav from "@/components/AdminNav";
import SupportChat from "@/components/SupportChat";
import { authClient } from "@/client/auth/auth-client";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 15000;

type SupportThread = {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  messageCount: number;
  unreadCount: number;
  lastMessage: string;
  lastMessageRole: string;
  lastMessageAt: string | null;
};

type SupportAccount = {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  banned: boolean;
  hasThread: boolean;
};

type RoleFilter = "all" | "doctor" | "patient";

function formatRelative(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const minutes = Math.round((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return date.toLocaleDateString();
}

/*
  The administration's inbox.

  Doctors and patients share one list rather than getting a screen each,
  because an administrator works through what is unanswered, and who
  wrote it matters less than how long it has been waiting.
*/
function AdminMessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();

  const isAdmin = useMemo(() => {
    const role = session?.user?.role as string | string[] | undefined;

    return (Array.isArray(role) ? role : String(role ?? "").split(","))
      .map((value) => value.trim().toLowerCase())
      .includes("admin");
  }, [session]);

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  /*
    Starting a conversation with somebody who has not written yet. The
    accounts are only fetched once the picker is opened, because most
    visits to this screen are answers rather than new messages.
  */
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [accounts, setAccounts] = useState<SupportAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [startedAccount, setStartedAccount] = useState<SupportAccount | null>(
    null,
  );

  const loadAccounts = useCallback(async () => {
    setIsLoadingAccounts(true);

    try {
      const response = await fetch(`${backendBaseUrl}/api/support/accounts`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the accounts.");
      }

      setAccounts(data.accounts ?? []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the accounts.",
      );
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  const loadThreads = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/support/threads`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the conversations.");
      }

      setThreads(data.threads ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the conversations.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPending) return;

    if (!session || !isAdmin) {
      router.replace("/");
      return;
    }

    void loadThreads();

    const intervalId = window.setInterval(() => {
      void loadThreads();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isAdmin, isPending, loadThreads, router, session]);

  /*
    A notification links straight to one conversation, so the address
    decides which is open before the list has even loaded.
  */
  useEffect(() => {
    const requested = searchParams.get("userId");

    if (requested) {
      setSelectedUserId(requested);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedUserId && threads.length > 0) {
      setSelectedUserId(threads[0].userId);
    }
  }, [selectedUserId, threads]);

  const visibleThreads = useMemo(
    () =>
      roleFilter === "all"
        ? threads
        : threads.filter((thread) => thread.userRole === roleFilter),
    [roleFilter, threads],
  );

  const selectedThread = threads.find(
    (thread) => thread.userId === selectedUserId,
  );

  const unreadTotal = threads.reduce(
    (total, thread) => total + thread.unreadCount,
    0,
  );

  if (isPending || !session || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
        <p className="font-bold text-cyan-100">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <AdminNav />

        {errorMessage && (
          <p className="mb-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-5 py-4 font-bold text-rose-100">
            {errorMessage}
          </p>
        )}

        <section className="rounded-3xl border border-white/20 bg-white/[0.08] p-7 backdrop-blur-2xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-cyan-300">
                Messages
              </p>

              <h1 className="mt-2 text-3xl font-black text-white">
                {unreadTotal > 0
                  ? `${unreadTotal} message${unreadTotal === 1 ? "" : "s"} waiting`
                  : "Nothing waiting"}
              </h1>

              <p className="mt-2 text-slate-300">
                Conversations with doctors and patients, newest first.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsPickerOpen((current) => {
                    if (!current && accounts.length === 0) {
                      void loadAccounts();
                    }

                    return !current;
                  });
                }}
                className="rounded-2xl border border-cyan-300/60 bg-cyan-400/20 px-4 py-2.5 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/30"
              >
                ✚ New message
              </button>

              {(["all", "doctor", "patient"] as RoleFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRoleFilter(value)}
                  className={`rounded-2xl border px-4 py-2.5 text-sm font-bold capitalize transition ${
                    roleFilter === value
                      ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-100"
                      : "border-white/15 bg-white/[0.06] text-slate-300 hover:border-cyan-300/40"
                  }`}
                >
                  {value === "all" ? "All" : `${value}s`}
                </button>
              ))}
            </div>
          </div>

          {/*
            Every doctor and patient, not only the ones who wrote first.
            An account with no thread yet is opened all the same: the
            conversation starts with the message sent to it.
          */}
          {isPickerOpen && (
            <div className="mt-6 rounded-3xl border border-cyan-300/25 bg-cyan-400/[0.06] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-black text-white">
                  Write to an account
                </p>

                <input
                  type="search"
                  value={accountSearch}
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder="Search a name or an email..."
                  className="w-64 rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
                />
              </div>

              <div className="mt-4 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                {isLoadingAccounts ? (
                  <p className="text-sm text-slate-400">Loading accounts...</p>
                ) : (
                  accounts
                    .filter((account) =>
                      roleFilter === "all"
                        ? true
                        : account.userRole === roleFilter,
                    )
                    .filter((account) => {
                      const needle = accountSearch.trim().toLowerCase();

                      return needle
                        ? `${account.userName} ${account.userEmail}`
                            .toLowerCase()
                            .includes(needle)
                        : true;
                    })
                    .map((account) => (
                      <button
                        key={account.userId}
                        type="button"
                        onClick={() => {
                          setStartedAccount(account);
                          setSelectedUserId(account.userId);
                          setIsPickerOpen(false);
                        }}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.05] px-4 py-3 text-left transition hover:border-cyan-300/50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-white">
                            {account.userName || account.userEmail}
                          </span>

                          <span className="block truncate text-xs text-slate-400">
                            {account.userRole} · {account.userEmail}
                            {account.banned ? " · suspended" : ""}
                          </span>
                        </span>

                        <span className="shrink-0 text-xs font-bold text-cyan-300">
                          {account.hasThread ? "Open" : "Start"}
                        </span>
                      </button>
                    ))
                )}

                {!isLoadingAccounts && accounts.length === 0 && (
                  <p className="text-sm text-slate-400">
                    No accounts to write to.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto pr-1">
              {isLoading ? (
                <p className="text-sm text-slate-400">
                  Loading conversations...
                </p>
              ) : visibleThreads.length === 0 ? (
                <div className="rounded-3xl border border-white/10 bg-black/15 p-6 text-center">
                  <span className="text-4xl">📭</span>

                  <p className="mt-3 font-bold text-white">
                    No conversations yet
                  </p>

                  <p className="mt-1 text-sm text-slate-400">
                    A thread appears here as soon as a doctor or a patient
                    writes to the administration.
                  </p>
                </div>
              ) : (
                visibleThreads.map((thread) => {
                  const isSelected = thread.userId === selectedUserId;

                  return (
                    <button
                      key={thread.userId}
                      type="button"
                      onClick={() => setSelectedUserId(thread.userId)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        isSelected
                          ? "border-cyan-300/60 bg-cyan-400/10"
                          : "border-white/12 bg-white/[0.05] hover:border-cyan-300/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-black text-white">
                            {thread.userName || thread.userEmail}
                          </p>

                          <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-cyan-300">
                            {thread.userRole}
                          </p>
                        </div>

                        {thread.unreadCount > 0 && (
                          <span className="shrink-0 rounded-full bg-rose-500/90 px-2.5 py-1 text-xs font-black text-white">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>

                      <p className="mt-2 line-clamp-2 text-sm text-slate-300">
                        {thread.lastMessageRole === "admin" ? "You: " : ""}
                        {thread.lastMessage}
                      </p>

                      <p className="mt-2 text-xs text-slate-500">
                        {formatRelative(thread.lastMessageAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>

            <div>
              {selectedUserId ? (
                <SupportChat
                  userId={selectedUserId}
                  viewerRole="admin"
                  /*
                    A conversation that has not started yet has no
                    thread to take a name from, so the account the
                    administrator picked names it instead.
                  */
                  title={
                    selectedThread?.userName ||
                    selectedThread?.userEmail ||
                    startedAccount?.userName ||
                    startedAccount?.userEmail ||
                    "Conversation"
                  }
                  subtitle={
                    selectedThread
                      ? `${selectedThread.userRole} · ${selectedThread.userEmail}`
                      : startedAccount
                        ? `${startedAccount.userRole} · ${startedAccount.userEmail} · new conversation`
                        : undefined
                  }
                  onSent={loadThreads}
                />
              ) : (
                <div className="flex h-full min-h-[20rem] items-center justify-center rounded-3xl border border-white/10 bg-black/15 p-6 text-center">
                  <p className="text-slate-400">
                    Pick a conversation to read and answer it.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AdminMessagesPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#06142f] via-[#0a2450] to-[#071a38]">
          <p className="font-bold text-cyan-100">Loading...</p>
        </main>
      }
    >
      <AdminMessagesContent />
    </Suspense>
  );
}
