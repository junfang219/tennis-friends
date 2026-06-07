// TennisRecord team-profile parsing — pure, no network, no DOM.
//
// tennisrecord.com is plain server-rendered HTML, so we parse it with
// string/regex scanning (Node has no DOM and AGENTS.md forbids adding a
// heavyweight HTML parser for this). Everything here is deterministic and
// unit-tested against a saved fixture (./__fixtures__/teamprofile.html), so
// the parser can evolve independently of the (untestable-in-CI) live fetch.
//
// IMPORTANT FOR MAINTAINERS: the fixture is a representative sample of the
// roster-table shape, not a guaranteed-current capture. If tennisrecord
// changes its markup, re-save a real team page into the fixture and adjust
// the row/field heuristics below — the tests will guide you.

export type ParsedPlayer = {
  name: string;
  sourcePlayerUrl: string;
  recordRaw: string;          // e.g. "12-3" ("" if not found)
  wins: number;
  losses: number;
  ntrpRating: number | null;  // published/computed NTRP, e.g. 4.0
  dynamicRating: number | null; // tennisrecord dynamic rating, e.g. 4.123
};

export type ParsedTeam = {
  teamName: string;
  players: ParsedPlayer[];
};

export type ParsedTeamUrl = {
  // Stable identifier for this tennisrecord team, used as the DB upsert key
  // (opponent_teams.source_team_key). Normalized so the same team pasted in
  // different casings dedupes.
  teamKey: string;
  // Canonical querystring to append to teamprofile.aspx to re-fetch the page.
  query: string;
  // Team name when the URL carries it (teamname= links) — display fallback.
  teamName?: string;
};

// Accept a full tennisrecord team URL or a bare team key. Real team links
// look like …/adult/teamprofile.aspx?teamname=For%20Funzies&year=2026; older
// /numeric forms use …?team=<key>. Returns null if the input isn't usable.
export function parseTeamUrl(input: string): ParsedTeamUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare key: digits, optionally with a leading "team=" stripped by the user.
  if (/^\d{2,}$/.test(trimmed)) {
    return {
      teamKey: `team=${trimmed}`,
      query: `team=${encodeURIComponent(trimmed)}`,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/(^|\.)tennisrecord\.com$/i.test(url.hostname)) return null;

  // Query params are case-insensitive in practice; check common spellings.
  let team = "";
  let teamName = "";
  let year = "";
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (k === "team" && value.trim()) team = value.trim();
    if (k === "teamname" && value.trim()) teamName = value.trim();
    if (k === "year" && /^\d{4}$/.test(value.trim())) year = value.trim();
  }

  if (team) {
    return { teamKey: `team=${team}`, query: `team=${encodeURIComponent(team)}` };
  }
  if (teamName) {
    const query =
      `teamname=${encodeURIComponent(teamName)}` + (year ? `&year=${year}` : "");
    return {
      teamKey: `teamname=${teamName.toLowerCase()}${year ? `&year=${year}` : ""}`,
      query,
      teamName,
    };
  }
  return null;
}

const TAG_RE = /<[^>]+>/g;
// Live pages link players as /adult/profile.aspx?playername=…; some older
// markup used "playerprofile". Either marks a roster row. (teamprofile.aspx
// schedule links never carry playername=, so they don't false-positive.)
const PLAYER_HREF_RE =
  /href\s*=\s*["']([^"']*(?:playerprofile|playername=)[^"']*)["']/i;
const RECORD_RE = /\b(\d{1,3})\s*-\s*(\d{1,3})\b/;
// Ratings look like 4 or 4.0 or 4.123. Capture the numeric tokens; classify
// by decimal precision: >=2 decimals → dynamic rating, exactly the NTRP grid
// (X.0 / X.5, 1.0–7.0) → NTRP. Anything else is ignored.
const FLOAT_RE = /\b(\d\.\d{1,4})\b/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(TAG_RE, " ")).replace(/\s+/g, " ").trim();
}

function classifyRatings(cellTexts: string[]): {
  ntrp: number | null;
  dynamic: number | null;
} {
  let ntrp: number | null = null;
  let dynamic: number | null = null;
  for (const text of cellTexts) {
    let m: RegExpExecArray | null;
    FLOAT_RE.lastIndex = 0;
    while ((m = FLOAT_RE.exec(text)) !== null) {
      const raw = m[1];
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      const decimals = raw.split(".")[1]?.length ?? 0;
      if (decimals >= 2) {
        // Highest-precision number on the row is the dynamic rating.
        if (dynamic === null) dynamic = value;
      } else if (
        ntrp === null &&
        value >= 1 &&
        value <= 7 &&
        (Math.abs((value * 10) % 5) < 1e-9) // X.0 or X.5
      ) {
        ntrp = value;
      }
    }
  }
  return { ntrp, dynamic };
}

function extractTeamName(html: string): string {
  // Live pages have no team-name heading and a generic <title>; the name is
  // the last plain-text row of the "Team Profile" box (flight / league link /
  // team name). Scan the chunk after the "Team Profile" label for td texts
  // and take the last one that isn't a link row.
  const profileIdx = html.search(/>\s*Team Profile\s*</i);
  if (profileIdx !== -1) {
    // The label sits in its own table; the box's rows are in the next table.
    // Slice up to the SECOND </table> so we never leak into the roster table.
    const parts = html.slice(profileIdx, profileIdx + 8000).split(/<\/table>/i);
    const chunk = parts.slice(0, 2).join("</table>");
    let last = "";
    for (const cell of chunk.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
      if (/<a\b/i.test(cell[1])) continue; // league/flight link rows
      const text = stripTags(cell[1]);
      if (text && !/^team profile$/i.test(text)) last = text;
    }
    if (last) return last;
  }

  // Fallbacks: first heading, then <title> (ignore the generic site title).
  const heading = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
  if (heading) {
    const text = stripTags(heading[1]);
    if (text) return text;
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) {
    const text = stripTags(title[1]).replace(/\s*[-|]\s*TennisRecord.*$/i, "");
    if (text && !/^TennisRecord\.com/i.test(text)) return text;
  }
  return "";
}

// Parse a team-profile page into a team name + roster. Defensive: rows that
// don't contain a player link are skipped; missing record/ratings just leave
// the corresponding fields empty/null rather than dropping the player.
export function parseTeamProfile(html: string): ParsedTeam {
  const teamName = extractTeamName(html);
  const players: ParsedPlayer[] = [];
  const seen = new Set<string>();

  const rowRe = /<tr\b[\s\S]*?<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[0];
    const hrefMatch = PLAYER_HREF_RE.exec(row);
    if (!hrefMatch) continue;

    const cells = [...row.matchAll(/<td\b[\s\S]*?<\/td>/gi)].map((c) =>
      stripTags(c[0]),
    );
    if (cells.length === 0) continue;

    // The player name is the text of the player-profile anchor.
    const anchorRe =
      /<a\b[^>]*(?:playerprofile|playername=)[^>]*>([\s\S]*?)<\/a>/i;
    const anchorMatch = anchorRe.exec(row);
    const name = anchorMatch ? stripTags(anchorMatch[1]) : "";
    if (!name) continue;

    const sourcePlayerUrl = decodeEntities(hrefMatch[1]);
    const dedupeKey = `${name}|${sourcePlayerUrl}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rowText = cells.join(" ");
    const recordMatch = RECORD_RE.exec(rowText);
    const wins = recordMatch ? Number(recordMatch[1]) : 0;
    const losses = recordMatch ? Number(recordMatch[2]) : 0;
    const recordRaw = recordMatch ? `${wins}-${losses}` : "";

    const { ntrp, dynamic } = classifyRatings(cells);

    players.push({
      name,
      sourcePlayerUrl,
      recordRaw,
      wins,
      losses,
      ntrpRating: ntrp,
      dynamicRating: dynamic,
    });
  }

  return { teamName, players };
}
