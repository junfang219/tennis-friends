import { describe, expect, it } from "vitest";
import { combineDateAndTime, formatWhenLabel } from "./wallClock";

// combineDateAndTime interprets the wall-clock dateStr + timeStr
// against the provided IANA zone — the same semantics Postgres'
// `::timestamp AT TIME ZONE tz` gives us for posts.play_timezone.
// These tests check that 18:00 Pacific lands at the correct UTC
// instant for both PDT (summer) and PST (winter), and that the
// function tolerates the same defaults / malformed inputs the
// cron's match_time / practice_time can produce.

describe("combineDateAndTime", () => {
  it("interprets 18:00 Pacific in July as 01:00 UTC next day (PDT)", () => {
    const d = combineDateAndTime("2026-07-15", "18:00", "America/Los_Angeles");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-07-16T01:00:00.000Z");
  });

  it("interprets 18:00 Pacific in January as 02:00 UTC next day (PST)", () => {
    const d = combineDateAndTime("2026-01-15", "18:00", "America/Los_Angeles");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-01-16T02:00:00.000Z");
  });

  it("interprets 18:00 UTC literally when timezone is UTC", () => {
    const d = combineDateAndTime("2026-07-15", "18:00", "UTC");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });

  it.each([
    ["2027-03-14", "08:30", "2027-03-14T15:30:00.000Z"],
    ["2027-11-07", "08:30", "2027-11-07T16:30:00.000Z"],
    ["2027-03-14", "00:30", "2027-03-14T08:30:00.000Z"],
    ["2027-03-14", "02:30", "2027-03-14T10:30:00.000Z"],
    ["2027-11-07", "01:30", "2027-11-07T09:30:00.000Z"],
  ])("resolves Pacific time on a DST transition: %s %s", (date, time, expected) => {
    expect(combineDateAndTime(date, time, "America/Los_Angeles")?.toISOString()).toBe(expected);
  });

  it("falls back to America/Los_Angeles when the timezone is empty/null", () => {
    const a = combineDateAndTime("2026-07-15", "18:00", "");
    const b = combineDateAndTime("2026-07-15", "18:00", null);
    const c = combineDateAndTime("2026-07-15", "18:00", "America/Los_Angeles");
    expect(a?.toISOString()).toBe(c?.toISOString());
    expect(b?.toISOString()).toBe(c?.toISOString());
  });

  it("falls back to 09:00 when match_time is empty / malformed", () => {
    const empty = combineDateAndTime("2026-07-15", "", "America/Los_Angeles");
    const bogus = combineDateAndTime("2026-07-15", "not-a-time", "America/Los_Angeles");
    // 09:00 PDT = 16:00 UTC.
    expect(empty?.toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(bogus?.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("returns null when the date is empty", () => {
    expect(combineDateAndTime("", "18:00", "America/Los_Angeles")).toBeNull();
  });

  it("returns null for a malformed date", () => {
    expect(combineDateAndTime("not-a-date", "18:00", "America/Los_Angeles")).toBeNull();
  });

  it("tolerates an invalid IANA zone by falling back to UTC", () => {
    // Should not throw; we fall back rather than crashing the cron.
    const d = combineDateAndTime("2026-07-15", "18:00", "Foo/Bar");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });
});

// formatWhenLabel is the display counterpart: it renders a UTC instant
// back in the event's zone for reminder push/email copy. Regression for
// the cron rendering in server-UTC — a 12:30 PM Pacific match showed as
// "7:30 PM" in every reminder.
describe("formatWhenLabel", () => {
  // 2026-09-26 12:30 America/Los_Angeles (PDT) = 19:30Z.
  const target = new Date("2026-09-26T19:30:00.000Z");

  it("renders the event's local wall clock, not the server's", () => {
    expect(formatWhenLabel(target, "America/Los_Angeles")).toBe(
      "Sat, Sep 26, 12:30 PM"
    );
  });

  it("handles standard time (PST) dates too", () => {
    // 2026-01-16 02:00Z = 18:00 PST on Jan 15.
    const winter = new Date("2026-01-16T02:00:00.000Z");
    expect(formatWhenLabel(winter, "America/Los_Angeles")).toBe(
      "Thu, Jan 15, 6:00 PM"
    );
  });

  it("defaults empty/null timezone to America/Los_Angeles", () => {
    expect(formatWhenLabel(target, "")).toBe("Sat, Sep 26, 12:30 PM");
    expect(formatWhenLabel(target, null)).toBe("Sat, Sep 26, 12:30 PM");
  });

  it("falls back to America/Los_Angeles on an invalid IANA zone", () => {
    expect(formatWhenLabel(target, "Foo/Bar")).toBe("Sat, Sep 26, 12:30 PM");
  });
});
