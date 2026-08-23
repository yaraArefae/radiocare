import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, signOut } from "../src/api/client";
import { colors, spacing } from "../src/theme";
import {
  Button,
  Card,
  Empty,
  Field,
  Folding,
  Label,
  Muted,
  Notice,
  Pill,
  Row,
  Screen,
  Title,
  Value,
} from "../src/ui";

/*
  The secretary's screen: one doctor's calendar and nothing else.

  She books, moves and cancels visits. She cannot open a study, an AI
  result or a report, and the screen shows none of them - not because
  they are hidden from view, but because the account genuinely cannot
  reach them. What she arranges is when somebody is seen, never what
  was found.

  Nothing she books is confirmed by her alone. A booking is an
  invitation the patient accepts or declines, which is why every new
  visit sits at Pending until they answer.
*/

type Appointment = {
  id: string;
  studyId: string;
  scheduledAt: string;
  status: string;
  notes?: string;
  patientName?: string;
  bodyRegion?: string;
};

type Bookable = {
  studyId: string;
  patientName?: string;
  bodyRegion?: string;
  patientAge?: number | string;
};

const STATUS_TONE: Record<string, string> = {
  Confirmed: colors.good,
  Pending: colors.warn,
  Declined: colors.bad,
  Cancelled: colors.bad,
  Completed: colors.accent,
};

function formatWhen(value: string) {
  const when = new Date(value);

  if (Number.isNaN(when.getTime())) return value;

  return when.toLocaleString();
}

export default function SecretaryScreen() {
  const router = useRouter();

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bookable, setBookable] = useState<Bookable[]>([]);
  const [doctorName, setDoctorName] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  /*
    The waiting list folds away.

    On a phone nineteen cases is a wall: the visits already booked -
    the reason she opened the screen - end up far below the fold. The
    count stays on the header, so a folded list still says how much
    work is behind it.
  */
  const [showBookable, setShowBookable] = useState(false);

  /* The case a visit is being booked for, and the time typed for it. */
  const [bookingFor, setBookingFor] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);

    const [visits, waiting] = await Promise.all([
      api<{ appointments?: Appointment[]; doctorName?: string }>(
        "/api/appointments",
      ),
      api<{ studies?: Bookable[] }>("/api/secretary/bookable"),
    ]);

    if (visits.ok) {
      setAppointments(visits.data?.appointments ?? []);
      setDoctorName(visits.data?.doctorName ?? "");
    }

    if (waiting.ok) {
      setBookable(waiting.data?.studies ?? []);
    }

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function book(studyId: string) {
    if (!when.trim()) {
      setFailed(true);
      setMessage("Pick a date and time for the visit first.");
      return;
    }

    setIsSaving(true);
    setMessage("");

    const result = await api("/api/appointments", {
      method: "POST",
      body: { studyId, scheduledAt: when.trim(), notes: note.trim() },
    });

    setIsSaving(false);
    setFailed(!result.ok);
    setMessage(
      result.ok
        ? "The visit was offered. The patient decides whether to accept it."
        : result.data?.message || "The visit could not be booked.",
    );

    if (result.ok) {
      setBookingFor("");
      setWhen("");
      setNote("");
      await load();
    }
  }

  async function cancel(id: string) {
    const result = await api(`/api/appointments/${id}`, {
      method: "PATCH",
      body: { status: "Cancelled" },
    });

    setFailed(!result.ok);
    setMessage(
      result.ok
        ? "The visit was cancelled."
        : result.data?.message || "This could not be cancelled.",
    );

    if (result.ok) await load();
  }

  return (
    <Screen refreshing={isLoading}>
      <Title
        eyebrow="Secretary"
        title="Doctor's calendar"
        subtitle={
          doctorName
            ? `Every visit in ${doctorName}'s calendar. Studies and reports are not part of this access.`
            : "Every visit in your doctor's calendar. Studies and reports are not part of this access."
        }
      />

      {message ? (
        <Notice text={message} tone={failed ? colors.bad : colors.good} />
      ) : null}

      <Folding
        label={`Waiting for a visit (${bookable.length})`}
        open={showBookable}
        onToggle={() => setShowBookable((open) => !open)}
      />

      {showBookable ? (
        bookable.length === 0 ? (
          <Empty text="Every case already has a visit booked." icon="✓" />
        ) : (
          bookable.map((item) => (
            <Card key={item.studyId}>
              <Value>{item.patientName ?? "Patient"}</Value>
              <Muted>
                {item.bodyRegion ?? "—"}
                {item.patientAge ? ` · ${item.patientAge} years` : ""}
              </Muted>

              {bookingFor === item.studyId ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Field
                    label="When"
                    value={when}
                    onChangeText={setWhen}
                    placeholder="2026-08-25 14:30"
                  />

                  <Field
                    label="Note (optional)"
                    value={note}
                    onChangeText={setNote}
                    placeholder="Anything the patient should know"
                  />

                  <Button
                    label="Offer this visit"
                    loading={isSaving}
                    onPress={() => void book(item.studyId)}
                  />

                  <Button
                    kind="ghost"
                    label="Cancel"
                    onPress={() => setBookingFor("")}
                  />
                </View>
              ) : (
                <Button
                  label="Book a visit"
                  onPress={() => {
                    setBookingFor(item.studyId);
                    setWhen("");
                    setNote("");
                  }}
                />
              )}
            </Card>
          ))
        )
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Label>Booked visits ({appointments.length})</Label>
      </View>

      {appointments.length === 0 ? (
        <Empty text="No visits in the calendar yet." icon="📅" />
      ) : (
        appointments.map((item) => (
          <Card key={item.id}>
            <Row>
              <Value>{item.patientName ?? "Patient"}</Value>
              <Pill
                text={item.status}
                tone={STATUS_TONE[item.status] ?? colors.muted}
              />
            </Row>

            <Muted>{formatWhen(item.scheduledAt)}</Muted>

            {item.bodyRegion ? <Muted>{item.bodyRegion}</Muted> : null}
            {item.notes ? <Muted>{item.notes}</Muted> : null}

            {item.status === "Cancelled" ||
            item.status === "Completed" ? null : (
              <Button
                kind="danger"
                label="Cancel this visit"
                onPress={() => void cancel(item.id)}
              />
            )}
          </Card>
        ))
      )}

      <View style={{ marginTop: spacing.lg }}>
        <Button
          kind="ghost"
          label="Sign out"
          onPress={async () => {
            await signOut();
            router.replace("/");
          }}
        />
      </View>
    </Screen>
  );
}
