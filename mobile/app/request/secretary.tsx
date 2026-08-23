import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { backendUrl } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Field,
  Label,
  Muted,
  Notice,
  Screen,
  Title,
} from "../../src/ui";

/*
  Applying for a secretary post.

  Shorter than the doctor's application on purpose. A secretary holds no
  medical licence and has no specialty, so asking for either would be
  asking for paper that does not exist. What is asked for is who they
  are, what trained them for the desk, and whatever proof of previous
  work they have.

  Only the identity document and the qualification are required. An
  applicant fresh out of college has no experience letter and no CV
  worth the name, and refusing them the form over paper they cannot
  possibly hold would filter for age rather than for suitability.

  The doctor they will work for is not asked here at all. That is the
  administration's decision, made when the application is approved.
*/

type DocumentKey =
  | "id-document"
  | "qualification-certificate"
  | "experience-certificate"
  | "cv";

type PickedFile = { uri: string; name: string; mimeType?: string };

const DOCUMENTS: Array<{
  key: DocumentKey;
  label: string;
  required: boolean;
}> = [
  { key: "id-document", label: "ID document or passport", required: true },
  {
    key: "qualification-certificate",
    label: "Qualification certificate",
    required: true,
  },
  {
    key: "experience-certificate",
    label: "Experience certificate (optional)",
    required: false,
  },
  { key: "cv", label: "CV (optional)", required: false },
];

const LANGUAGES = ["Arabic", "English", "Hebrew", "French", "Turkish"];

export default function SecretaryRequestScreen() {
  const router = useRouter();

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    nationalId: "",
    qualification: "",
    institute: "",
    graduationYear: "",
    yearsOfExperience: "",
    currentWorkplace: "",
    about: "",
  });

  const [languages, setLanguages] = useState<string[]>(["Arabic"]);
  const [files, setFiles] = useState<Partial<Record<DocumentKey, PickedFile>>>(
    {},
  );

  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage("");
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
    const required: Array<keyof typeof form> = [
      "fullName",
      "email",
      "phone",
      "nationalId",
      "qualification",
      "institute",
    ];

    const missing = required.filter((key) => !form[key].trim());

    if (missing.length > 0) {
      setMessage(`Still empty: ${missing.join(", ")}`);
      return;
    }

    for (const document of DOCUMENTS) {
      if (document.required && !files[document.key]) {
        setMessage(`Attach your ${document.label.toLowerCase()}.`);
        return;
      }
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
          yearsOfExperience: Number(form.yearsOfExperience || 0),
          graduationYear: form.graduationYear || null,
          languages,
          declarationAccepted: true,
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

      const response = await fetch(`${backendUrl}/api/secretary-requests`, {
        method: "POST",
        headers: { Origin: "radiocare://" },
        body: payload,
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setDone(
          data?.message ??
            "Your application was sent. An administrator will read your certificates.",
        );
      } else {
        setMessage(data?.message ?? "The application could not be sent.");
      }
    } catch {
      setMessage("Unable to reach the server. Check the connection.");
    } finally {
      setIsBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Title
          eyebrow="Secretary application"
          title="Sent"
          subtitle={done}
        />

        <Card>
          <Muted>
            An administrator reads the certificates, decides which doctor
            you would work with, and emails your sign-in details. They are
            valid for 24 hours and you replace the password on your first
            sign in.
          </Muted>
        </Card>

        <Button label="Back to sign in" onPress={() => router.replace("/")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title
        eyebrow="Secretary application"
        title="Apply for a secretary post"
        subtitle="Send your details and your certificates. You are not asked for a medical licence: a secretary manages appointments and never reads studies."
      />

      {message ? <Notice text={message} tone={colors.bad} /> : null}

      <Card>
        <Label>Personal information</Label>

        <Field
          label="Full legal name"
          value={form.fullName}
          onChangeText={(value) => update("fullName", value)}
          placeholder="Your full legal name"
        />

        <Field
          label="Email"
          value={form.email}
          onChangeText={(value) => update("email", value)}
          placeholder="Where the approval is sent"
        />

        <Field
          label="Phone"
          value={form.phone}
          onChangeText={(value) => update("phone", value)}
          placeholder="Mobile number"
        />

        <Field
          label="National ID or passport"
          value={form.nationalId}
          onChangeText={(value) => update("nationalId", value)}
          placeholder="Identity number"
        />
      </Card>

      <Card>
        <Label>Qualification</Label>

        <Field
          label="Qualification"
          value={form.qualification}
          onChangeText={(value) => update("qualification", value)}
          placeholder="Diploma in Medical Secretarial Studies"
        />

        <Field
          label="College or institute"
          value={form.institute}
          onChangeText={(value) => update("institute", value)}
          placeholder="Where you studied"
        />

        <Field
          label="Graduation year (optional)"
          value={form.graduationYear}
          onChangeText={(value) => update("graduationYear", value)}
          placeholder="2022"
        />
      </Card>

      <Card>
        <Label>Experience</Label>

        <Muted>
          Previous work is welcome but not required. An applicant with none
          is still considered.
        </Muted>

        <Field
          label="Years of experience"
          value={form.yearsOfExperience}
          onChangeText={(value) => update("yearsOfExperience", value)}
          placeholder="0"
        />

        <Field
          label="Current or last workplace (optional)"
          value={form.currentWorkplace}
          onChangeText={(value) => update("currentWorkplace", value)}
          placeholder="Clinic or hospital"
        />

        <View style={{ marginTop: spacing.sm }}>
          <Label>Languages you speak</Label>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: spacing.xs,
              marginTop: spacing.xs,
            }}
          >
            {LANGUAGES.map((language) => {
              const active = languages.includes(language);

              return (
                <Pressable
                  key={language}
                  onPress={() =>
                    setLanguages((current) =>
                      current.includes(language)
                        ? current.filter((item) => item !== language)
                        : [...current, language],
                    )
                  }
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 8,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? colors.accent : colors.line,
                    backgroundColor: active ? colors.surfaceStrong : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.text : colors.muted,
                      fontWeight: "700",
                    }}
                  >
                    {language}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Muted>
            A patient calling to move an appointment has to be understood.
          </Muted>
        </View>

        <Field
          label="Anything else (optional)"
          value={form.about}
          onChangeText={(value) => update("about", value)}
          placeholder="Anything that would not fit above"
          multiline
        />
      </Card>

      <Card>
        <Label>Certificates</Label>

        <Muted>
          Your identity paper and your qualification are required. The other
          two help, and an application without them is still read.
        </Muted>

        {DOCUMENTS.map((document) => (
          <View key={document.key} style={{ marginTop: spacing.sm }}>
            <Button
              kind={files[document.key] ? "ghost" : "primary"}
              label={
                files[document.key]
                  ? `✓ ${files[document.key]?.name}`
                  : `Attach ${document.label}`
              }
              onPress={() => void pick(document.key)}
            />
          </View>
        ))}
      </Card>

      <Pressable onPress={() => setAccepted((value) => !value)}>
        <Card>
          <Text style={{ color: colors.text, lineHeight: 22 }}>
            {accepted ? "☑" : "☐"}  I confirm that the information and
            certificates I sent are accurate, and I authorize RadioCare
            administrators to verify them.
          </Text>
        </Card>
      </Pressable>

      <Button
        label="Submit application"
        loading={isBusy}
        onPress={() => void submit()}
      />

      <Button kind="ghost" label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}
