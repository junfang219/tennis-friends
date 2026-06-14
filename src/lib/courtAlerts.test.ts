import { describe, expect, it } from "vitest";
import {
  weekdayOf,
  bookableDatesSeattle,
  alertTargetDates,
  alertMatchesWindows,
  type AlertMatchInput,
} from "./courtAlerts";
import type { SnapshotWindow } from "./courtAvailability";

const win = (start: string, end: string): SnapshotWindow => ({ start, end });

describe("weekdayOf", () => {
  it("returns JS getDay() values (0=Sun)", () => {
    expect(weekdayOf("2026-06-14")).toBe(0); // Sunday
    expect(weekdayOf("2026-06-15")).toBe(1); // Monday
    expect(weekdayOf("2026-06-13")).toBe(6); // Saturday
  });
});

describe("bookableDatesSeattle", () => {
  it("spans tomorrow through +14 (14 dates) and excludes today", () => {
    // Mid-day UTC so the Seattle calendar date is unambiguous.
    const now = new Date("2026-06-13T19:00:00Z");
    const dates = bookableDatesSeattle(now);
    expect(dates).toHaveLength(14);
    expect(dates).not.toContain("2026-06-13"); // today, not bookable
    expect(dates[0]).toBe("2026-06-14"); // tomorrow
    expect(dates[13]).toBe("2026-06-27"); // +14
  });

  it("uses the Seattle calendar day, not UTC", () => {
    // 2026-06-14T05:30:00Z is still 2026-06-13 22:30 in Seattle (PDT, -7),
    // so "today" is the 13th and tomorrow is the 14th.
    const now = new Date("2026-06-14T05:30:00Z");
    expect(bookableDatesSeattle(now)[0]).toBe("2026-06-14");
  });
});

describe("alertTargetDates", () => {
  const bookable = bookableDatesSeattle(new Date("2026-06-13T19:00:00Z"));

  it("once: returns the target date when in the bookable window", () => {
    const a: AlertMatchInput = {
      mode: "once",
      target_date: "2026-06-20",
      weekdays: null,
      start_time: null,
      end_time: null,
    };
    expect(alertTargetDates(a, bookable)).toEqual(["2026-06-20"]);
  });

  it("once: returns nothing for a past or beyond-window date", () => {
    const past: AlertMatchInput = {
      mode: "once",
      target_date: "2026-06-13",
      weekdays: null,
      start_time: null,
      end_time: null,
    };
    const beyond: AlertMatchInput = { ...past, target_date: "2026-07-04" };
    expect(alertTargetDates(past, bookable)).toEqual([]);
    expect(alertTargetDates(beyond, bookable)).toEqual([]);
  });

  it("repeat: expands every matching weekday in the window", () => {
    // Saturdays (6) in 2026-06-14 … 2026-06-27: the 20th and 27th.
    const sat: AlertMatchInput = {
      mode: "repeat",
      target_date: null,
      weekdays: [6],
      start_time: null,
      end_time: null,
    };
    expect(alertTargetDates(sat, bookable)).toEqual(["2026-06-20", "2026-06-27"]);
  });

  it("repeat: handles multiple weekdays including Sunday (0)", () => {
    const sunMon: AlertMatchInput = {
      mode: "repeat",
      target_date: null,
      weekdays: [0, 1],
      start_time: null,
      end_time: null,
    };
    // Sundays: 14, 21; Mondays: 15, 22 (sorted by date order in the window).
    expect(alertTargetDates(sunMon, bookable)).toEqual([
      "2026-06-14",
      "2026-06-15",
      "2026-06-21",
      "2026-06-22",
    ]);
  });
});

describe("alertMatchesWindows", () => {
  const anyTime: AlertMatchInput = {
    mode: "once",
    target_date: "2026-06-20",
    weekdays: null,
    start_time: null,
    end_time: null,
  };
  const evening: AlertMatchInput = {
    ...anyTime,
    start_time: "17:00",
    end_time: "21:00",
  };

  it("any-time matches whenever there is an open window", () => {
    expect(alertMatchesWindows(anyTime, [win("08:00:00", "09:00:00")])).toBe(true);
    expect(alertMatchesWindows(anyTime, [])).toBe(false);
  });

  it("narrowed window matches only overlapping opens", () => {
    expect(alertMatchesWindows(evening, [win("18:00:00", "19:00:00")])).toBe(true);
    expect(alertMatchesWindows(evening, [win("08:00:00", "12:00:00")])).toBe(false);
  });

  it("touching endpoints do not count as overlap", () => {
    // A window ending exactly at 17:00 is not usable for a 17:00–21:00 range.
    expect(alertMatchesWindows(evening, [win("16:00:00", "17:00:00")])).toBe(false);
    expect(alertMatchesWindows(evening, [win("21:00:00", "22:00:00")])).toBe(false);
  });
});
