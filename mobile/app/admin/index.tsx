import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, currentSession, signOut } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Button,
  Card,
  Label,
  Muted,
  Row,
  Screen,
  Title,
  Value,
} from "../../src/ui";

type Overview = {
  studies?: {
    total: number;
    normal: number;
    abnormal: number;
    urgent: number;
    waiting: number;
  };
  accounts?: { total: number; patients: number; doctors: number };
  queue?: {
    pendingPatients: number;
    pendingDoctors: number;
    bookedAppointments: number;
    unreadSupport: number;
  };
};

/*
  What an administrator checks first: what is waiting on them, and what
  the system has been doing.
*/
export default function AdminHome() {
  const router = useRouter();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const user = await currentSession();

    if (!user) {
      router.replace("/");
      return;
    }

    setName(user.name ?? "");

    const result = await api<Overview>("/api/admin/overview");

    if (result.ok) setOverview(result.data);

    setIsLoading(false);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  const queue = overview?.queue;
  const studies = overview?.studies;

  const waiting = [
    { label: "Patient requests", value: queue?.pendingPatients },
    { label: "Doctor requests", value: queue?.pendingDoctors },
    { label: "Unread messages", value: queue?.unreadSupport },
    { label: "Booked appointments", value: queue?.bookedAppointments },
  ];

  const counters = [
    { label: "Studies", value: studies?.total },
    { label: "Abnormal", value: studies?.abnormal, tone: colors.bad },
    { label: "Urgent", value: studies?.urgent, tone: colors.warn },
    { label: "Waiting", value: studies?.waiting },
  ];

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Administration"
        title={name ? `Welcome, ${name}` : "Administration"}
        subtitle="The queues, the accounts and the cases in one view."
      />

      <Card>
        <Label>Waiting on you</Label>

        <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
          {waiting.map((item) => (
            <Row key={item.label}>
              <Muted>{item.label}</Muted>

              <Text
                style={{
                  color: item.value ? colors.accent : colors.muted,
                  fontSize: 20,
                  fontWeight: "900",
                }}
              >
                {isLoading ? "…" : (item.value ?? 0)}
              </Text>
            </Row>
          ))}
        </View>
      </Card>

      {/*
        The counters are the entrance to the case list rather than a
        display: an administrator who sees "93 abnormal" wants to open
        those 93, so each card carries the filter that shows them.
      */}
      <Row style={{ flexWrap: "wrap", gap: spacing.sm }}>
        {counters.map((card) => (
          <Pressable
            key={card.label}
            onPress={() => router.push("/admin/studies")}
            style={{ flexGrow: 1, minWidth: "45%" }}
          >
            <Card>
              <Label>{card.label}</Label>
              <Value tone={card.tone}>{isLoading ? "…" : (card.value ?? 0)}</Value>
            </Card>
          </Pressable>
        ))}
      </Row>

      <Pressable onPress={() => router.push("/admin/studies")}>
        <Card>
          <Row>
            <View>
              <Label>All cases</Label>
              <Muted>Every study, with its clinic and its AI reading</Muted>
            </View>

            <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "900" }}>
              {studies?.total ?? 0}
            </Text>
          </Row>
        </Card>
      </Pressable>

      <Card>
        <Label>Accounts</Label>

        <Row style={{ marginTop: spacing.sm }}>
          <View>
            <Muted>Patients</Muted>
            <Value>{overview?.accounts?.patients ?? 0}</Value>
          </View>

          <View>
            <Muted>Doctors</Muted>
            <Value>{overview?.accounts?.doctors ?? 0}</Value>
          </View>

          <View>
            <Muted>Total</Muted>
            <Value>{overview?.accounts?.total ?? 0}</Value>
          </View>
        </Row>
      </Card>

      <Pressable onPress={() => router.push("/admin/requests")}>
        <Card>
          <Row>
            <View>
              <Label>Registration requests</Label>
              <Muted>Approve a patient or a doctor</Muted>
            </View>

            <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "900" }}>
              {(queue?.pendingPatients ?? 0) + (queue?.pendingDoctors ?? 0)}
            </Text>
          </Row>
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/admin/messages")}>
        <Card>
          <Row>
            <View>
              <Label>Messages</Label>
              <Muted>Conversations with doctors and patients</Muted>
            </View>

            <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "900" }}>
              {queue?.unreadSupport ?? 0}
            </Text>
          </Row>
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/appointments")}>
        <Card>
          <Row>
            <View>
              <Label>Appointments</Label>
              <Muted>Booked visits between doctors and patients</Muted>
            </View>

            <Text style={{ color: colors.accent, fontSize: 20, fontWeight: "900" }}>
              {queue?.bookedAppointments ?? 0}
            </Text>
          </Row>
        </Card>
      </Pressable>

      <View style={{ height: spacing.md }} />

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
