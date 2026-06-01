"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { getMyIdFast } from "./_authFast";

const MESSAGE_COLUMNS =
  "id, sender_id, receiver_id, content, media_url, media_type, shared_post_id, created_at";

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  media_url: string;
  media_type: string;
  shared_post_id: string | null;
  created_at: string;
}

export interface DMThread {
  other: {
    id: string;
    name: string;
    profile_image_url: string;
  };
  last_message: DirectMessage;
  unread_count: number;
}

/** Messages exchanged with `otherId`, oldest first. */
export async function listDirectMessages(
  supabase: SupabaseClient<Database>,
  otherId: string,
  opts: { limit?: number } = {}
): Promise<DirectMessage[]> {
  // Cached snapshot first — avoids a ~60-90ms /auth/v1/user round trip on
  // every chat open. See getMyIdFast for the trust-boundary rationale.
  const me = await getMyIdFast(supabase);
  if (!me) return [];

  // Per-user "Clear chat history" soft-clear. direct_message_reads.cleared_at
  // hides everything older than that timestamp from THIS user's view; the
  // rows stay in the table so the other party still sees them.
  const { data: read } = await supabase
    .from("direct_message_reads")
    .select("cleared_at")
    .eq("user_id", me)
    .eq("other_id", otherId)
    .maybeSingle();
  const clearedAt = read?.cleared_at ?? null;

  let query = supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .or(
      `and(sender_id.eq.${me},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${me})`
    )
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 200);
  if (clearedAt) query = query.gt("created_at", clearedAt);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function sendDirectMessage(
  supabase: SupabaseClient<Database>,
  receiverId: string,
  content: string,
  opts: { mediaUrl?: string; mediaType?: string; sharedPostId?: string } = {}
): Promise<DirectMessage> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("messages")
    .insert({
      sender_id: auth.user.id,
      receiver_id: receiverId,
      content,
      media_url: opts.mediaUrl ?? "",
      media_type: opts.mediaType ?? "",
      shared_post_id: opts.sharedPostId ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as DirectMessage;
}

/** Delete a DM you sent. RLS policy `messages_delete_sender` enforces
 *  sender-only deletion at the DB level — this helper just wraps the call
 *  so consumers don't construct the query inline. */
export async function deleteDirectMessage(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) throw error;
}

export async function markDmRead(
  supabase: SupabaseClient<Database>,
  otherId: string
): Promise<void> {
  const me = await getMyIdFast(supabase);
  if (!me) throw new Error("Not signed in");
  const { error } = await supabase.from("direct_message_reads").upsert(
    {
      user_id: me,
      other_id: otherId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,other_id" }
  );
  if (error) throw error;
}

/** Inbox: list every DM thread with last-message + unread count. */
export async function listDmThreads(
  supabase: SupabaseClient<Database>
): Promise<DMThread[]> {
  const me = await getMyIdFast(supabase);
  if (!me) return [];

  const [msgsRes, readsRes] = await Promise.all([
    supabase
      .from("messages")
      .select(
        `id, sender_id, receiver_id, content, media_url, media_type, shared_post_id, created_at,
         sender:profiles!messages_sender_id_fkey ( id, name, profile_image_url ),
         receiver:profiles!messages_receiver_id_fkey ( id, name, profile_image_url )`
      )
      .or(`sender_id.eq.${me},receiver_id.eq.${me}`)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("direct_message_reads")
      .select("other_id, last_read_at, cleared_at")
      .eq("user_id", me),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  if (readsRes.error) throw readsRes.error;

  const readMap = new Map(
    (readsRes.data ?? []).map((r) => [
      r.other_id,
      { lastReadAt: r.last_read_at, clearedAt: r.cleared_at ?? null },
    ])
  );

  type MessageWithProfiles = DirectMessage & {
    sender: { id: string; name: string; profile_image_url: string };
    receiver: { id: string; name: string; profile_image_url: string };
  };

  // Group by partner.
  const byPartner = new Map<string, MessageWithProfiles[]>();
  for (const m of (msgsRes.data ?? []) as unknown as MessageWithProfiles[]) {
    const partnerId = m.sender_id === me ? m.receiver_id : m.sender_id;
    if (!byPartner.has(partnerId)) byPartner.set(partnerId, []);
    byPartner.get(partnerId)!.push(m);
  }

  const threads: DMThread[] = [];
  for (const [partnerId, msgs] of byPartner) {
    const state = readMap.get(partnerId);
    // Per-user "Clear chat history" soft-clear: drop everything older than
    // cleared_at from the inbox preview. A thread with no surviving messages
    // disappears entirely until a new message arrives.
    const clearedAt = state?.clearedAt ?? null;
    const visible = clearedAt
      ? msgs.filter((m) => m.created_at > clearedAt)
      : msgs;
    if (visible.length === 0) continue;
    visible.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const last = visible[0];
    const lastReadAt = state?.lastReadAt ?? "1970-01-01T00:00:00Z";
    const unread = visible.filter(
      (m) => m.receiver_id === me && m.created_at > lastReadAt
    ).length;
    threads.push({
      other: last.sender_id === me ? last.receiver : last.sender,
      last_message: last,
      unread_count: unread,
    });
  }

  threads.sort((a, b) =>
    b.last_message.created_at.localeCompare(a.last_message.created_at)
  );

  return threads;
}
