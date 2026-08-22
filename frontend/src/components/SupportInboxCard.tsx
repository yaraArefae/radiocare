"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 20000;

type Props = {
  viewerRole: "admin" | "doctor" | "patient";
  /* A tile on a dashboard, or a button beside the other actions. */
  variant?: "card" | "button";
};

/*
  The administration conversation, shown where the user already is.

  The notification bell only speaks while something is unread, which
  makes the whole feature invisible the moment it is caught up. This
  stays on the dashboard either way: it says how to reach the
  administration when there is nothing waiting, and how much is waiting
  when there is.
*/
export default function SupportInboxCard({
  viewerRole,
  variant = "card",
}: Props) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [threadCount, setThreadCount] = useState(0);

  const isAdmin = viewerRole === "admin";
  const href = isAdmin ? "/admin/messages" : "/support";

  const loadCount = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/support/unread`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.success) {
        setUnreadCount(Number(data.unreadCount ?? 0));
        setThreadCount(Number(data.threadCount ?? 0));
      }
    } catch (error) {
      console.error("Unable to read the message count:", error);
    }
  }, []);

  useEffect(() => {
    void loadCount();

    const intervalId = window.setInterval(() => {
      void loadCount();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadCount]);

  const headline = isAdmin
    ? unreadCount > 0
      ? `${unreadCount} new message${unreadCount === 1 ? "" : "s"}`
      : "Messages"
    : unreadCount > 0
      ? `${unreadCount} ${unreadCount === 1 ? "reply" : "replies"} waiting`
      : "Administration";

  const description = isAdmin
    ? unreadCount > 0
      ? `From ${threadCount} account${threadCount === 1 ? "" : "s"}, waiting for an answer.`
      : "Conversations with doctors and patients."
    : unreadCount > 0
      ? "The administration answered you."
      : "Ask about your account, a clinic, or a request.";

  if (variant === "button") {
    return (
      <Link
        href={href}
        className="relative inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
      >
        🏛️ {isAdmin ? "Messages" : "Contact Admin"}
        {unreadCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={[
        "block rounded-[26px] border p-6 text-left backdrop-blur-2xl transition hover:-translate-y-1",
        unreadCount > 0
          ? "border-rose-300/40 bg-rose-500/10"
          : "border-white/15 bg-white/10",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-cyan-200">
          {isAdmin ? "Administration inbox" : "Message the administration"}
        </p>

        <span className="text-2xl" aria-hidden="true">
          {unreadCount > 0 ? "📬" : "🏛️"}
        </span>
      </div>

      <h2 className="mt-3 text-2xl font-bold text-white">{headline}</h2>

      <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
    </Link>
  );
}
