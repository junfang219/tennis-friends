import { describe, expect, it } from "vitest";
import { combineDateAndTime } from "./wallClock";

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
