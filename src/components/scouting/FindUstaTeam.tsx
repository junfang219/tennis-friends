"use client";

import { useEffect, useRef, useState } from "react";
import {
  searchTeams,
  previewTeam,
  scoutLeague,
  importSchedule,
  type TeamSearchResult,
  type TeamPreview,
} from "@/lib/supabase/queries/scouting";
import {
  SEARCH_YEARS,
  SEARCH_SECTIONS,
  SEARCH_LEAGUE_TYPES,
  DEFAULT_SECTION,
  DEFAULT_YEAR,
} from "@/lib/tennisrecord/searchOptions";
import { errorMessage } from "@/lib/errorMessage";

// "Find your USTA team" — searches tennisrecord by name + filters so a captain
// picks their exact team (disambiguating same-named teams by level/section and,
// finally, by roster) and imports its league schedule into the team's matches.
// Reused on the Scouting page and right after a USTA team is created.

function genderLabel(g: string): string {
  if (g === "F") return "Women";
  if (g === "M") return "Men";
  if (g === "X") return "Mixed";
  return g;
}

function describeResult(r: TeamSearchResult): string {
  const bits = [
    r.ntrp != null ? `NTRP ${r.ntrp.toFixed(1)}` : "",
    genderLabel(r.gender),
    r.leagueType,
  ].filter(Boolean);
  return bits.join(" · ");
}

function rating(p: TeamPreview["players"][number]): string {
  if (p.dynamicRating != null) return p.dynamicRating.toFixed(2);
  if (p.ntrpRating != null) return p.ntrpRating.toFixed(1);
  return "—";
}

export default function FindUstaTeam({
  groupId,
  defaultSection = DEFAULT_SECTION,
  onImported,
}: {
  groupId: string;
  defaultSection?: string;
  onImported?: (summary: {
    teamName: string;
    imported: number;
    skipped: number;
  }) => void;
}) {
  const [teamName, setTeamName] = useState("");
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [section, setSection] = useState(defaultSection);
  const [leagueType, setLeagueType] = useState("");

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TeamSearchResult[] | null>(null);
  const [error, setError] = useState("");

  // Selected candidate + its roster/schedule preview (confirmation step).
  const [selected, setSelected] = useState<TeamSearchResult | null>(null);
  const [preview, setPreview] = useState<TeamPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [importing, setImporting] = useState(false);
  // Import is one long server call (~30s), so we can't read true progress —
  // trickle a bar toward ~95% so it visibly moves, then snap to 100% on finish.
  const [progress, setProgress] = useState(0);
  const [importStage, setImportStage] = useState("");
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(
    null,
  );

  const stopTrickle = () => {
    if (trickleRef.current) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
  };
  // Clear the timer if the component unmounts mid-import.
  useEffect(() => stopTrickle, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || searching) return;
    setSearching(true);
    setError("");
    setResults(null);
    setSelected(null);
    setPreview(null);
    setDone(null);
    try {
      const rows = await searchTeams(groupId, {
        teamName: teamName.trim(),
        year,
        section,
        leagueType,
      });
      setResults(rows);
    } catch (err) {
      setError(errorMessage(err, "Could not search tennisrecord."));
    }
    setSearching(false);
  }

  async function handleSelect(r: TeamSearchResult) {
    setSelected(r);
    setPreview(null);
    setPreviewing(true);
    setError("");
    setDone(null);
    try {
      setPreview(await previewTeam(groupId, r.teamUrl));
    } catch (err) {
      setError(errorMessage(err, "Could not load that team."));
      setSelected(null);
    }
    setPreviewing(false);
  }

  async function handleImport() {
    if (!selected || !preview || importing) return;
    setImporting(true);
    setError("");
    setProgress(6);
    setImportStage("Finding your team and scouting opponents…");
    // Ease toward 95% over ~30s — bigger steps early, smaller as it fills.
    trickleRef.current = setInterval(() => {
      setProgress((p) => (p >= 95 ? 95 : p + Math.max(0.5, (95 - p) * 0.045)));
    }, 500);
    try {
      // Commit: mark this as the team's own league entry + scout opponents,
      // then insert the schedule rows (insert-only / idempotent).
      const league = await scoutLeague(groupId, { url: selected.teamUrl });
      setProgress((p) => Math.max(p, 92));
      setImportStage("Adding matches to your calendar…");
      const sched = league.schedule.length ? league.schedule : preview.schedule;
      const { imported, skipped } = await importSchedule(groupId, sched);
      stopTrickle();
      setProgress(100);
      setDone({ imported, skipped });
      onImported?.({
        teamName: preview.teamName || selected.name,
        imported,
        skipped,
      });
    } catch (err) {
      setError(errorMessage(err, "Could not import the schedule."));
      setProgress(0);
      setImportStage("");
    }
    stopTrickle();
    setImporting(false);
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="rounded-xl border border-court-green-pale/40 bg-court-green-pale/10 p-4">
        <div className="font-semibold text-court-green">
          Imported {done.imported} match{done.imported === 1 ? "" : "es"}
          {done.skipped > 0 ? ` · ${done.skipped} already on the calendar` : ""}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Find them on the Availability tab — edit times, locations or home/away
          there as needed.
        </p>
      </div>
    );
  }

  // ── Confirmation (roster + schedule) ────────────────────────────────────────
  if (selected) {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-500">
              Is this your team?
            </div>
            <div className="font-display text-base font-bold text-gray-900 truncate">
              {preview?.teamName || selected.name}
            </div>
            <div className="text-xs text-gray-500">{describeResult(selected)}</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setPreview(null);
              setError("");
            }}
            className="btn-ghost btn-sm shrink-0"
          >
            Back
          </button>
        </div>

        {previewing ? (
          <div className="skeleton w-full h-24 mt-3" />
        ) : preview ? (
          <div className="mt-3">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
              Roster — confirm you recognize these players
            </div>
            {preview.players.length === 0 ? (
              <p className="text-sm text-gray-500">No roster found on this team page.</p>
            ) : (
              <ul className="text-sm divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {preview.players.map((p) => (
                  <li
                    key={`${p.name}-${p.recordRaw}`}
                    className="py-1.5 flex items-center justify-between gap-2"
                  >
                    <span className="text-gray-900 truncate">{p.name}</span>
                    <span className="text-gray-500 tabular-nums shrink-0">
                      {p.recordRaw || "—"} · {rating(p)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 text-xs text-gray-500">
              {preview.schedule.length > 0
                ? `${preview.schedule.length} scheduled match${preview.schedule.length === 1 ? "" : "es"} found.`
                : "No league schedule found on this team's page."}
            </div>

            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || preview.schedule.length === 0}
                className="btn-primary btn-sm"
              >
                {importing
                  ? "Importing…"
                  : `Import ${preview.schedule.length} match${preview.schedule.length === 1 ? "" : "es"}`}
              </button>
              <a
                href={selected.teamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost btn-sm"
              >
                View on TennisRecord
              </a>
            </div>
            {importing && (
              <div className="mt-3" role="status" aria-live="polite">
                <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-court-green transition-[width] duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  {importStage} <span className="text-gray-400">~30 seconds</span>
                </p>
              </div>
            )}
          </div>
        ) : (
          error && <p className="text-sm text-red-600 mt-3">{error}</p>
        )}
      </div>
    );
  }

  // ── Search form + results ───────────────────────────────────────────────────
  return (
    <div>
      <form onSubmit={handleSearch} className="space-y-2.5">
        <div>
          <label
            htmlFor="usta-teamname"
            className="block text-xs font-semibold text-gray-600 mb-1"
          >
            Find your USTA team
          </label>
          <input
            id="usta-teamname"
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Your team name (e.g. Slice Girls)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-court-green-soft"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            aria-label="Section"
            className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="">All sections</option>
            {SEARCH_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={leagueType}
            onChange={(e) => setLeagueType(e.target.value)}
            aria-label="League type"
            className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {SEARCH_LEAGUE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            aria-label="Year"
            className="px-2 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            {SEARCH_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={searching || !teamName.trim()}
          className="btn-primary btn-sm w-full"
        >
          {searching ? "Searching…" : "Search"}
        </button>
        <p className="text-[11px] text-gray-400">
          We search TennisRecord (public USTA league data) — no USTA login
          needed. Narrow by section and league to find the right team.
        </p>
      </form>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {results && (
        <div className="mt-3">
          {results.length === 0 ? (
            <p className="text-sm text-gray-500">
              No teams matched. Try a shorter name or change the section/league
              filters.
            </p>
          ) : (
            <>
              <div className="text-[11px] text-gray-400 mb-1">
                {results.length} team{results.length === 1 ? "" : "s"} found —
                pick yours (confirm by roster next):
              </div>
              <ul className="space-y-1.5 max-h-80 overflow-y-auto">
                {results.map((r) => (
                  <li key={r.teamKey}>
                    <button
                      type="button"
                      onClick={() => handleSelect(r)}
                      className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 hover:border-court-green-soft"
                    >
                      <div className="font-semibold text-gray-900 text-sm truncate">
                        {r.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {describeResult(r)}
                        {r.section ? ` · ${r.section}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
