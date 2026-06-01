import { describe, expect, it } from "vitest";
import { isInReminderWindow, REMINDER_GRACE_MS } from "./reminderWindow";

const target = new Date("2026-06-10T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

// now = (target - hoursBefore) + offsetMs  (offset 0 = exactly the due instant)
function nowAt(hoursBefore: number, offsetMs: number): Date {
  return new Date(target.getTime() - hoursBefore * HOUR + offsetMs);
}

describe("isInReminderWindow (never-early, grace catch-up)", () => {
  it("fires exactly at the due instant", () => {
    expect(isInReminderWindow(nowAt(24, 0), target, 24)).toBe(true);
    expect(isInReminderWindow(nowAt(1, 0), target, 1)).toBe(true);
  });

  it("never fires early (before the due instant)", () => {
    expect(isInReminderWindow(nowAt(24, -1 * MIN), target, 24)).toBe(false);
    expect(isInReminderWindow(nowAt(24, -30 * MIN), target, 24)).toBe(false);
  });

  it("fires for a tick shortly after the due instant (≤15 min late typical)", () => {
    expect(isInReminderWindow(nowAt(24, 15 * MIN), target, 24)).toBe(true);
  });

  it("catch-up: a later tick within the grace window still fires", () => {
    // e.g. the on-time tick was missed; the +30m tick covers it.
    expect(isInReminderWindow(nowAt(24, 30 * MIN), target, 24)).toBe(true);
    expect(isInReminderWindow(nowAt(24, REMINDER_GRACE_MS - MIN), target, 24)).toBe(true);
  });

  it("stops firing once the grace window has elapsed (upper bound exclusive)", () => {
    expect(isInReminderWindow(nowAt(24, REMINDER_GRACE_MS), target, 24)).toBe(false);
    expect(isInReminderWindow(nowAt(24, REMINDER_GRACE_MS + MIN), target, 24)).toBe(false);
  });

  it("only the relevant lead time matches at a given moment", () => {
    const now = nowAt(24, 0); // exactly the 24h instant
    expect(isInReminderWindow(now, target, 24)).toBe(true);
    expect(isInReminderWindow(now, target, 1)).toBe(false); // 1h window is hours away
  });

  it("does not fire for long-past events (beyond the grace window)", () => {
    const past = new Date("2026-06-01T18:00:00Z"); // 9 days ago vs target
    expect(isInReminderWindow(target, past, 24)).toBe(false);
  });

  it("respects a custom grace window", () => {
    expect(isInReminderWindow(nowAt(24, 20 * MIN), target, 24, 15 * MIN)).toBe(false);
    expect(isInReminderWindow(nowAt(24, 10 * MIN), target, 24, 15 * MIN)).toBe(true);
  });
});
