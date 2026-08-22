import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api } from "../../src/api/client";
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
  A patient asking for an account.

  Nothing is created here: the request goes into the administrator's
  queue, and the account with its temporary password is only made when
  somebody approves it. That is the same path the website uses, so a
  request sent from a phone appears in the same queue as any other.
*/
export default function PatientRequestScreen() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [symptoms, setSymptoms] = useState("");
  const [history, setHistory] = useState("");

  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function submit() {
    const years = Number(age);

    if (!fullName.trim() || !email.trim() || !phone.trim() || !nationalId.trim()) {
      setMessage("Name, email, phone and national ID are all required.");
      return;
    }

    if (!Number.isInteger(years) || years < 0 || years > 120) {
      setMessage("Enter an age between 0 and 120.");
      return;
    }

    setIsBusy(true);
    setMessage("");

    const result = await api<{ success: boolean; message?: string; alreadyRegistered?: boolean }>(
      "/api/patient-requests",
      {
        body: {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          nationalId: nationalId.trim(),
          age: years,
          gender,
          symptoms: symptoms.trim(),
          medicalHistory: history.trim(),
        },
      },
    );

    setIsBusy(false);

    if (result.ok && result.data?.success) {
      setDone(
        result.data.message ??
          "Your request was sent. An administrator will review it and email your sign-in details.",
      );
    } else {
      setMessage(result.data?.message ?? "The request could not be sent.");
    }
  }

  if (done) {
    return (
      <Screen>
        <Title eyebrow="Request sent" title="Now it waits for an administrator" />

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
        eyebrow="New patient"
        title="Ask for an account"
        subtitle="An administrator reviews the request and emails your sign-in details."
      />

      <Card>
        <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Your name" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
        />
        <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="05..." keyboardType="numeric" />
        <Field label="National ID" value={nationalId} onChangeText={setNationalId} placeholder="ID number" keyboardType="numeric" />

        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Field label="Age" value={age} onChangeText={setAge} placeholder="30" keyboardType="numeric" />
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
                    backgroundColor: gender === option ? "rgba(56,189,248,0.18)" : "transparent",
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
          placeholder="Optional"
          multiline
        />

        <Field
          label="Medical history"
          value={history}
          onChangeText={setHistory}
          placeholder="Optional"
          multiline
        />
      </Card>

      <Notice text={message} tone={colors.bad} />

      <Button label="Send the request" onPress={submit} loading={isBusy} />

      <Button label="Back to sign in" kind="ghost" onPress={() => router.replace("/")} />
    </Screen>
  );
}
