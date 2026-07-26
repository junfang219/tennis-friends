import { describe, expect, it } from "vitest";
import { validateBookingWindow, snapBookingRange } from "./bookingWindow";

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

describe("snapBookingRange", () => {
  // A 4:00–9:00 free window, in minutes from midnight.
  const bar = { barStartMin: 240, barEndMin: 540 };

  it("tap places a 1-hour block at the snapped tapped mark", () => {
    // Tap ~8:00 (480) → 8:00–9:00.
    expect(snapBookingRange({ ...bar, anchorMin: 480, cursorMin: 480 })).toEqual({
      startMin: 480,
      endMin: 540,
    });
    // Tap 8:12 (492) snaps to 8:00.
    expect(snapBookingRange({ ...bar, anchorMin: 492, cursorMin: 492 })).toEqual({
      startMin: 480,
      endMin: 540,
    });
  });

  it("tap near the bar end shifts the block left so it fits", () => {
    // Tap 8:50 (530): a 1h block would overrun 9:00, so start shifts to 8:00.
    expect(snapBookingRange({ ...bar, anchorMin: 530, cursorMin: 530 })).toEqual({
      startMin: 480,
      endMin: 540,
    });
  });

  it("drag spans anchor→cursor, snapped to 30 min", () => {
    // Drag 8:00 → 9:00... but bar ends 9:00; use a 4:00–10:00 bar for 2h.
    const wide = { barStartMin: 240, barEndMin: 600 };
    expect(
      snapBookingRange({ ...wide, anchorMin: 480, cursorMin: 600 })
    ).toEqual({ startMin: 480, endMin: 600 });
    // Reverse drag (cursor before anchor) still yields ordered range.
    expect(
      snapBookingRange({ ...wide, anchorMin: 540, cursorMin: 420 })
    ).toEqual({ startMin: 420, endMin: 540 });
  });

  it("floors a short drag to the 1-hour minimum", () => {
    // Drag 8:00 → 8:30 (30 min) → floored to 8:00–9:00.
    expect(snapBookingRange({ ...bar, anchorMin: 480, cursorMin: 510 })).toEqual({
      startMin: 480,
      endMin: 540,
    });
  });

  it("clamps the range inside the bar", () => {
    // Cursor past the bar end clamps to 9:00, start held at min-1h back.
    expect(snapBookingRange({ ...bar, anchorMin: 500, cursorMin: 900 })).toEqual({
      startMin: 480,
      endMin: 540,
    });
  });

  it("returns the whole bar when it is at or under the minimum", () => {
    expect(
      snapBookingRange({ barStartMin: 480, barEndMin: 510, anchorMin: 490, cursorMin: 505 })
    ).toEqual({ startMin: 480, endMin: 510 });
  });
});
