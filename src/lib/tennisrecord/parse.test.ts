import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseTeamUrl,
  parseTeamProfile,
  parseSchedule,
  parseSearchResults,
  discoverOpponentLinks,
} from "./parse";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "teamprofile.html"),
  "utf8",
);

// Live captures of tennisrecord team-search results (teamname "Slice Girls",
// Pacific NW, 2026) and an empty search — guards against search-markup drift.
const searchFixture = readFileSync(
  join(__dirname, "__fixtures__", "searchresults.html"),
  "utf8",
);
const searchEmptyFixture = readFileSync(
  join(__dirname, "__fixtures__", "searchresults-empty.html"),
  "utf8",
);

// Live capture of a real team page (For Funzies, 2026) — the canonical guard
// against tennisrecord markup drift. If this breaks, re-save the page and
// adjust the heuristics in parse.ts.
const realFixture = readFileSync(
  join(__dirname, "__fixtures__", "teamprofile-real.html"),
  "utf8",
);

describe("parseTeamUrl", () => {
  it("extracts the team key from a numeric team= URL", () => {
    expect(
      parseTeamUrl("https://www.tennisrecord.com/adult/teamprofile.aspx?team=123456"),
    ).toEqual({ teamKey: "team=123456", query: "team=123456" });
  });

  it("accepts a real teamname= URL with year", () => {
    expect(
      parseTeamUrl(
        "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=For%20Funzies&year=2026",
      ),
    ).toEqual({
      teamKey: "teamname=for funzies&year=2026",
      query: "teamname=For%20Funzies&year=2026",
      teamName: "For Funzies",
    });
  });

  it("preserves the s= disambiguator (several teams can share a name)", () => {
    expect(
      parseTeamUrl(
        "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=Slice%20Girls&year=2026&s=36",
      ),
    ).toEqual({
      teamKey: "teamname=slice girls&year=2026&s=36",
      query: "teamname=Slice%20Girls&year=2026&s=36",
      teamName: "Slice Girls",
    });
  });

  it("accepts a teamname= URL without a year", () => {
    expect(
      parseTeamUrl(
        "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=Slice%20Girls",
      ),
    ).toEqual({
      teamKey: "teamname=slice girls",
      query: "teamname=Slice%20Girls",
      teamName: "Slice Girls",
    });
  });

  it("normalizes teamname casing into the dedupe key", () => {
    const a = parseTeamUrl(
      "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=FOR%20FUNZIES&year=2026",
    );
    const b = parseTeamUrl(
      "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=for%20funzies&year=2026",
    );
    expect(a?.teamKey).toBe(b?.teamKey);
  });

  it("is case-insensitive on the query param and tolerates extra params", () => {
    expect(
      parseTeamUrl("https://tennisrecord.com/adult/teamprofile.aspx?Year=2026&TEAM=99"),
    ).toEqual({ teamKey: "team=99", query: "team=99" });
  });

  it("accepts a bare numeric key", () => {
    expect(parseTeamUrl("  654321 ")).toEqual({
      teamKey: "team=654321",
      query: "team=654321",
    });
  });

  it("rejects non-tennisrecord URLs and junk", () => {
    expect(parseTeamUrl("https://example.com/teamprofile.aspx?team=1")).toBeNull();
    expect(parseTeamUrl("not a url")).toBeNull();
    expect(parseTeamUrl("")).toBeNull();
    expect(
      parseTeamUrl("https://www.tennisrecord.com/adult/teamprofile.aspx"),
    ).toBeNull();
  });
});

describe("parseTeamProfile (synthetic fixture)", () => {
  const team = parseTeamProfile(fixture);

  it("reads the team name", () => {
    expect(team.teamName).toBe("Capitol Hill Smashers 4.0");
  });

  it("parses only player rows (skips the totals row)", () => {
    expect(team.players.map((p) => p.name)).toEqual([
      "Jane Doe",
      "John Smith",
      "New Player",
    ]);
  });

  it("parses record, NTRP, and dynamic rating for a full row", () => {
    const jane = team.players[0];
    expect(jane.recordRaw).toBe("12-3");
    expect(jane.wins).toBe(12);
    expect(jane.losses).toBe(3);
    expect(jane.ntrpRating).toBe(4.0);
    expect(jane.dynamicRating).toBeCloseTo(4.123, 3);
    expect(jane.sourcePlayerUrl).toContain("playerprofile.aspx");
  });

  it("tolerates a player with no ratings yet", () => {
    const rookie = team.players[2];
    expect(rookie.name).toBe("New Player");
    expect(rookie.recordRaw).toBe("0-0");
    expect(rookie.ntrpRating).toBeNull();
    expect(rookie.dynamicRating).toBeNull();
  });

  it("returns an empty roster for markup with no player rows", () => {
    expect(parseTeamProfile("<html><body>nothing here</body></html>").players).toEqual(
      [],
    );
  });
});

describe("parseSchedule (real live capture)", () => {
  const schedule = parseSchedule(realFixture);

  it("parses only the wide table (no responsive duplicates)", () => {
    expect(schedule).toHaveLength(6);
  });

  it("parses dates, opponents, and hrefs", () => {
    expect(schedule[0]).toMatchObject({
      dateISO: "2026-06-01",
      opponentName: "Slice Girls",
      matchSite: "TBA",
      resultText: "0-0",
    });
    expect(schedule[0].opponentHref).toContain("teamname=Slice Girls");
    expect(schedule.map((m) => m.opponentName)).toEqual([
      "Slice Girls",
      "Barrios-Woods",
      "Sumertime Fun",
      "Code Pink",
      "WATT Happens on the Court",
      "Sets on the Beach",
    ]);
  });

  it("nulls the 3:00 AM placeholder time but keeps the raw text", () => {
    for (const m of schedule) {
      expect(m.timeRaw).toBe("3:00 AM");
      expect(m.time).toBeNull();
    }
  });

  it("discovers distinct opponents with normalized team keys", () => {
    const links = discoverOpponentLinks(schedule);
    expect(links).toHaveLength(6);
    expect(links[0]).toMatchObject({
      name: "Slice Girls",
      teamKey: "teamname=slice girls&year=2026&s=36",
    });
    expect(links[0].teamUrl).toBe(
      "https://www.tennisrecord.com/adult/teamprofile.aspx?teamname=Slice Girls&year=2026&s=36",
    );
    // Re-running over a double round-robin (same opponents twice) dedupes.
    expect(discoverOpponentLinks([...schedule, ...schedule])).toHaveLength(6);
  });
});

describe("parseSchedule (synthetic edge cases)", () => {
  const wideHeader =
    "<table><tr><th>Local Schedule</th><th>Time</th><th>Opponent</th>" +
    "<th>Match Site</th><th>Result</th></tr>";
  const row = (date: string, time: string, name: string) =>
    `<tr><td>${date}</td><td>${time}</td>` +
    `<td><a href="/adult/teamprofile.aspx?teamname=${name}&year=2026">${name}</a></td>` +
    `<td>Lower Woodland</td><td>0-0</td></tr>`;

  it("converts a real PM time to 24h", () => {
    const html = wideHeader + row("07/04/2026", "6:30 PM", "Acers") + "</table>";
    expect(parseSchedule(html)[0]).toMatchObject({
      dateISO: "2026-07-04",
      time: "18:30",
      timeRaw: "6:30 PM",
      matchSite: "Lower Woodland",
    });
  });

  it("keeps a 12:15 AM time and leaves a malformed date empty", () => {
    const html = wideHeader + row("7/4/26", "12:15 AM", "Acers") + "</table>";
    expect(parseSchedule(html)[0]).toMatchObject({ dateISO: "", time: "00:15" });
  });

  it("returns [] when only the narrow responsive table exists", () => {
    const html =
      "<table><tr><th>Local Schedule</th><th>Opponent</th></tr>" +
      "<tr><td>06/01/2026 3:00 AM</td>" +
      '<td><a href="/adult/teamprofile.aspx?teamname=X&year=2026">X</a></td></tr>' +
      "</table>";
    expect(parseSchedule(html)).toEqual([]);
  });

  it("returns [] for markup with no schedule", () => {
    expect(parseSchedule("<html><body>nope</body></html>")).toEqual([]);
  });
});

describe("parseTeamProfile (real live capture)", () => {
  const team = parseTeamProfile(realFixture);

  it("reads the team name from the Team Profile box", () => {
    expect(team.teamName).toBe("For Funzies");
  });

  it("parses the roster, deduping repeated responsive-layout rows", () => {
    expect(team.players.map((p) => p.name)).toEqual([
      "Julie Martin",
      "Angela Wang",
    ]);
  });

  it("parses NTRP, record, and dynamic rating from real markup", () => {
    const julie = team.players[0];
    expect(julie.ntrpRating).toBe(3.0);
    expect(julie.recordRaw).toBe("5-7");
    expect(julie.dynamicRating).toBeCloseTo(2.97, 2);
    expect(julie.sourcePlayerUrl).toContain("playername=Julie Martin");

    const angela = team.players[1];
    expect(angela.ntrpRating).toBe(3.0);
    expect(angela.recordRaw).toBe("7-5");
    expect(angela.dynamicRating).toBeCloseTo(2.85, 2);
  });
});

describe("parseSearchResults (real live capture)", () => {
  const results = parseSearchResults(searchFixture);

  it("extracts every result row with its disambiguation columns", () => {
    expect(results).toHaveLength(14);
    const first = results[0];
    expect(first.name).toBe("AYTC-Slice Girls Don't Blink-Thompson");
    expect(first.leagueType).toBe("Adult 18+");
    expect(first.section).toBe("Pacific NW");
    expect(first.gender).toBe("F");
    expect(first.ntrp).toBe(3.5);
  });

  it("disambiguates same-named teams via the &s= team key", () => {
    const sliceGirls = results.filter((r) => r.name === "Slice Girls");
    expect(sliceGirls.length).toBeGreaterThan(1);
    // Every same-named row resolves to a distinct, re-fetchable team key.
    const keys = sliceGirls.map((r) => r.teamKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("teamname=slice girls&year=2026&s=29");
    const s37 = sliceGirls.find((r) => r.teamKey.endsWith("&s=37"));
    expect(s37?.ntrp).toBe(2.5); // level still distinguishes some of them
  });

  it("round-trips %27/space-encoded hrefs into a clean team URL + key", () => {
    const apos = results.find((r) => r.name.includes("Don't"));
    expect(apos?.teamKey).toBe(
      "teamname=aytc-slice girls don't blink-thompson&year=2026",
    );
    expect(apos?.teamUrl).toContain("/adult/teamprofile.aspx?");
    // The canonical URL must be a valid, parseable URL (no raw spaces).
    expect(() => new URL(apos!.teamUrl)).not.toThrow();
  });

  it("dedupes to distinct team keys across all results", () => {
    const keys = results.map((r) => r.teamKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns [] for a 'No Teams Found' page", () => {
    expect(parseSearchResults(searchEmptyFixture)).toEqual([]);
  });
});
