import { describe, expect, it } from "vitest";
import { validateBookingWindow, defaultBookingEnd } from "./bookingWindow";

// Mid-day UTC so the Seattle calendar date is unambiguous: 2026-07-25 in
// Seattle (PDT, -7).
const NOW = new Date("2026-07-25T19:00:00Z");

const valid = {
  date: "2026-07-30",
  startTime: "17:00",
  endTime: "18:00",
  now: NOW,
};

describe("validateBookingWindow", () => {
  it("accepts a normal 1-hour booking and resolves Seattle wall-clock to UTC", () => {
    const res = validateBookingWindow(valid);
    if (!res.ok) throw new Error(res.reason);
    // 17:00 PDT = 00:00 UTC next day.
    expect(res.start.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(res.end.toISOString()).toBe("2026-07-31T01:00:00.000Z");
  });

  it("accepts a 75-minute block (Amy Yee indoor)", () => {
    expect(
      validateBookingWindow({ ...valid, startTime: "09:00", endTime: "10:15" }).ok
    ).toBe(true);
  });

  it("rejects malformed date and time strings", () => {
    expect(validateBookingWindow({ ...valid, date: "7/30/2026" }).ok).toBe(false);
    expect(validateBookingWindow({ ...valid, startTime: "5pm" }).ok).toBe(false);
    expect(validateBookingWindow({ ...valid, endTime: "26:00" }).ok).toBe(false);
  });

  it("rejects end <= start", () => {
    expect(
      validateBookingWindow({ ...valid, startTime: "18:00", endTime: "17:00" }).ok
    ).toBe(false);
    expect(
      validateBookingWindow({ ...valid, startTime: "17:00", endTime: "17:00" }).ok
    ).toBe(false);
  });

  it("rejects durations under 30 min and over 4 h", () => {
    expect(
      validateBookingWindow({ ...valid, endTime: "17:15" }).ok
    ).toBe(false);
    expect(
      validateBookingWindow({ ...valid, startTime: "10:00", endTime: "14:30" }).ok
    ).toBe(false);
  });

  it("allows today (phone/in-person bookings) but rejects past dates", () => {
    expect(validateBookingWindow({ ...valid, date: "2026-07-25" }).ok).toBe(true);
    expect(validateBookingWindow({ ...valid, date: "2026-07-24" }).ok).toBe(false);
  });

  it("uses the Seattle calendar day, not UTC, for 'today'", () => {
    // 05:30 UTC on the 26th is still 22:30 on the 25th in Seattle, so the
    // 25th is today and must be accepted.
    const lateNight = new Date("2026-07-26T05:30:00Z");
    expect(
      validateBookingWindow({ ...valid, date: "2026-07-25", now: lateNight }).ok
    ).toBe(true);
  });

  it("rejects dates beyond +30 days", () => {
    expect(validateBookingWindow({ ...valid, date: "2026-08-24" }).ok).toBe(true);
    expect(validateBookingWindow({ ...valid, date: "2026-08-25" }).ok).toBe(false);
  });
});

describe("defaultBookingEnd", () => {
  it("defaults to one hour after the start", () => {
    expect(defaultBookingEnd("17:00", "21:00")).toBe("18:00");
    expect(defaultBookingEnd("07:30", "12:00")).toBe("08:30");
  });

  it("clamps to the free window's end when it is under an hour away", () => {
    expect(defaultBookingEnd("20:30", "21:00")).toBe("21:00");
    expect(defaultBookingEnd("20:45", "21:00")).toBe("21:00");
  });

  it("honors a custom max duration", () => {
    expect(defaultBookingEnd("09:00", "12:00", 75)).toBe("10:15");
  });
});
