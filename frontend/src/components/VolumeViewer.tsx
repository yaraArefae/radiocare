"use client";

import { useEffect, useRef, useState } from "react";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

type Layout = {
  sliceCount: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  originalDepth: number;
};

/*
  Plays a CT or an MRI the way a radiologist reads one: by moving
  through the slices.

  A volume arrives as a file no browser can open, and a doctor sent one
  has a download rather than a study. The service renders every slice
  into a single image, and this draws one tile of it at a time onto a
  canvas, which is why scrubbing is instant: the whole stack is already
  in memory after one request, and moving the slider is a copy between
  two canvases rather than a trip to the server.
*/
export default function VolumeViewer({ studyId }: { studyId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLImageElement | null>(null);

  const [layout, setLayout] = useState<Layout | null>(null);
  const [slice, setSlice] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch(
          `${BACKEND_URL}/api/studies/${studyId}/slices`,
          { credentials: "include" },
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message ?? "This study could not be opened.");
        }

        const parsed: Layout = JSON.parse(
          response.headers.get("X-Slice-Layout") ?? "{}",
        );

        const blob = await response.blob();
        const image = new Image();

        image.onload = () => {
          if (!active) return;

          sheetRef.current = image;
          setLayout(parsed);
          /*
            Opens on the middle slice. The first and last slice of a
            scan are usually air, and a viewer that opens on a black
            rectangle looks broken.
          */
          setSlice(Math.floor((parsed.sliceCount || 1) / 2));
          setLoading(false);
        };

        image.onerror = () => {
          if (active) {
            setError("This study could not be drawn.");
            setLoading(false);
          }
        };

        image.src = URL.createObjectURL(blob);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "This study could not be opened.",
          );
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [studyId]);

  /* Draws the tile the slider is on. */
  useEffect(() => {
    const canvas = canvasRef.current;
    const sheet = sheetRef.current;

    if (!canvas || !sheet || !layout) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    canvas.width = layout.tileWidth;
    canvas.height = layout.tileHeight;

    const column = slice % layout.columns;
    const row = Math.floor(slice / layout.columns);

    context.drawImage(
      sheet,
      column * layout.tileWidth,
      row * layout.tileHeight,
      layout.tileWidth,
      layout.tileHeight,
      0,
      0,
      layout.tileWidth,
      layout.tileHeight,
    );
  }, [slice, layout]);

  /* The play loop. */
  useEffect(() => {
    if (!playing || !layout) return;

    const timer = window.setInterval(() => {
      setSlice((current) => (current + 1) % layout.sliceCount);
    }, 1000 / speed);

    return () => window.clearInterval(timer);
  }, [playing, speed, layout]);

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-white/15 bg-black/30">
        <p className="text-slate-300">Rendering the study...</p>
      </div>
    );
  }

  if (error || !layout) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl border border-white/15 bg-black/30 p-6 text-center">
        <span className="text-5xl">🧊</span>
        <p className="mt-4 font-bold text-slate-300">{error}</p>
        <a
          href={`${BACKEND_URL}/api/studies/${studyId}/image`}
          className="mt-4 rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-cyan-200"
        >
          Download the original file
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-white/15 bg-black/30 p-4">
      <div className="flex items-center justify-center overflow-hidden rounded-2xl bg-black">
        <canvas
          ref={canvasRef}
          className="max-h-[520px] w-full object-contain"
          style={{ imageRendering: "auto" }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setPlaying((current) => !current)}
          className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 font-black text-white transition hover:from-cyan-400 hover:to-blue-500"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>

        <input
          type="range"
          min={0}
          max={layout.sliceCount - 1}
          value={slice}
          onChange={(event) => {
            setPlaying(false);
            setSlice(Number(event.target.value));
          }}
          className="h-2 min-w-48 flex-1 cursor-pointer accent-cyan-400"
        />

        <span className="min-w-24 text-sm font-bold text-slate-300">
          {slice + 1} / {layout.sliceCount}
        </span>

        <label className="flex items-center gap-2 text-sm font-bold text-slate-400">
          Speed
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="rounded-lg border border-white/15 bg-[#0a2450] px-2 py-1 text-white"
          >
            <option value={4}>Slow</option>
            <option value={12}>Normal</option>
            <option value={30}>Fast</option>
          </select>
        </label>
      </div>

      {/*
        A tall scan is thinned before it is drawn, so the slider does not
        promise more slices than it can show. Saying so is cheaper than a
        doctor counting them and wondering where the rest went.
      */}
      {layout.originalDepth > layout.sliceCount ? (
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Showing {layout.sliceCount} slices sampled evenly from{" "}
          {layout.originalDepth}. Download the original file for the full
          stack.
        </p>
      ) : null}
    </div>
  );
}
