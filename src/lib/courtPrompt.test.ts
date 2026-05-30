import { describe, expect, it } from "vitest";
import {
  PROMPT_WINDOW_BEFORE_MS,
  gameWindowMs,
  isReportEligibleCategory,
  isWithinPromptWindow,
} from "./courtPrompt";

describe("gameWindowMs", () => {
  it("computes start/end from play_date + play_time with explicit duration", () => {
    const win = gameWindowMs({ playDate: "2026-05-30", playTime: "18:00", playDuration: 60 });
    // Parsed in local zone; derive the expected start the same way to stay
    // tz-agnostic, then assert the duration math.
    const expectedStart = new Date("2026-05-30T18:00:00").getTime();
    expect(win).not.toBeNull();
    expect(win!.startMs).toBe(expectedStart);
    expect(win!.endMs).toBe(expectedStart + 60 * 60 * 1000);
  });

  it("defaults to 90 minutes when duration is null or zero", () => {
    const start = new Date("2026-05-30T09:30:00").getTime();
    for (const playDuration of [null, 0]) {
      const win = gameWindowMs({ playDate: "2026-05-30", playTime: "09:30", playDuration });
      expect(win!.endMs - win!.startMs).toBe(90 * 60 * 1000);
      expect(win!.startMs).toBe(start);
    }
  });

  it("returns null when date or time is missing", () => {
    expect(gameWindowMs({ playDate: "", playTime: "18:00", playDuration: 60 })).toBeNull();
    expect(gameWindowMs({ playDate: "2026-05-30", playTime: "", playDuration: 60 })).toBeNull();
  });

  it("returns null for a well-formed but invalid calendar date", () => {
    // Out-of-range month → Date parses to NaN (unlike free-form garbage,
    // which V8 may coerce to an arbitrary date).
    expect(gameWindowMs({ playDate: "2026-13-40", playTime: "10:00", playDuration: 60 })).toBeNull();
  });
});

describe("isWithinPromptWindow", () => {
  const start = new Date("2026-05-30T18:00:00").getTime();
  const end = start + 90 * 60 * 1000;

  it("is false before the 30-min-early opening", () => {
    expect(isWithinPromptWindow(start, end, start - PROMPT_WINDOW_BEFORE_MS - 1)).toBe(false);
  });

  it("opens exactly 30 min before start", () => {
    expect(isWithinPromptWindow(start, end, start - PROMPT_WINDOW_BEFORE_MS)).toBe(true);
  });

  it("is true during the game and at the end boundary", () => {
    expect(isWithinPromptWindow(start, end, start + 10 * 60 * 1000)).toBe(true);
    expect(isWithinPromptWindow(start, end, end)).toBe(true);
  });

  it("is false after the game ends", () => {
    expect(isWithinPromptWindow(start, end, end + 1)).toBe(false);
  });
});

describe("isReportEligibleCategory", () => {
  it("accepts public parks, schools, and colleges", () => {
    expect(isReportEligibleCategory("public_park")).toBe(true);
    expect(isReportEligibleCategory("school")).toBe(true);
    expect(isReportEligibleCategory("college")).toBe(true);
  });

  it("rejects private/indoor categories and nullish input", () => {
    expect(isReportEligibleCategory("private_club")).toBe(false);
    expect(isReportEligibleCategory("hoa_community")).toBe(false);
    expect(isReportEligibleCategory("indoor_facility")).toBe(false);
    expect(isReportEligibleCategory(null)).toBe(false);
    expect(isReportEligibleCategory(undefined)).toBe(false);
  });
});
