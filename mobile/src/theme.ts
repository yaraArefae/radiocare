/*
  The look of the website, translated to a phone.

  The colours are the ones the web application already uses, so the two
  read as one product. What changes is the geometry: a phone is held in
  one hand, so targets are larger, the page is one column, and the
  spacing is tighter than a desktop card grid.
*/
export const colors = {
  ground: "#06142f",
  groundDeep: "#071a38",
  surface: "rgba(255,255,255,0.07)",
  surfaceStrong: "rgba(255,255,255,0.12)",
  line: "rgba(255,255,255,0.15)",
  lineStrong: "rgba(103,232,249,0.45)",
  text: "#f2f8ff",
  muted: "#9fb4cc",
  accent: "#38bdf8",
  accentDeep: "#0e74ff",
  good: "#34d399",
  warn: "#fbbf24",
  bad: "#fb7185",
} as const;

export const radius = {
  small: 12,
  medium: 18,
  large: 26,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
} as const;

/* One place decides what a result looks like, on every screen. */
export function resultColor(result: string | undefined) {
  const value = String(result ?? "").toUpperCase();

  if (value === "ABNORMAL") return colors.bad;
  if (value === "NORMAL") return colors.good;
  if (value === "UNCERTAIN") return colors.warn;

  return colors.accent;
}

export function priorityColor(priority: string | undefined) {
  const value = String(priority ?? "").toUpperCase();

  if (value.includes("URGENT")) return colors.bad;
  if (value.includes("REVIEW")) return colors.warn;

  return colors.good;
}
