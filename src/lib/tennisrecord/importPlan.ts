import { parseTeamUrl } from "./parse";

// Pure planning step for the schedule-import route: decide which scouted
// schedule rows become new team_matches and which are skipped because the
// captain (or a previous import) already has that match. Insert-only by
// design — existing rows are never updated.

export type ImportCandidate = {
  dateISO: string; // YYYY-MM-DD
  time?: string | null; // 24h HH:MM, or null/absent for TBA
  opponentName: string;
  opponentHref?: string;
  matchSite?: string; // venue from tennisrecord; "TBA"/"" → blank location
};

export type ExistingMatch = {
  match_date: string;
  opponent: string;
  opponent_team_id: string | null;
};

export type PlannedRow = {
  match_date: string;
  match_time: string;
  opponent: string;
  opponent_team_id: string | null;
  location: string;
};

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// tennisrecord uses "TBA" for an undecided venue — not a real location.
const cleanSite = (site: string | undefined) => {
  const s = (site ?? "").trim();
  return /^tba$/i.test(s) ? "" : s;
};

// Resolve an opponent href to its normalized tennisrecord team key ("" if
// unusable) — the same key opponent_teams.source_team_key stores.
export function hrefTeamKey(href: string | undefined): string {
  if (!href) return "";
  const url = href.startsWith("http")
    ? href
    : `https://www.tennisrecord.com${href}`;
  return parseTeamUrl(url)?.teamKey ?? "";
}

export function planScheduleImport(
  candidates: ImportCandidate[],
  existing: ExistingMatch[],
  teamIdByKey: Map<string, string>,
): { rows: PlannedRow[]; skipped: number } {
  // A match "exists" when the same date already has the same opponent —
  // matched by linked scouting id or by normalized free-text name.
  const existingKeys = new Set<string>();
  for (const m of existing) {
    if (m.opponent_team_id) {
      existingKeys.add(`${m.match_date}|id:${m.opponent_team_id}`);
    }
    if (m.opponent) {
      existingKeys.add(`${m.match_date}|name:${normalizeName(m.opponent)}`);
    }
  }

  const rows: PlannedRow[] = [];
  let skipped = 0;
  const batchKeys = new Set<string>(); // dedupe within the request too
  for (const candidate of candidates) {
    const teamKey = hrefTeamKey(candidate.opponentHref);
    const opponentTeamId = teamKey ? (teamIdByKey.get(teamKey) ?? null) : null;

    const idKey = opponentTeamId
      ? `${candidate.dateISO}|id:${opponentTeamId}`
      : null;
    const nameKey = `${candidate.dateISO}|name:${normalizeName(candidate.opponentName)}`;
    if (
      (idKey && (existingKeys.has(idKey) || batchKeys.has(idKey))) ||
      existingKeys.has(nameKey) ||
      batchKeys.has(nameKey)
    ) {
      skipped += 1;
      continue;
    }
    if (idKey) batchKeys.add(idKey);
    batchKeys.add(nameKey);

    rows.push({
      match_date: candidate.dateISO,
      match_time: candidate.time ?? "",
      opponent: candidate.opponentName,
      opponent_team_id: opponentTeamId,
      location: cleanSite(candidate.matchSite),
    });
  }

  return { rows, skipped };
}
