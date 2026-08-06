"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const backendBaseUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const REFRESH_INTERVAL_MS = 6000;

type CaseMessage = {
  id: number;
  senderId: string;
  senderRole: "doctor" | "patient";
  message: string;
  isRead: boolean;
  createdAt: string;
};

type Props = {
  studyId: string;
  /* Shown above the thread, for example the patient or doctor name. */
  title?: string;
  compact?: boolean;
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
  The private conversation about one case.

  Only the patient the case belongs to, and a doctor of the clinic that
  received it, can open this thread. That rule is enforced in the API,
  so another patient cannot reach the messages even by calling the
  endpoint directly.
*/
export default function CaseChat({
  studyId,
  title,
  compact = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [viewerRole, setViewerRole] = useState<"doctor" | "patient">(
    "patient",
  );
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch(
        `${backendBaseUrl}/api/studies/${encodeURIComponent(
          studyId,
        )}/messages`,
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
      setViewerRole(data.role ?? "patient");
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
  }, [studyId]);

  useEffect(() => {
    setIsLoading(true);
    void loadMessages();

    const intervalId = window.setInterval(() => {
      void loadMessages();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = newMessage.trim();

    if (!message) return;

    try {
      setIsSending(true);
      setErrorMessage("");

      const response = await fetch(
        `${backendBaseUrl}/api/studies/${encodeURIComponent(
          studyId,
        )}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to send the message.");
      }

      setMessages((current) => [...current, data.chatMessage]);
      setNewMessage("");

      setNoticeMessage(
        data.waitingForDoctor
          ? "Your message was saved. A doctor from the matching clinic will see it when they open your case."
          : "",
      );
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

  return (
    <section className="flex flex-col rounded-3xl border border-white/15 bg-white/[0.06] p-5 backdrop-blur-2xl md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-300">
            Case follow-up
          </p>

          <h3 className="mt-1 text-xl font-black text-white">
            {title ??
              (viewerRole === "doctor"
                ? "Message the patient"
                : "Message your doctor")}
          </h3>
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

      {noticeMessage && (
        <p className="mt-4 rounded-2xl border border-cyan-300/25 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          {noticeMessage}
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
              {viewerRole === "doctor"
                ? "Write the first note to the patient about this case."
                : "Ask your doctor anything about this case."}
            </p>
          </div>
        ) : (
          messages.map((caseMessage) => {
            const isOwnMessage = caseMessage.senderRole === viewerRole;

            return (
              <div
                key={caseMessage.id}
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
                    {caseMessage.senderRole === "doctor"
                      ? "Doctor"
                      : "Patient"}
                  </p>

                  <p className="mt-1 whitespace-pre-wrap break-words leading-6">
                    {caseMessage.message}
                  </p>

                  <p className="mt-2 text-right text-[11px] opacity-65">
                    {formatMessageTime(caseMessage.createdAt)}
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
            viewerRole === "doctor"
              ? "Write a note for the patient..."
              : "Write a question about your case..."
          }
          maxLength={2000}
          className="min-w-0 flex-1 rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3.5 text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/60"
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
