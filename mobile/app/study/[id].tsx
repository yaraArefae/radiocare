import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import {
  api,
  backendUrl,
  currentSession,
  loadStoredSession,
  rolesOf,
} from "../../src/api/client";
import CaseChat from "../../src/CaseChat";
import CaseReport from "../../src/CaseReport";
import VolumeViewer from "../../src/VolumeViewer";
import { colors, radius, priorityColor, resultColor, spacing } from "../../src/theme";
import { Card, Label, Muted, Pill, Row, Screen, Title, Value } from "../../src/ui";

type Finding = {
  name: string;
  probability: number;
  threshold: number;
  detected: boolean;
};

type Study = {
  id: string;
  patient?: string;
  patientName?: string;
  bodyRegion?: string;
  studyKind?: string;
  imagingView?: string;
  status?: string;
  priority?: string;
  triageResult?: string;
  aiResult?: string;
  primaryFinding?: string | null;
  confidence?: number | string | null;
  detectedRegion?: string;
  detectedClinic?: string;
  explanation?: string;
  createdAt?: string;
  symptoms?: string;
  medicalHistory?: string;
  allFindings?: Finding[];
  possibleFindings?: Finding[];
};

/*
  One case, as the doctor and the patient both see it: the image, what
  the model said, and every finding with the threshold it had to clear.
*/
export default function StudyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [study, setStudy] = useState<Study | null>(null);
  const [details, setDetails] = useState<any>(null);
  const [cookie, setCookie] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<"doctor" | "patient" | "admin">("patient");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setCookie(await loadStoredSession());

      const user = await currentSession();
      const roles = rolesOf(user?.role);

      setViewerRole(
        roles.includes("admin") ? "admin" : roles.includes("doctor") ? "doctor" : "patient",
      );

      const result = await api<{ success: boolean; study?: Study; message?: string }>(
        `/api/studies/${id}`,
      );

      if (!result.ok || !result.data?.success) {
        setError(result.data?.message ?? "Unable to load the study.");
      } else {
        const loaded = result.data.study ?? (result.data as any);
        setStudy(loaded);

        /* The reading is stored as JSON on the study record. */
        try {
          setDetails(
            typeof loaded.explanation === "string" && loaded.explanation.startsWith("{")
              ? JSON.parse(loaded.explanation)
              : null,
          );
        } catch {
          setDetails(null);
        }
      }

      setIsLoading(false);
    })();
  }, [id]);

  const result =
    study?.triageResult ?? details?.triageResult ?? study?.aiResult ?? "";

  const findings: Finding[] =
    study?.allFindings ?? details?.allFindings ?? study?.possibleFindings ?? [];

  return (
    <Screen refreshing={isLoading}>
      {error ? <Muted>{error}</Muted> : null}

      {study ? (
        <>
          <Title
            eyebrow={study.bodyRegion ?? "Study"}
            title={study.patient ?? study.patientName ?? "Study"}
            subtitle={study.imagingView}
          />

          {/*
            A radiograph is one picture and is shown as one. A CT or an
            MRI is a stack, and handing it to Image drew a black
            rectangle: the file is a .nii.gz, which nothing on a phone
            can decode. It goes to the slice viewer instead.
          */}
          {study.studyKind === "VOLUME" ? (
            <View style={{ marginBottom: spacing.sm }}>
              <VolumeViewer studyId={String(study.id)} />
            </View>
          ) : (
            <Image
              source={{
                uri: `${backendUrl}/api/studies/${study.id}/image`,
                headers: cookie ? { Cookie: cookie } : undefined,
              }}
              style={{
                width: "100%",
                height: 300,
                borderRadius: radius.medium,
                backgroundColor: "#000",
                resizeMode: "contain",
                marginBottom: spacing.sm,
              }}
            />
          )}

          <Card tone={resultColor(result)}>
            <Label>AI preliminary result</Label>

            <Text
              style={{
                color: resultColor(result),
                fontSize: 28,
                fontWeight: "900",
              }}
            >
              {result || "NOT ANALYZED"}
            </Text>

            <Row style={{ marginTop: spacing.md }}>
              <View>
                <Label>Confidence</Label>
                <Value>
                  {study.confidence !== undefined && study.confidence !== null
                    ? `${Number(study.confidence).toFixed(2)}%`
                    : "—"}
                </Value>
              </View>

              <View>
                <Label>Priority</Label>
                <Value tone={priorityColor(study.priority)}>{study.priority ?? "—"}</Value>
              </View>
            </Row>

            <View style={{ marginTop: spacing.md }}>
              <Label>Primary finding</Label>
              <Value>
                {study.primaryFinding || details?.primaryFinding || "No confirmed finding"}
              </Value>
            </View>
          </Card>

          {findings.length > 0 ? (
            <Card>
              <Label>Findings and thresholds</Label>

              {findings.map((finding) => (
                <View key={finding.name} style={{ marginTop: spacing.sm }}>
                  <Row>
                    <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
                      {finding.name}
                    </Text>

                    <Text
                      style={{
                        color: finding.detected ? colors.bad : colors.muted,
                        fontWeight: "800",
                      }}
                    >
                      {finding.probability}%
                    </Text>
                  </Row>

                  <View
                    style={{
                      height: 6,
                      borderRadius: 999,
                      backgroundColor: "rgba(255,255,255,0.1)",
                      marginTop: 6,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.min(100, Number(finding.probability))}%`,
                        height: "100%",
                        backgroundColor: finding.detected ? colors.bad : colors.accent,
                      }}
                    />
                  </View>

                  <Muted>
                    {finding.detected ? "Above" : "Below"} its threshold of {finding.threshold}%
                  </Muted>
                </View>
              ))}
            </Card>
          ) : null}

          {details?.message ? (
            <Card>
              <Label>What the model reported</Label>
              <Muted>{details.message}</Muted>
            </Card>
          ) : null}

          <Card>
            <Row>
              <Pill text={study.status ?? "—"} />
              <Pill text={study.detectedClinic ?? study.detectedRegion ?? ""} />
            </Row>

            {study.symptoms ? (
              <View style={{ marginTop: spacing.md }}>
                <Label>Symptoms</Label>
                <Muted>{study.symptoms}</Muted>
              </View>
            ) : null}

            {study.medicalHistory ? (
              <View style={{ marginTop: spacing.md }}>
                <Label>Medical history</Label>
                <Muted>{study.medicalHistory}</Muted>
              </View>
            ) : null}
          </Card>

          {/*
            The doctor writes the reading; both sides can talk about it.
            An administrator sees the case but takes part in neither, so
            they are shown neither control.
          */}
          {viewerRole === "doctor" ? <CaseReport studyId={String(id)} /> : null}

          {viewerRole !== "admin" ? (
            <CaseChat studyId={String(id)} viewerRole={viewerRole} />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
