import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";

import { api, currentSession, rolesOf } from "../src/api/client";
import { colors, spacing } from "../src/theme";
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
} from "../src/ui";

type Appointment = {
  id: string;
  studyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes?: string;
  bodyRegion?: string;
  patientName?: string;
  doctorName?: string;
  doctorSpecialty?: string;
};

const STATUS_TONE: Record<string, string> = {
  Confirmed: colors.good,
  Pending: colors.warn,
  Declined: colors.bad,
  Cancelled: colors.bad,
  Completed: colors.accent,
};

function formatWhen(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/*
  Appointments, from whichever side the account sits on.

  A patient answers invitations; a doctor watches the ones they sent.
  Both read the same list from the same endpoint - the server decides
  which rows belong to the person asking.
*/
export default function AppointmentsScreen() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [role, setRole] = useState<"doctor" | "patient">("patient");
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const user = await currentSession();
    const roles = rolesOf(user?.role);

    setRole(roles.includes("doctor") ? "doctor" : "patient");

    const result = await api<{ success: boolean; appointments?: Appointment[] }>(
      "/api/appointments",
    );

    if (result.ok && result.data?.success) {
      setAppointments(result.data.appointments ?? []);
    }

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  async function respond(id: string, status: "Confirmed" | "Declined") {
    setBusyId(id);
    setMessage("");

    const result = await api<{ success: boolean; message?: string }>(
      `/api/appointments/${id}`,
      { method: "PATCH", body: { status } },
    );

    if (result.ok && result.data?.success) {
      setMessage(
        status === "Confirmed" ? "Appointment accepted." : "Appointment declined.",
      );
      await load();
    } else {
      setMessage(result.data?.message ?? "The appointment was not updated.");
    }

    setBusyId("");
  }

  const upcoming = appointments.filter(
    (item) => new Date(item.scheduledAt).getTime() >= Date.now(),
  );

  const past = appointments.filter(
    (item) => new Date(item.scheduledAt).getTime() < Date.now(),
  );

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Appointments"
        title={upcoming.length ? `${upcoming.length} coming up` : "Nothing booked"}
        subtitle={
          role === "doctor"
            ? "The visits you invited patients to."
            : "Visits your doctor invited you to."
        }
      />

      <Notice text={message} tone={colors.good} />

      {!isLoading && appointments.length === 0 ? (
        <Empty icon="📅" text="No appointments yet." />
      ) : null}

      {[
        { label: "Coming up", items: upcoming },
        { label: "Past", items: past },
      ].map((section) =>
        section.items.length ? (
          <View key={section.label}>
            <Label>{section.label}</Label>

            {section.items.map((item) => (
              <Card key={item.id}>
                <Row>
                  <Value>
                    {role === "doctor" ? item.patientName : item.doctorName}
                  </Value>

                  <Pill text={item.status} tone={STATUS_TONE[item.status]} />
                </Row>

                <Muted>{formatWhen(item.scheduledAt)} · {item.durationMinutes} min</Muted>

                {item.bodyRegion ? <Muted>{item.bodyRegion}</Muted> : null}

                {item.notes ? (
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.xs }}>
                    {item.notes}
                  </Text>
                ) : null}

                {/*
                  Only a patient answers, and only while the invitation is
                  still open and in the future.
                */}
                {role === "patient" &&
                item.status === "Pending" &&
                new Date(item.scheduledAt).getTime() >= Date.now() ? (
                  <Row style={{ marginTop: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Accept"
                        onPress={() => respond(item.id, "Confirmed")}
                        loading={busyId === item.id}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Button
                        label="Decline"
                        kind="ghost"
                        onPress={() => respond(item.id, "Declined")}
                        loading={busyId === item.id}
                      />
                    </View>
                  </Row>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null,
      )}
    </Screen>
  );
}
