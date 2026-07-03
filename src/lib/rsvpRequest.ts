// Compose the "please RSVP" request a captain shares from the Matches tab.
// Pure (no React/Supabase) so the text is identical across share destinations
// and unit-testable. The selected matches are mentioned for context; the link
// (a per-guest /rsvp/{token} or the in-app availability page) is passed
// separately to nativeShare. See rsvpRequest.test.ts.

import { formatDateHeader } from "./lineupMessage";

export type RsvpRequestMatch = {
  matchDate: string;
  matchTime?: string;
  opponent?: string;
  location?: string;
};

/** One bullet line per match: "Sat, Jul 5 · 6:00 PM · vs Aces · Central Park". */
function matchLine(m: RsvpRequestMatch): string {
  const bits = [
    formatDateHeader(m.matchDate),
    m.matchTime?.trim() || "",
    m.opponent?.trim() ? `vs ${m.opponent.trim()}` : "",
    m.location?.trim() || "",
  ].filter(Boolean);
  return ` • ${bits.join(" · ")}`;
}

export function buildRsvpRequestText(
  teamName: string,
  matches: RsvpRequestMatch[],
): string {
  const header = `🎾 ${teamName} — please set your availability:`;
  if (matches.length === 0) return `${header}\nTap to RSVP:`;
  return `${header}\n${matches.map(matchLine).join("\n")}\nTap to RSVP:`;
}

/**
 * The in-app link a joined member opens to RSVP. Focuses a single match (scroll
 * + highlight, already supported by the availability page) only when exactly one
 * match is selected; otherwise lands on the full availability page.
 */
export function availabilityLink(
  origin: string,
  groupId: string,
  matchIds: string[],
): string {
  const base = `${origin}/groups/${groupId}/availability`;
  return matchIds.length === 1 ? `${base}?focus=${matchIds[0]}` : base;
}
