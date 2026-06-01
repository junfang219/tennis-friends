import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_PREFS,
  parseReminderPrefs,
  serializeReminderPrefs,
} from "./reminderPrefs";

describe("parseReminderPrefs", () => {
  it("returns defaults for null/empty/invalid input", () => {
    expect(parseReminderPrefs(null)).toEqual(DEFAULT_REMINDER_PREFS);
    expect(parseReminderPrefs("")).toEqual(DEFAULT_REMINDER_PREFS);
    expect(parseReminderPrefs("not json")).toEqual(DEFAULT_REMINDER_PREFS);
  });

  it("fills missing keys with defaults but keeps an explicit empty array", () => {
    // {} → both default (this is the DB's default value for reminder_prefs).
    expect(parseReminderPrefs("{}")).toEqual(DEFAULT_REMINDER_PREFS);
    // An explicit [] means 'reminders disabled' for that kind — NOT defaults.
    expect(parseReminderPrefs(JSON.stringify({ matchHours: [] }))).toEqual({
      matchHours: [],
      practiceHours: DEFAULT_REMINDER_PREFS.practiceHours,
    });
  });

  it("keeps valid hours, sorted desc and de-duplicated", () => {
    expect(
      parseReminderPrefs(JSON.stringify({ matchHours: [1, 24, 1, 6], practiceHours: [12] }))
    ).toEqual({ matchHours: [24, 6, 1], practiceHours: [12] });
  });

  it("drops disallowed hours (only 24/12/6/3/1 are valid)", () => {
    expect(
      parseReminderPrefs(JSON.stringify({ matchHours: [2, 5, 24, 100, 0], practiceHours: [99] }))
    ).toEqual({ matchHours: [24], practiceHours: [] });
  });

  it("round-trips through serializeReminderPrefs", () => {
    const prefs = { matchHours: [24, 1], practiceHours: [6] };
    expect(parseReminderPrefs(serializeReminderPrefs(prefs))).toEqual(prefs);
  });
});
