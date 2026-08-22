"use client";

import { useCallback, useEffect, useState } from "react";

const aiServiceUrl = (
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8001"
).replace(/\/$/, "");

export type ClinicFinding = {
  name: string;
  score: number;
  scoreLabel: string;
  testPositives?: number | null;
};

export type ClinicCapability = {
  slug: string;
  name: string;
  regions: string[];
  dataset: string | null;
  trainingImages: number;
  aiServed: boolean;
  tier: "high" | "moderate" | "limited" | "none";
  note: string;
  weakestFinding: ClinicFinding | null;
  strongestFinding: ClinicFinding | null;
  findings: ClinicFinding[];
};

export const tierStyle: Record<
  ClinicCapability["tier"],
  { chip: string; label: string }
> = {
  high: {
    chip: "border-emerald-300/35 bg-emerald-400/15 text-emerald-100",
    label: "AI · high accuracy",
  },
  moderate: {
    chip: "border-cyan-300/35 bg-cyan-400/15 text-cyan-100",
    label: "AI · moderate",
  },
  limited: {
    chip: "border-amber-300/35 bg-amber-400/15 text-amber-100",
    label: "AI · limited",
  },
  none: {
    chip: "border-slate-300/25 bg-slate-400/10 text-slate-300",
    label: "Doctor review only",
  },
};

/*
  Loads the measured capability of every clinic once and hands it to the
  page. The numbers come from the training runs, so a clinic never
  claims more than its model actually delivers.
*/
export function useClinicCapabilities() {
  const [capabilities, setCapabilities] = useState<
    Record<string, ClinicCapability>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${aiServiceUrl}/clinics`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) return;

      const data = await response.json();

      setCapabilities(
        Object.fromEntries(
          (data.clinics ?? []).map((clinic: ClinicCapability) => [
            clinic.slug,
            clinic,
          ]),
        ),
      );
    } catch (error) {
      console.error("Unable to load the clinic capabilities:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { capabilities, isLoading };
}

type Props = {
  capability?: ClinicCapability;
  compact?: boolean;
};

export default function ClinicAiStatus({
  capability,
  compact = false,
}: Props) {
  if (!capability) {
    return null;
  }

  const style = tierStyle[capability.tier] ?? tierStyle.none;

  if (compact) {
    return (
      <span
        className={`rounded-full border px-3 py-1.5 text-xs font-black ${style.chip}`}
      >
        {capability.aiServed ? style.label : tierStyle.none.label}
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-black ${style.chip}`}
        >
          {capability.aiServed ? style.label : tierStyle.none.label}
        </span>

        {capability.dataset && (
          <span className="text-xs text-slate-400">
            {capability.dataset}
            {capability.trainingImages
              ? ` · ${capability.trainingImages.toLocaleString()} images`
              : ""}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-300">
        {capability.note}
      </p>

      {capability.aiServed && capability.weakestFinding && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs text-slate-300">
            Strongest:{" "}
            <span className="font-bold text-white">
              {capability.strongestFinding?.name}
            </span>{" "}
            {capability.strongestFinding?.scoreLabel}{" "}
            {capability.strongestFinding?.score.toFixed(2)}
          </p>

          <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs text-slate-300">
            Weakest:{" "}
            <span className="font-bold text-white">
              {capability.weakestFinding.name}
            </span>{" "}
            {capability.weakestFinding.scoreLabel}{" "}
            {capability.weakestFinding.score.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
