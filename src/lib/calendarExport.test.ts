import { describe, it, expect } from "vitest";
import { buildIcs, buildGoogleCalendarUrl, type ExportEvent } from "./calendarExport";
import { getFacilities } from "./facilities";

// Mirrors personalToExport() in src/app/calendar/page.tsx so the personal-event
// export path is exercised the same way the calendar renders it. If that mapper
// changes shape, this should change in lockstep.
type PersonalRow = {
  id: string;
  title: string;
  notes: string;
  event_date: string;
  event_time: string;
  duration_minutes: number | null;
  location: string;
  court_facility_id: string | null;
};
function personalToExport(e: PersonalRow): ExportEvent {
  return {
    id: `personal-${e.id}`,
    title: e.title,
    description: e.notes,
    date: e.event_date,
    time: e.event_time,
    durationMinutes: e.duration_minutes ?? undefined,
    location: e.location,
    facilityId: e.court_facility_id,
  };
}

const base: PersonalRow = {
  id: "abc",
  title: "Lesson with coach",
  notes: "bring extra balls",
  event_date: "2026-06-20",
  event_time: "17:30",
  duration_minutes: 60,
  location: "Green Lake",
  court_facility_id: null,
};

describe("personal event → .ics", () => {
  it("encodes a timed event with start/end, summary, location, description", () => {
    const ics = buildIcs(personalToExport(base));
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:personal-abc@tennisfriend");
    expect(ics).toContain("SUMMARY:Lesson with coach");
    expect(ics).toContain("DTSTART:20260620T173000");
    expect(ics).toContain("DTEND:20260620T183000"); // +60 min
    expect(ics).toContain("LOCATION:Green Lake");
    expect(ics).toContain("DESCRIPTION:bring extra balls");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("defaults duration to 90 min when unset", () => {
    const ics = buildIcs(personalToExport({ ...base, duration_minutes: null }));
    expect(ics).toContain("DTSTART:20260620T173000");
    expect(ics).toContain("DTEND:20260620T190000"); // +90 min
  });

  it("emits an all-day VEVENT when there's no time (next-day exclusive end)", () => {
    const ics = buildIcs(personalToExport({ ...base, event_time: "" }));
    expect(ics).toContain("DTSTART;VALUE=DATE:20260620");
    expect(ics).toContain("DTEND;VALUE=DATE:20260621");
  });

  it("escapes commas/newlines in text fields", () => {
    const ics = buildIcs(
      personalToExport({ ...base, title: "Doubles, then drinks", notes: "court 3\nwear white" })
    );
    expect(ics).toContain("SUMMARY:Doubles\\, then drinks");
    expect(ics).toContain("DESCRIPTION:court 3\\nwear white");
  });
});

describe("personal event → Google Calendar URL", () => {
  it("builds a TEMPLATE url with decoded params", () => {
    const url = new URL(buildGoogleCalendarUrl(personalToExport(base)));
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Lesson with coach");
    expect(url.searchParams.get("dates")).toBe("20260620T173000/20260620T183000");
    expect(url.searchParams.get("location")).toBe("Green Lake");
    expect(url.searchParams.get("details")).toBe("bring extra balls");
  });

  it("uses date-only range for all-day events", () => {
    const url = new URL(buildGoogleCalendarUrl(personalToExport({ ...base, event_time: "" })));
    expect(url.searchParams.get("dates")).toBe("20260620/20260621");
    expect(url.searchParams.get("ctz")).toBeNull(); // no tz for all-day
  });
});

describe("facility-linked location resolves to canonical name + address", () => {
  it("upgrades a picked court's location to name, street address", () => {
    const fac = getFacilities().find((f) => f.address && f.address.trim().length > 0);
    expect(fac).toBeTruthy();
    const url = new URL(
      buildGoogleCalendarUrl(
        personalToExport({ ...base, location: fac!.name, court_facility_id: fac!.courtId })
      )
    );
    expect(url.searchParams.get("location")).toBe(`${fac!.name}, ${fac!.address.trim()}`);
  });
});
