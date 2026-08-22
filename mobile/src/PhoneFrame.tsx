import { ReactNode } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { colors } from "./theme";

/*
  A phone, drawn around the application when it runs on a laptop.

  Expo can render this app in a browser, which is how it is tested and
  demonstrated without a handset. A browser window is the wrong shape
  for it, though: stretched across a monitor the layout stops being the
  thing that was designed. So on the web, and only there, the app is
  held to the size of a phone screen and framed like one.

  On a real device the frame does not exist: the phone is the frame.
*/

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

export default function PhoneFrame({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();

  if (Platform.OS !== "web") {
    return <>{children}</>;
  }

  /*
    A narrow browser window is already phone shaped - a real phone
    running the web build, or a laptop window dragged small - so the
    frame gets out of the way instead of shrinking the app twice.
  */
  if (width < PHONE_WIDTH + 80) {
    return <>{children}</>;
  }

  const frameHeight = Math.min(PHONE_HEIGHT, height - 48);

  return (
    <View style={styles.page}>
      <View style={[styles.phone, { width: PHONE_WIDTH, height: frameHeight }]}>
        <View style={styles.notch} />
        <View style={styles.screen}>{children}</View>
      </View>

      <Text style={styles.caption}>
        RadioCare · mobile application · {PHONE_WIDTH} × {Math.round(frameHeight)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#020b16",
    paddingVertical: 24,
  },
  phone: {
    borderRadius: 44,
    borderWidth: 10,
    borderColor: "#10233a",
    backgroundColor: colors.ground,
    overflow: "hidden",
    /* A phone held in front of a dark room casts a little light. */
    boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
  } as any,
  notch: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    width: 150,
    height: 26,
    backgroundColor: "#10233a",
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    zIndex: 10,
  },
  screen: { flex: 1, overflow: "hidden" },
  caption: {
    color: "rgba(159,180,204,0.65)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginTop: 14,
    textTransform: "uppercase",
  },
});
