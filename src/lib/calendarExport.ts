import { getFacilityByCourtId } from "@/lib/facilities";

export type ExportEvent = {
  id: string;
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
  courtFacilityId?: string | null;
  gameType: string;
  // posts.players_needed / players_confirmed count ADDITIONAL players beyond
  // the creator. Display math always adds +1 for the creator.
  playersConfirmed?: number;
  playersNeeded?: number;
  courtBooked?: boolean;
  // Full roster ordered creator-first, then approved play_request users.
  playerNames?: string[];
  author: { name: string };
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseStart(ev: ExportEvent): { start: Date; end: Date } | null {
  if (!ev.playDate || !ev.playTime || !ev.playTime.includes(":")) return null;
  const [y, mo, d] = ev.playDate.split("-").map(Number);
  const [h, mi] = ev.playTime.split(":").map(Number);
  if ([y, mo, d, h, mi].some((x) => Number.isNaN(x))) return null;
  const start = new Date(y, mo - 1, d, h, mi, 0);
  const end = new Date(start.getTime() + (ev.playDuration || 90) * 60_000);
  return { start, end };
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

// When the post is linked to a catalog facility, prefer the canonical name +
// full street address so calendar apps can geocode it into a directions pin.
// Free-text venues (no facility match) fall back to whatever the author typed.
function resolveLocation(ev: ExportEvent): { venueName: string; locationField: string } {
  const facility = ev.courtFacilityId ? getFacilityByCourtId(ev.courtFacilityId) : null;
  if (facility) {
    const addr = facility.address?.trim();
    return {
      venueName: facility.name,
      locationField: addr ? `${facility.name}, ${addr}` : facility.name,
    };
  }
  const fallback = ev.courtLocation || "";
  return { venueName: fallback, locationField: fallback };
}

function eventTitle(ev: ExportEvent, venueName: string): string {
  const type = ev.gameType ? ev.gameType.charAt(0).toUpperCase() + ev.gameType.slice(1) : "Game";
  const where = venueName ? ` at ${venueName}` : "";
  return `Tennis — ${type}${where}`;
}

// Buttons that trigger this exporter are only shown on confirmed sessions
// (calendar/page.tsx gates on isComplete), so we describe the event as
// confirmed and drop the original "Looking for N players" post body.
function eventDetails(ev: ExportEvent): string {
  const lines: string[] = [];
  const type = ev.gameType ? ev.gameType.toLowerCase() : "tennis";
  const headParts = [`Confirmed ${type}`];
  if (ev.playDuration) headParts.push(`${ev.playDuration} min`);
  lines.push(headParts.join(" · "));

  const names = (ev.playerNames ?? []).filter((n) => n && n.trim());
  const total =
    typeof ev.playersNeeded === "number" && ev.playersNeeded >= 0
      ? ev.playersNeeded + 1
      : null;
  const filled =
    names.length > 0
      ? names.length
      : typeof ev.playersConfirmed === "number"
        ? ev.playersConfirmed + 1
        : null;
  if (total !== null && filled !== null) {
    const slot = `${filled}/${total}`;
    lines.push(names.length > 0 ? `Players (${slot}): ${names.join(", ")}` : `Players: ${slot}`);
  }

  if (ev.courtBooked) lines.push("Court booked");
  if (ev.author?.name) lines.push(`Organizer: ${ev.author.name}`);
  return lines.join("\n");
}

export function buildIcs(ev: ExportEvent): string {
  const t = parseStart(ev);
  if (!t) return "";
  const { venueName, locationField } = resolveLocation(ev);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TennisFriend//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.id}@tennisfriend`,
    `DTSTAMP:${formatUtcStamp(new Date())}`,
    `DTSTART:${formatFloating(t.start)}`,
    `DTEND:${formatFloating(t.end)}`,
    `SUMMARY:${escapeIcsText(eventTitle(ev, venueName))}`,
    `LOCATION:${escapeIcsText(locationField)}`,
    `DESCRIPTION:${escapeIcsText(eventDetails(ev))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function buildGoogleCalendarUrl(ev: ExportEvent): string {
  const t = parseStart(ev);
  if (!t) return "https://calendar.google.com/calendar/render";
  const { venueName, locationField } = resolveLocation(ev);
  const tz = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
    : "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(ev, venueName),
    dates: `${formatFloating(t.start)}/${formatFloating(t.end)}`,
    details: eventDetails(ev),
    location: locationField,
  });
  if (tz) params.set("ctz", tz);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcs(ev: ExportEvent): void {
  const ics = buildIcs(ev);
  if (!ics) return;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tennis-${ev.id}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
