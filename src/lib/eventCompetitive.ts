import type { EventMatch } from "@prisma/client";

export type StandingsRow = {
  userId: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  rank: number;
};

// Parse a score string like "6-4,3-6,7-5" into per-set [side1Games, side2Games].
export function parseScore(score: string): Array<[number, number]> {
  if (!score) return [];
  return score
    .split(/[,;]/)
    .map((set) => set.trim())
    .filter(Boolean)
    .map((set) => {
      const m = set.match(/^(\d+)\s*[-:/]\s*(\d+)/);
      if (!m) return null;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (isNaN(a) || isNaN(b)) return null;
      return [a, b] as [number, number];
    })
    .filter((s): s is [number, number] => s != null);
}

// Validate a singles tennis score: each set 6–7 games with valid margins, no
// more than 5 sets, decided by a clear majority. Used by the report endpoint.
export function validateSinglesScore(
  sets: Array<[number, number]>
): { ok: true; winnerSide: 1 | 2 } | { ok: false; error: string } {
  if (sets.length < 1) return { ok: false, error: "At least one set required" };
  if (sets.length > 5) return { ok: false, error: "Max 5 sets" };
  let side1Sets = 0;
  let side2Sets = 0;
  for (const [a, b] of sets) {
    if (a < 0 || b < 0) return { ok: false, error: "Negative games not allowed" };
    if (a === b) return { ok: false, error: "Sets can't tie" };
    // Valid set scores: 6-0..6-4, 7-5, 7-6, or 10+ point match tiebreak.
    const winnerGames = Math.max(a, b);
    const loserGames = Math.min(a, b);
    const validRegular =
      (winnerGames === 6 && loserGames <= 4) ||
      (winnerGames === 7 && (loserGames === 5 || loserGames === 6));
    const validSuperTiebreak = winnerGames >= 10 && winnerGames - loserGames >= 2;
    if (!validRegular && !validSuperTiebreak) {
      return { ok: false, error: `Invalid set score ${a}-${b}` };
    }
    if (a > b) side1Sets++;
    else side2Sets++;
  }
  if (side1Sets === side2Sets) return { ok: false, error: "Match must have a winner" };
  return { ok: true, winnerSide: side1Sets > side2Sets ? 1 : 2 };
}

// Compute standings from a list of completed EventMatch rows. Points: win = 3,
// loss = 0. Sort by points → set diff → game diff → fewer losses → userId for
// stability.
export function computeStandings(
  participantIds: string[],
  matches: EventMatch[]
): StandingsRow[] {
  const rows = new Map<string, StandingsRow>();
  for (const userId of participantIds) {
    rows.set(userId, {
      userId,
      wins: 0,
      losses: 0,
      setsWon: 0,
      setsLost: 0,
      gamesWon: 0,
      gamesLost: 0,
      points: 0,
      rank: 0,
    });
  }

  for (const m of matches) {
    if (m.status !== "completed" || !m.winnerSide) continue;
    const sets = parseScore(m.score);
    if (sets.length === 0) continue;
    let side1Sets = 0;
    let side2Sets = 0;
    let side1Games = 0;
    let side2Games = 0;
    for (const [a, b] of sets) {
      if (a > b) side1Sets++;
      else side2Sets++;
      side1Games += a;
      side2Games += b;
    }
    const side1Won = m.winnerSide === 1;
    const winnerIds = side1Won
      ? [m.player1Id, m.player3Id].filter(Boolean) as string[]
      : [m.player2Id, m.player4Id].filter(Boolean) as string[];
    const loserIds = side1Won
      ? [m.player2Id, m.player4Id].filter(Boolean) as string[]
      : [m.player1Id, m.player3Id].filter(Boolean) as string[];

    for (const id of winnerIds) {
      const row = rows.get(id);
      if (!row) continue;
      row.wins++;
      row.points += 3;
      row.setsWon += side1Won ? side1Sets : side2Sets;
      row.setsLost += side1Won ? side2Sets : side1Sets;
      row.gamesWon += side1Won ? side1Games : side2Games;
      row.gamesLost += side1Won ? side2Games : side1Games;
    }
    for (const id of loserIds) {
      const row = rows.get(id);
      if (!row) continue;
      row.losses++;
      row.setsWon += side1Won ? side2Sets : side1Sets;
      row.setsLost += side1Won ? side1Sets : side2Sets;
      row.gamesWon += side1Won ? side2Games : side1Games;
      row.gamesLost += side1Won ? side1Games : side2Games;
    }
  }

  const sorted = [...rows.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const setDiffA = a.setsWon - a.setsLost;
    const setDiffB = b.setsWon - b.setsLost;
    if (setDiffB !== setDiffA) return setDiffB - setDiffA;
    const gameDiffA = a.gamesWon - a.gamesLost;
    const gameDiffB = b.gamesWon - b.gamesLost;
    if (gameDiffB !== gameDiffA) return gameDiffB - gameDiffA;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.userId.localeCompare(b.userId);
  });

  sorted.forEach((row, i) => {
    row.rank = i + 1;
  });
  return sorted;
}

// Standard single-elimination seeding so #1 vs lowest, #2 vs second-lowest, etc.
// Returns ordered pairs that fill round 1. Byes (null) are assigned to top seeds
// when participantCount < bracketSize.
export function seedBracket(
  seeds: string[]
): Array<[string | null, string | null]> {
  const n = seeds.length;
  if (n < 2) return [];
  const size = nextPowerOfTwo(n);
  const padded: Array<string | null> = [...seeds];
  while (padded.length < size) padded.push(null);
  // Classic seeding order: for size 8 → [1,8,4,5,2,7,3,6] then pair adjacent.
  const order = bracketSeedOrder(size);
  const ordered = order.map((idx) => padded[idx - 1] ?? null);
  const pairs: Array<[string | null, string | null]> = [];
  for (let i = 0; i < ordered.length; i += 2) {
    pairs.push([ordered[i], ordered[i + 1]]);
  }
  return pairs;
}

function bracketSeedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const next: number[] = [];
    const sum = order.length * 2 + 1;
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function bracketSlot(round: number, index: number): string {
  return `R${round}-${index + 1}`;
}

// Total rounds for a given bracket size (8 → 3, 16 → 4).
export function bracketRounds(participantCount: number): number {
  if (participantCount < 2) return 0;
  const size = nextPowerOfTwo(participantCount);
  return Math.log2(size);
}

// Round-name shorthand for the rendered bracket header.
export function bracketRoundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  return `Round of ${1 << (fromEnd + 1)}`;
}

// Deterministic Fisher–Yates seeded by (eventId, round) so the same pairings
// regenerate identically if someone re-fetches before the matches save.
export function shuffleDeterministic<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Pair up players for a mixer round. If odd, the last player sits out (bye).
export function mixerPairings(playerIds: string[], eventId: string, round: number): {
  pairs: Array<[string, string]>;
  bye: string | null;
} {
  const shuffled = shuffleDeterministic(playerIds, `${eventId}:${round}`);
  const pairs: Array<[string, string]> = [];
  let bye: string | null = null;
  if (shuffled.length % 2 === 1) {
    bye = shuffled.pop() ?? null;
  }
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }
  return { pairs, bye };
}

// Ladder challenge gap config: parsed from Event.config JSON, with a sensible
// default of 3 ranks. Empty/invalid JSON → default.
export function ladderMaxGap(rawConfig: string): number {
  if (!rawConfig) return 3;
  try {
    const obj = JSON.parse(rawConfig);
    const v = obj?.ladderMaxGap;
    if (typeof v === "number" && v > 0 && Number.isFinite(v)) return Math.floor(v);
  } catch {
    // ignore — default below
  }
  return 3;
}
