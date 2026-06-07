import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTeamUrl, parseTeamProfile } from "./parse";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "teamprofile.html"),
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
