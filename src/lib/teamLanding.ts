import { canAdmin, canCaptain, type TeamRole } from "./groupRoles";
import type { LineupSlotDef } from "./leagueFormats";
import { formatDateHeader } from "./lineupMessage";
import { parseSchedulingStatus, windowEndFor } from "./matchWindow";
import { normalizeMatchStatus, RSVP, RSVP_LABEL } from "./rsvpStatus";
import { combineDateAndTime, formatWhenLabel } from "./wallClock";

type LandingMember = {
  id: string;
  user_id: string | null;
  roles: TeamRole[];
  placeholder_scope: string | null;
};

type LandingAvailability = {
  member_id: string;
  status: string;
  lineup_slot: string;
};

export type LandingMatch = {
  id: string;
  match_date: string;
  match_time: string;
  timezone: string | null;
  location: string;
  opponent: string;
  scheduling_status: string;
  window_end: string | null;
  availabilities: LandingAvailability[];
  format: LineupSlotDef[] | null;
};

export type TeamLanding = {
  role: "Captain" | "Co-captain" | "Member";
  title: string;
  context?: string;
  details?: string;
  status?: string;
  action?: { href: string; label: string; secondary?: boolean };
};

export function matchTiming(match: Pick<LandingMatch, "match_date" | "match_time" | "timezone" | "scheduling_status" | "window_end">) {
  const scheduling = parseSchedulingStatus(match.scheduling_status);
  const start = combineDateAndTime(match.match_date, match.match_time, match.timezone);
  if (scheduling === "fixed" && match.match_time) return { start, end: start };

  const endDate = match.window_end ||
    (scheduling === "window" ? windowEndFor(match.match_date) : match.match_date);
  return { start, end: combineDateAndTime(endDate, "23:59", match.timezone) };
}

function matchCard(match: LandingMatch): Pick<TeamLanding, "title" | "details"> {
  const date = formatDateHeader(match.match_date);
  const scheduling = parseSchedulingStatus(match.scheduling_status);
  const endDate = match.window_end || (scheduling === "window" ? windowEndFor(match.match_date) : null);
  let when = `${date} · Time to be confirmed`;
  if (scheduling === "fixed") {
    const time = /^\d{1,2}:\d{2}$/.test(match.match_time)
      ? combineDateAndTime(match.match_date, match.match_time, match.timezone)
      : null;
    when = time ? formatWhenLabel(time, match.timezone) : [date, match.match_time].filter(Boolean).join(", ");
  } else if (endDate) {
    when = `${date} to ${formatDateHeader(endDate)}`;
  }

  return {
    title: match.opponent ? `vs. ${match.opponent}` : "Team match",
    details: [when, match.location].filter(Boolean).join(" · "),
  };
}

function captainMatchAction(match: LandingMatch, eligibleMembers: LandingMember[]) {
  const eligibility = new Set(eligibleMembers.map(member => member.id));
  const replies = match.availabilities.filter(reply => eligibility.has(reply.member_id));
  const responded = replies.filter(reply => normalizeMatchStatus(reply.status) !== RSVP.NO_RESPONSE).length;
  const available = replies.filter(reply => normalizeMatchStatus(reply.status) === RSVP.PLAYING).length;
  const total = eligibleMembers.length;

  const format = match.format;
  const slotCounts = new Map<string, number>();
  for (const reply of replies) {
    const slot = reply.lineup_slot.trim();
    if (slot && slot !== "Reserve") slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);
  }
  const lineupComplete = format
    ? format.every(slot => slotCounts.get(slot.code) === (slot.type === "doubles" ? 2 : 1))
    : slotCounts.size > 0;
  const status = responded === total && total > 0
    ? `All ${total} responded · ${available} available`
    : `${responded} of ${total} players responded`;

  if (lineupComplete) return { label: "View lineup", status };
  if (responded < total || !format) return { label: "Review availability", status };

  const needed = format.reduce((count, slot) => count + (slot.type === "doubles" ? 2 : 1), 0);
  if (available >= needed) return { label: "Set lineup", status };
  const shortBy = needed - available;
  return { label: "Review availability", status: `${status} · ${shortBy} more needed for the lineup` };
}

export function teamLanding({
  groupId, ownerId, userId, members, matches, onboardingEnabled, now,
}: {
  groupId: string;
  ownerId: string;
  userId: string;
  members: LandingMember[];
  matches: LandingMatch[];
  onboardingEnabled: boolean;
  now: Date;
}): TeamLanding | null {
  const member = members.find(row => row.user_id === userId);
  if (!member && ownerId !== userId) return null;

  const capability = { isOwner: ownerId === userId, roles: member?.roles ?? [] };
  const canManageRoster = canAdmin(capability);
  const canManageMatches = canCaptain(capability);
  const role = canManageMatches ? "Captain" : canManageRoster ? "Co-captain" : "Member";
  const teamHref = `/groups/${groupId}`;
  const matchHref = (id: string) => `${teamHref}/availability?focus=${id}`;
  const upcoming = matches
    .flatMap(match => {
      const { start, end } = matchTiming(match);
      return start && end && end >= now ? [{ match, startsAt: start.getTime() }] : [];
    })
    .sort((a, b) => a.startsAt - b.startsAt)
    .map(entry => entry.match);
  const [nextMatch] = upcoming;

  if (canManageRoster && onboardingEnabled && !members.some(row => row.user_id && row.user_id !== ownerId)) {
    return { role, title: "Build your roster", status: "Invite teammates to join and respond to matches.", action: { label: "Invite players", href: `${teamHref}/invite-players` } };
  }

  if (canManageMatches && nextMatch) {
    const eligibleMembers = members.filter(row =>
      row.user_id || !row.placeholder_scope || ["all", "match"].includes(row.placeholder_scope)
    );
    const { label, status } = captainMatchAction(nextMatch, eligibleMembers);
    return {
      role, context: "Next match", ...matchCard(nextMatch), status,
      action: { label, href: matchHref(nextMatch.id) },
    };
  }

  if (canManageRoster && !nextMatch && onboardingEnabled) {
    return { role, title: "Your roster", action: { label: "Manage roster", href: `${teamHref}/roster` } };
  }

  if (!nextMatch) return { role, title: "No upcoming matches" };

  const responseFor = (match: LandingMatch) =>
    normalizeMatchStatus(match.availabilities.find(reply => reply.member_id === member?.id)?.status ?? "");
  const needsResponse = member && upcoming.find(match => responseFor(match) === RSVP.NO_RESPONSE);
  if (needsResponse) {
    return {
      role, context: needsResponse === nextMatch ? "Next match" : "Upcoming match",
      ...matchCard(needsResponse), status: "Availability requested",
      action: { label: "Set my availability", href: `${matchHref(needsResponse.id)}&respond=1` },
    };
  }

  const response = responseFor(nextMatch);
  return {
    role, context: "Next match", ...matchCard(nextMatch),
    ...(response !== RSVP.NO_RESPONSE ? {
      status: `Availability up to date · Your response: ${RSVP_LABEL[response]}`,
      action: { label: "Edit response", href: `${matchHref(nextMatch.id)}&respond=1`, secondary: true },
    } : {}),
  };
}
