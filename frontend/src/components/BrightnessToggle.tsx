"use client";

import { useEffect, useState } from "react";

type BrightnessLevel = "dim" | "normal" | "bright";

const brightnessOptions: Record<
  BrightnessLevel,
  {
    value: string;
    icon: string;
    label: string;
  }
> = {
  dim: {
    value: "0.78",
    icon: "🌙",
    label: "Low brightness",
  },

  normal: {
    value: "1",
    icon: "☀️",
    label: "Normal brightness",
  },

  bright: {
    value: "1.12",
    icon: "🔆",
    label: "High brightness",
  },
};

const brightnessOrder: BrightnessLevel[] = ["dim", "normal", "bright"];

export default function BrightnessToggle() {
  const [brightness, setBrightness] =
    useState<BrightnessLevel>("normal");

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedBrightness = localStorage.getItem(
      "radiocare-brightness"
    ) as BrightnessLevel | null;

    const initialBrightness =
      savedBrightness && brightnessOptions[savedBrightness]
        ? savedBrightness
        : "normal";

    setBrightness(initialBrightness);

    document.documentElement.style.setProperty(
      "--app-brightness",
      brightnessOptions[initialBrightness].value
    );

    setMounted(true);
  }, []);

  function changeBrightness() {
    const currentIndex = brightnessOrder.indexOf(brightness);

    const nextIndex = (currentIndex + 1) % brightnessOrder.length;

    const nextBrightness = brightnessOrder[nextIndex];

    setBrightness(nextBrightness);

    localStorage.setItem("radiocare-brightness", nextBrightness);

    document.documentElement.style.setProperty(
      "--app-brightness",
      brightnessOptions[nextBrightness].value
    );
  }

  if (!mounted) {
    return null;
  }

  const currentOption = brightnessOptions[brightness];

  return (
    <button
      type="button"
      onClick={changeBrightness}
      title={currentOption.label}
      aria-label={currentOption.label}
      className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-2xl border border-white/25 bg-[#071a38]/75 text-2xl shadow-[0_15px_45px_rgba(0,0,0,0.4)] backdrop-blur-2xl transition duration-300 hover:-translate-y-1 hover:border-cyan-300/70 hover:bg-[#0a2450]/90 hover:shadow-[0_15px_50px_rgba(34,211,238,0.25)]"
    >
      <span aria-hidden="true">{currentOption.icon}</span>
    </button>
  );
}