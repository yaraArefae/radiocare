import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../../src/api/client";
import { colors, radius, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Empty,
  Label,
  Muted,
  Pill,
  Row,
  Screen,
  Title,
  Value,
} from "../../src/ui";

type Thread = {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  unreadCount: number;
  lastMessage: string;
  lastMessageRole: string;
};

type Message = {
  id: number;
  senderRole: "admin" | "doctor" | "patient";
  message: string;
  createdAt: string;
};

/*
  The administration's inbox on a phone.

  A laptop can show the list and the conversation side by side; a phone
  cannot, so it shows the list until one is picked and the conversation
  after that, with a way back. Same data, one column.
*/
export default function AdminMessages() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const scroller = useRef<ScrollView | null>(null);

  const loadThreads = useCallback(async () => {
    const result = await api<{ success: boolean; threads?: Thread[] }>(
      "/api/support/threads",
    );

    setThreads(result.data?.threads ?? []);
    setIsLoading(false);
  }, []);

  const openThread = useCallback(async (thread: Thread) => {
    setActive(thread);

    const result = await api<{ success: boolean; messages?: Message[] }>(
      `/api/support/messages?userId=${encodeURIComponent(thread.userId)}`,
    );

    setMessages(result.data?.messages ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void loadThreads();
    }, [loadThreads]),
  );

  async function send() {
    const text = draft.trim();

    if (!text || !active) return;

    setIsSending(true);

    const result = await api<{ success: boolean; supportMessage?: Message }>(
      "/api/support/messages",
      { body: { userId: active.userId, message: text } },
    );

    if (result.ok && result.data?.supportMessage) {
      setMessages((current) => [...current, result.data.supportMessage!]);
      setDraft("");
      void loadThreads();
    }

    setIsSending(false);
  }

  if (active) {
    return (
      <Screen scroll={false}>
        <Pressable onPress={() => setActive(null)} style={{ marginBottom: spacing.sm }}>
          <Text style={{ color: colors.accent, fontWeight: "800" }}>← All conversations</Text>
        </Pressable>

        <Title
          eyebrow={active.userRole}
          title={active.userName || active.userEmail}
          subtitle={active.userEmail}
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
          {messages.length === 0 ? <Muted>No messages yet.</Muted> : null}

          {messages.map((item) => {
            const isMine = item.senderRole === "admin";

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
                  marginBottom: spacing.xs,
                  borderWidth: isMine ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800" }}>
                  {isMine ? "You" : item.senderRole}
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
            placeholder="Write an answer..."
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

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Administration"
        title="Messages"
        subtitle="Conversations with doctors and patients."
      />

      {!isLoading && threads.length === 0 ? (
        <Empty icon="📭" text="Nobody has written yet." />
      ) : null}

      {threads.map((thread) => (
        <Pressable key={thread.userId} onPress={() => openThread(thread)}>
          <Card tone={thread.unreadCount > 0 ? colors.bad : undefined}>
            <Row>
              <Value>{thread.userName || thread.userEmail}</Value>

              {thread.unreadCount > 0 ? (
                <Pill text={String(thread.unreadCount)} tone={colors.bad} />
              ) : (
                <Pill text={thread.userRole} />
              )}
            </Row>

            <Muted>
              {thread.lastMessageRole === "admin" ? "You: " : ""}
              {thread.lastMessage}
            </Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
