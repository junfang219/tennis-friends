import { getFacilityByCourtId, resolveFacilityByName, type Facility } from "@/lib/facilities";
import { z } from "zod";

/**
 * A neutral calendar entry any of the app's event types can map to (find-players
 * games, team matches, team practices, personal events). Callers supply an
 * explicit title/description; this module handles the .ics / Google-Calendar
 * encoding and resolves a catalog facility to a geocodable name + address.
 *
 * `time` is optional — omit it (or pass "") for an all-day entry.
 */
export type ExportEvent = {
  id: string;
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM — omit/"" for all-day
  durationMinutes?: number;
  location?: string;
  /** Catalog "tf-N"; when set, the location is upgraded to the canonical
   *  name + street address so calendar apps can geocode a directions pin. */
  facilityId?: string | null;
  /** IANA zone the date/time strings are wall-clock in (team_matches/
   *  team_practices store one). Omitted → the exporting device's zone. */
  timezone?: string | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const dateSchema = z.iso.date();
const timezoneSchema = z.string().min(1).refine((zone) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; }
  catch { return false; }
}, "Invalid timezone");
const exportEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().optional(),
  date: dateSchema,
  time: z.string().regex(/^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$/).or(z.literal("")).optional(),
  durationMinutes: z.number().finite().positive().optional(),
  location: z.string().optional(),
  facilityId: z.string().nullable().optional(),
  timezone: timezoneSchema.or(z.literal("")).nullable().optional(),
});

const nativeFields = {
  title: z.string().trim().min(1),
  notes: z.string(),
  location: z.string(),
  timezone: timezoneSchema,
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
};
export const calendarPayloadSchema = z.discriminatedUnion("allDay", [
  z.object({ ...nativeFields, allDay: z.literal(true), start: dateSchema, end: dateSchema }),
  z.object({ ...nativeFields, allDay: z.literal(false), start: z.iso.datetime({ precision: 3 }), end: z.iso.datetime({ precision: 3 }) }),
]).refine((event) => event.end > event.start, "End must follow start");
export type CalendarPayload = z.infer<typeof calendarPayloadSchema>;

// Resolve against both sides of a timezone transition. A missing spring-forward
// time is rejected; for a repeated fall-back time choose the earlier occurrence.
function wallClockInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallDate = new Date(0);
  wallDate.setUTCFullYear(year, month - 1, day);
  wallDate.setUTCHours(hour, minute, 0, 0);
  const wall = wallDate.getTime();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const asWall = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (key: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === key)?.value);
    const result = new Date(0);
    result.setUTCFullYear(value("year"), value("month") - 1, value("day"));
    result.setUTCHours(value("hour"), value("minute"), value("second"), 0);
    return result.getTime();
  };
  const candidates = [-86400000, 0, 86400000].map((delta) => {
    const sample = wall + delta;
    return wall - (asWall(sample) - sample);
  }).filter((instant) => asWall(instant) === wall);
  if (!candidates.length) throw new Error("This time does not exist in the event timezone.");
  return new Date(Math.min(...candidates));
}

/** Shared validated event snapshot for Apple, ICS, and Google. */
export function normalizeCalendarEvent(input: ExportEvent): CalendarPayload {
  const ev = exportEventSchema.parse(input);
  const timezone = ev.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const facility = resolveFacility(ev);
  const common = {
    title: ev.title, notes: ev.description ?? "", timezone,
    location: locationFieldFor(ev, facility, "\n"),
    ...(facility?.latitude != null && facility.longitude != null ? {
      coordinates: { latitude: facility.latitude, longitude: facility.longitude },
    } : {}),
  };
  if (!ev.time) {
    const end = new Date(`${ev.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return calendarPayloadSchema.parse({ ...common, allDay: true, start: ev.date, end: end.toISOString().slice(0, 10) });
  }
  const start = wallClockInstant(ev.date, ev.time, timezone);
  const end = new Date(start.getTime() + (ev.durationMinutes ?? 90) * 60000);
  return calendarPayloadSchema.parse({ ...common, allDay: false, start: start.toISOString(), end: end.toISOString() });
}

function exportTiming(event: CalendarPayload): { start: string; end: string } {
  return event.allDay
    ? { start: event.start.replaceAll("-", ""), end: event.end.replaceAll("-", "") }
    : { start: formatUtcStamp(new Date(event.start)), end: formatUtcStamp(new Date(event.end)) };
}

function formatUtcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// When the event is linked to a catalog facility — or its free-text location
// fuzzy-matches one (team matches/practices store only a venue name) — prefer
// the canonical name + full street address so calendar apps geocode it into a
// directions pin instead of showing a bare, video-call-looking text row.
// Unresolvable free text falls back to whatever the user typed.
function resolveFacility(ev: ExportEvent): Facility | null {
  if (ev.facilityId) return getFacilityByCourtId(ev.facilityId);
  if (ev.location) return resolveFacilityByName(ev.location);
  return null;
}

// `sep` is "\n" for the .ics (Apple renders name/address as two lines, its
// own emission style) and ", " for the Google Calendar URL (single line).
function locationFieldFor(
  ev: ExportEvent,
  facility: Facility | null,
  sep: string
): string {
  if (facility) {
    const addr = facility.address?.trim();
    return addr ? `${facility.name}${sep}${addr}` : facility.name;
  }
  return ev.location ?? "";
}

// The VEVENT block for one event, or null if its date can't be parsed.
function buildVevent(ev: ExportEvent): string[] | null {
  let normalized: CalendarPayload;
  try { normalized = normalizeCalendarEvent(ev); } catch { return null; }
  const t = exportTiming(normalized);
  const facility = resolveFacility(ev);
  const locationField = normalized.location;
  const dtStart = `DTSTART${normalized.allDay ? ";VALUE=DATE" : ""}:${t.start}`;
  const dtEnd = `DTEND${normalized.allDay ? ";VALUE=DATE" : ""}:${t.end}`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.id}@tennisfriend`,
    `DTSTAMP:${formatUtcStamp(new Date())}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeIcsText(normalized.title)}`,
    `LOCATION:${escapeIcsText(locationField)}`,
  ];
  // Known coordinates get a real map pin: GEO for standards clients plus
  // Apple's structured-location extension, which is what makes iOS show
  // the location as a mappable address (with directions and travel time)
  // rather than plain text in the "Location or Video Call" slot.
  if (facility && facility.latitude != null && facility.longitude != null) {
    const lat = facility.latitude;
    const lng = facility.longitude;
    const addr = facility.address?.trim() || facility.name;
    lines.push(`GEO:${lat};${lng}`);
    lines.push(
      `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=${escapeIcsText(addr)};` +
        `X-APPLE-RADIUS=200;X-TITLE=${escapeIcsText(facility.name)}:geo:${lat},${lng}`
    );
  }
  lines.push(`DESCRIPTION:${escapeIcsText(normalized.notes)}`, "END:VEVENT");
  return lines;
}

// RFC 5545 §3.1: content lines longer than 75 octets must be folded with
// CRLF + one space. Some parsers reject unfolded long lines (our
// X-APPLE-STRUCTURED-LOCATION easily exceeds the limit). Splits on
// character boundaries so multi-byte UTF-8 (em dashes in titles) stays intact.
function foldIcsLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  const budget = () => (out.length === 0 ? 75 : 74); // continuations start with a space
  for (const ch of line) {
    const chBytes = new TextEncoder().encode(ch).length;
    if (bytes + chBytes > budget()) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += chBytes;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

function wrapCalendar(vevents: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TennisFriend//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vevents.flat(),
    "END:VCALENDAR",
  ]
    .flatMap(foldIcsLine)
    .join("\r\n");
}

export function buildIcs(ev: ExportEvent): string {
  const vevent = buildVevent(ev);
  if (!vevent) return "";
  return wrapCalendar([vevent]);
}

// One .ics holding many events — used by the post-signup "add all my matches"
// prompt. Import behavior depends on the receiving calendar application.
export function buildIcsBundle(events: ExportEvent[]): string {
  const vevents = events.map(buildVevent).filter((v): v is string[] => v !== null);
  if (vevents.length === 0) return "";
  return wrapCalendar(vevents);
}

export function buildGoogleCalendarUrl(ev: ExportEvent): string {
  const normalized = normalizeCalendarEvent(ev);
  const t = exportTiming(normalized);
  const locationField = normalized.location.replaceAll("\n", ", ");
  const dates = `${t.start}/${t.end}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: normalized.title,
    dates,
    details: normalized.notes,
    location: locationField,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function triggerIcsDownload(ics: string, filename: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadIcs(ev: ExportEvent): void {
  const ics = buildIcs(ev);
  if (!ics) return;
  triggerIcsDownload(ics, `tennis-${ev.id}.ics`);
}

export function downloadIcsBundle(events: ExportEvent[], filename = "tennis-matches.ics"): void {
  const ics = buildIcsBundle(events);
  if (!ics) return;
  triggerIcsDownload(ics, filename);
}

/** Encode the exact shared snapshot without resolving locations or device zones again. */
export function buildCalendarPayloadIcs(id: string, input: CalendarPayload, stamp = new Date()): string {
  const event = calendarPayloadSchema.parse(input);
  const timing = exportTiming(event);
  const suffix = event.allDay ? ";VALUE=DATE" : "";
  const lines = [
    "BEGIN:VEVENT", `UID:${escapeIcsText(id)}@tennisfriend`,
    `DTSTAMP:${formatUtcStamp(stamp)}`,
    `DTSTART${suffix}:${timing.start}`, `DTEND${suffix}:${timing.end}`,
    `SUMMARY:${escapeIcsText(event.title)}`, `DESCRIPTION:${escapeIcsText(event.notes)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
  ];
  if (event.coordinates) lines.push(`GEO:${event.coordinates.latitude};${event.coordinates.longitude}`);
  lines.push("END:VEVENT");
  return wrapCalendar([lines]) + "\r\n";
}

/** A single, named subscription containing all of a team's current entries. */
export function buildNamedCalendarIcs(name: string, entries: Array<{id:string;payload:CalendarPayload}>, stamp = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TennisFriend//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `NAME:${escapeIcsText(name)}`, `X-WR-CALNAME:${escapeIcsText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  const header = lines.flatMap(foldIcsLine).join("\r\n");
  const events = entries.map(({id,payload}) => {
    const calendar = buildCalendarPayloadIcs(id,payload,stamp);
    return calendar.slice(calendar.indexOf("BEGIN:VEVENT"),calendar.indexOf("END:VCALENDAR"));
  }).join("");
  return `${header}\r\n${events}END:VCALENDAR\r\n`;
}
