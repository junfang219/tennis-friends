import { getFacilityByCourtId } from "@/lib/facilities";

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
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type Timing =
  | { allDay: true; startYmd: string; endYmd: string }
  | { allDay: false; start: Date; end: Date };

function parseTiming(ev: ExportEvent): Timing | null {
  if (!ev.date) return null;
  const [y, mo, d] = ev.date.split("-").map(Number);
  if ([y, mo, d].some((x) => Number.isNaN(x))) return null;

  if (ev.time && ev.time.includes(":")) {
    const [h, mi] = ev.time.split(":").map(Number);
    if (![h, mi].some((x) => Number.isNaN(x))) {
      const start = new Date(y, mo - 1, d, h, mi, 0);
      const end = new Date(start.getTime() + (ev.durationMinutes || 90) * 60_000);
      return { allDay: false, start, end };
    }
  }

  // All-day: DTEND is exclusive, so it's the next calendar day.
  const startYmd = `${y}${pad(mo)}${pad(d)}`;
  const endDate = new Date(y, mo - 1, d + 1);
  const endYmd =
    `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;
  return { allDay: true, startYmd, endYmd };
}

function formatFloating(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}00`
  );
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
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// When the event is linked to a catalog facility, prefer the canonical name +
// full street address so calendar apps can geocode it into a directions pin.
// Free-text venues fall back to whatever the user typed.
function resolveLocationField(ev: ExportEvent): string {
  const facility = ev.facilityId ? getFacilityByCourtId(ev.facilityId) : null;
  if (facility) {
    const addr = facility.address?.trim();
    return addr ? `${facility.name}, ${addr}` : facility.name;
  }
  return ev.location ?? "";
}

// The VEVENT block for one event, or null if its date can't be parsed.
function buildVevent(ev: ExportEvent): string[] | null {
  const t = parseTiming(ev);
  if (!t) return null;
  const locationField = resolveLocationField(ev);
  const dtStart = t.allDay
    ? `DTSTART;VALUE=DATE:${t.startYmd}`
    : `DTSTART:${formatFloating(t.start)}`;
  const dtEnd = t.allDay
    ? `DTEND;VALUE=DATE:${t.endYmd}`
    : `DTEND:${formatFloating(t.end)}`;
  return [
    "BEGIN:VEVENT",
    `UID:${ev.id}@tennisfriend`,
    `DTSTAMP:${formatUtcStamp(new Date())}`,
    dtStart,
    dtEnd,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `LOCATION:${escapeIcsText(locationField)}`,
    `DESCRIPTION:${escapeIcsText(ev.description ?? "")}`,
    "END:VEVENT",
  ];
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
  ].join("\r\n");
}

export function buildIcs(ev: ExportEvent): string {
  const vevent = buildVevent(ev);
  if (!vevent) return "";
  return wrapCalendar([vevent]);
}

// One .ics holding many events — used by the post-signup "add all my matches"
// prompt so a guest who just claimed their roster slot gets every game they
// said they're playing in a single calendar import.
export function buildIcsBundle(events: ExportEvent[]): string {
  const vevents = events.map(buildVevent).filter((v): v is string[] => v !== null);
  if (vevents.length === 0) return "";
  return wrapCalendar(vevents);
}

export function buildGoogleCalendarUrl(ev: ExportEvent): string {
  const t = parseTiming(ev);
  if (!t) return "https://calendar.google.com/calendar/render";
  const locationField = resolveLocationField(ev);
  const dates = t.allDay
    ? `${t.startYmd}/${t.endYmd}`
    : `${formatFloating(t.start)}/${formatFloating(t.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
    details: ev.description ?? "",
    location: locationField,
  });
  // Timezone only matters for timed events; all-day entries are date-only.
  if (!t.allDay) {
    const tz =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
        : "";
    if (tz) params.set("ctz", tz);
  }
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
