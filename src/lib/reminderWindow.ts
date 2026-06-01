/**
 * Reminder firing window for the event-reminders cron (runs every 15 min,
 * pg_cron schedule `0,15,30,45 * * * *`).
 *
 * A reminder for `hoursBefore` lead time is due at (target − hoursBefore). We
 * fire at the first cron tick AT OR AFTER that instant, within a grace window
 * — so reminders are NEVER early and, with a 15-min cron, at most ~15 min late
 * in the normal case. The grace window (default 1h) also provides catch-up: if
 * a cron tick is skipped (deploy, DB maintenance, a transient 5xx), the next
 * tick still falls inside the window and delivers. The `reminder_sent` unique
 * guard dedupes so only the first qualifying tick actually sends.
 *
 * Extracted from the cron route so the firing logic is unit-testable without
 * the route's server-only dependencies.
 */
export const REMINDER_GRACE_MS = 60 * 60 * 1000; // 1h catch-up window

export function isInReminderWindow(
  now: Date,
  target: Date,
  hoursBefore: number,
  graceMs: number = REMINDER_GRACE_MS
): boolean {
  const reminderAt = target.getTime() - hoursBefore * 60 * 60 * 1000;
  const delta = now.getTime() - reminderAt;
  // Never early (delta >= 0); fire within the grace window (catch-up).
  return delta >= 0 && delta < graceMs;
}
