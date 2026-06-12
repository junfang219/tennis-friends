import { describe, expect, it } from "vitest";
import {
  slotMinutes,
  openWindows,
  toSnapshotWindows,
  buildSnapshotRows,
  windowsToSlots,
} from "./courtAvailability";
import type { DayAvailability, Timeslot } from "./activenet";

const slot = (startTime: string, endTime: string, available = true): Timeslot => ({
  date: "2026-06-13",
  startTime,
  endTime,
  available,
});

describe("slotMinutes", () => {
  it("computes duration in minutes", () => {
    expect(slotMinutes("07:00:00", "08:00:00")).toBe(60);
    expect(slotMinutes("10:00:00", "10:01:00")).toBe(1);
    expect(slotMinutes("17:15:00", "21:00:00")).toBe(225);
  });
});

describe("openWindows", () => {
  it("keeps available windows >= 30 min, drops slivers and unavailable", () => {
    const slots = [
      slot("07:00:00", "08:00:00"),
      slot("10:00:00", "10:01:00"), // sliver
      slot("13:00:00", "13:30:00"), // exactly 30 → kept
      slot("14:00:00", "16:00:00", false), // unavailable
    ];
    expect(openWindows(slots).map((s) => s.startTime)).toEqual(["07:00:00", "13:00:00"]);
  });
});

describe("toSnapshotWindows", () => {
  it("maps open slots to compact start/end windows", () => {
    expect(toSnapshotWindows([slot("07:00:00", "08:00:00"), slot("10:00:00", "10:01:00")])).toEqual([
      { start: "07:00:00", end: "08:00:00" },
    ]);
  });
});

describe("buildSnapshotRows", () => {
  const days: DayAvailability[] = [
    { date: "2026-06-12", status: 7, slots: [] }, // today: locked → skip
    {
      date: "2026-06-13",
      status: 0,
      slots: [slot("07:00:00", "08:00:00"), slot("10:00:00", "10:01:00")],
    },
    { date: "2026-06-27", status: 8, slots: [] }, // beyond window → skip
    { date: "2026-06-14", status: 0, slots: [slot("17:15:00", "21:00:00")] },
  ];

  it("keeps only status-0 days and filters their windows", () => {
    const rows = buildSnapshotRows(2, 279, days);
    expect(rows.map((r) => r.date)).toEqual(["2026-06-13", "2026-06-14"]);
    expect(rows[0]).toEqual({
      center_id: 2,
      resource_id: 279,
      date: "2026-06-13",
      windows: [{ start: "07:00:00", end: "08:00:00" }],
      day_status: 0,
    });
  });

  it("keeps a status-0 day even when it has no open windows (fully booked)", () => {
    const rows = buildSnapshotRows(2, 279, [{ date: "2026-06-15", status: 0, slots: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].windows).toEqual([]);
  });
});

describe("windowsToSlots", () => {
  it("rehydrates windows as available timeslots for a date", () => {
    expect(windowsToSlots("2026-06-12", [{ start: "17:15:00", end: "21:00:00" }])).toEqual([
      { date: "2026-06-12", startTime: "17:15:00", endTime: "21:00:00", available: true },
    ]);
  });
});
