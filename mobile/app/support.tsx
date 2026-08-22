import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../src/api/client";
import { colors, radius, spacing } from "../src/theme";
import { Button, Card, Label, Muted, Screen, Title } from "../src/ui";

type Message = {
  id: number;
  senderRole: "admin" | "doctor" | "patient";
  message: string;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Administration",
  doctor: "Doctor",
  patient: "Patient",
};

/*
  The conversation with the administration - the same thread the website
  shows, about the account rather than about a case.
*/
export default function SupportScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [mine, setMine] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const scroller = useRef<ScrollView | null>(null);

  async function load() {
    const result = await api<{ success: boolean; messages?: Message[]; thread?: { userRole: string } }>(
      "/api/support/messages",
    );

    if (result.ok && result.data?.success) {
      setMessages(result.data.messages ?? []);
      setMine(result.data.thread?.userRole ?? "");
    }

    setIsLoading(false);
  }

  useEffect(() => {
    void load();

    const timer = setInterval(() => void load(), 8000);

    return () => clearInterval(timer);
  }, []);

  async function send() {
    const text = draft.trim();

    if (!text) return;

    setIsSending(true);

    const result = await api<{ success: boolean; supportMessage?: Message }>(
      "/api/support/messages",
      { body: { message: text } },
    );

    if (result.ok && result.data?.supportMessage) {
      setMessages((current) => [...current, result.data.supportMessage!]);
      setDraft("");
    }

    setIsSending(false);
  }

  return (
    <Screen scroll={false} refreshing={isLoading}>
      <Title
        eyebrow="Administration"
        title="Message the admin"
        subtitle="For your account, your clinic or a request. Case questions go to the doctor instead."
      />

      <ScrollView
        ref={scroller}
        style={{
          flex: 1,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.medium,
          backgroundColor: "rgba(0,0,0,0.15)",
          padding: spacing.sm,
        }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 && !isLoading ? (
          <Muted>No messages yet. Write the first one.</Muted>
        ) : null}

        {messages.map((item) => {
          const isMine = item.senderRole === mine;

          return (
            <View
              key={item.id}
              style={{
                alignSelf: isMine ? "flex-end" : "flex-start",
                maxWidth: "85%",
                backgroundColor: isMine ? colors.accentDeep : "rgba(255,255,255,0.08)",
                borderRadius: radius.medium,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                marginBottom: spacing.sm,
                borderWidth: isMine ? 0 : 1,
                borderColor: colors.line,
              }}
            >
              <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800" }}>
                {ROLE_LABEL[item.senderRole] ?? item.senderRole}
              </Text>

              <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21, marginTop: 3 }}>
                {item.message}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={{ paddingVertical: spacing.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write to the administration..."
          placeholderTextColor="rgba(159,180,204,0.5)"
          style={{
            backgroundColor: "rgba(255,255,255,0.07)",
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: radius.small,
            paddingHorizontal: spacing.md,
            paddingVertical: 13,
            color: colors.text,
            fontSize: 15,
          }}
        />

        <Button label="Send" onPress={send} loading={isSending} disabled={!draft.trim()} />
      </View>
    </Screen>
  );
}
