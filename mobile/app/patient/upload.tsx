import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import { aiServiceUrl, api, backendUrl } from "../../src/api/client";
import { colors, radius, resultColor, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Field,
  Label,
  Muted,
  Notice,
  Row,
  Screen,
  Title,
  Value,
} from "../../src/ui";

/*
  The same six clinics the website offers, with the same endpoints. A
  region that is not on this list has no clinic to receive it, so it is
  not offered.
*/
const REGIONS = [
  { key: "CHEST", label: "Chest", endpoint: "/predict/chest/findings", view: "Chest X-ray" },
  { key: "SHOULDER", label: "Shoulder", endpoint: "/predict/shoulder", view: "Shoulder X-ray" },
  { key: "HAND_WRIST", label: "Hand & Wrist", endpoint: "/predict/hand-wrist", view: "Hand & Wrist X-ray" },
  { key: "SPINE", label: "Spine", endpoint: "/predict/region/spine", view: "Spine X-ray" },
  { key: "PELVIS_HIP", label: "Pelvis & Hip", endpoint: "/predict/region/pelvis", view: "Pelvis & Hip X-ray" },
  { key: "LOWER_LIMB", label: "Leg & Foot", endpoint: "/predict/region/lower-limb", view: "Lower Limb X-ray" },
] as const;

type Finding = {
  name: string;
  probability: number;
  threshold: number;
  detected: boolean;
};

type Analysis = {
  result?: string;
  triageResult?: string;
  confidence?: number;
  primaryFinding?: string | null;
  message?: string;
  scopeNote?: string | null;
  bodyRegion?: string;
  detectedRegion?: string;
  detectedClinic?: string;
  priority?: string;
  needsDoctorReview?: boolean;
  allFindings?: Finding[];
  abnormalityProbability?: number;
  decisionThreshold?: number;
  modelName?: string;
  disclaimer?: string;
};

export default function UploadScreen() {
  const router = useRouter();

  const [region, setRegion] = useState<(typeof REGIONS)[number]>(REGIONS[0]);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [symptoms, setSymptoms] = useState("");
  const [history, setHistory] = useState("");
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function pick(from: "library" | "camera") {
    const permission =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setMessage("RadioCare needs permission to read the image.");
      return;
    }

    const picked =
      from === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 1 });

    if (!picked.canceled && picked.assets[0]) {
      setImage(picked.assets[0]);
      setAnalysis(null);
      setSaved("");
      setMessage("");
    }
  }

  /*
    The picked file, in the shape each platform's fetch understands: a
    browser hands over a real File, while the native runtime uploads
    from the file's address.
  */
  async function filePart(asset: ImagePicker.ImagePickerAsset) {
    const name = asset.fileName ?? `xray-${Date.now()}.jpg`;
    const type = asset.mimeType ?? "image/jpeg";

    if (asset.uri.startsWith("data:") || asset.uri.startsWith("blob:")) {
      const blob = await (await fetch(asset.uri)).blob();

      return new File([blob], name, { type });
    }

    return { uri: asset.uri, name, type } as unknown as Blob;
  }

  async function analyse() {
    if (!image) {
      setMessage("Choose the X-ray image first.");
      return;
    }

    const years = Number(age);

    if (!Number.isInteger(years) || years < 0 || years > 120) {
      setMessage("Enter an age between 0 and 120.");
      return;
    }

    setIsBusy(true);
    setMessage("");
    setSaved("");

    try {
      const part = await filePart(image);

      const aiForm = new FormData();
      aiForm.append("image", part as any);

      const aiResponse = await fetch(`${aiServiceUrl}${region.endpoint}`, {
        method: "POST",
        body: aiForm,
      });

      const reading = (await aiResponse.json()) as Analysis;

      if (!aiResponse.ok) {
        throw new Error((reading as any)?.detail ?? "The analysis failed.");
      }

      setAnalysis(reading);

      /* The study is filed with the reading attached, exactly as on the web. */
      const studyForm = new FormData();
      const result = reading.triageResult ?? reading.result ?? "NOT_ANALYZED";

      studyForm.append("image", (await filePart(image)) as any);
      studyForm.append("age", String(years));
      studyForm.append("gender", gender);
      studyForm.append("symptoms", symptoms.trim());
      studyForm.append("medicalHistory", history.trim());
      studyForm.append("bodyRegion", reading.bodyRegion ?? region.key);
      studyForm.append("imagingView", region.view);
      studyForm.append("priority", reading.priority ?? "Routine");
      studyForm.append(
        "clinicalNotes",
        `${region.label} X-ray uploaded from the mobile application.`,
      );
      studyForm.append("detectedRegion", reading.detectedRegion ?? reading.bodyRegion ?? region.key);
      studyForm.append("detectedClinic", reading.detectedClinic ?? "");
      studyForm.append("triageResult", result);
      studyForm.append("predictedFinding", reading.primaryFinding ?? result);
      studyForm.append("primaryFinding", reading.primaryFinding ?? "");
      studyForm.append("confidence", String(reading.confidence ?? 0));
      studyForm.append("explanation", reading.message ?? "");
      studyForm.append("allFindings", JSON.stringify(reading.allFindings ?? []));

      const stored = await api<{ success: boolean; message?: string }>(
        "/api/studies",
        { formData: studyForm },
      );

      setSaved(
        stored.ok && stored.data?.success
          ? "Saved and sent to the clinic."
          : stored.data?.message ?? "The reading is shown, but the study was not saved.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The analysis failed.");
    } finally {
      setIsBusy(false);
    }
  }

  const result = analysis?.triageResult ?? analysis?.result;
  const findings = (analysis?.allFindings ?? []).slice(0, 6);

  return (
    <Screen>
      <Title
        eyebrow="New study"
        title="Upload an X-ray"
        subtitle="Pick the body region, add the image, and the clinic's model reads it."
      />

      <Card>
        <Label>Body region</Label>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: spacing.xs }}>
            {REGIONS.map((item) => {
              const isActive = item.key === region.key;

              return (
                <Pressable
                  key={item.key}
                  onPress={() => {
                    setRegion(item);
                    setAnalysis(null);
                  }}
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
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>

        <View style={{ height: spacing.md }} />

        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Field label="Age" value={age} onChangeText={setAge} placeholder="44" keyboardType="numeric" />
          </View>

          <View style={{ flex: 1 }}>
            <Label>Gender</Label>

            <Row style={{ justifyContent: "flex-start", gap: spacing.xs }}>
              {["Male", "Female"].map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setGender(option)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 11,
                    borderRadius: radius.small,
                    borderWidth: 1,
                    borderColor: gender === option ? colors.lineStrong : colors.line,
                    backgroundColor:
                      gender === option ? "rgba(56,189,248,0.18)" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: gender === option ? colors.accent : colors.muted,
                      fontWeight: "700",
                      fontSize: 13,
                    }}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </Row>
          </View>
        </Row>

        <Field
          label="Current symptoms"
          value={symptoms}
          onChangeText={setSymptoms}
          placeholder="Pain, swelling, since when..."
          multiline
        />

        <Field
          label="Medical history"
          value={history}
          onChangeText={setHistory}
          placeholder="Chronic illnesses, surgeries..."
          multiline
        />
      </Card>

      <Card>
        <Label>X-ray image</Label>

        {image ? (
          <Image
            source={{ uri: image.uri }}
            style={{
              width: "100%",
              height: 260,
              borderRadius: radius.small,
              resizeMode: "contain",
              backgroundColor: "#000",
              marginBottom: spacing.sm,
            }}
          />
        ) : (
          <View
            style={{
              height: 150,
              borderRadius: radius.small,
              borderWidth: 1,
              borderColor: colors.line,
              borderStyle: "dashed",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: spacing.sm,
            }}
          >
            <Muted>JPG, PNG or WEBP · up to 20 MB</Muted>
          </View>
        )}

        <Row>
          <View style={{ flex: 1 }}>
            <Button label="Choose image" kind="ghost" onPress={() => pick("library")} />
          </View>

          <View style={{ flex: 1 }}>
            <Button label="Camera" kind="ghost" onPress={() => pick("camera")} />
          </View>
        </Row>
      </Card>

      <Notice text={message} tone={colors.bad} />
      <Notice text={saved} tone={colors.good} />

      <Button
        label={`Analyze ${region.label} X-ray`}
        onPress={analyse}
        loading={isBusy}
        disabled={!image}
      />

      {analysis ? (
        <View style={{ marginTop: spacing.lg }}>
          <Card tone={resultColor(result)}>
            <Label>AI preliminary result</Label>

            <Text
              style={{
                color: resultColor(result),
                fontSize: 30,
                fontWeight: "900",
                letterSpacing: -0.5,
              }}
            >
              {result}
            </Text>

            <Row style={{ marginTop: spacing.md }}>
              <View>
                <Label>Confidence</Label>
                <Value>{analysis.confidence?.toFixed?.(2) ?? analysis.confidence}%</Value>
              </View>

              <View>
                <Label>Priority</Label>
                <Value>{analysis.priority}</Value>
              </View>
            </Row>

            {analysis.primaryFinding ? (
              <View style={{ marginTop: spacing.md }}>
                <Label>Primary finding</Label>
                <Value>{analysis.primaryFinding}</Value>
              </View>
            ) : null}

            {analysis.abnormalityProbability !== undefined ? (
              <View style={{ marginTop: spacing.md }}>
                <Label>
                  Abnormality score · decides at {analysis.decisionThreshold}%
                </Label>
                <Value>{analysis.abnormalityProbability}%</Value>
              </View>
            ) : null}
          </Card>

          {findings.length > 0 ? (
            <Card>
              <Label>All findings and their thresholds</Label>

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
                        width: `${Math.min(100, finding.probability)}%`,
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

          {analysis.message ? (
            <Card>
              <Muted>{analysis.message}</Muted>
            </Card>
          ) : null}

          <Button label="Back to my studies" kind="ghost" onPress={() => router.replace("/patient")} />
        </View>
      ) : null}

      <View style={{ height: spacing.md }} />
      <Muted>AI service: {aiServiceUrl}</Muted>
      <Muted>Backend: {backendUrl}</Muted>
    </Screen>
  );
}
