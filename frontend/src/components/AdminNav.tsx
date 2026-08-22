"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import NotificationBell from "@/components/NotificationBell";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/*
  One navigation for every admin screen. Before this, the overview and
  the patient requests had no link anywhere, so an administrator had to
  type the address by hand to reach them.
*/
const adminLinks = [
  { href: "/admin/overview", label: "Overview", icon: "📊" },
  {
    href: "/admin/patient-requests",
    label: "Patient requests",
    icon: "🧑",
    counter: "pendingPatients" as const,
  },
  {
    href: "/admin/doctor-requests",
    label: "Doctor requests",
    icon: "🩺",
    counter: "pendingDoctors" as const,
  },
  {
    href: "/admin/messages",
    label: "Messages",
    icon: "💬",
    counter: "unreadSupport" as const,
  },
  { href: "/admin/appointments", label: "Appointments", icon: "📅" },
  { href: "/admin/users", label: "Accounts", icon: "👥" },
  { href: "/admin/patients", label: "Patients", icon: "🧾" },
  { href: "/admin/clinics", label: "Clinics", icon: "🏥" },
  {
    href: "/admin/secretary-requests",
    label: "Secretary requests",
    icon: "📇",
    counter: "pendingSecretaries" as const,
  },
  { href: "/admin/secretaries", label: "Secretaries", icon: "🗓️" },
];

/*
  The spacing below the menu belongs to the pages that stack it above
  their content. Inside a header bar it pushes the row off centre, so
  those pass compact and lay it out themselves.
*/
export default function AdminNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const [counters, setCounters] = useState<Record<string, number>>({});

  const loadCounters = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/admin/overview`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      if (!response.ok) return;

      const data = await response.json();

      if (data.success) {
        setCounters(data.queue ?? {});
      }
    } catch (error) {
      console.error("Unable to load the admin counters:", error);
    }
  }, []);

  useEffect(() => {
    void loadCounters();
  }, [loadCounters]);

  return (
    <nav
      className={[
        "flex flex-wrap items-center gap-2",
        compact ? "" : "mb-6",
      ].join(" ")}
    >
      <NotificationBell />

      {/*
        The way back to the main dashboard. Every admin screen carries
        this navigation, so putting it here means no screen is a dead
        end, whichever one an administrator landed on from a
        notification.
      */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2.5 text-sm font-bold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/25"
      >
        <span aria-hidden="true">←</span>
        Dashboard
      </Link>

      {adminLinks.map((link) => {
        const isActive = pathname === link.href;
        const pending = link.counter
          ? Number(counters[link.counter] ?? 0)
          : 0;

        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold transition",
              isActive
                ? "border-cyan-300/60 bg-cyan-400/20 text-white"
                : "border-white/15 bg-white/[0.06] text-slate-300 hover:border-cyan-300/40 hover:text-white",
            ].join(" ")}
          >
            <span aria-hidden="true">{link.icon}</span>
            {link.label}

            {pending > 0 && (
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-black text-white">
                {pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
