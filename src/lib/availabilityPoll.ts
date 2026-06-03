// Availability-poll ranking: given each member's free-form (date, start, end)
// blocks, surface the windows where the most members overlap.
//
// The algorithm operates entirely on wall-clock HH:MM strings — the poll
// carries its own IANA timezone (mirroring team_matches.timezone), and the
// candidate dates are interpreted in that zone end-to-end, so no Date object
// touches this code. Matches the pattern in src/lib/wallClock.ts.

export type Block = {
  date: string;  // YYYY-MM-DD
  start: string; // HH:MM (24h)
  end: string;   // HH:MM (24h, exclusive)
};

export type MemberResponse = {
  userId: string;
  userName: string;
  blocks: Block[];
};

export type RankedWindow = {
  date: string;
  start: string;
  end: string;
  durationMinutes: number;
  memberIds: string[];
  memberNames: string[];
};

export type RankInput = {
  candidateDates: string[];
  minBlockMinutes: number;
  minPlayers: number;
};

export type RankResult = {
  top: RankedWindow[];     // meet minPlayers, sorted best-first
  nearMiss: RankedWindow[]; // 1 player short of minPlayers, sorted best-first
};

const TICK_MINUTES = 15;
const TICKS_PER_DAY = (24 * 60) / TICK_MINUTES;

function toTick(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return NaN;
  return h * 4 + Math.floor(mm / TICK_MINUTES);
}

function fromTick(t: number): string {
  const h = Math.floor(t / 4);
  const m = (t % 4) * TICK_MINUTES;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Rank candidate windows for a poll. Returns up to `limit` top-ranked windows
// (>= minPlayers) plus a separate near-miss list (one player short).
export function rankWindows(
  input: RankInput,
  responses: MemberResponse[],
  limit = 10,
): RankResult {
  const minTicks = Math.max(1, Math.ceil(input.minBlockMinutes / TICK_MINUTES));
  const windows: RankedWindow[] = [];

  for (const date of input.candidateDates) {
    // Per-tick presence: which members are free at this 15-min slot.
    const presence: Set<string>[] = Array.from({ length: TICKS_PER_DAY }, () => new Set());

    for (const r of responses) {
      const memberMask = new Array<boolean>(TICKS_PER_DAY).fill(false);
      for (const b of r.blocks) {
        if (b.date !== date) continue;
        const s = toTick(b.start);
        const e = toTick(b.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        if (e <= s) continue;
        if (e - s < minTicks) continue; // sub-minimum block: drop per the 2h floor.
        for (let t = Math.max(0, s); t < Math.min(TICKS_PER_DAY, e); t++) {
          memberMask[t] = true;
        }
      }
      for (let t = 0; t < TICKS_PER_DAY; t++) {
        if (memberMask[t]) presence[t].add(r.userId);
      }
    }

    pushDayWindows(date, presence, minTicks, responses, windows);
  }

  // Sort: most members desc, longest desc, then earliest start.
  windows.sort((a, b) =>
    b.memberIds.length - a.memberIds.length
    || b.durationMinutes - a.durationMinutes
    || (a.date + a.start).localeCompare(b.date + b.start),
  );

  const top: RankedWindow[] = [];
  const nearMiss: RankedWindow[] = [];
  for (const w of windows) {
    if (w.memberIds.length >= input.minPlayers) {
      if (top.length < limit) top.push(w);
    } else if (w.memberIds.length === input.minPlayers - 1) {
      if (nearMiss.length < limit) nearMiss.push(w);
    }
  }
  return { top, nearMiss };
}

// Walk a single day's presence array. For each tick s with non-empty presence,
// extend e forward maintaining the running intersection of presence sets; the
// longest non-empty [s, e) is the maximal window where the same set of members
// can all attend. That intersection is the window's member list — guarantees
// every listed member is free for the entire window.
//
// After enumeration, collapse windows that share the same member-set, keeping
// the longest. This eliminates shifted-by-one-tick duplicates that share both
// the trailing end tick and the member set.
function pushDayWindows(
  date: string,
  presence: Set<string>[],
  minTicks: number,
  responses: MemberResponse[],
  out: RankedWindow[],
): void {
  type Candidate = { start: number; end: number; members: string[] };
  const candidates: Candidate[] = [];

  for (let s = 0; s + minTicks <= TICKS_PER_DAY; s++) {
    if (presence[s].size === 0) continue;
    const intersection = new Set(presence[s]);
    let e = s + 1;
    // Build the window [s, e) by appending one tick at a time; stop when the
    // next tick would empty the intersection (don't include that tick).
    while (e < TICKS_PER_DAY && presence[e].size > 0) {
      let stillIntersects = false;
      for (const id of intersection) {
        if (presence[e].has(id)) { stillIntersects = true; break; }
      }
      if (!stillIntersects) break;
      for (const id of [...intersection]) {
        if (!presence[e].has(id)) intersection.delete(id);
      }
      e++;
    }
    if (e - s < minTicks) continue;
    candidates.push({ start: s, end: e, members: [...intersection].sort() });
  }

  // Collapse same-member-set windows: keep the longest (then earliest start).
  const bestByKey = new Map<string, Candidate>();
  for (const c of candidates) {
    const key = `${date}|${c.members.join(",")}`;
    const prev = bestByKey.get(key);
    if (!prev) { bestByKey.set(key, c); continue; }
    const prevLen = prev.end - prev.start;
    const curLen = c.end - c.start;
    if (curLen > prevLen || (curLen === prevLen && c.start < prev.start)) {
      bestByKey.set(key, c);
    }
  }

  for (const c of bestByKey.values()) {
    const memberNames = c.members
      .map((id) => responses.find((r) => r.userId === id)?.userName ?? id)
      .sort((a, b) => a.localeCompare(b));
    out.push({
      date,
      start: fromTick(c.start),
      end: fromTick(c.end),
      durationMinutes: (c.end - c.start) * TICK_MINUTES,
      memberIds: c.members,
      memberNames,
    });
  }
}

// Validate a single block on the client before saving — returns null if OK,
// otherwise a user-facing error string. Mirrors the DB CHECK semantics so
// invalid rows never get round-tripped.
export function validateBlock(
  block: Block,
  minBlockMinutes: number,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(block.date)) return "Pick a date.";
  const s = toTick(block.start);
  const e = toTick(block.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "Pick start and end time.";
  if (e <= s) return "End must be after start.";
  const minutes = (e - s) * TICK_MINUTES;
  if (minutes < minBlockMinutes) return `Block must be at least ${Math.round(minBlockMinutes / 60)} hours.`;
  return null;
}

// Public for unit tests: HH:MM → 15-min tick index in [0, 96).
export const __test = { toTick, fromTick };
