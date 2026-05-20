// Per-team reminder preferences stored on Group.reminderPrefs as JSON.
// hoursBefore arrays list each lead time at which the cron should fire a
// reminder for non-RSVP'd members. Empty array = reminders disabled for
// that kind.
export type ReminderPrefs = {
  matchHours: number[];
  practiceHours: number[];
};

// Sensible defaults — opt-in for matches (24h + 1h), opt-in for practices
// at 24h. Teams that want a different cadence override on the Settings page.
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  matchHours: [24, 1],
  practiceHours: [24],
};

// "Hours before" choices the UI offers. Day-of-morning (0) is intentionally
// excluded — there's no single right local hour to fire it.
const ALLOWED_HOURS = [24, 12, 6, 3, 1];

function clampHours(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const out: number[] = [];
  for (const v of input) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    if (!ALLOWED_HOURS.includes(n)) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => b - a);
}

export function parseReminderPrefs(raw: string | null | undefined): ReminderPrefs {
  if (!raw) return { ...DEFAULT_REMINDER_PREFS };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        matchHours: clampHours((parsed as { matchHours?: unknown }).matchHours ?? DEFAULT_REMINDER_PREFS.matchHours),
        practiceHours: clampHours((parsed as { practiceHours?: unknown }).practiceHours ?? DEFAULT_REMINDER_PREFS.practiceHours),
      };
    }
  } catch {
    // fall through
  }
  return { ...DEFAULT_REMINDER_PREFS };
}

export function serializeReminderPrefs(prefs: ReminderPrefs): string {
  return JSON.stringify({
    matchHours: clampHours(prefs.matchHours),
    practiceHours: clampHours(prefs.practiceHours),
  });
}

export const REMINDER_HOUR_CHOICES = ALLOWED_HOURS;
