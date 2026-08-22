import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { api } from "./api/client";
import { colors, radius, spacing } from "./theme";
import { Button, Label, Muted } from "./ui";

type CaseMessage = {
  id: number;
  senderRole: "doctor" | "patient";
  message: string;
  createdAt: string;
};

/*
  The private conversation about one case.

  Only the patient the study belongs to and a doctor of the clinic that
  received it can open this thread; the rule is enforced by the server,
  so the phone asks the same endpoint the website does and gets the same
  refusal if it is not entitled to it.
*/
export default function CaseChat({
  studyId,
  viewerRole,
}: {
  studyId: string;
  viewerRole: "doctor" | "patient";
}) {
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState("");

  const scroller = useRef<ScrollView | null>(null);

  async function load() {
    const result = await api<{ success: boolean; messages?: CaseMessage[] }>(
      `/api/studies/${studyId}/messages`,
    );

    if (result.ok && result.data?.success) {
      setMessages(result.data.messages ?? []);
    }
  }

  useEffect(() => {
    void load();

    const timer = setInterval(() => void load(), 8000);

    return () => clearInterval(timer);
  }, [studyId]);

  async function send() {
    const text = draft.trim();

    if (!text) return;

    setIsSending(true);

    const result = await api<{
      success: boolean;
      caseMessage?: CaseMessage;
      waitingForDoctor?: boolean;
      message?: string;
    }>(`/api/studies/${studyId}/messages`, { body: { message: text } });

    if (result.ok && result.data?.caseMessage) {
      setMessages((current) => [...current, result.data.caseMessage!]);
      setDraft("");
      setNotice(
        result.data.waitingForDoctor
          ? "Saved. A doctor of the clinic will see it when they open your case."
          : "",
      );
    } else {
      setNotice(result.data?.message ?? "The message was not sent.");
    }

    setIsSending(false);
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.medium,
        backgroundColor: colors.surface,
        padding: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <Label>
        {viewerRole === "doctor" ? "Message the patient" : "Message your doctor"}
      </Label>

      <ScrollView
        ref={scroller}
        style={{ maxHeight: 240, marginTop: spacing.sm }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <Muted>No messages about this case yet.</Muted>
        ) : null}

        {messages.map((item) => {
          const isMine = item.senderRole === viewerRole;

          return (
            <View
              key={item.id}
              style={{
                alignSelf: isMine ? "flex-end" : "flex-start",
                maxWidth: "88%",
                backgroundColor: isMine ? colors.accentDeep : "rgba(255,255,255,0.08)",
                borderRadius: radius.medium,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                marginBottom: spacing.xs,
                borderWidth: isMine ? 0 : 1,
                borderColor: colors.line,
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800" }}>
                {item.senderRole === "doctor" ? "Doctor" : "Patient"}
              </Text>

              <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 3 }}>
                {item.message}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {notice ? <Muted>{notice}</Muted> : null}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={
          viewerRole === "doctor" ? "Write a note for the patient..." : "Ask about your case..."
        }
        placeholderTextColor="rgba(159,180,204,0.5)"
        style={{
          backgroundColor: "rgba(255,255,255,0.07)",
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.small,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
          color: colors.text,
          fontSize: 15,
          marginTop: spacing.sm,
        }}
      />

      <Button label="Send" onPress={send} loading={isSending} disabled={!draft.trim()} />
    </View>
  );
}
