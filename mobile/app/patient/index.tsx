import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, currentSession, signOut } from "../../src/api/client";
import { colors, priorityColor, resultColor, spacing } from "../../src/theme";
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

type Study = {
  id: string;
  bodyRegion: string;
  imagingView?: string;
  status: string;
  priority: string;
  triageResult?: string;
  aiResult?: string;
  predictedFinding?: string;
  confidence?: number | string | null;
  createdAt?: string;
  date?: string;
};

function formatDate(value?: string) {
  if (!value) return "";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/*
  What the patient has sent in, and where each of it stands.
*/
export default function PatientHome() {
  const router = useRouter();

  const [studies, setStudies] = useState<Study[]>([]);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const user = await currentSession();

    if (!user) {
      router.replace("/");
      return;
    }

    setName(user.name ?? "");

    const result = await api<{ success: boolean; studies?: Study[]; message?: string }>(
      "/api/studies",
    );

    if (!result.ok || !result.data?.success) {
      setError(result.data?.message ?? "Unable to load your studies.");
    } else {
      setStudies(result.data.studies ?? []);
      setError("");
    }

    setIsLoading(false);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Patient"
        title={name ? `Hello, ${name}` : "My studies"}
        subtitle="Send an X-ray, a CT or an MRI, follow its review, read the doctor's report."
      />

      <Button label="＋  Upload a study" onPress={() => router.push("/patient/upload")} />

      <Row style={{ marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            label="📅  Appointments"
            kind="ghost"
            onPress={() => router.push("/appointments")}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Button
            label="🏛️  Admin"
            kind="ghost"
            onPress={() => router.push("/support")}
          />
        </View>
      </Row>

      <View style={{ height: spacing.md }} />

      <Row style={{ marginBottom: spacing.sm }}>
        <Label>{studies.length} study{studies.length === 1 ? "" : "s"}</Label>

        <Pressable onPress={() => router.push("/support")}>
          <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 13 }}>
            Contact admin →
          </Text>
        </Pressable>
      </Row>

      {error ? <Muted>{error}</Muted> : null}

      {!isLoading && studies.length === 0 ? (
        <Empty icon="🩻" text="Nothing yet. Your uploads will appear here." />
      ) : null}

      {studies.map((study) => {
        const result = study.triageResult ?? study.aiResult ?? "";

        return (
          <Pressable key={study.id} onPress={() => router.push(`/study/${study.id}`)}>
            <Card>
              <Row>
                <Value>{study.bodyRegion}</Value>
                <Pill text={result || "PENDING"} tone={resultColor(result)} />
              </Row>

              <View style={{ height: spacing.sm }} />

              <Muted>
                {study.predictedFinding && study.predictedFinding !== result
                  ? `${study.predictedFinding} · `
                  : ""}
                {formatDate(study.createdAt ?? study.date)}
              </Muted>

              <Row style={{ marginTop: spacing.sm }}>
                <Pill text={study.status} />
                <Pill text={study.priority} tone={priorityColor(study.priority)} />
              </Row>
            </Card>
          </Pressable>
        );
      })}

      <View style={{ height: spacing.lg }} />

      <Button
        label="Sign out"
        kind="danger"
        onPress={async () => {
          await signOut();
          router.replace("/");
        }}
      />
    </Screen>
  );
}
