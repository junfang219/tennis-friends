// Reconcile an imported USTA roster against the team's current members.
//
// When a captain imports a USTA team, the roster names need to be matched to
// existing members (exact, or different-spelling), or added as new placeholder
// rows. This module is the pure, testable core of that decision — the UI in
// FindUstaTeam renders the result and lets the captain override each row.

/** Trim, lowercase, collapse internal whitespace — for case/space-insensitive
 *  name comparison. (Same shape as the dedupe key in tennisrecord/importPlan.) */
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface RosterMember {
  memberId: string;
  name: string;
}

export type Disposition =
  | { action: "add" }
  | { action: "skip" }
  | { action: "map"; memberId: string };

// Classic iterative Levenshtein edit distance. Small rosters, so the O(n*m)
// allocation is fine; kept dependency-free (no fuzzy-match lib in the project).
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Members ordered by name similarity to `name` (closest first), so a
 *  different-spelling member surfaces at the top of a row's dropdown without
 *  being silently auto-mapped. Ties keep the original order (stable). */
export function rankMembersFor(
  name: string,
  members: RosterMember[],
): RosterMember[] {
  const target = normalizeName(name);
  return members
    .map((m, i) => ({ m, i, d: levenshtein(target, normalizeName(m.name)) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .map((e) => e.m);
}

/**
 * Default disposition per imported roster name:
 * - exact normalized match to a member → map to that member (nothing created);
 * - otherwise → add (create a new placeholder row). This is the confirmed
 *   default; the captain can still switch any row to map/skip in the UI.
 */
export function planRosterReconciliation(
  playerNames: string[],
  members: RosterMember[],
): Disposition[] {
  return playerNames.map((name) => {
    const target = normalizeName(name);
    const exact = members.find((m) => normalizeName(m.name) === target);
    return exact
      ? ({ action: "map", memberId: exact.memberId } as const)
      : ({ action: "add" } as const);
  });
}
