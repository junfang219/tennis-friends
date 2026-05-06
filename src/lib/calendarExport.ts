export type ExportEvent = {
  id: string;
  playDate: string;
  playTime: string;
  playDuration: number;
  courtLocation: string;
  gameType: string;
  content: string;
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

function eventTitle(ev: ExportEvent): string {
  const type = ev.gameType ? ev.gameType.charAt(0).toUpperCase() + ev.gameType.slice(1) : "Game";
  const where = ev.courtLocation ? ` at ${ev.courtLocation}` : "";
  return `Tennis — ${type}${where}`;
}

function eventDetails(ev: ExportEvent): string {
  const lines = [ev.content?.trim(), ev.author?.name ? `Organizer: ${ev.author.name}` : ""].filter(Boolean);
  return lines.join("\n");
}

export function buildIcs(ev: ExportEvent): string {
  const t = parseStart(ev);
  if (!t) return "";
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
    `SUMMARY:${escapeIcsText(eventTitle(ev))}`,
    `LOCATION:${escapeIcsText(ev.courtLocation || "")}`,
    `DESCRIPTION:${escapeIcsText(eventDetails(ev))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function buildGoogleCalendarUrl(ev: ExportEvent): string {
  const t = parseStart(ev);
  if (!t) return "https://calendar.google.com/calendar/render";
  const tz = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
    : "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(ev),
    dates: `${formatFloating(t.start)}/${formatFloating(t.end)}`,
    details: eventDetails(ev),
    location: ev.courtLocation || "",
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
