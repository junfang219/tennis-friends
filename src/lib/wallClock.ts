// Pure date/time helpers — no server-only deps so they're safe to
// import from unit tests. The cron event-reminders route uses these
// to interpret wall-clock match_date/match_time and practice_date/
// practice_time strings as moments in the row's IANA timezone.
//
// JS Date doesn't take a timezone in its constructor; the technique
// here mirrors Postgres' `::timestamp AT TIME ZONE tz` semantics by
// computing the offset between the candidate UTC instant and the
// same wall-clock rendered in the target zone, then shifting.

export function combineDateAndTime(
  dateStr: string,
  timeStr: string,
  timezone: string | null | undefined
): Date | null {
  if (!dateStr) return null;
  // match_time / practice_time can be empty; default to 9am so untimed
  // entries still get reminders rather than being silently skipped.
  const safeTime = /^\d{1,2}:\d{2}$/.test(timeStr) ? timeStr : "09:00";
  const tz = timezone && timezone.length > 0 ? timezone : "America/Los_Angeles";

  const [yyyy, mm, dd] = dateStr.split("-").map((s) => parseInt(s, 10));
  const [hh, mi] = safeTime.padStart(5, "0").split(":").map((s) => parseInt(s, 10));
  if (
    !Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd) ||
    !Number.isFinite(hh) || !Number.isFinite(mi)
  ) {
    return null;
  }

  // First pass: treat the inputs as if they were UTC.
  const candidateUtcMs = Date.UTC(yyyy, mm - 1, dd, hh, mi);
  // What hour/minute does that UTC instant land at in the target zone?
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(candidateUtcMs));
  } catch {
    // Invalid IANA — fall back to interpreting as UTC.
    return new Date(candidateUtcMs);
  }
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? "NaN", 10);
  const tzMs = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour") === 24 ? 0 : get("hour"), get("minute")
  );
  // candidateUtcMs - tzMs = the zone offset at that instant.
  // The true UTC instant = candidateUtcMs + (candidateUtcMs - tzMs).
  const trueUtcMs = candidateUtcMs + (candidateUtcMs - tzMs);
  const out = new Date(trueUtcMs);
  return Number.isFinite(out.getTime()) ? out : null;
}

// Render a UTC instant back to the event's local wall clock for reminder
// copy ("Sat, Sep 26, 12:30 PM"). Without an explicit timeZone the cron's
// toLocaleString rendered in server time (Vercel = UTC), so the push
// notification showed a time 7-8 hours later than the actual match.
export function formatWhenLabel(
  target: Date,
  timezone: string | null | undefined
): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const tz = timezone && timezone.length > 0 ? timezone : "America/Los_Angeles";
  try {
    return target.toLocaleString("en-US", { ...opts, timeZone: tz });
  } catch {
    // Invalid IANA in the row — fall back to the app's home zone.
    return target.toLocaleString("en-US", { ...opts, timeZone: "America/Los_Angeles" });
  }
}
