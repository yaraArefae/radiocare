import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import {
  backendUrl,
  currentSession,
  describeSession,
  loadStoredSession,
  rolesOf,
  signIn,
} from "../src/api/client";
import { colors, spacing } from "../src/theme";
import { Button, Card, Field, Label, Muted, Notice, Row, Screen, Title } from "../src/ui";

/*
  Sign in, and the fork in the road after it.

  The four roles do not share a home screen, so this is where the
  application decides which one the account belongs to - the same rule
  the website applies, read from the same session.
*/
export default function SignInScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  function goHome(role: unknown) {
    const roles = rolesOf(role);

    if (roles.includes("admin")) return router.replace("/admin");
    if (roles.includes("doctor")) return router.replace("/doctor");
    /*
      A secretary has one screen: the calendar of the doctor she works
      for. She was landing on the patient home before this, which is
      not hers and shows her nothing she can act on.
    */
    if (roles.includes("secretary")) return router.replace("/secretary");

    return router.replace("/patient");
  }

  /* A session that is still valid should not ask for a password again. */
  useEffect(() => {
    (async () => {
      const stored = await loadStoredSession();

      if (stored) {
        const user = await currentSession();

        if (user) {
          goHome(user.role);
          return;
        }
      }

      setIsChecking(false);
    })();
  }, []);

  async function submit() {
    if (!email.trim() || !password) {
      setMessage("Enter your email and password.");
      return;
    }

    setIsBusy(true);
    setMessage("");

    const result = await signIn(email.trim(), password);

    if (!result.ok) {
      setMessage(result.message);
      setIsBusy(false);
      return;
    }

    /*
      The password was accepted, but that only matters if the session it
      created survives the next request. It is checked here, before
      leaving this screen: a home screen that silently bounces back to
      the login form tells the user nothing about why.
    */
    const session = await describeSession();

    setIsBusy(false);

    if (!session.user) {
      setMessage(
        `Signed in, but the session did not stick (status ${session.status}` +
          `${session.hasCookie ? "" : ", no cookie was stored"}). ` +
          (session.message || "Tell the developer this exact line."),
      );

      return;
    }

    goHome(session.user.role ?? result.user?.role);
  }

  if (isChecking) {
    return (
      <Screen scroll={false} refreshing>
        <Muted>Checking your session...</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg }}>
        <View
          style={{
            width: 74,
            height: 74,
            borderRadius: 24,
            backgroundColor: "rgba(56,189,248,0.15)",
            borderWidth: 1,
            borderColor: colors.lineStrong,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 34 }}>🩻</Text>
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: 30,
            fontWeight: "900",
            marginTop: spacing.md,
            letterSpacing: -0.6,
          }}
        >
          RadioCare
        </Text>

        <Muted>Preliminary AI reading, then a doctor.</Muted>
      </View>

      <Card>
        <Title title="Sign in" subtitle="Use the same account as the website." />

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          secure
        />

        <Notice text={message} tone={colors.bad} />

        <Button label="Sign in" onPress={submit} loading={isBusy} />
      </Card>

      {/*
        Nobody registers themselves into a clinical system. Both paths
        below open a request that an administrator has to approve, which
        is what creates the account.
      */}
      <Card>
        <Label>No account yet?</Label>

        <Row>
          <View style={{ flex: 1 }}>
            <Button
              label="I am a patient"
              kind="ghost"
              onPress={() => router.push("/request/patient")}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Button
              label="I am a doctor"
              kind="ghost"
              onPress={() => router.push("/request/doctor")}
            />
          </View>
        </Row>

        {/*
          A secretary applies the same way a doctor does. There was no
          route in for her at all before this: the role existed, the
          accounts existed, and the only way to get one was for an
          administrator to type it in.
        */}
        <Button
          label="I am applying to be a secretary"
          kind="ghost"
          onPress={() => router.push("/request/secretary")}
        />
      </Card>

      <Muted>Server: {backendUrl}</Muted>
    </Screen>
  );
}
