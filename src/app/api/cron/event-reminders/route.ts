import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { postPushFanout } from "@/lib/pushFanout";
import { parseReminderPrefs } from "@/lib/reminderPrefs";
import { isInReminderWindow } from "@/lib/reminderWindow";
import { sendReminderEmail } from "@/lib/reminderEmail";
import { combineDateAndTime } from "@/lib/wallClock";

/**
 * Reminder cron — triggered every 15 minutes by the `event-reminders-hourly`
 * pg_cron job (schedule `0,15,30,45 * * * *`), which net.http_get's this route on
 * prod with the CRON_SECRET bearer. (vercel.json declares no crons.) For each
 * team, finds upcoming matches/practices that have reached a reminder lead
 * time (see isInReminderWindow: never early, ≤~15 min late, with catch-up),
 * and notifies non-RSVP'd members via push + email per the team's
 * reminder_prefs.
 *
 * Idempotency: a `reminder_sent` row per (kind, refId, userId, hoursBefore)
 * guards against duplicate sends across the multiple cron ticks that fall in
 * a single reminder's grace window — only the first qualifying tick delivers.
 *
 * Auth: the pg_cron job sends `Authorization: Bearer <CRON_SECRET>`; we
 * reject anything else so the route can't be abused as a relay.
 *
 * This is a port of the pre-Supabase Prisma route (deleted in 86f26a5),
 * now using the service-role admin client because cron runs without a
 * user session.
 */
export async function GET(request: Request) {
  // CRON_SECRET MUST be set in any environment that exposes this route
  // (Vercel injects it on its scheduled calls). Allowing the check to
  // be skipped when the env var is missing left the route as an
  // unauthenticated trigger for service-role notifications/emails —
  // refuse to run rather than silently fall open.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  const header = request.headers.get("authorization") || "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const horizonMs = 26 * 60 * 60 * 1000; // 26h covers the 24h reminder + buffer
  const horizon = new Date(now.getTime() + horizonMs);

  let matchesChecked = 0;
  let practicesChecked = 0;
  let dispatched = 0;
  const errors: string[] = [];

  const todayIso = isoDate(now);
  const horizonIso = isoDate(horizon);

  // ── Matches ────────────────────────────────────────────────────────────
  const { data: matches, error: matchErr } = await admin
    .from("team_matches")
    .select(
      `id, group_id, match_date, match_time, location, opponent, timezone,
       group:groups!team_matches_group_id_fkey ( id, name, reminder_prefs ),
       availabilities ( user_id )`
    )
    .gte("match_date", todayIso)
    .lte("match_date", horizonIso);
  if (matchErr) {
    errors.push(`team_matches: ${matchErr.message}`);
  }
  for (const m of (matches ?? []) as unknown as Array<{
    id: string;
    group_id: string;
    match_date: string;
    match_time: string;
    location: string;
    opponent: string;
    timezone: string;
    group: { id: string; name: string; reminder_prefs: unknown };
    availabilities: { user_id: string }[];
  }>) {
    matchesChecked += 1;
    const prefs = parseReminderPrefs(
      typeof m.group.reminder_prefs === "string"
        ? m.group.reminder_prefs
        : JSON.stringify(m.group.reminder_prefs ?? {})
    );
    if (prefs.matchHours.length === 0) continue;
    const target = combineDateAndTime(m.match_date, m.match_time, m.timezone);
    if (!target) continue;

    for (const hoursBefore of prefs.matchHours) {
      if (!isInReminderWindow(now, target, hoursBefore)) continue;

      const rsvped = new Set((m.availabilities ?? []).map((a) => a.user_id));
      const members = await listUnrsvpedMembers(admin, m.group_id, rsvped);
      if (members.length === 0) continue;

      const result = await dispatch(admin, {
        kind: "match",
        refId: m.id,
        teamId: m.group_id,
        teamName: m.group.name,
        memberUserIds: members,
        hoursBefore,
        target,
        title: m.opponent ? `vs ${m.opponent}` : "Team match",
        location: m.location,
        rsvpPath: `/groups/${m.group_id}/availability?focus=${m.id}`,
        request,
      });
      dispatched += result.dispatched;
      if (result.error) errors.push(result.error);
    }
  }

  // ── Practices ──────────────────────────────────────────────────────────
  const { data: practices, error: practiceErr } = await admin
    .from("team_practices")
    .select(
      `id, practice_date, timezone,
       series:practice_series!team_practices_series_id_fkey (
         id, group_id, name, location, practice_time,
         group:groups!practice_series_group_id_fkey ( id, name, reminder_prefs )
       ),
       availabilities ( user_id )`
    )
    .gte("practice_date", todayIso)
    .lte("practice_date", horizonIso);
  if (practiceErr) {
    errors.push(`team_practices: ${practiceErr.message}`);
  }
  for (const p of (practices ?? []) as unknown as Array<{
    id: string;
    practice_date: string;
    timezone: string;
    series: {
      id: string;
      group_id: string;
      name: string;
      location: string;
      practice_time: string;
      group: { id: string; name: string; reminder_prefs: unknown };
    };
    availabilities: { user_id: string }[];
  }>) {
    practicesChecked += 1;
    const group = p.series.group;
    const prefs = parseReminderPrefs(
      typeof group.reminder_prefs === "string"
        ? group.reminder_prefs
        : JSON.stringify(group.reminder_prefs ?? {})
    );
    if (prefs.practiceHours.length === 0) continue;
    const target = combineDateAndTime(p.practice_date, p.series.practice_time, p.timezone);
    if (!target) continue;

    for (const hoursBefore of prefs.practiceHours) {
      if (!isInReminderWindow(now, target, hoursBefore)) continue;

      const rsvped = new Set((p.availabilities ?? []).map((a) => a.user_id));
      const members = await listUnrsvpedMembers(admin, group.id, rsvped);
      if (members.length === 0) continue;

      const result = await dispatch(admin, {
        kind: "practice",
        refId: p.id,
        teamId: group.id,
        teamName: group.name,
        memberUserIds: members,
        hoursBefore,
        target,
        title: p.series.name,
        location: p.series.location,
        rsvpPath: `/groups/${group.id}/practice?focus=${p.id}`,
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

type Admin = ReturnType<typeof createSupabaseAdminClient>;

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// combineDateAndTime moved to src/lib/wallClock.ts and isInReminderWindow to
// src/lib/reminderWindow.ts so they're unit-testable without the cron route's
// server-only deps.

async function listUnrsvpedMembers(
  admin: Admin,
  groupId: string,
  rsvped: Set<string>
): Promise<string[]> {
  const { data: members } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  return (members ?? [])
    .map((m) => m.user_id)
    .filter((id) => !rsvped.has(id));
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

async function dispatch(
  admin: Admin,
  opts: DispatchOpts
): Promise<{ dispatched: number; error?: string }> {
  // Filter out anyone who already received THIS specific reminder
  // (kind + refId + hoursBefore).
  const { data: already } = await admin
    .from("reminder_sent")
    .select("user_id")
    .eq("kind", opts.kind)
    .eq("ref_id", opts.refId)
    .eq("hours_before", opts.hoursBefore)
    .in("user_id", opts.memberUserIds);
  const alreadySet = new Set((already ?? []).map((r) => r.user_id));
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

  // Single APN code path: push-fanout (Web Crypto ES256 + HTTP/2). We
  // await the response so reminder_sent only gets written when delivery
  // didn't outright fail — otherwise a 5xx push-fanout outage would
  // permanently suppress the reminder for the (kind, ref_id, hoursBefore)
  // tuple and the user would never hear about the match.
  const pushResult = await postPushFanout(targets, {
    title: `${opts.teamName}: ${kindLabel} reminder`,
    body: `${opts.title} — ${whenLabel} · ${opts.location}`,
    threadId: `reminder:${opts.kind}:${opts.refId}`,
    data: { kind: opts.kind, refId: opts.refId, teamId: opts.teamId },
  });

  // Email to targets that have an address set.
  const { data: users } = await admin
    .from("profiles")
    .select("id, email")
    .in("id", targets)
    .not("email", "is", null);
  for (const u of users ?? []) {
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

  // Hard failures from push-fanout (network error or 5xx) should NOT
  // mark these recipients as already-notified. push-fanout no-ops on
  // missing config and returns ok:false / status:0 — we treat that as
  // "delivered as far as this cron is concerned" so reminder_sent
  // still advances and we don't re-spam on every hourly run.
  const pushHardFail =
    !pushResult.ok && pushResult.status >= 500;
  if (pushHardFail) {
    return {
      dispatched: 0,
      error: `push-fanout ${pushResult.status}: ${pushResult.error ?? "no detail"}`,
    };
  }

  // Record dispatch. The (kind, ref_id, user_id, hours_before) unique
  // index also enforces this server-side if a concurrent run races us.
  const { error: insErr } = await admin.from("reminder_sent").insert(
    targets.map((userId) => ({
      kind: opts.kind,
      ref_id: opts.refId,
      user_id: userId,
      hours_before: opts.hoursBefore,
    }))
  );
  if (insErr && !insErr.message.toLowerCase().includes("duplicate")) {
    return { dispatched: targets.length, error: `reminder_sent: ${insErr.message}` };
  }
  return { dispatched: targets.length };
}
