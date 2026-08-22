import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Empty,
  Label,
  Muted,
  Notice,
  Pill,
  Row,
  Screen,
  Title,
  Value,
} from "../../src/ui";

type Application = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  status: string;
  specialty?: string;
  subspecialty?: string;
  age?: number;
  gender?: string;
  createdAt?: string;
  submittedAt?: string;
};

type Kind = "patient" | "doctor";

/*
  The registration queue.

  Approving is what creates the account and issues the temporary
  password, so the credentials the server returns are shown here once -
  an administrator who is not at their desk still has to be able to pass
  them on if the email does not arrive.
*/
export default function AdminRequests() {
  const [kind, setKind] = useState<Kind>("patient");
  const [applications, setApplications] = useState<Application[]>([]);
  const [credentials, setCredentials] = useState<{
    loginEmail: string;
    temporaryPassword: string;
  } | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (which: Kind) => {
    const result = await api<{ success: boolean; applications?: Application[] }>(
      which === "patient" ? "/api/patient-requests" : "/api/doctor-requests",
    );

    setApplications(
      (result.data?.applications ?? []).filter((item) => item.status === "Pending"),
    );

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load(kind);
    }, [kind, load]),
  );

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setMessage("");
    setCredentials(null);

    const result = await api<{
      success: boolean;
      message?: string;
      credentials?: { loginEmail: string; temporaryPassword: string };
    }>(
      kind === "patient"
        ? "/api/patient-requests/manage"
        : "/api/doctor-requests/manage",
      {
        body: {
          requestId: id,
          action,
          reason: action === "reject" ? "Rejected from the mobile application." : undefined,
        },
      },
    );

    if (result.ok && result.data?.success) {
      setMessage(result.data.message ?? "Done.");

      if (result.data.credentials) setCredentials(result.data.credentials);

      await load(kind);
    } else {
      setMessage(result.data?.message ?? "The request was not updated.");
    }

    setBusyId("");
  }

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Administration"
        title="Registration requests"
        subtitle="Approving creates the account and its temporary password."
      />

      <Row style={{ justifyContent: "flex-start", marginBottom: spacing.md }}>
        {(["patient", "doctor"] as Kind[]).map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              setKind(option);
              setIsLoading(true);
              void load(option);
            }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 9,
              borderRadius: 999,
              marginRight: spacing.xs,
              borderWidth: 1,
              borderColor: kind === option ? colors.lineStrong : colors.line,
              backgroundColor: kind === option ? "rgba(56,189,248,0.18)" : "transparent",
            }}
          >
            <Text
              style={{
                color: kind === option ? colors.accent : colors.muted,
                fontWeight: "700",
                fontSize: 13,
                textTransform: "capitalize",
              }}
            >
              {option}s
            </Text>
          </Pressable>
        ))}
      </Row>

      <Notice text={message} tone={colors.good} />

      {credentials ? (
        <Card tone={colors.good}>
          <Label>Account created · shown once</Label>
          <Muted>Sign-in email</Muted>
          <Value>{credentials.loginEmail}</Value>

          <View style={{ height: spacing.sm }} />

          <Muted>Temporary password</Muted>
          <Value>{credentials.temporaryPassword}</Value>
        </Card>
      ) : null}

      {!isLoading && applications.length === 0 ? (
        <Empty icon="✅" text={`No ${kind} requests waiting.`} />
      ) : null}

      {applications.map((item) => (
        <Card key={item.id}>
          <Row>
            <Value>{item.fullName}</Value>
            <Pill text={item.status} tone={colors.warn} />
          </Row>

          <Muted>{item.email}</Muted>
          {item.phone ? <Muted>{item.phone}</Muted> : null}

          {item.specialty ? (
            <Muted>
              {item.specialty}
              {item.subspecialty ? ` · ${item.subspecialty}` : ""}
            </Muted>
          ) : null}

          {item.age ? <Muted>{item.age} years · {item.gender}</Muted> : null}

          <Row style={{ marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Approve"
                onPress={() => act(item.id, "approve")}
                loading={busyId === item.id}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Button
                label="Reject"
                kind="danger"
                onPress={() => act(item.id, "reject")}
                loading={busyId === item.id}
              />
            </View>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
