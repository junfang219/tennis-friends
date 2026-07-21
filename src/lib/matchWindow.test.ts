import { describe, expect, it } from "vitest";
import { matchWindowDates, parseSchedulingStatus, windowEndFor } from "./matchWindow";

describe("parseSchedulingStatus", () => {
  it("passes through known states and defaults everything else to fixed", () => {
    expect(parseSchedulingStatus("window")).toBe("window");
    expect(parseSchedulingStatus("tbd")).toBe("tbd");
    expect(parseSchedulingStatus("fixed")).toBe("fixed");
    expect(parseSchedulingStatus("bogus")).toBe("fixed");
    expect(parseSchedulingStatus(null)).toBe("fixed");
    expect(parseSchedulingStatus(undefined)).toBe("fixed");
  });
});

describe("windowEndFor", () => {
  it("spans a 7-day week (start + 6)", () => {
    expect(windowEndFor("2026-08-03")).toBe("2026-08-09");
  });

  it("crosses month boundaries", () => {
    expect(windowEndFor("2026-08-28")).toBe("2026-09-03");
  });
});

describe("matchWindowDates", () => {
  it("lists every date of a window inclusive", () => {
    expect(matchWindowDates("2026-08-03", "2026-08-09")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("falls back to fallbackDays when window_end is missing or inverted", () => {
    expect(matchWindowDates("2026-08-03", null, 3)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
    ]);
    expect(matchWindowDates("2026-08-03", "2026-08-01", 2)).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("clamps to the polls candidate-date cap (60)", () => {
    const dates = matchWindowDates("2026-01-01", "2026-12-31");
    expect(dates).toHaveLength(60);
    expect(dates[0]).toBe("2026-01-01");
  });

  it("returns [] for a malformed anchor", () => {
    expect(matchWindowDates("not-a-date", null)).toEqual([]);
  });
});
