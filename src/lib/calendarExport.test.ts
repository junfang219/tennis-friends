import { describe, it, expect } from "vitest";
import { buildIcs, buildGoogleCalendarUrl, buildIcsBundle, type ExportEvent } from "./calendarExport";
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
    // The app leaves this unset for personal events (device zone); tests pin
    // it so the expected UTC stamps don't depend on the machine running them.
    timezone: "America/Los_Angeles",
  };
}


// .ics output is folded at 75 octets (RFC 5545 §3.1); unfold before matching
// so assertions don't break when a property happens to span a fold boundary.
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, "");

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
    const ics = unfold(buildIcs(personalToExport(base)));
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:personal-abc@tennisfriend");
    expect(ics).toContain("SUMMARY:Lesson with coach");
    // 17:30 PDT (UTC-7) as an explicit UTC instant — floating (zone-less)
    // times were read as UTC by Google Calendar's importer, shifting events.
    expect(ics).toContain("DTSTART:20260621T003000Z");
    expect(ics).toContain("DTEND:20260621T013000Z"); // +60 min
    expect(ics).toContain("LOCATION:Green Lake");
    expect(ics).toContain("DESCRIPTION:bring extra balls");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("defaults duration to 90 min when unset", () => {
    const ics = unfold(buildIcs(personalToExport({ ...base, duration_minutes: null })));
    expect(ics).toContain("DTSTART:20260621T003000Z");
    expect(ics).toContain("DTEND:20260621T020000Z"); // +90 min
  });

  it("uses the standard-time offset for winter dates (PST, UTC-8)", () => {
    const ics = unfold(buildIcs(
      personalToExport({ ...base, event_date: "2026-01-10", event_time: "18:00" })
    ));
    expect(ics).toContain("DTSTART:20260111T020000Z");
  });

  it("emits an all-day VEVENT when there's no time (next-day exclusive end)", () => {
    const ics = unfold(buildIcs(personalToExport({ ...base, event_time: "" })));
    expect(ics).toContain("DTSTART;VALUE=DATE:20260620");
    expect(ics).toContain("DTEND;VALUE=DATE:20260621");
  });

  it("escapes commas/newlines in text fields", () => {
    const ics = unfold(buildIcs(
      personalToExport({ ...base, title: "Doubles, then drinks", notes: "court 3\nwear white" })
    ));
    expect(ics).toContain("SUMMARY:Doubles\\, then drinks");
    expect(ics).toContain("DESCRIPTION:court 3\\nwear white");
  });
});

describe("personal event → Google Calendar URL", () => {
  it("builds a TEMPLATE url with decoded params", () => {
    const url = new URL(buildGoogleCalendarUrl(personalToExport(base)));
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Lesson with coach");
    expect(url.searchParams.get("dates")).toBe("20260621T003000Z/20260621T013000Z");
    // Free-text "Green Lake" fuzzy-resolves to the catalog venue, so the
    // exported location is the geocodable canonical name + street address.
    expect(url.searchParams.get("location")).toContain("Green Lake Park West Tennis Courts");
    expect(url.searchParams.get("location")).toContain("Seattle, WA");
    expect(url.searchParams.get("details")).toBe("bring extra balls");
  });

  it("uses date-only range for all-day events", () => {
    const url = new URL(buildGoogleCalendarUrl(personalToExport({ ...base, event_time: "" })));
    expect(url.searchParams.get("dates")).toBe("20260620/20260621");
    expect(url.searchParams.get("ctz")).toBeNull(); // no tz for all-day
  });
});

describe("team match export resolves free-text venues to mappable addresses", () => {
  // Team matches carry no facilityId — only a free-text location. The export
  // must fuzzy-resolve it so Apple/Google get a geocodable address + pin
  // instead of a bare name that renders as a video-call-looking text row.
  const match: ExportEvent = {
    id: "match-sp",
    title: "Tennis match — Slice Society",
    date: "2026-10-03",
    time: "18:15",
    timezone: "America/Los_Angeles",
    location: "Tennis Center Sand Point",
  };

  it("upgrades LOCATION to name + street address and emits a map pin", () => {
    const ics = unfold(buildIcs(match));
    expect(ics).toMatch(/LOCATION:Tennis Center Sand Point\\n.*Seattle/);
    expect(ics).toContain("GEO:");
    expect(ics).toContain("X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS=");
    expect(ics).toMatch(/X-TITLE=Tennis Center Sand Point:geo:[\d.-]+,[\d.-]+/);
  });

  it("puts the resolved name + address in the Google URL", () => {
    const url = new URL(buildGoogleCalendarUrl(match));
    const loc = url.searchParams.get("location") ?? "";
    expect(loc).toContain("Tennis Center Sand Point");
    expect(loc).toContain("Seattle");
  });

  it("leaves unresolvable free text verbatim with no map pin", () => {
    const ics = unfold(buildIcs({ ...match, id: "match-x", location: "Pierre's secret backyard court" }));
    expect(ics).toContain("LOCATION:Pierre's secret backyard court");
    expect(ics).not.toContain("GEO:");
    expect(ics).not.toContain("X-APPLE-STRUCTURED-LOCATION");
  });
});

describe("team match export honors the row's stored timezone", () => {
  // Regression for the 9/26 Slice Society match: stored wall clock
  // 2026-09-26 12:30 America/Los_Angeles must export as 19:30Z, so calendar
  // apps in Seattle show 12:30 PM — not the 5:30 AM that floating-time ICS
  // produced after Google's UTC interpretation.
  const match: ExportEvent = {
    id: "match-926",
    title: "Tennis match — Slice Society",
    date: "2026-09-26",
    time: "12:30",
    timezone: "America/Los_Angeles",
    location: "Harbor Square Athletic Club",
  };

  it("emits the correct UTC instant in the .ics", () => {
    const ics = unfold(buildIcs(match));
    expect(ics).toContain("DTSTART:20260926T193000Z");
    expect(ics).toContain("DTEND:20260926T210000Z"); // default 90 min
  });

  it("emits the correct UTC instants in the Google URL", () => {
    const url = new URL(buildGoogleCalendarUrl(match));
    expect(url.searchParams.get("dates")).toBe("20260926T193000Z/20260926T210000Z");
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

describe("RFC 5545 line folding", () => {
  it("keeps every raw content line at 75 octets or less", () => {
    const ics = buildIcs({
      id: "match-long",
      title: "Tennis match — a deliberately long title to force folding 🎾🎾",
      description: "long description ".repeat(20),
      date: "2026-09-26",
      time: "12:30",
      timezone: "America/Los_Angeles",
      location: "Harbor Square Athletic Club",
    });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Folding must round-trip: unfolding restores the full property.
    expect(unfold(ics)).toContain("X-APPLE-RADIUS=200");
  });
});

describe("buildIcsBundle", () => {
  const timed: ExportEvent = {
    id: "match-1",
    title: "Slice Society vs HBSQ-Fine Whines-Ikeda",
    date: "2026-09-26",
    time: "12:30",
    timezone: "America/Los_Angeles",
    location: "Harbor Square Athletic Club",
  };
  // A window-scheduled match: date known, time still TBD → all-day entry.
  const allDay: ExportEvent = {
    id: "match-2",
    title: "Slice Society vs RBW-Mixed Signals-Wang",
    date: "2026-10-18",
    time: "",
    location: "Robinswood Tennis Center",
  };

  it("wraps every event in one calendar document", () => {
    const ics = unfold(buildIcsBundle([timed, allDay]));
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART:20260926T193000Z"); // 12:30 PDT
    expect(ics).toContain("DTSTART;VALUE=DATE:20261018"); // all-day
  });

  it("drops an event with an unparseable date without corrupting the file", () => {
    const ics = unfold(buildIcsBundle([timed, { ...allDay, id: "bad", date: "" }]));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("END:VCALENDAR");
  });

  it("returns empty string when nothing is exportable", () => {
    expect(buildIcsBundle([{ ...allDay, date: "" }])).toBe("");
  });
});
