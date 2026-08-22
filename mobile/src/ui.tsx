import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "./theme";

/*
  The pieces every screen is built from.

  They exist so a screen reads as a description of what it shows rather
  than a list of styles, and so a change of spacing or colour happens
  once instead of in thirty places.
*/

export function Screen({
  children,
  scroll = true,
  refreshing,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
}) {
  const content = (
    <View style={styles.screenInner}>
      {refreshing ? (
        <ActivityIndicator color={colors.accent} style={{ marginBottom: spacing.sm }} />
      ) : null}
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Title({ eyebrow, title, subtitle }: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({
  children,
  style,
  tone,
}: {
  children: ReactNode;
  style?: ViewStyle;
  tone?: string;
}) {
  return (
    <View
      style={[
        styles.card,
        tone ? { borderColor: tone, borderWidth: 1.5 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Value({ children, tone }: { children: ReactNode; tone?: string }) {
  return <Text style={[styles.value, tone ? { color: tone } : null]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  loading,
  disabled,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  kind?: "primary" | "ghost" | "danger";
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        kind === "primary" ? styles.buttonPrimary : null,
        kind === "ghost" ? styles.buttonGhost : null,
        kind === "danger" ? styles.buttonDanger : null,
        pressed ? { opacity: 0.75 } : null,
        isDisabled ? { opacity: 0.5 } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "numeric";
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(159,180,204,0.5)"
        secureTextEntry={secure}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
        multiline={multiline}
        style={[styles.input, multiline ? { height: 92, textAlignVertical: "top" } : null]}
      />
    </View>
  );
}

export function Pill({ text, tone }: { text: string; tone?: string }) {
  return (
    <View style={[styles.pill, tone ? { borderColor: tone } : null]}>
      <Text style={[styles.pillText, tone ? { color: tone } : null]}>{text}</Text>
    </View>
  );
}

export function Notice({ text, tone }: { text: string; tone?: string }) {
  if (!text) return null;

  return (
    <View
      style={[
        styles.notice,
        tone ? { borderColor: tone, backgroundColor: `${tone}1a` } : null,
      ]}
    >
      <Text style={[styles.noticeText, tone ? { color: tone } : null]}>{text}</Text>
    </View>
  );
}

export function Empty({ text, icon = "—" }: { text: string; icon?: string }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
      <Text style={{ fontSize: 34, marginBottom: spacing.sm }}>{icon}</Text>
      <Muted>{text}</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  scrollContent: { paddingBottom: spacing.xl * 2 },
  screenInner: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.medium,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  value: { color: colors.text, fontSize: 16, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  input: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.small,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    color: colors.text,
    fontSize: 15,
  },
  button: {
    borderRadius: radius.small,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  buttonPrimary: { backgroundColor: colors.accentDeep },
  buttonGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  buttonDanger: { backgroundColor: "rgba(251,113,133,0.16)", borderWidth: 1, borderColor: colors.bad },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  pill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  notice: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radius.small,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeText: { color: colors.text, fontSize: 13, lineHeight: 20, fontWeight: "600" },
});
