import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  backendUrl,
  loadStoredSession,
  loadStoredToken,
} from "./api/client";
import { colors, radius, spacing } from "./theme";
import { Button, Muted } from "./ui";

/*
  A CT or an MRI, played the way a radiologist reads one.

  A volume arrives as a .nii.gz or a folder of DICOM files, and a phone
  handed one has a download it cannot open. The AI service is the only
  part that can read those formats, so the study is rendered there into
  a single image holding every slice in a grid, and this shows one tile
  of that grid at a time.

  There is no canvas on a phone, so the tile is cut the way sprites have
  always been cut: a window the size of one slice, with the whole sheet
  inside it, slid so that the slice being looked at is the part showing.
  Moving between slices is two numbers changing, which is why scrubbing
  costs nothing - the entire stack is already in memory after one
  request.
*/

type Layout = {
  sliceCount: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  originalDepth: number;
};

function readLayout(response: Response): Layout | null {
  const header = response.headers.get("X-Slice-Layout");

  const raw: Partial<Layout> = header
    ? JSON.parse(header)
    : {
        sliceCount: Number(response.headers.get("X-Slice-Count")),
        columns: Number(response.headers.get("X-Slice-Columns")),
        rows: Number(response.headers.get("X-Slice-Rows")),
        tileWidth: Number(response.headers.get("X-Tile-Width")),
        tileHeight: Number(response.headers.get("X-Tile-Height")),
        originalDepth: Number(response.headers.get("X-Original-Depth")),
      };

  /*
    An empty object is still an object. What matters is not that the
    layout parsed but that it holds numbers a slice can be cut with.
  */
  const usable =
    Number(raw.sliceCount) > 0 &&
    Number(raw.columns) > 0 &&
    Number(raw.tileWidth) > 0 &&
    Number(raw.tileHeight) > 0;

  return usable ? (raw as Layout) : null;
}

export default function VolumeViewer({ studyId }: { studyId: string }) {
  const { width: screenWidth } = useWindowDimensions();

  const [layout, setLayout] = useState<Layout | null>(null);
  const [sheet, setSheet] = useState("");
  const [slice, setSlice] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const cookie = await loadStoredSession();
        const token = await loadStoredToken();

        const headers: Record<string, string> = { Origin: "radiocare://" };

        if (token) headers.Authorization = `Bearer ${token}`;
        if (cookie) headers.Cookie = cookie;

        const response = await fetch(
          `${backendUrl}/api/studies/${studyId}/slices`,
          { headers, credentials: "include" },
        );

        if (!response.ok) {
          const detail = await response.json().catch(() => null);

          throw new Error(
            detail?.message ?? "This study could not be opened.",
          );
        }

        const parsed = readLayout(response);

        if (!parsed) {
          throw new Error(
            "This study was rendered, but the server did not say how its " +
              "slices are arranged.",
          );
        }

        /*
          The sheet is carried as a data URI rather than fetched again by
          the image component. Image cannot be given a session, and this
          request already has one and already holds the bytes.
        */
        const blob = await response.blob();

        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();

          reader.onerror = () => reject(new Error("read failed"));
          reader.onloadend = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });

        if (!active) return;

        setLayout(parsed);
        setSheet(encoded);
        /*
          Opens on the middle slice. The first and last slice of a scan
          are usually air, and a viewer that opens on a black rectangle
          looks broken.
        */
        setSlice(Math.floor(parsed.sliceCount / 2));
        setLoading(false);
      } catch (caught) {
        if (!active) return;

        setError(
          caught instanceof Error
            ? caught.message
            : "This study could not be opened.",
        );
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [studyId]);

  /* The play loop. */
  useEffect(() => {
    if (!playing || !layout) return;

    timer.current = setInterval(() => {
      setSlice((current) => (current + 1) % layout.sliceCount);
    }, 90);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, layout]);

  if (loading) {
    return (
      <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Rendering the study...</Muted>
      </View>
    );
  }

  if (error || !layout) {
    return (
      <View
        style={{
          padding: spacing.md,
          borderRadius: radius.medium,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 30 }}>🧊</Text>
        <Muted>{error}</Muted>
      </View>
    );
  }

  /*
    The slice is drawn as large as the screen allows, and the sheet
    behind it is scaled by the same amount so the window still lands on
    one tile.
  */
  const available = Math.min(screenWidth - spacing.md * 2, 420);
  const scale = available / layout.tileWidth;

  const column = slice % layout.columns;
  const row = Math.floor(slice / layout.columns);

  return (
    <View>
      <View
        style={{
          width: available,
          height: layout.tileHeight * scale,
          borderRadius: radius.medium,
          overflow: "hidden",
          backgroundColor: "#000",
          alignSelf: "center",
        }}
      >
        <Image
          source={{ uri: sheet }}
          style={{
            position: "absolute",
            width: layout.columns * layout.tileWidth * scale,
            height: layout.rows * layout.tileHeight * scale,
            left: -column * layout.tileWidth * scale,
            top: -row * layout.tileHeight * scale,
          }}
          resizeMode="stretch"
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: spacing.sm,
        }}
      >
        <View style={{ width: 110 }}>
          <Button
            label={playing ? "❚❚ Pause" : "▶ Play"}
            onPress={() => setPlaying((value) => !value)}
          />
        </View>

        <Text style={{ color: colors.text, fontWeight: "700" }}>
          {slice + 1} / {layout.sliceCount}
        </Text>
      </View>

      {/*
        A slider drawn as a row of steps rather than a native control.

        A phone slider is dragged with a thumb the width of a finger, and
        on a stack of twenty eight slices that is four slices wide. Tapping
        a step lands on the slice that was aimed at.
      */}
      <View
        style={{
          flexDirection: "row",
          marginTop: spacing.sm,
          height: 34,
          borderRadius: radius.small,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        {Array.from({ length: layout.sliceCount }).map((_, index) => (
          <Pressable
            key={index}
            onPress={() => {
              setPlaying(false);
              setSlice(index);
            }}
            style={{
              flex: 1,
              backgroundColor:
                index === slice
                  ? colors.accent
                  : index < slice
                    ? colors.surfaceStrong
                    : colors.surface,
            }}
          />
        ))}
      </View>

      {layout.originalDepth > layout.sliceCount ? (
        <Muted>
          Showing {layout.sliceCount} slices sampled evenly from{" "}
          {layout.originalDepth}.
        </Muted>
      ) : null}
    </View>
  );
}
