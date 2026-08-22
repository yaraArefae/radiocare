import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { backendUrl } from "../../src/api/client";
import { colors, radius, spacing } from "../../src/theme";
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
} from "../../src/ui";

/*
  A doctor applying to work in a clinic.

  Unlike the patient form this one carries files: an administrator is
  asked to verify a medical licence, and a file name is not a licence.
  The four documents are uploaded with the application and stored where
  only an administrator can open them.
*/

const DOCUMENTS = [
  { key: "id-document", label: "ID document" },
  { key: "medical-license", label: "Medical license" },
  { key: "specialty-certificate", label: "Specialty certificate" },
  { key: "cv", label: "CV" },
] as const;

type DocumentKey = (typeof DOCUMENTS)[number]["key"];

type PickedFile = { uri: string; name: string; mimeType?: string };

export default function DoctorRequestScreen() {
  const router = useRouter();

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    nationalId: "",
    specialty: "",
    subspecialty: "",
    licenseNumber: "",
    licensingAuthority: "",
    licenseCountry: "",
    licenseIssueDate: "",
    licenseExpiryDate: "",
    yearsOfExperience: "",
    currentWorkplace: "",
    medicalDegree: "",
    university: "",
    graduationYear: "",
  });

  const [files, setFiles] = useState<Partial<Record<DocumentKey, PickedFile>>>({});
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function pick(key: DocumentKey) {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
    });

    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];

    setFiles((current) => ({
      ...current,
      [key]: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType },
    }));
  }

  async function submit() {
    const missing = Object.entries(form)
      .filter(([, value]) => !String(value).trim())
      .map(([key]) => key);

    if (missing.length > 0) {
      setMessage(`Still empty: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "..." : ""}`);
      return;
    }

    if (!accepted) {
      setMessage("Confirm that the information you entered is correct.");
      return;
    }

    setIsBusy(true);
    setMessage("");

    try {
      const payload = new FormData();

      payload.append(
        "application",
        JSON.stringify({
          ...form,
          yearsOfExperience: Number(form.yearsOfExperience),
          graduationYear: Number(form.graduationYear),
          declarationAccepted: true,
          additionalDocuments: [],
          idDocumentPath: files["id-document"]?.name ?? "",
          medicalLicensePath: files["medical-license"]?.name ?? "",
          specialtyCertificatePath: files["specialty-certificate"]?.name ?? "",
          cvPath: files.cv?.name ?? "",
        }),
      );

      for (const { key } of DOCUMENTS) {
        const file = files[key];

        if (!file) continue;

        payload.append(key, {
          uri: file.uri,
          name: file.name,
          type: file.mimeType ?? "application/octet-stream",
        } as any);
      }

      const response = await fetch(`${backendUrl}/api/doctor-requests`, {
        method: "POST",
        headers: { Origin: "radiocare://" },
        body: payload,
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setDone(
          data?.message ??
            "Your application was sent. An administrator will review your documents.",
        );
      } else {
        setMessage(data?.message ?? "The application could not be sent.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The application could not be sent.");
    } finally {
      setIsBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title eyebrow="Application sent" title="Now it waits for review" />

        <Card tone={colors.good}>
          <Muted>{done}</Muted>
        </Card>

        <Button label="Back to sign in" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title
        eyebrow="New doctor"
        title="Apply to a clinic"
        subtitle="An administrator verifies your licence before the account is created."
      />

      <Card>
        <Label>About you</Label>
        <Field label="Full name" value={form.fullName} onChangeText={(v) => update("fullName", v)} />
        <Field
          label="Email"
          value={form.email}
          onChangeText={(v) => update("email", v)}
          keyboardType="email-address"
        />
        <Field label="Phone" value={form.phone} onChangeText={(v) => update("phone", v)} keyboardType="numeric" />
        <Field label="Date of birth" value={form.dateOfBirth} onChangeText={(v) => update("dateOfBirth", v)} placeholder="1990-01-30" />
        <Field label="National ID" value={form.nationalId} onChangeText={(v) => update("nationalId", v)} keyboardType="numeric" />
      </Card>

      <Card>
        <Label>Your specialty</Label>
        <Field label="Specialty" value={form.specialty} onChangeText={(v) => update("specialty", v)} placeholder="Radiology" />
        <Field label="Subspecialty" value={form.subspecialty} onChangeText={(v) => update("subspecialty", v)} placeholder="Chest" />
        <Field label="Years of experience" value={form.yearsOfExperience} onChangeText={(v) => update("yearsOfExperience", v)} keyboardType="numeric" />
        <Field label="Current workplace" value={form.currentWorkplace} onChangeText={(v) => update("currentWorkplace", v)} />
      </Card>

      <Card>
        <Label>Licence</Label>
        <Field label="Licence number" value={form.licenseNumber} onChangeText={(v) => update("licenseNumber", v)} />
        <Field label="Licensing authority" value={form.licensingAuthority} onChangeText={(v) => update("licensingAuthority", v)} />
        <Field label="Country" value={form.licenseCountry} onChangeText={(v) => update("licenseCountry", v)} />
        <Field label="Issued on" value={form.licenseIssueDate} onChangeText={(v) => update("licenseIssueDate", v)} placeholder="2020-01-30" />
        <Field label="Expires on" value={form.licenseExpiryDate} onChangeText={(v) => update("licenseExpiryDate", v)} placeholder="2030-01-30" />
      </Card>

      <Card>
        <Label>Education</Label>
        <Field label="Medical degree" value={form.medicalDegree} onChangeText={(v) => update("medicalDegree", v)} placeholder="MD" />
        <Field label="University" value={form.university} onChangeText={(v) => update("university", v)} />
        <Field label="Graduation year" value={form.graduationYear} onChangeText={(v) => update("graduationYear", v)} keyboardType="numeric" />
      </Card>

      <Card>
        <Label>Documents</Label>
        <Muted>A photo or a PDF. These are read only by an administrator.</Muted>

        <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
          {DOCUMENTS.map((document) => {
            const file = files[document.key];

            return (
              <Pressable
                key={document.key}
                onPress={() => pick(document.key)}
                style={{
                  borderWidth: 1,
                  borderColor: file ? colors.good : colors.line,
                  borderRadius: radius.small,
                  padding: spacing.md,
                }}
              >
                <Row>
                  <Text style={{ color: colors.text, fontWeight: "700" }}>
                    {document.label}
                  </Text>

                  <Text
                    style={{
                      color: file ? colors.good : colors.accent,
                      fontWeight: "800",
                      fontSize: 12,
                    }}
                  >
                    {file ? "Chosen" : "Choose"}
                  </Text>
                </Row>

                {file ? <Muted>{file.name}</Muted> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Pressable onPress={() => setAccepted((value) => !value)}>
        <Card tone={accepted ? colors.good : undefined}>
          <Row>
            <Text style={{ color: colors.text, flex: 1, fontSize: 14 }}>
              I confirm the information above is correct.
            </Text>

            <Text style={{ fontSize: 20 }}>{accepted ? "☑" : "☐"}</Text>
          </Row>
        </Card>
      </Pressable>

      <Notice text={message} tone={colors.bad} />

      <Button label="Send the application" onPress={submit} loading={isBusy} />

      <Button label="Back to sign in" kind="ghost" onPress={() => router.replace("/")} />
    </Screen>
  );
}
