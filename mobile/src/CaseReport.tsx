import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api } from "./api/client";
import { colors, radius, spacing } from "./theme";
import { Button, Field, Label, Muted, Notice, Row } from "./ui";

type Report = {
  findings?: string;
  impression?: string;
  recommendations?: string;
  finalFinding?: string;
  severity?: string;
  aiAgreement?: string;
  doctorNotes?: string;
  status?: string;
  doctorName?: string;
  followUpRequired?: boolean;
};

const SEVERITIES = ["Normal", "Mild", "Moderate", "Severe", "Critical"];
const AGREEMENTS = ["Agree", "Partially agree", "Disagree"];

/*
  The doctor's report, written on the phone.

  A report saved as a draft is the doctor's own working note; approving
  it is what releases it to the patient and closes the case, so the two
  are separate buttons rather than one save that quietly publishes.
*/
export default function CaseReport({ studyId }: { studyId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [finalFinding, setFinalFinding] = useState("");
  const [severity, setSeverity] = useState("Moderate");
  const [agreement, setAgreement] = useState("Agree");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await api<{ success: boolean; report?: Report | null }>(
        `/api/studies/${studyId}/report`,
      );

      const existing = result.data?.report ?? null;

      if (existing) {
        setReport(existing);
        setFindings(existing.findings ?? "");
        setImpression(existing.impression ?? "");
        setRecommendations(existing.recommendations ?? "");
        setFinalFinding(existing.finalFinding ?? "");
        setSeverity(existing.severity ?? "Moderate");
        setAgreement(existing.aiAgreement ?? "Agree");
        setNotes(existing.doctorNotes ?? "");
      }
    })();
  }, [studyId]);

  async function save(status: "Draft" | "Approved") {
    if (!impression.trim()) {
      setMessage("The impression is what the patient reads. Write it first.");
      return;
    }

    setBusy(status);
    setMessage("");

    const result = await api<{ success: boolean; report?: Report; message?: string }>(
      `/api/studies/${studyId}/report`,
      {
        body: {
          findings,
          impression,
          recommendations,
          finalFinding: finalFinding || impression,
          severity,
          aiAgreement: agreement,
          doctorNotes: notes,
          followUpRequired: false,
          additionalTests: "",
          status,
        },
      },
    );

    if (result.ok && result.data?.success) {
      setReport(result.data.report ?? null);
      setMessage(
        status === "Approved"
          ? "Report approved. The patient can read it now."
          : "Draft saved.",
      );
    } else {
      setMessage(result.data?.message ?? "The report was not saved.");
    }

    setBusy("");
  }

  const isApproved = report?.status === "Approved";

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: isApproved ? colors.good : colors.line,
        borderRadius: radius.medium,
        backgroundColor: colors.surface,
        padding: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      <Pressable onPress={() => setIsOpen((open) => !open)}>
        <Row>
          <Label>
            {isApproved ? "Report · approved" : report ? "Report · draft" : "Write the report"}
          </Label>

          <Text style={{ color: colors.accent, fontWeight: "800" }}>
            {isOpen ? "Hide" : "Open"}
          </Text>
        </Row>
      </Pressable>

      {!isOpen && report?.impression ? (
        <Muted>{report.impression}</Muted>
      ) : null}

      {isOpen ? (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label="Findings"
            value={findings}
            onChangeText={setFindings}
            placeholder="What the image shows..."
            multiline
          />

          <Field
            label="Impression"
            value={impression}
            onChangeText={setImpression}
            placeholder="The conclusion the patient reads..."
            multiline
          />

          <Field
            label="Recommendations"
            value={recommendations}
            onChangeText={setRecommendations}
            placeholder="What the patient should do next..."
            multiline
          />

          <Label>Severity</Label>
          <Row style={{ flexWrap: "wrap", justifyContent: "flex-start", marginBottom: spacing.md }}>
            {SEVERITIES.map((option) => (
              <Pressable
                key={option}
                onPress={() => setSeverity(option)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  marginRight: spacing.xs,
                  marginBottom: spacing.xs,
                  borderColor: severity === option ? colors.lineStrong : colors.line,
                  backgroundColor:
                    severity === option ? "rgba(56,189,248,0.18)" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: severity === option ? colors.accent : colors.muted,
                    fontWeight: "700",
                    fontSize: 12,
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </Row>

          <Label>Do you agree with the AI reading?</Label>
          <Row style={{ flexWrap: "wrap", justifyContent: "flex-start", marginBottom: spacing.md }}>
            {AGREEMENTS.map((option) => (
              <Pressable
                key={option}
                onPress={() => setAgreement(option)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  marginRight: spacing.xs,
                  marginBottom: spacing.xs,
                  borderColor: agreement === option ? colors.lineStrong : colors.line,
                  backgroundColor:
                    agreement === option ? "rgba(56,189,248,0.18)" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: agreement === option ? colors.accent : colors.muted,
                    fontWeight: "700",
                    fontSize: 12,
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            ))}
          </Row>

          <Field
            label="Private notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Not shown to the patient..."
            multiline
          />

          <Notice
            text={message}
            tone={message.includes("not") ? colors.bad : colors.good}
          />

          <Row>
            <View style={{ flex: 1 }}>
              <Button
                label="Save draft"
                kind="ghost"
                onPress={() => save("Draft")}
                loading={busy === "Draft"}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Button
                label="Approve"
                onPress={() => save("Approved")}
                loading={busy === "Approved"}
              />
            </View>
          </Row>
        </View>
      ) : null}
    </View>
  );
}
