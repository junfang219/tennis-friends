import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushToUsers } from "@/lib/push";
import { parseReminderPrefs } from "@/lib/reminderPrefs";
import { sendReminderEmail } from "@/lib/reminderEmail";

/**
 * Hourly cron — declared in vercel.json. For each team with reminder
 * preferences set, finds upcoming matches/practices whose target reminder
 * window contains `now`, and notifies non-RSVP'd members via push + email.
 *
 * Idempotency: a ReminderSent row guards against duplicate sends when the
 * cron fires twice in the same window (deploy + scheduled run, manual
 * trigger, etc.).
 *
 * Auth: Vercel injects Authorization: Bearer <CRON_SECRET> on its calls;
 * we reject anything else so the route can't be abused as a relay.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") || "";
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const horizonMs = 26 * 60 * 60 * 1000; // 26h — covers the 24h reminder + buffer
  const horizon = new Date(now.getTime() + horizonMs);

  let matchesChecked = 0;
  let practicesChecked = 0;
  let dispatched = 0;
  const errors: string[] = [];

  // ── Matches ────────────────────────────────────────────────────────────
  // Pull every match in the next ~26h. matchDate is "YYYY-MM-DD" (lex
  // comparable) so a date-range filter is enough; we combine with matchTime
  // in JS to compute the actual datetime.
  const todayIso = isoDate(now);
  const horizonIso = isoDate(horizon);

  const upcomingMatches = await prisma.teamMatch.findMany({
    where: {
      matchDate: { gte: todayIso, lte: horizonIso },
    },
    include: {
      group: { select: { id: true, name: true, reminderPrefs: true } },
      availabilities: { select: { userId: true } },
    },
  });

  for (const match of upcomingMatches) {
    matchesChecked += 1;
    const prefs = parseReminderPrefs(match.group.reminderPrefs);
    if (prefs.matchHours.length === 0) continue;

    const target = combineDateAndTime(match.matchDate, match.matchTime);
    if (!target) continue;

    for (const hoursBefore of prefs.matchHours) {
      if (!isInReminderWindow(now, target, hoursBefore)) continue;

      const rsvped = new Set(match.availabilities.map((a) => a.userId));
      const members = await prisma.groupMember.findMany({
        where: { groupId: match.groupId, userId: { notIn: Array.from(rsvped) } },
        select: { userId: true },
      });
      if (members.length === 0) continue;

      const result = await dispatch({
        kind: "match",
        refId: match.id,
        teamId: match.groupId,
        teamName: match.group.name,
        memberUserIds: members.map((m) => m.userId),
        hoursBefore,
        target,
        title: match.opponent ? `vs ${match.opponent}` : "Team match",
        location: match.location,
        rsvpPath: `/groups/${match.groupId}/availability?focus=${match.id}`,
        request,
      });
      dispatched += result.dispatched;
      if (result.error) errors.push(result.error);
    }
  }

  // ── Practices ──────────────────────────────────────────────────────────
  const upcomingPractices = await prisma.teamPractice.findMany({
    where: {
      practiceDate: { gte: todayIso, lte: horizonIso },
    },
    include: {
      series: {
        include: {
          group: { select: { id: true, name: true, reminderPrefs: true } },
        },
      },
      availabilities: { select: { userId: true } },
    },
  });

  for (const practice of upcomingPractices) {
    practicesChecked += 1;
    const group = practice.series.group;
    const prefs = parseReminderPrefs(group.reminderPrefs);
    if (prefs.practiceHours.length === 0) continue;

    const target = combineDateAndTime(practice.practiceDate, practice.series.practiceTime);
    if (!target) continue;

    for (const hoursBefore of prefs.practiceHours) {
      if (!isInReminderWindow(now, target, hoursBefore)) continue;

      const rsvped = new Set(practice.availabilities.map((a) => a.userId));
      const members = await prisma.groupMember.findMany({
        where: { groupId: group.id, userId: { notIn: Array.from(rsvped) } },
        select: { userId: true },
      });
      if (members.length === 0) continue;

      const result = await dispatch({
        kind: "practice",
        refId: practice.id,
        teamId: group.id,
        teamName: group.name,
        memberUserIds: members.map((m) => m.userId),
        hoursBefore,
        target,
        title: practice.series.name,
        location: practice.series.location,
        rsvpPath: `/groups/${group.id}/practice?focus=${practice.id}`,
        request,
      });
      dispatched += result.dispatched;
      if (result.error) errors.push(result.error);
    }
  }

  return NextResponse.json({
    ok: true,
    matchesChecked,
    practicesChecked,
    dispatched,
    errors: errors.slice(0, 5),
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function combineDateAndTime(dateStr: string, timeStr: string): Date | null {
  if (!dateStr) return null;
  // matchTime / practiceTime can be empty; default to 9am so untimed
  // matches still get reminders rather than being silently skipped.
  const safeTime = /^\d{1,2}:\d{2}$/.test(timeStr) ? timeStr : "09:00";
  const d = new Date(`${dateStr}T${safeTime.padStart(5, "0")}:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Hourly cron with a 1-hour-wide window centred on (target - hoursBefore).
 * Window is half-open: [target - hoursBefore - 30min, target - hoursBefore + 30min).
 * The ReminderSent unique guard prevents duplicates if windows overlap.
 */
function isInReminderWindow(now: Date, target: Date, hoursBefore: number): boolean {
  const reminderAt = target.getTime() - hoursBefore * 60 * 60 * 1000;
  const delta = now.getTime() - reminderAt;
  return delta >= -30 * 60 * 1000 && delta < 30 * 60 * 1000;
}

type DispatchOpts = {
  kind: "match" | "practice";
  refId: string;
  teamId: string;
  teamName: string;
  memberUserIds: string[];
  hoursBefore: number;
  target: Date;
  title: string;
  location: string;
  rsvpPath: string;
  request: Request;
};

async function dispatch(opts: DispatchOpts): Promise<{ dispatched: number; error?: string }> {
  // Filter out anyone who already received THIS specific reminder.
  const already = await prisma.reminderSent.findMany({
    where: {
      kind: opts.kind,
      refId: opts.refId,
      hoursBefore: opts.hoursBefore,
      userId: { in: opts.memberUserIds },
    },
    select: { userId: true },
  });
  const alreadySet = new Set(already.map((r) => r.userId));
  const targets = opts.memberUserIds.filter((id) => !alreadySet.has(id));
  if (targets.length === 0) return { dispatched: 0 };

  const origin = new URL(opts.request.url).origin;
  const rsvpUrl = `${origin}${opts.rsvpPath}`;
  const whenLabel = opts.target.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const kindLabel = opts.kind === "match" ? "Match" : "Practice";

  // Push to all targets at once.
  void pushToUsers(targets, {
    title: `${opts.teamName}: ${kindLabel} reminder`,
    body: `${opts.title} — ${whenLabel} · ${opts.location}`,
    threadId: `reminder:${opts.kind}:${opts.refId}`,
    data: { kind: opts.kind, refId: opts.refId, teamId: opts.teamId },
  });

  // Email to targets that have an address set.
  const users = await prisma.user.findMany({
    where: { id: { in: targets }, email: { not: null } },
    select: { id: true, email: true },
  });
  for (const u of users) {
    if (!u.email) continue;
    void sendReminderEmail({
      to: u.email,
      teamName: opts.teamName,
      kind: opts.kind,
      title: opts.title,
      whenLabel,
      location: opts.location,
      hoursBefore: opts.hoursBefore,
      rsvpUrl,
    });
  }

  // Record dispatch — use createMany with skipDuplicates so a concurrent
  // run can't insert the same row twice (unique constraint also enforces).
  try {
    await prisma.reminderSent.createMany({
      data: targets.map((userId) => ({
        kind: opts.kind,
        refId: opts.refId,
        userId,
        hoursBefore: opts.hoursBefore,
      })),
    });
  } catch (err) {
    return {
      dispatched: targets.length,
      error: err instanceof Error ? err.message : "ReminderSent write failed",
    };
  }
  return { dispatched: targets.length };
}
