import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import PhoneFrame from "../src/PhoneFrame";
import { colors } from "../src/theme";

/*
  The frame every screen sits in.

  Navigation is a plain stack rather than tabs: the roles do not share a
  set of destinations - a patient has an upload and a history, a doctor
  has a queue - so a tab bar would be three different bars pretending to
  be one.
*/
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />

      <PhoneFrame>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.groundDeep },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "800" },
          contentStyle: { backgroundColor: colors.ground },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="patient/index" options={{ title: "My studies" }} />
        <Stack.Screen name="patient/upload" options={{ title: "New X-ray" }} />
        <Stack.Screen name="doctor/index" options={{ title: "My clinic" }} />
        <Stack.Screen name="admin/index" options={{ title: "Administration" }} />
        <Stack.Screen name="admin/studies" options={{ title: "All cases" }} />
        <Stack.Screen name="admin/requests" options={{ title: "Requests" }} />
        <Stack.Screen name="admin/messages" options={{ title: "Messages" }} />
        <Stack.Screen name="study/[id]" options={{ title: "Study" }} />
        <Stack.Screen name="appointments" options={{ title: "Appointments" }} />
        <Stack.Screen name="request/patient" options={{ title: "Patient request" }} />
        <Stack.Screen name="request/doctor" options={{ title: "Doctor application" }} />
        <Stack.Screen name="support" options={{ title: "Administration" }} />
      </Stack>
      </PhoneFrame>
    </SafeAreaProvider>
  );
}
