/**
 * Shared time-of-day presets for court availability UI.
 *
 * Used by both the map's "find open courts" finder (AvailabilityFinder) and the
 * court-alert subscribe modal (CourtAlertModal) so the two stay in lockstep —
 * same labels, same ranges, same custom From/To hour options. Pure data + tiny
 * formatters, no React.
 */

export type Preset = "any" | "morning" | "afternoon" | "evening" | "custom";

/** [start, end] as "HH:mm" clock strings; null = unbounded ("any time"). */
export const PRESET_RANGES: Record<
  Exclude<Preset, "custom">,
  [string | null, string | null]
> = {
  any: [null, null],
  morning: ["06:00", "12:00"],
  afternoon: ["12:00", "17:00"],
  evening: ["17:00", "21:00"],
};

export const PRESET_LABELS: { key: Preset; label: string }[] = [
  { key: "any", label: "Any time" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
  { key: "custom", label: "Custom" },
];

/** "6 AM" / "5 PM" label for an hour-of-day (0–23). */
export function hourLabel(h: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 ? "AM" : "PM"}`;
}

/** Hour options for the custom From/To selects (6am–9pm). */
export const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => 6 + i).map(
  (h) => ({
    value: `${String(h).padStart(2, "0")}:00`,
    label: hourLabel(h),
  })
);

/** Resolve a preset (+ custom bounds) to its [start, end] "HH:mm" range. */
export function presetRange(
  preset: Preset,
  customStart: string,
  customEnd: string
): [string | null, string | null] {
  return preset === "custom" ? [customStart, customEnd] : PRESET_RANGES[preset];
}
