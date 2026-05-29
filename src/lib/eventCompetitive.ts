// Pure helpers for tournament / ladder / round-robin events.
//
// Restored from src/lib/eventCompetitive.ts (deleted in 86f26a5). The
// algorithm is unchanged; only the standings input shape switched from
// the Prisma `EventMatch` row to a plain shape so the helpers work
// against snake_case database rows or the camelCase adapter output
// without further coupling.

export type ScoreSet = [number, number];

export type StandingsMatchInput = {
  status: string;
  score: string;
  winnerSide: number | null;
  player1Id: string | null;
  player2Id: string | null;
  player3Id?: string | null;
  player4Id?: string | null;
};

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

// Parse a score string like "6-4,3-6,7-5" into per-set [side1, side2] pairs.
// Tolerates "-", ":", "/" between games and ";" or "," between sets so
// player-entered variants don't fail-closed.
export function parseScore(score: string): ScoreSet[] {
  if (!score) return [];
  return score
    .split(/[,;]/)
    .map((set) => set.trim())
    .filter(Boolean)
    .map((set): ScoreSet | null => {
      // Alternation, not a [-:/] char class: Tailwind's content scanner reads
      // "[-:/]" as an arbitrary-property class and emits invalid CSS that
      // Turbopack's parser then rejects. (?:-|:|\/) matches identically.
      const m = set.match(/^(\d+)\s*(?:-|:|\/)\s*(\d+)/);
      if (!m) return null;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (isNaN(a) || isNaN(b)) return null;
      return [a, b];
    })
    .filter((s): s is ScoreSet => s != null);
}

// Validate a singles score: 1–5 sets, each set 6-0..6-4 / 7-5 / 7-6, or
// a 10+ match tiebreak with ≥2 margin. Returns the winning side or an
// error explaining which set is malformed.
export function validateSinglesScore(
  sets: ScoreSet[]
): { ok: true; winnerSide: 1 | 2 } | { ok: false; error: string } {
  if (sets.length < 1) return { ok: false, error: "At least one set required" };
  if (sets.length > 5) return { ok: false, error: "Max 5 sets" };
  let side1Sets = 0;
  let side2Sets = 0;
  for (const [a, b] of sets) {
    if (a < 0 || b < 0) return { ok: false, error: "Negative games not allowed" };
    if (a === b) return { ok: false, error: "Sets can't tie" };
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

// Round-robin / ladder standings derived from completed matches.
// Win = 3 points, loss = 0; tiebreakers: set diff → game diff → fewer
// losses → user-id (stable). Doubles aware via player3/player4 slots.
export function computeStandings(
  participantIds: string[],
  matches: StandingsMatchInput[]
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
    const winnerIds = (side1Won
      ? [m.player1Id, m.player3Id]
      : [m.player2Id, m.player4Id]
    ).filter((id): id is string => !!id);
    const loserIds = (side1Won
      ? [m.player2Id, m.player4Id]
      : [m.player1Id, m.player3Id]
    ).filter((id): id is string => !!id);

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

// ---------------------------------------------------------------------
// Single-elimination seeding
// ---------------------------------------------------------------------

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
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

// Classic single-elimination seeding: #1 vs lowest, #2 vs second-lowest, etc.
// Returns ordered round-1 pairs. Byes (null) are assigned to top seeds when
// participantCount < bracketSize. Order: index 0 = R1-1, index 1 = R1-2, ...
export function seedBracket(
  seeds: string[]
): Array<[string | null, string | null]> {
  const n = seeds.length;
  if (n < 2) return [];
  const size = nextPowerOfTwo(n);
  const padded: Array<string | null> = [...seeds];
  while (padded.length < size) padded.push(null);
  const order = bracketSeedOrder(size);
  const ordered = order.map((idx) => padded[idx - 1] ?? null);
  const pairs: Array<[string | null, string | null]> = [];
  for (let i = 0; i < ordered.length; i += 2) {
    pairs.push([ordered[i], ordered[i + 1]]);
  }
  return pairs;
}

export function bracketSlot(round: number, index: number): string {
  return `R${round}-${index + 1}`;
}

// Total rounds for a given participant count (8 → 3, 16 → 4).
export function bracketRounds(participantCount: number): number {
  if (participantCount < 2) return 0;
  return Math.log2(nextPowerOfTwo(participantCount));
}

// Round-name shorthand for the rendered bracket header.
export function bracketRoundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  return `Round of ${1 << (fromEnd + 1)}`;
}

// ---------------------------------------------------------------------
// Mixer rotation pairing
// ---------------------------------------------------------------------

// FNV-1a hash → 32-bit unsigned int seed. Used to derive a deterministic
// PRNG state from `${eventId}:${round}` so reissuing the same round
// regenerates the same pairings.
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Fisher–Yates shuffle seeded by `seed`. Pure: same seed + input → same
// output, so callers can preview the pairing client-side and have the
// server insert the identical result.
export function shuffleDeterministic<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hashSeed(seed) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pair players for one mixer round. Odd count → last shuffled player
// sits out (bye). The shuffle is seeded by (eventId, round) so a retry
// after a transient network failure produces the same pairings.
export function mixerPairings(
  playerIds: readonly string[],
  eventId: string,
  round: number
): { pairs: Array<[string, string]>; bye: string | null } {
  const shuffled = shuffleDeterministic(playerIds, `${eventId}:${round}`);
  let bye: string | null = null;
  if (shuffled.length % 2 === 1) {
    bye = shuffled.pop() ?? null;
  }
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }
  return { pairs, bye };
}

// Ladder challenge gap config: parsed from events.config jsonb (or a
// JSON string, for forward-compat). Default 3.
export function ladderMaxGap(rawConfig: unknown): number {
  const defaultGap = 3;
  if (rawConfig == null) return defaultGap;
  let obj: unknown = rawConfig;
  if (typeof rawConfig === "string") {
    if (rawConfig.trim().length === 0) return defaultGap;
    try {
      obj = JSON.parse(rawConfig);
    } catch {
      return defaultGap;
    }
  }
  if (obj && typeof obj === "object" && "ladderMaxGap" in obj) {
    const v = (obj as { ladderMaxGap: unknown }).ladderMaxGap;
    if (typeof v === "number" && v > 0 && Number.isFinite(v)) return Math.floor(v);
  }
  return defaultGap;
}
