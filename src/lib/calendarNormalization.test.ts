import { describe, expect, it } from "vitest";
import { normalizeCalendarEvent, buildIcs, buildGoogleCalendarUrl, type ExportEvent } from "./calendarExport";
const event: ExportEvent = { id: "match-1", title: "Tennis", date: "2026-09-26", time: "12:30", timezone: "America/Los_Angeles", location: "Private backyard" };

describe("shared calendar snapshot", () => {
  it.each(["game", "match", "practice", "personal"])("normalizes %s events consistently across outputs", (kind) => {
    const input = { ...event, id: `${kind}-1` };
    const value = normalizeCalendarEvent(input);
    expect(value.start).toBe("2026-09-26T19:30:00.000Z");
    expect(value.end).toBe("2026-09-26T21:00:00.000Z");
    expect(value.location).toBe("Private backyard");
    expect(value.coordinates).toBeUndefined();
    expect(buildIcs(input)).toContain("DTSTART:20260926T193000Z");
    expect(new URL(buildGoogleCalendarUrl(input)).searchParams.get("dates")).toBe("20260926T193000Z/20260926T210000Z");
  });
  it("resolves coordinates and full venue address", () => {
    const result = normalizeCalendarEvent({ ...event, location: "Tennis Center Sand Point" });
    expect(result.location).toContain("Seattle");
    expect(result.coordinates?.latitude).toBeTypeOf("number");
  });
  it.each([["2026-12-31", "2027-01-01"], ["2028-02-29", "2028-03-01"]])("preserves all-day dates across %s", (start, end) => {
    expect(normalizeCalendarEvent({ ...event, date: start, time: "" })).toMatchObject({ allDay: true, start, end });
  });
  it("honors explicit zones independently of the device and defaults missing zones to the device", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      expect(normalizeCalendarEvent(event).start).toBe("2026-09-26T19:30:00.000Z");
      expect(normalizeCalendarEvent({ ...event, timezone: undefined }).start).toBe("2026-09-26T03:30:00.000Z");
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });
  it.each([
    { date: "2026-02-30" }, { date: "garbage" }, { time: "25:00" }, { time: "12:99" },
    { time: "noon" }, { timezone: "Mars/Olympus" }, { durationMinutes: 0 },
    { durationMinutes: -1 }, { durationMinutes: Infinity }, { title: " " },
  ])("rejects invalid data %j", (change) => {
    expect(() => normalizeCalendarEvent({ ...event, ...change })).toThrow();
    expect(buildIcs({ ...event, ...change })).toBe("");
  });
  it("handles both sides of DST changes and rejects nonexistent wall times", () => {
    expect(normalizeCalendarEvent({ ...event, date: "2026-03-08", time: "03:30" }).start).toBe("2026-03-08T10:30:00.000Z");
    expect(() => normalizeCalendarEvent({ ...event, date: "2026-03-08", time: "02:30" })).toThrow("does not exist");
    expect(normalizeCalendarEvent({ ...event, date: "2026-11-01", time: "01:30" }).start).toBe("2026-11-01T08:30:00.000Z");
    expect(normalizeCalendarEvent({ ...event, date: "2026-11-01", time: "03:30" }).start).toBe("2026-11-01T11:30:00.000Z");
  });
});
