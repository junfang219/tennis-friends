import { describe, expect, it } from "vitest";
import { buildPollShare } from "./availabilityPollShare";
import type { RankedWindow } from "./availabilityPoll";

function w(date: string, start: string, end: string): RankedWindow {
  return {
    date,
    start,
    end,
    durationMinutes: 120,
    memberIds: [],
    memberNames: [],
  };
}

describe("buildPollShare", () => {
  it("emits a single window with header and one date line, no link", () => {
    const out = buildPollShare({
      teamName: "Bayside Smashers",
      windows: [w("2026-06-08", "10:00", "12:00")],
    });
    expect(out.title).toBe("Possible times — Bayside Smashers");
    expect(out.url).toBe("");
    expect(out.text).toBe(
      [
        "🎾 Bayside Smashers — possible times",
        "",
        "📅 Mon, Jun 8 · 10:00–12:00",
      ].join("\n"),
    );
    expect(out.text).not.toMatch(/http|view the poll/i);
  });

  it("emits three windows in input order", () => {
    const out = buildPollShare({
      teamName: "Aces",
      windows: [
        w("2026-06-08", "10:00", "12:00"),
        w("2026-06-09", "14:00", "16:30"),
        w("2026-06-10", "18:00", "20:00"),
      ],
    });
    const dateLines = out.text.split("\n").filter((l) => l.startsWith("📅"));
    expect(dateLines).toEqual([
      "📅 Mon, Jun 8 · 10:00–12:00",
      "📅 Tue, Jun 9 · 14:00–16:30",
      "📅 Wed, Jun 10 · 18:00–20:00",
    ]);
  });

  it("handles zero windows — text is just the header, no broken link line", () => {
    const out = buildPollShare({ teamName: "Empty FC", windows: [] });
    expect(out.text).toBe("🎾 Empty FC — possible times");
    expect(out.text).not.toContain("📅");
  });

  it("preserves special chars in team name without escaping", () => {
    const out = buildPollShare({
      teamName: "Smith & Co's",
      windows: [w("2026-06-08", "09:00", "11:00")],
    });
    expect(out.title).toBe("Possible times — Smith & Co's");
    expect(out.text).toContain("🎾 Smith & Co's — possible times");
  });

  it("falls back to a generic team label when teamName is blank", () => {
    const out = buildPollShare({
      teamName: "   ",
      windows: [w("2026-06-08", "09:00", "11:00")],
    });
    expect(out.title).toBe("Possible times — your team");
    expect(out.text).toContain("🎾 your team — possible times");
  });
});
