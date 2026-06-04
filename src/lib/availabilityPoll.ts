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
// extend e forward maintaining the running intersection of presence sets.
// Every time the intersection would SHRINK at tick e (a member drops), emit
// the just-closed [s, e) sub-window with the pre-shrink member set, then
// continue extending with the smaller set. The trailing segment is emitted
// after the loop. This surfaces nested overlaps like "A 9-21, B 9-12" as both
// {A,B} 9-12 and {A} 9-21 instead of swallowing the {A,B} sub-window.
//
// After enumeration, collapse windows that share the same member-set, keeping
// the longest. This eliminates shifted-by-one-tick duplicates emitted at
// different start ticks.
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
    while (e < TICKS_PER_DAY && presence[e].size > 0) {
      let dropper = false;
      for (const id of intersection) {
        if (!presence[e].has(id)) { dropper = true; break; }
      }
      if (dropper) {
        if (e - s >= minTicks) {
          candidates.push({ start: s, end: e, members: [...intersection].sort() });
        }
        for (const id of [...intersection]) {
          if (!presence[e].has(id)) intersection.delete(id);
        }
        if (intersection.size === 0) break;
      }
      e++;
    }
    // Trailing segment: intersection still non-empty when we ran out of
    // presence (end-of-day or hit a zero tick).
    if (intersection.size > 0 && e - s >= minTicks) {
      candidates.push({ start: s, end: e, members: [...intersection].sort() });
    }
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

  // Subtract higher-population coverage: each candidate's range is reduced
  // by the union of every other candidate whose member set is a STRICT
  // superset (more members AND all of ours). The remaining pieces are the
  // time uniquely covered by THIS subset of members — so a 1-player
  // near-miss row never visually overlaps the captain's chosen 2-player
  // top row. Subtraction uses the OTHER candidate's original range, not
  // its post-processed pieces, so the result reflects ground-truth presence.
  const deduped = [...bestByKey.values()];
  for (const c of deduped) {
    const supersetRanges: Array<[number, number]> = [];
    for (const other of deduped) {
      if (other === c) continue;
      if (other.members.length <= c.members.length) continue;
      const isSuperset = c.members.every((m) => other.members.includes(m));
      if (!isSuperset) continue;
      const lo = Math.max(c.start, other.start);
      const hi = Math.min(c.end, other.end);
      if (lo < hi) supersetRanges.push([lo, hi]);
    }
    const remaining = subtractRanges(c.start, c.end, supersetRanges);
    for (const [s, e] of remaining) {
      if (e - s < minTicks) continue;
      const memberNames = c.members
        .map((id) => responses.find((r) => r.userId === id)?.userName ?? id)
        .sort((a, b) => a.localeCompare(b));
      out.push({
        date,
        start: fromTick(s),
        end: fromTick(e),
        durationMinutes: (e - s) * TICK_MINUTES,
        memberIds: c.members,
        memberNames,
      });
    }
  }
}

// Return the contiguous pieces of [start, end) not covered by any of the
// input ranges. Ranges are inclusive-start, exclusive-end (matching tick
// semantics elsewhere in this file). Pure math helper — used by the
// pushDayWindows subtraction pass to carve a candidate's range around
// higher-population overlap.
function subtractRanges(
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): Array<[number, number]> {
  if (ranges.length === 0) return [[start, end]];
  // Sort and merge overlapping/adjacent input ranges.
  const sorted = ranges
    .map((r) => [r[0], r[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    if (merged.length > 0 && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  const result: Array<[number, number]> = [];
  let cursor = start;
  for (const [s, e] of merged) {
    if (e <= cursor) continue;
    if (s >= end) break;
    if (s > cursor) result.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
    if (cursor >= end) break;
  }
  if (cursor < end) result.push([cursor, end]);
  return result;
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
