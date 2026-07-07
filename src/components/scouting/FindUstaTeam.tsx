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
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { addRosterPlaceholders } from "@/lib/supabase/queries";
import { linkRosterPlaceholder, type PlaceholderLink } from "@/lib/supabase/queries/guestRsvp";
import { listFriends, type FriendProfile } from "@/lib/supabase/queries/friends";
import {
  planRosterReconciliation,
  rankMembersFor,
  normalizeName,
  levenshtein,
  type RosterMember,
  type Disposition,
} from "@/lib/rosterMatch";

// Pre-select a friend for an imported name only when the closest friend name is
// this near (edit distance) — tight enough to avoid false auto-links.
const LINK_SUGGEST_MAX_DISTANCE = 2;

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
  teamMembers,
}: {
  groupId: string;
  defaultSection?: string;
  onImported?: (summary: {
    teamName: string;
    imported: number;
    skipped: number;
  }) => void;
  // When provided (Availability page), the roster step lets the captain map
  // each imported player to an existing member or add them as a new row.
  // Omitted (Scouting page) → roster reconciliation UI is hidden.
  teamMembers?: RosterMember[];
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
  const [done, setDone] = useState<{
    imported: number;
    skipped: number;
    added: number;
  } | null>(null);

  // Roster reconciliation (only active when `teamMembers` is provided). One
  // disposition per preview.players row; the captain can override each.
  const reconcileEnabled = !!teamMembers;
  const [dispositions, setDispositions] = useState<Disposition[]>([]);

  // Post-import "link teammates to friends" step. After placeholders are
  // created we look up the captain's friends, pre-match by name, and let them
  // confirm which imported names map to a real account (so those teammates can
  // RSVP in-app instead of via a shared link).
  const [created, setCreated] = useState<PlaceholderLink[]>([]);
  const [linkFriends, setLinkFriends] = useState<FriendProfile[] | null>(null);
  // placeholder id → chosen friend id ("" = don't link). Only holds rows that
  // had a close-enough suggestion; other created placeholders stay as-is.
  const [linkChoices, setLinkChoices] = useState<Record<string, string>>({});
  const [linkStepOpen, setLinkStepOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkedCount, setLinkedCount] = useState<number | null>(null);
  const [linkError, setLinkError] = useState("");

  // Friends ranked by name similarity to `name` (closest first).
  const rankedFriends = (name: string, pool: FriendProfile[]): FriendProfile[] => {
    const byId = new Map(pool.map((f) => [f.id, f]));
    return rankMembersFor(name, pool.map((f) => ({ memberId: f.id, name: f.name })))
      .map((r) => byId.get(r.memberId)!)
      .filter(Boolean);
  };

  // Load friends and pre-select close name matches for the created placeholders.
  const loadFriendSuggestions = async (placeholders: PlaceholderLink[]) => {
    try {
      const supabase = createSupabaseBrowserClient();
      const all = await listFriends(supabase);
      // Skip friends already on the team (matched by name — no user id here).
      const memberNames = new Set((teamMembers ?? []).map((m) => normalizeName(m.name)));
      const eligible = all.filter((f) => !memberNames.has(normalizeName(f.name)));
      setLinkFriends(eligible);
      if (!eligible.length) return;
      const choices: Record<string, string> = {};
      for (const ph of placeholders) {
        const top = rankedFriends(ph.name, eligible)[0];
        if (top && levenshtein(normalizeName(ph.name), normalizeName(top.name)) <= LINK_SUGGEST_MAX_DISTANCE) {
          choices[ph.id] = top.id;
        }
      }
      if (Object.keys(choices).length) {
        setLinkChoices(choices);
        setLinkStepOpen(true);
      }
    } catch {
      // Non-fatal: the import already succeeded — just skip the link step.
    }
  };

  const doLinks = async () => {
    if (linking) return;
    setLinking(true);
    setLinkError("");
    const supabase = createSupabaseBrowserClient();
    let n = 0;
    try {
      for (const [memberId, friendId] of Object.entries(linkChoices)) {
        if (!friendId) continue;
        await linkRosterPlaceholder(supabase, memberId, friendId);
        n += 1;
      }
      setLinkedCount(n);
      setLinkStepOpen(false);
      onImported?.({ teamName: "", imported: 0, skipped: 0 });
    } catch (e) {
      setLinkError(errorMessage(e, "Could not link some teammates."));
    }
    setLinking(false);
  };

  const addCount = dispositions.filter((d) => d.action === "add").length;

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
    setDispositions([]);
    setPreviewing(true);
    setError("");
    setDone(null);
    try {
      const p = await previewTeam(groupId, r.teamUrl);
      setPreview(p);
      // Seed each roster row's default action: exact name match → map to that
      // member; otherwise → add (the captain can override per row).
      if (teamMembers) {
        setDispositions(
          planRosterReconciliation(
            p.players.map((pl) => pl.name),
            teamMembers,
          ),
        );
      }
    } catch (err) {
      setError(errorMessage(err, "Could not load that team."));
      setSelected(null);
    }
    setPreviewing(false);
  }

  function setRowDisposition(index: number, next: Disposition) {
    setDispositions((prev) => {
      const copy = prev.slice();
      copy[index] = next;
      return copy;
    });
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

      // Add roster players the captain chose to bring on as new rows. Matched
      // ("map") and "skip" rows create nothing. Placeholders are match-scoped so
      // they appear only on the matches matrix. Invite links aren't surfaced here
      // — the captain may still tweak the roster; they send links later from the
      // Invite button.
      let added = 0;
      let createdPlaceholders: PlaceholderLink[] = [];
      if (reconcileEnabled) {
        const namesToAdd = preview.players
          .map((p, i) => ({ name: p.name.trim(), d: dispositions[i] }))
          .filter((x) => x.name && x.d?.action === "add")
          .map((x) => ({ name: x.name }));
        if (namesToAdd.length) {
          setImportStage("Adding players to your roster…");
          createdPlaceholders = await addRosterPlaceholders(
            createSupabaseBrowserClient(),
            groupId,
            namesToAdd,
            "match",
          );
          added = namesToAdd.length;
        }
      }

      stopTrickle();
      setProgress(100);
      setDone({ imported, skipped, added });
      onImported?.({
        teamName: preview.teamName || selected.name,
        imported,
        skipped,
      });
      // Offer to link the newly-added names to existing friends' accounts.
      if (createdPlaceholders.length) {
        setCreated(createdPlaceholders);
        void loadFriendSuggestions(createdPlaceholders);
      }
    } catch (err) {
      setError(errorMessage(err, "Could not import the schedule."));
      setProgress(0);
      setImportStage("");
    }
    stopTrickle();
    setImporting(false);
  }

  // ── Link teammates to friends (post-import) ─────────────────────────────────
  if (done && linkStepOpen) {
    const rows = created.filter((ph) => ph.id in linkChoices);
    const pool = linkFriends ?? [];
    const chosenCount = Object.values(linkChoices).filter(Boolean).length;
    return (
      <div className="rounded-xl border border-court-green-pale/40 bg-court-green-pale/10 p-4">
        <div className="font-semibold text-court-green">Link teammates to their accounts</div>
        <p className="text-xs text-gray-500 mt-1">
          These imported names match your friends. Link them so they can RSVP in
          the app — the rest keep their share links.
        </p>
        <ul className="mt-3 divide-y divide-court-green-pale/30">
          {rows.map((ph) => (
            <li key={ph.id} className="py-2 flex items-center justify-between gap-2">
              <span className="text-sm text-gray-900 truncate">{ph.name}</span>
              <select
                aria-label={`Link ${ph.name} to a friend`}
                value={linkChoices[ph.id] ?? ""}
                onChange={(e) =>
                  setLinkChoices((prev) => ({ ...prev, [ph.id]: e.target.value }))
                }
                className="shrink-0 max-w-[11rem] px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white"
              >
                <option value="">Don&apos;t link</option>
                {rankedFriends(ph.name, pool).map((f) => (
                  <option key={f.id} value={f.id}>
                    Link: {f.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {linkError && <p className="text-sm text-red-600 mt-2">{linkError}</p>}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={doLinks}
            disabled={linking || chosenCount === 0}
            className="btn-primary btn-sm"
          >
            {linking ? "Linking…" : `Link ${chosenCount} teammate${chosenCount === 1 ? "" : "s"}`}
          </button>
          <button
            type="button"
            onClick={() => setLinkStepOpen(false)}
            disabled={linking}
            className="btn-ghost btn-sm"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="rounded-xl border border-court-green-pale/40 bg-court-green-pale/10 p-4">
        <div className="font-semibold text-court-green">
          Imported {done.imported} match{done.imported === 1 ? "" : "es"}
          {done.skipped > 0 ? ` · ${done.skipped} already on the calendar` : ""}
          {done.added > 0
            ? ` · added ${done.added} player${done.added === 1 ? "" : "s"}`
            : ""}
          {linkedCount != null && linkedCount > 0
            ? ` · linked ${linkedCount} to accounts`
            : ""}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Find them on the Availability tab — edit times, locations or home/away
          there as needed.
        </p>
        {done.added > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Send each added player their RSVP link anytime from the Invite button.
          </p>
        )}
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
              {reconcileEnabled
                ? "Roster — add each player to your team or map to a member"
                : "Roster — confirm you recognize these players"}
            </div>
            {preview.players.length === 0 ? (
              <p className="text-sm text-gray-500">No roster found on this team page.</p>
            ) : (
              <ul className="text-sm divide-y divide-gray-100 max-h-60 overflow-y-auto">
                {preview.players.map((p, i) => {
                  if (!reconcileEnabled || !teamMembers) {
                    return (
                      <li
                        key={`${p.name}-${p.recordRaw}`}
                        className="py-1.5 flex items-center justify-between gap-2"
                      >
                        <span className="text-gray-900 truncate">{p.name}</span>
                        <span className="text-gray-500 tabular-nums shrink-0">
                          {p.recordRaw || "—"} · {rating(p)}
                        </span>
                      </li>
                    );
                  }
                  const d = dispositions[i];
                  const value =
                    d?.action === "map" ? d.memberId : (d?.action ?? "add");
                  return (
                    <li
                      key={`${p.name}-${p.recordRaw}`}
                      className="py-1.5 flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-gray-900 truncate">{p.name}</div>
                        <div className="text-[11px] text-gray-500 tabular-nums">
                          {p.recordRaw || "—"} · {rating(p)}
                        </div>
                      </div>
                      <select
                        aria-label={`What to do with ${p.name}`}
                        value={value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRowDisposition(
                            i,
                            v === "add"
                              ? { action: "add" }
                              : v === "skip"
                                ? { action: "skip" }
                                : { action: "map", memberId: v },
                          );
                        }}
                        className="shrink-0 max-w-[9.5rem] px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white"
                      >
                        <option value="add">Add as new player</option>
                        <option value="skip">Skip</option>
                        {rankMembersFor(p.name, teamMembers).map((m) => (
                          <option key={m.memberId} value={m.memberId}>
                            On team: {m.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
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
                  : reconcileEnabled && addCount > 0
                    ? `Import ${preview.schedule.length} match${preview.schedule.length === 1 ? "" : "es"} & ${addCount} player${addCount === 1 ? "" : "s"}`
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
