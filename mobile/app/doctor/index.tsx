import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, currentSession, signOut } from "../../src/api/client";
import { colors, priorityColor, resultColor, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Empty,
  Folding,
  Label,
  Muted,
  Pill,
  Row,
  Screen,
  Title,
  Value,
} from "../../src/ui";

type Clinic = { key: string; name: string };

type ClinicStudy = {
  id: string;
  patient: string;
  bodyRegion: string;
  status: string;
  priority: string;
  aiResult: string;
  confidence?: number | string | null;
  date?: string;
};

type Capability = {
  slug: string;
  tier: string;
  note: string;
  aiServed: boolean;
  trainingImages: number;
};

/*
  The doctor's queue.

  A doctor works one clinic, so the phone opens on the queue rather than
  on a list of clinics to choose from - the same shortcut the website
  takes for a doctor who covers a single clinic.
*/
export default function DoctorHome() {
  const router = useRouter();

  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [active, setActive] = useState<Clinic | null>(null);
  const [studies, setStudies] = useState<ClinicStudy[]>([]);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  /*
    The queue folds away.

    A busy clinic holds ninety seven cases, and on a phone that is a
    wall of cards with everything else buried under it. The count stays
    on the header whether it is open or shut, so a folded queue still
    says how much is behind it.
  */
  const [showStudies, setShowStudies] = useState(false);

  const loadQueue = useCallback(async (clinic: Clinic) => {
    const result = await api<{ success: boolean; studies?: ClinicStudy[]; message?: string }>(
      `/api/studies?clinic=${encodeURIComponent(clinic.key)}`,
    );

    if (!result.ok || !result.data?.success) {
      setError(result.data?.message ?? "Unable to load the queue.");
      setStudies([]);
      return;
    }

    /* Cleared cases leave the queue; everything else waits for a doctor. */
    setStudies(
      (result.data.studies ?? []).filter(
        (study) => String(study.aiResult ?? "").trim().toLowerCase() !== "normal",
      ),
    );

    setError("");
  }, []);

  const load = useCallback(async () => {
    const user = await currentSession();

    if (!user) {
      router.replace("/");
      return;
    }

    const mine = await api<{ success: boolean; clinics?: Clinic[] }>("/api/doctor/clinic");
    const list = mine.data?.clinics ?? [];

    setClinics(list);

    const chosen = list[0] ?? null;
    setActive(chosen);

    if (chosen) {
      await loadQueue(chosen);

      /* The measured grade of the model this clinic runs on. */
      const capabilities = await api<{ clinics?: Capability[] }>("/clinics", {
        baseUrl: process.env.EXPO_PUBLIC_AI_SERVICE_URL ?? undefined,
      }).catch(() => ({ data: null } as any));

      const found = capabilities?.data?.clinics?.find(
        (item: Capability) => item.slug === chosen.key,
      );

      setCapability(found ?? null);
    }

    setIsLoading(false);
  }, [loadQueue, router]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Doctor"
        title={active?.name ?? "My clinic"}
        subtitle="Cases the AI could not clear, waiting for your reading."
      />

      {clinics.length > 1 ? (
        <Row style={{ flexWrap: "wrap", justifyContent: "flex-start", marginBottom: spacing.sm }}>
          {clinics.map((clinic) => (
            <Pressable
              key={clinic.key}
              onPress={() => {
                setActive(clinic);
                void loadQueue(clinic);
              }}
              style={{
                paddingHorizontal: 13,
                paddingVertical: 8,
                borderRadius: 999,
                marginRight: spacing.xs,
                marginBottom: spacing.xs,
                borderWidth: 1,
                borderColor: active?.key === clinic.key ? colors.lineStrong : colors.line,
              }}
            >
              <Text
                style={{
                  color: active?.key === clinic.key ? colors.accent : colors.muted,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {clinic.name}
              </Text>
            </Pressable>
          ))}
        </Row>
      ) : null}

      {capability ? (
        <Card>
          <Row>
            <Label>AI support</Label>
            <Pill
              text={capability.tier}
              tone={
                capability.tier === "high"
                  ? colors.good
                  : capability.tier === "moderate"
                    ? colors.warn
                    : colors.bad
              }
            />
          </Row>

          <Muted>{capability.note}</Muted>
          <Muted>{capability.trainingImages.toLocaleString()} training images</Muted>
        </Card>
      ) : null}

      <Row>
        <View style={{ flex: 1 }}>
          <Button
            label="📅  Appointments"
            kind="ghost"
            onPress={() => router.push("/appointments")}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Button label="🏛️  Admin" kind="ghost" onPress={() => router.push("/support")} />
        </View>
      </Row>

      <Folding
        label={`${studies.length} case${studies.length === 1 ? "" : "s"} to review`}
        open={showStudies}
        onToggle={() => setShowStudies((open) => !open)}
      />

      {error ? <Muted>{error}</Muted> : null}

      {!isLoading && studies.length === 0 ? (
        <Empty icon="✅" text="Nothing waiting. The queue is clear." />
      ) : null}

      {(showStudies ? studies : []).map((study) => (
        <Pressable key={study.id} onPress={() => router.push(`/study/${study.id}`)}>
          <Card>
            <Row>
              <Value>{study.patient}</Value>
              <Pill text={study.aiResult || "PENDING"} tone={resultColor(study.aiResult)} />
            </Row>

            <Muted>
              {study.bodyRegion}
              {study.confidence ? ` · ${Number(study.confidence).toFixed(1)}% confidence` : ""}
            </Muted>

            <Row style={{ marginTop: spacing.sm }}>
              <Pill text={study.status} />
              <Pill text={study.priority} tone={priorityColor(study.priority)} />
            </Row>
          </Card>
        </Pressable>
      ))}

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
