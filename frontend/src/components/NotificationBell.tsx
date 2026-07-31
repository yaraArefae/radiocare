"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 20000;

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  appointmentId: string | null;
  studyId: string | null;
  isRead: boolean;
  createdAt: string;
};

const notificationIcon: Record<string, string> = {
  appointment_invitation: "📅",
  appointment_confirmed: "✅",
  appointment_declined: "❌",
  appointment_rescheduled: "🔁",
  appointment_cancelled: "🚫",
  appointment_completed: "🏁",
  appointment_reminder: "⏰",
  chat_message: "💬",
  new_case: "🩻",
};

function formatRelativeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const differenceMs = Date.now() - date.getTime();
  const minutes = Math.round(differenceMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;

  return date.toLocaleDateString();
}

export default function NotificationBell() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/notifications`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      if (!response.ok) return;

      const data = await response.json();

      if (!data.success) return;

      setNotifications(data.notifications ?? []);
      setUnreadCount(Number(data.unreadCount ?? 0));
    } catch (error) {
      console.error("Unable to load notifications:", error);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();

    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadNotifications]);

  /*
    Clicking anywhere outside the panel closes it.
  */
  useEffect(() => {
    if (!isOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  async function markAsRead(ids: number[], markAll = false) {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/notifications`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(markAll ? { markAll: true } : { ids }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) return;

      setNotifications((current) =>
        current.map((notification) =>
          markAll || ids.includes(notification.id)
            ? { ...notification, isRead: true }
            : notification,
        ),
      );

      setUnreadCount(Number(data.unreadCount ?? 0));
    } catch (error) {
      console.error("Unable to update notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function clearNotifications() {
    try {
      setIsLoading(true);

      const response = await fetch(
        `${backendBaseUrl}/api/notifications`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (!response.ok) return;

      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error("Unable to clear notifications:", error);
    } finally {
      setIsLoading(false);
    }
  }

  function openNotification(notification: NotificationItem) {
    if (!notification.isRead) {
      void markAsRead([notification.id]);
    }

    setIsOpen(false);

    if (notification.link) {
      router.push(notification.link);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-xl transition hover:border-cyan-300/50 hover:bg-white/15"
      >
        <span aria-hidden="true">🔔</span>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white shadow-lg">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-3 w-[22rem] max-w-[90vw] overflow-hidden rounded-3xl border border-white/20 bg-[#0a1c3c]/95 shadow-[0_25px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
            <div>
              <p className="font-black text-white">Notifications</p>
              <p className="text-xs text-slate-400">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You are all caught up"}
              </p>
            </div>

            <div className="flex gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void markAsRead([], true)}
                  className="rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-3 py-1.5 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/25 disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}

              {notifications.length > 0 && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void clearNotifications()}
                  className="rounded-xl border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:text-white disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">
                No notifications yet.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={[
                    "flex w-full gap-3 border-b border-white/5 px-5 py-4 text-left transition hover:bg-white/[0.06]",
                    notification.isRead ? "opacity-70" : "bg-cyan-400/[0.07]",
                  ].join(" ")}
                >
                  <span className="text-xl" aria-hidden="true">
                    {notificationIcon[notification.type] ?? "🔔"}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-bold leading-5 text-white">
                        {notification.title}
                      </span>

                      {!notification.isRead && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-300" />
                      )}
                    </span>

                    {notification.body && (
                      <span className="mt-1 block text-sm leading-6 text-slate-300">
                        {notification.body}
                      </span>
                    )}

                    <span className="mt-1 block text-xs text-slate-500">
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
