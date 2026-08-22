"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import NotificationBell from "@/components/NotificationBell";
import SupportInboxCard from "@/components/SupportInboxCard";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 20000;

/*
  The three things an administrator checks without going looking for
  them: what was announced, what was written, and what is booked.

  They live in the page header rather than inside a screen, because each
  one is a reason to leave whatever screen you are on.
*/
export default function AdminQuickBar() {
  const [bookedAppointments, setBookedAppointments] = useState<number | null>(
    null,
  );

  const loadCounters = useCallback(async () => {
    try {
      const response = await fetch(`${backendBaseUrl}/api/admin/overview`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.success) {
        setBookedAppointments(
          Number(data.queue?.bookedAppointments ?? 0),
        );
      }
    } catch (error) {
      console.error("Unable to load the appointment count:", error);
    }
  }, []);

  useEffect(() => {
    void loadCounters();

    const intervalId = window.setInterval(() => {
      void loadCounters();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadCounters]);

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <NotificationBell />

      <SupportInboxCard viewerRole="admin" variant="button" />

      <Link
        href="/admin/appointments"
        className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/25"
      >
        📅 Appointments
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/15 px-1.5 text-[11px] font-black text-white">
          {bookedAppointments ?? "…"}
        </span>
      </Link>
    </div>
  );
}
