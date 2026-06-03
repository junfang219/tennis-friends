import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { postPushFanout } from "@/lib/pushFanout";

// POST /api/groups/[id]/polls
//
// Captain-only. Creates an availability poll under the captain's auth (the
// availability_polls_insert_captain RLS policy enforces it), then fans the
// announcement out to every other team member: a notification row each plus
// a push notification. This is the only path that creates polls — the new-poll
// page POSTs here and never inserts directly.
//
// Response: 201 + the created poll row. The client redirects to the poll
// detail page on success.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await ctx.params;
  const supabase = await createSupabaseServerClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = auth.user.id;

  let body: {
    title?: string;
    candidate_dates?: unknown;
    min_players?: number;
    min_block_minutes?: number;
    timezone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const candidateDates = Array.isArray(body.candidate_dates)
    ? body.candidate_dates.filter(
        (d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
      )
    : [];
  if (candidateDates.length === 0) {
    return NextResponse.json({ error: "Pick at least one date." }, { status: 400 });
  }
  if (candidateDates.length > 60) {
    return NextResponse.json({ error: "Too many dates (max 60)." }, { status: 400 });
  }

  const minPlayers = Math.max(1, Math.min(20, Number(body.min_players) || 4));
  const minBlockMinutes = Math.max(30, Math.min(720, Number(body.min_block_minutes) || 120));
  const title = (body.title ?? "").toString().trim().slice(0, 120);
  const timezone = (body.timezone ?? "America/Los_Angeles").toString().slice(0, 64);

  // RLS check + insert under the caller's auth. If the user isn't a captain,
  // availability_polls_insert_captain rejects with a 42501 / RLS error.
  const { data: created, error: insErr } = await supabase
    .from("availability_polls")
    .insert({
      group_id: groupId,
      created_by_id: me,
      title,
      candidate_dates: candidateDates,
      min_players: minPlayers,
      min_block_minutes: minBlockMinutes,
      timezone,
    })
    .select("id, group_id, title, candidate_dates, min_players, min_block_minutes, timezone, status, created_at")
    .single();

  if (insErr || !created) {
    const msg = insErr?.message ?? "Could not create poll";
    const status = insErr?.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }

  // Notify all OTHER members. Use the admin client to bypass RLS so we can
  // insert one notification row per recipient and read the full member list.
  const admin = createSupabaseAdminClient();
  const { data: members } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);

  const recipientIds = (members ?? [])
    .map((m: { user_id: string }) => m.user_id)
    .filter((uid: string) => uid && uid !== me);

  if (recipientIds.length > 0) {
    const earliest = [...candidateDates].sort()[0];
    const bodyText = title
      ? title
      : `Mark when you're free between ${earliest} and beyond`;

    await admin.from("notifications").insert(
      recipientIds.map((uid: string) => ({
        user_id: uid,
        actor_id: me,
        type: "availability_poll" as const,
        poll_id: created.id,
      })),
    );

    // Fire-and-forget push fanout: don't block the response on APN.
    void postPushFanout(recipientIds, {
      title: "New availability poll",
      body: bodyText,
      data: {
        kind: "availability_poll",
        pollId: created.id,
        groupId,
      },
    });
  }

  return NextResponse.json(created, { status: 201 });
}
