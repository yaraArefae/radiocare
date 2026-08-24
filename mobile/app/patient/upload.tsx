import * as DocumentPicker from "expo-document-picker";
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
  Every study the website accepts, in the two kinds it accepts them as.

  A radiograph is one picture and comes out of the photo library. A CT
  or an MRI is a stack of slices in a .nii.gz, an .npy or a folder of
  DICOM files, which no photo library holds and no image picker will
  offer - so those are chosen through the file picker instead, and sent
  to a different endpoint under a different field name.

  The phone offered the six X-ray clinics only. Two thirds of the
  trained models read volumes, and none of them could be reached from
  here at all.
*/
type PickedFile = { uri: string; name: string; type: string };

type Region = {
  /*
    Unique per study type. The body region is not: five of these are
    chest studies and six are abdominal, and reusing it meant React saw
    repeated keys and the chip row highlighted every chest study when
    one was picked.
  */
  id: string;
  bodyRegion: string;
  label: string;
  endpoint: string;
  view: string;
  kind: "image" | "volume";
};

const REGIONS: readonly Region[] = [
  /* ---- X-ray: picked from the photo library ---------------------- */
  { id: "findings", bodyRegion: "CHEST", label: "Chest X-ray", endpoint: "/predict/chest/findings", view: "Chest X-ray", kind: "image" },
  { id: "shoulder", bodyRegion: "SHOULDER", label: "Shoulder X-ray", endpoint: "/predict/shoulder", view: "Shoulder X-ray", kind: "image" },
  { id: "hand-wrist", bodyRegion: "HAND_WRIST", label: "Hand & Wrist X-ray", endpoint: "/predict/hand-wrist", view: "Hand & Wrist X-ray", kind: "image" },
  { id: "spine", bodyRegion: "SPINE", label: "Spine X-ray", endpoint: "/predict/region/spine", view: "Spine X-ray", kind: "image" },
  { id: "pelvis", bodyRegion: "PELVIS_HIP", label: "Pelvis & Hip X-ray", endpoint: "/predict/region/pelvis", view: "Pelvis & Hip X-ray", kind: "image" },
  { id: "lower-limb", bodyRegion: "LOWER_LIMB", label: "Leg & Foot X-ray", endpoint: "/predict/region/lower-limb", view: "Lower Limb X-ray", kind: "image" },

  /* ---- CT and MRI: chosen as a file ------------------------------ */
  { id: "head-mri", bodyRegion: "HEAD", label: "Head MRI — Brain Tumour", endpoint: "/predict/volume/head-mri", view: "Head MRI", kind: "volume" },
  { id: "head-mra", bodyRegion: "HEAD", label: "Head MRA — Aneurysm", endpoint: "/predict/volume/head-mra", view: "Head MRA", kind: "volume" },
  { id: "chest-ct", bodyRegion: "CHEST", label: "Chest CT — Lung Nodule", endpoint: "/predict/volume/chest-ct", view: "Chest CT", kind: "volume" },
  { id: "chest-ct-tumour", bodyRegion: "CHEST", label: "Lung CT — Tumour", endpoint: "/predict/volume/chest-ct-tumour", view: "Lung CT", kind: "volume" },
  { id: "chest-ct-lungs", bodyRegion: "CHEST", label: "Chest CT — Whole Scan", endpoint: "/predict/volume/chest-ct-lungs", view: "Chest CT", kind: "volume" },
  { id: "chest-ct-ribs", bodyRegion: "CHEST", label: "Rib CT — Fracture Type", endpoint: "/predict/volume/chest-ct-ribs", view: "Rib CT", kind: "volume" },
  { id: "abdomen-ct", bodyRegion: "ABDOMEN", label: "Abdomen CT — Adrenal", endpoint: "/predict/volume/abdomen-ct", view: "Abdomen CT", kind: "volume" },
  { id: "abdomen-ct-pancreas", bodyRegion: "ABDOMEN", label: "Pancreas CT — Tumour", endpoint: "/predict/volume/abdomen-ct-pancreas", view: "Pancreas CT", kind: "volume" },
  { id: "abdomen-ct-liver-vessels", bodyRegion: "ABDOMEN", label: "Liver Vessels CT — Tumour", endpoint: "/predict/volume/abdomen-ct-liver-vessels", view: "Liver Vessels CT", kind: "volume" },
  { id: "abdomen-ct-colon", bodyRegion: "ABDOMEN", label: "Colon CT — Cancer", endpoint: "/predict/volume/abdomen-ct-colon", view: "Colon CT", kind: "volume" },
  { id: "abdomen-ct-kidney", bodyRegion: "ABDOMEN", label: "Kidney CT — Tumour", endpoint: "/predict/volume/abdomen-ct-kidney", view: "Kidney CT", kind: "volume" },
  { id: "abdomen-ct-liver", bodyRegion: "ABDOMEN", label: "Liver CT — Tumour", endpoint: "/predict/volume/abdomen-ct-liver", view: "Liver CT", kind: "volume" },
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
  /*
    Whatever was chosen, from whichever picker.

    Both pickers hand back a uri, a name and a type, and everything
    downstream needs only those three, so the screen keeps one shape
    rather than branching on which picker filled it.
  */
  const [file, setFile] = useState<PickedFile | null>(null);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  function accept(chosen: PickedFile) {
    setFile(chosen);
    setAnalysis(null);
    setSaved("");
    setMessage("");
  }

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
      const asset = picked.assets[0];

      accept({
        uri: asset.uri,
        name: asset.fileName ?? `xray-${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
    }
  }

  /*
    A volume is a file, not a picture.

    No photo library holds a .nii.gz and no image picker will offer one,
    so a CT or an MRI is chosen from the phone's files. The type is left
    open because these extensions have no agreed MIME type and a strict
    filter hides the very file the patient came to send.
  */
  async function pickVolume() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });

    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];

    accept({
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType ?? "application/octet-stream",
    });
  }

  /*
    The picked file, in the shape each platform's fetch understands: a
    browser hands over a real File, while the native runtime uploads
    from the file's address.
  */
  async function filePart(chosen: PickedFile) {
    if (chosen.uri.startsWith("data:") || chosen.uri.startsWith("blob:")) {
      const blob = await (await fetch(chosen.uri)).blob();

      return new File([blob], chosen.name, { type: chosen.type });
    }

    return {
      uri: chosen.uri,
      name: chosen.name,
      type: chosen.type,
    } as unknown as Blob;
  }

  async function analyse() {
    if (!file) {
      setMessage(
        region.kind === "volume"
          ? "Choose the scan file first."
          : "Choose the X-ray image first.",
      );
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
      const part = await filePart(file);

      /*
        The volume endpoints take the file under "study" and the image
        endpoints under "image". Sending the wrong name reaches the
        server as a request with no file at all.
      */
      const aiForm = new FormData();
      aiForm.append(region.kind === "volume" ? "study" : "image", part as any);

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

      studyForm.append("image", (await filePart(file)) as any);
      studyForm.append("age", String(years));
      studyForm.append("gender", gender);
      studyForm.append("symptoms", symptoms.trim());
      studyForm.append("medicalHistory", history.trim());
      studyForm.append("bodyRegion", reading.bodyRegion ?? region.bodyRegion);
      studyForm.append("imagingView", region.view);
      studyForm.append("priority", reading.priority ?? "Routine");
      studyForm.append(
        "clinicalNotes",
        `${region.label} uploaded from the mobile application.`,
      );
      studyForm.append("detectedRegion", reading.detectedRegion ?? reading.bodyRegion ?? region.bodyRegion);
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
        title="Upload a study"
        subtitle="Pick the body region, add the image, and the clinic's model reads it."
      />

      <Card>
        <Label>Body region</Label>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: spacing.xs }}>
            {REGIONS.map((item) => {
              const isActive = item.id === region.id;

              return (
                <Pressable
                  key={item.id}
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
        <Label>{region.kind === "volume" ? "Scan file" : "X-ray image"}</Label>

        {/*
          A radiograph is shown; a volume cannot be. A .nii.gz holds a
          stack of slices in a format nothing on a phone can decode, so
          drawing it would produce a black rectangle. The file's name is
          the honest preview, and the slices are played on the study
          screen once the AI service has rendered them.
        */}
        {file && region.kind === "image" ? (
          <Image
            source={{ uri: file.uri }}
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
              paddingHorizontal: spacing.md,
            }}
          >
            {file ? (
              <>
                <Text style={{ fontSize: 30 }}>🧊</Text>
                <Value>{file.name}</Value>
                <Muted>Volume selected</Muted>
              </>
            ) : (
              <Muted>
                {region.kind === "volume"
                  ? "NIfTI (.nii, .nii.gz), .npy or DICOM (.dcm, .zip)"
                  : "JPG, PNG or WEBP · up to 20 MB"}
              </Muted>
            )}
          </View>
        )}

        {region.kind === "volume" ? (
          <Button label="Choose a scan file" kind="ghost" onPress={pickVolume} />
        ) : (
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Choose image" kind="ghost" onPress={() => pick("library")} />
            </View>

            <View style={{ flex: 1 }}>
              <Button label="Camera" kind="ghost" onPress={() => pick("camera")} />
            </View>
          </Row>
        )}
      </Card>

      <Notice text={message} tone={colors.bad} />
      <Notice text={saved} tone={colors.good} />

      <Button
        label={`Analyze ${region.label}`}
        onPress={analyse}
        loading={isBusy}
        disabled={!file}
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
