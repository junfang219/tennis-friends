"use client";

import { RSVP, RSVP_LABEL, type RsvpStatus } from "@/lib/rsvpStatus";

// Status options in display order. NO_RESPONSE is implicit (no row) — picker
// only renders the three actionable states.
const OPTIONS: { value: Exclude<RsvpStatus, "no_response">; label: string; bg: string; text: string }[] = [
  { value: RSVP.PLAYING, label: RSVP_LABEL.playing, bg: "bg-court-green", text: "text-white" },
  { value: RSVP.MAYBE, label: RSVP_LABEL.maybe, bg: "bg-ball-yellow", text: "text-court-green" },
  { value: RSVP.NOT_PLAYING, label: RSVP_LABEL.not_playing, bg: "bg-gray-300", text: "text-gray-700" },
];

export function pickerOptionMeta(status: string) {
  return OPTIONS.find((o) => o.value === status);
}

export type RsvpPickerProps = {
  // Current RSVP status. Pass empty string / "no_response" to render no active selection.
  value: string;
  onSelect: (status: Exclude<RsvpStatus, "no_response">) => void;
  size?: "sm" | "md";
  // Grid columns. Defaults to 3 (one per option).
  cols?: 2 | 3;
};

/**
 * Compact 3-button RSVP picker using the unified playing/maybe/not_playing
 * vocabulary. Used in match + practice popovers.
 */
export default function RsvpPicker({ value, onSelect, size = "sm", cols = 3 }: RsvpPickerProps) {
  const padding = size === "sm" ? "px-2 py-1.5" : "px-3 py-2";
  const text = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <div className={`grid gap-1 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`${text} font-semibold ${padding} rounded ${
            value === opt.value
              ? `${opt.bg} ${opt.text} ring-2 ring-court-green/40`
              : `${opt.bg} ${opt.text} opacity-70 hover:opacity-100`
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
