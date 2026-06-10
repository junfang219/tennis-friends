import { describe, it, expect } from "vitest";
import { planScheduleImport, hrefTeamKey } from "./importPlan";

const SLICE_HREF = "/adult/teamprofile.aspx?teamname=Slice Girls&year=2026&s=36";
const SLICE_KEY = "teamname=slice girls&year=2026&s=36";

const candidates = [
  { dateISO: "2026-06-01", time: null, opponentName: "Slice Girls", opponentHref: SLICE_HREF },
  { dateISO: "2026-06-08", time: "18:30", opponentName: "Barrios-Woods", opponentHref: "/adult/teamprofile.aspx?teamname=Barrios-Woods&year=2026" },
];

describe("hrefTeamKey", () => {
  it("normalizes relative hrefs to the scouting team key", () => {
    expect(hrefTeamKey(SLICE_HREF)).toBe(SLICE_KEY);
  });

  it("returns '' for missing or junk hrefs", () => {
    expect(hrefTeamKey(undefined)).toBe("");
    expect(hrefTeamKey("/adult/league.aspx?x=1")).toBe("");
  });
});

describe("planScheduleImport", () => {
  it("imports new matches with FK links and TBA times as ''", () => {
    const teamIds = new Map([[SLICE_KEY, "team-slice"]]);
    const { rows, skipped } = planScheduleImport(candidates, [], teamIds);
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      { match_date: "2026-06-01", match_time: "", opponent: "Slice Girls", opponent_team_id: "team-slice", location: "" },
      { match_date: "2026-06-08", match_time: "18:30", opponent: "Barrios-Woods", opponent_team_id: null, location: "" },
    ]);
  });

  it("carries a real matchSite into location but drops 'TBA'", () => {
    const withSites = [
      { ...candidates[0], matchSite: "Amy Yee Tennis Center" },
      { ...candidates[1], matchSite: "TBA" },
    ];
    const { rows } = planScheduleImport(withSites, [], new Map());
    expect(rows.map((r) => r.location)).toEqual([
      "Amy Yee Tennis Center",
      "",
    ]);
  });

  it("is idempotent: a re-import of already-imported rows skips everything", () => {
    const teamIds = new Map([[SLICE_KEY, "team-slice"]]);
    const first = planScheduleImport(candidates, [], teamIds);
    const second = planScheduleImport(
      candidates,
      first.rows.map((r) => ({
        match_date: r.match_date,
        opponent: r.opponent,
        opponent_team_id: r.opponent_team_id,
      })),
      teamIds,
    );
    expect(second.rows).toEqual([]);
    expect(second.skipped).toBe(2);
  });

  it("never clobbers a captain-entered match (normalized name match)", () => {
    const existing = [
      { match_date: "2026-06-01", opponent: "  slice  GIRLS ", opponent_team_id: null },
    ];
    const { rows, skipped } = planScheduleImport(candidates, existing, new Map());
    expect(skipped).toBe(1);
    expect(rows.map((r) => r.opponent)).toEqual(["Barrios-Woods"]);
  });

  it("skips by linked id even when the captain renamed the opponent", () => {
    const teamIds = new Map([[SLICE_KEY, "team-slice"]]);
    const existing = [
      { match_date: "2026-06-01", opponent: "SG (rivals!)", opponent_team_id: "team-slice" },
    ];
    const { rows } = planScheduleImport(candidates, existing, teamIds);
    expect(rows.map((r) => r.opponent)).toEqual(["Barrios-Woods"]);
  });

  it("dedupes duplicates inside one request", () => {
    const { rows, skipped } = planScheduleImport(
      [...candidates, ...candidates],
      [],
      new Map(),
    );
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(2);
  });

  it("treats the same opponent on different dates as distinct (double round-robin)", () => {
    const twice = [
      candidates[0],
      { ...candidates[0], dateISO: "2026-07-20" },
    ];
    const { rows, skipped } = planScheduleImport(twice, [], new Map());
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
  });
});
