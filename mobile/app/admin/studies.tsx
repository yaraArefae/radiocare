import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../../src/api/client";
import { colors, priorityColor, radius, resultColor, spacing } from "../../src/theme";
import {
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
  patient?: string;
  patientName?: string;
  bodyRegion?: string;
  imagingView?: string;
  status?: string;
  priority?: string;
  triageResult?: string;
  aiResult?: string;
  predictedFinding?: string;
  primaryFinding?: string;
  confidence?: number | string | null;
  clinicKey?: string;
  createdAt?: string;
  date?: string;
};

type Filter = "all" | "abnormal" | "urgent" | "review" | "done";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "abnormal", label: "Abnormal" },
  { key: "urgent", label: "Urgent" },
  { key: "review", label: "Waiting" },
  { key: "done", label: "Completed" },
];

function textOf(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function formatDate(value?: string) {
  if (!value) return "";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/*
  Every case in the system, for the administration.

  A doctor sees one clinic and a patient sees their own record; an
  administrator is the only one who needs the whole list, which is why
  this screen exists and why the filters are the questions actually
  asked of it: what is abnormal, what is urgent, what is still waiting.
*/
export default function AdminStudies() {
  const router = useRouter();

  const [studies, setStudies] = useState<Study[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ success: boolean; studies?: Study[]; message?: string }>(
      "/api/studies",
    );

    if (result.ok && result.data?.success) {
      setStudies(result.data.studies ?? []);
      setError("");
    } else {
      setError(result.data?.message ?? "Unable to load the cases.");
    }

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  const counts = useMemo(() => {
    const result = { all: studies.length, abnormal: 0, urgent: 0, review: 0, done: 0 };

    for (const study of studies) {
      const outcome = textOf(study.triageResult ?? study.aiResult);
      const status = textOf(study.status);
      const priority = textOf(study.priority);

      if (outcome === "abnormal") result.abnormal += 1;
      if (priority.includes("urgent")) result.urgent += 1;
      if (status.includes("review") || status.includes("waiting")) result.review += 1;
      if (status.includes("complet") || status.includes("approved")) result.done += 1;
    }

    return result;
  }, [studies]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return studies.filter((study) => {
      const outcome = textOf(study.triageResult ?? study.aiResult);
      const status = textOf(study.status);
      const priority = textOf(study.priority);

      const passesFilter =
        filter === "all"
          ? true
          : filter === "abnormal"
            ? outcome === "abnormal"
            : filter === "urgent"
              ? priority.includes("urgent")
              : filter === "review"
                ? status.includes("review") || status.includes("waiting")
                : status.includes("complet") || status.includes("approved");

      if (!passesFilter) return false;

      if (!needle) return true;

      return [
        study.patient,
        study.patientName,
        study.bodyRegion,
        study.clinicKey,
        study.primaryFinding,
        study.predictedFinding,
        study.id,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [filter, search, studies]);

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Administration"
        title={`${studies.length} case${studies.length === 1 ? "" : "s"}`}
        subtitle="Every study in the system, whichever clinic received it."
      />

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search a patient, a region, a finding..."
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
          marginBottom: spacing.sm,
        }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        <Row style={{ gap: spacing.xs }}>
          {FILTERS.map((item) => {
            const isActive = filter === item.key;

            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 999,
                  marginRight: spacing.xs,
                  borderWidth: 1,
                  borderColor: isActive ? colors.lineStrong : colors.line,
                  backgroundColor: isActive ? "rgba(56,189,248,0.18)" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: isActive ? colors.accent : colors.muted,
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  {item.label} {counts[item.key]}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </ScrollView>

      {error ? <Muted>{error}</Muted> : null}

      {!isLoading && visible.length === 0 ? (
        <Empty icon="🗂️" text="No case matches this filter." />
      ) : null}

      <Label>
        {visible.length} shown
      </Label>

      {visible.slice(0, 100).map((study) => {
        const outcome = study.triageResult ?? study.aiResult ?? "";

        return (
          <Pressable key={study.id} onPress={() => router.push(`/study/${study.id}`)}>
            <Card>
              <Row>
                <Value>{study.patient ?? study.patientName ?? "Patient"}</Value>
                <Pill text={outcome || "PENDING"} tone={resultColor(outcome)} />
              </Row>

              <Muted>
                {study.bodyRegion}
                {study.clinicKey ? ` · ${study.clinicKey}` : ""}
                {study.confidence ? ` · ${Number(study.confidence).toFixed(1)}%` : ""}
              </Muted>

              {study.primaryFinding || study.predictedFinding ? (
                <Muted>{study.primaryFinding || study.predictedFinding}</Muted>
              ) : null}

              <Row style={{ marginTop: spacing.sm }}>
                <Pill text={study.status ?? "—"} />
                <Pill text={study.priority ?? "—"} tone={priorityColor(study.priority)} />
              </Row>

              <Muted>{formatDate(study.createdAt ?? study.date)}</Muted>
            </Card>
          </Pressable>
        );
      })}

      {visible.length > 100 ? (
        <Muted>Showing the first 100. Narrow it with the search box.</Muted>
      ) : null}
    </Screen>
  );
}
