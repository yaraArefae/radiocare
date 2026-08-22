"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 6000;

type SupportMessage = {
  id: number;
  senderId: string;
  senderRole: "admin" | "doctor" | "patient";
  message: string;
  isRead: boolean;
  createdAt: string;
};

type Props = {
  /*
    Whose thread to open. An administrator names the doctor or patient;
    a doctor or a patient leaves it out and gets their own, which is the
    only one the server will give them anyway.
  */
  userId?: string;
  viewerRole: "admin" | "doctor" | "patient";
  title?: string;
  subtitle?: string;
  compact?: boolean;
  /* Told after every send, so an inbox can refresh its unread counts. */
  onSent?: () => void;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administration",
  doctor: "Doctor",
  patient: "Patient",
};

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/*
  The conversation between one doctor or patient and the administration.

  The same component serves both ends of it. Which messages sit on the
  right is decided by who is reading, not by a fixed role, so an admin
  sees their own answers on the right and the doctor sees theirs there.
*/
export default function SupportChat({
  userId,
  viewerRole,
  title,
  subtitle,
  compact = false,
  onSent,
}: Props) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const loadMessages = useCallback(async () => {
    if (viewerRole === "admin" && !userId) {
      setMessages([]);
      setIsLoading(false);
      return;
    }

    try {
      const query = userId
        ? `?userId=${encodeURIComponent(userId)}`
        : "";

      const response = await fetch(
        `${backendBaseUrl}/api/support/messages${query}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the messages.");
      }

      setMessages(data.messages ?? []);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to load the messages.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [userId, viewerRole]);

  useEffect(() => {
    setIsLoading(true);
    void loadMessages();

    const intervalId = window.setInterval(() => {
      void loadMessages();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [loadMessages]);

  useEffect(() => {
    const element = scrollRef.current;

    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();

    const text = newMessage.trim();

    if (!text || isSending) return;

    setIsSending(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `${backendBaseUrl}/api/support/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            userId ? { userId, message: text } : { message: text },
          ),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to send the message.");
      }

      setMessages((current) => [...current, data.supportMessage]);
      setNewMessage("");
      onSent?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to send the message.",
      );
    } finally {
      setIsSending(false);
    }
  }

  const heading =
    title ??
    (viewerRole === "admin"
      ? "Reply to this account"
      : "Message the administration");

  return (
    <section className="flex flex-col rounded-3xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-2xl md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Administration
          </p>

          <h3 className="mt-1 text-xl font-black text-white">{heading}</h3>

          {subtitle && (
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          )}
        </div>

        <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-200">
          Private
        </span>
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-100">
          {errorMessage}
        </p>
      )}

      <div
        ref={scrollRef}
        className={[
          "mt-4 flex flex-col gap-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/15 p-4",
          compact ? "h-64" : "h-80",
        ].join(" ")}
      >
        {isLoading ? (
          <p className="m-auto text-sm text-slate-400">
            Loading conversation...
          </p>
        ) : messages.length === 0 ? (
          <div className="m-auto text-center">
            <span className="text-4xl">💬</span>

            <p className="mt-3 font-bold text-white">No messages yet</p>

            <p className="mt-1 text-sm text-slate-400">
              {viewerRole === "admin"
                ? "Write the first message to this account."
                : "Ask the administration about your account, your clinic, or a request."}
            </p>
          </div>
        ) : (
          messages.map((supportMessage) => {
            const isOwnMessage = supportMessage.senderRole === viewerRole;

            return (
              <div
                key={supportMessage.id}
                className={`flex ${
                  isOwnMessage ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    isOwnMessage
                      ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white"
                      : "border border-white/15 bg-white/[0.08] text-slate-100"
                  }`}
                >
                  <p className="text-xs font-bold opacity-75">
                    {ROLE_LABELS[supportMessage.senderRole] ?? "User"}
                  </p>

                  <p className="mt-1 whitespace-pre-wrap break-words leading-6">
                    {supportMessage.message}
                  </p>

                  <p className="mt-2 text-right text-[11px] opacity-65">
                    {formatMessageTime(supportMessage.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={sendMessage} className="mt-4 flex gap-3">
        <input
          type="text"
          value={newMessage}
          onChange={(event) => setNewMessage(event.target.value)}
          placeholder={
            viewerRole === "admin"
              ? "Write an answer..."
              : "Write to the administration..."
          }
          maxLength={2000}
          disabled={viewerRole === "admin" && !userId}
          className="min-w-0 flex-1 rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60 disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={isSending || !newMessage.trim()}
          className="rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-6 py-3.5 font-black text-white disabled:opacity-50"
        >
          {isSending ? "..." : "Send"}
        </button>
      </form>
    </section>
  );
}
