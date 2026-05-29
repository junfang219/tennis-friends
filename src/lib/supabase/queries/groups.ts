"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types";
import { getMyIdFast } from "./_authFast";
import { getCached, setCached } from "../../queryCache";

export interface Group {
  id: string;
  name: string;
  image_url: string;
  cover_image_url: string;
  cover_offset_y: number;
  cover_scale: number;
  owner_id: string;
  member_types: unknown;
  reminder_prefs: unknown;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: "owner" | "manager" | "captain" | "member";
  member_type: string;
  created_at: string;
  last_read_at: string;
  muted: boolean;
  pinned_at: string | null;
  hidden_at: string | null;
  cleared_at: string | null;
  archived_at: string | null;
  user: {
    id: string;
    name: string;
    profile_image_url: string;
    ntrp_rating: number | null;
  };
}

const GROUP_COLUMNS =
  "id, name, image_url, cover_image_url, cover_offset_y, cover_scale, owner_id, member_types, reminder_prefs, created_at, updated_at";

/**
 * Groups the signed-in user belongs to (any role). The default
 * filter excludes rows the caller has archived (group_members.
 * archived_at NOT NULL); pass `{ archived: true }` to fetch only
 * the archived list for the Archived Teams collapsible.
 */
export async function listMyGroups(
  supabase: SupabaseClient<Database>,
  opts: { archived?: boolean } = {}
): Promise<Group[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  let q = supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", auth.user.id);
  q = opts.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data: memberships, error: mErr } = await q;
  if (mErr) throw mErr;
  const groupIds = (memberships ?? []).map((m) => m.group_id);
  if (groupIds.length === 0) return [];

  const { data, error } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .in("id", groupIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Group[];
}

// Cross-tab cache for the team header data. The team page primes these when
// it loads; the action tabs (chat, availability, practice, calendar, albums,
// files) read them synchronously for an instant first paint and revalidate in
// the background. Wiped on sign-out via clearAllCached().
const GROUP_KEY = (id: string) => `group:${id}`;
const GROUP_MEMBERS_KEY = (id: string) => `group-members:${id}`;

export function getCachedGroup(id: string): Group | undefined {
  return getCached<Group>(GROUP_KEY(id));
}

export function getCachedGroupMembers(groupId: string): GroupMember[] | undefined {
  return getCached<GroupMember[]>(GROUP_MEMBERS_KEY(groupId));
}

/** Cached group + members, or null if either side hasn't been fetched yet. */
export function getCachedGroupBundle(
  id: string
): { group: Group; members: GroupMember[] } | null {
  const group = getCachedGroup(id);
  const members = getCachedGroupMembers(id);
  return group && members ? { group, members } : null;
}

export async function getGroup(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Group | null> {
  const { data, error } = await supabase
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const group = (data as Group | null) ?? null;
  if (group) setCached(GROUP_KEY(id), group);
  return group;
}

export async function listGroupMembers(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from("group_members")
    .select(
      `id, group_id, user_id, role, member_type, created_at, last_read_at, muted, pinned_at, hidden_at, cleared_at, archived_at,
       user:profiles!group_members_user_id_fkey ( id, name, profile_image_url, ntrp_rating )`
    )
    .eq("group_id", groupId)
    .is("archived_at", null);
  if (error) throw error;
  const members = (data ?? []) as unknown as GroupMember[];
  setCached(GROUP_MEMBERS_KEY(groupId), members);
  return members;
}

/**
 * Fetch group + members in parallel, populating the cross-tab cache. Pair with
 * getCachedGroupBundle() for stale-while-revalidate: render the cached bundle
 * immediately, then call this to refresh.
 */
export async function fetchGroupBundle(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<{ group: Group | null; members: GroupMember[] }> {
  const [group, members] = await Promise.all([
    getGroup(supabase, id),
    listGroupMembers(supabase, id),
  ]);
  return { group, members };
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  media_url: string;
  media_type: string;
  shared_post_id: string | null;
  kind: "chat" | "announcement";
  notify_email: boolean;
  pinned_at: string | null;
  poll_id: string | null;
  created_at: string;
  sender: { id: string; name: string; profile_image_url: string };
}

const GROUP_MESSAGE_COLUMNS = `
  id, group_id, sender_id, content, media_url, media_type, shared_post_id,
  kind, notify_email, pinned_at, poll_id, created_at,
  sender:profiles!group_messages_sender_id_fkey ( id, name, profile_image_url )
`;

export async function listGroupMessages(
  supabase: SupabaseClient<Database>,
  groupId: string,
  opts: { limit?: number } = {}
): Promise<GroupMessage[]> {
  const { data, error } = await supabase
    .from("group_messages")
    .select(GROUP_MESSAGE_COLUMNS)
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (error) throw error;
  return (data ?? []).reverse() as unknown as GroupMessage[];
}

/**
 * Inbox row for a team group chat. Mirrors the DMThread / Chat shapes so
 * the /chat page can fold team chats into the same list of conversations.
 */
export interface TeamThread {
  group: { id: string; name: string; image_url: string };
  last_message: {
    id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    created_at: string;
  } | null;
  unread_count: number;
  muted: boolean;
  pinned_at: string | null;
  /** Non-null when this group is the backing chat for an Event. */
  event_id: string | null;
}

/** Inbox: every team chat the user is a member of (not hidden / archived). */
export async function listMyTeamThreads(
  supabase: SupabaseClient<Database>
): Promise<TeamThread[]> {
  const me = await getMyIdFast(supabase);
  if (!me) return [];

  const { data: memberships, error: mErr } = await supabase
    .from("group_members")
    .select("group_id, last_read_at, muted, pinned_at")
    .eq("user_id", me)
    .is("archived_at", null)
    .is("hidden_at", null);
  if (mErr) throw mErr;
  const groupIds = (memberships ?? []).map((m) => m.group_id);
  if (groupIds.length === 0) return [];

  // Groups + recent messages + event backing in parallel.
  const [groupsRes, msgsRes, eventsRes] = await Promise.all([
    supabase
      .from("groups")
      .select("id, name, image_url")
      .in("id", groupIds),
    supabase
      .from("group_messages")
      .select(
        `id, group_id, sender_id, content, created_at,
         sender:profiles!group_messages_sender_id_fkey ( id, name )`
      )
      .in("group_id", groupIds)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("events")
      .select("id, host_group_id")
      .in("host_group_id", groupIds),
  ]);
  if (groupsRes.error) throw groupsRes.error;
  if (msgsRes.error) throw msgsRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const groupsById = new Map(
    (groupsRes.data ?? []).map((g) => [g.id, g as { id: string; name: string; image_url: string }])
  );
  const eventByGroup = new Map<string, string>();
  for (const e of eventsRes.data ?? []) {
    if (e.host_group_id) eventByGroup.set(e.host_group_id, e.id);
  }

  type MsgRow = {
    id: string;
    group_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    sender: { id: string; name: string };
  };
  const byGroup = new Map<string, MsgRow[]>();
  for (const m of (msgsRes.data ?? []) as unknown as MsgRow[]) {
    if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, []);
    byGroup.get(m.group_id)!.push(m);
  }

  const threads: TeamThread[] = [];
  for (const m of memberships ?? []) {
    const group = groupsById.get(m.group_id);
    if (!group) continue;
    const msgs = (byGroup.get(m.group_id) ?? []).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    const last = msgs[0] ?? null;
    const lastReadAt = m.last_read_at ?? "1970-01-01T00:00:00Z";
    const unread = msgs.filter(
      (msg) => msg.sender_id !== me && msg.created_at > lastReadAt
    ).length;
    threads.push({
      group,
      last_message: last
        ? {
            id: last.id,
            sender_id: last.sender_id,
            sender_name: last.sender.name,
            content: last.content,
            created_at: last.created_at,
          }
        : null,
      unread_count: unread,
      muted: !!m.muted,
      pinned_at: m.pinned_at ?? null,
      event_id: eventByGroup.get(group.id) ?? null,
    });
  }

  // Newest activity first; teams with no messages drop to the bottom in
  // group creation-time order (already implicit since msgs[] is empty
  // for those — null last_message sorts to "1970" and stays at the end).
  threads.sort((a, b) => {
    const at = a.last_message?.created_at ?? "1970-01-01T00:00:00Z";
    const bt = b.last_message?.created_at ?? "1970-01-01T00:00:00Z";
    return bt.localeCompare(at);
  });

  return threads;
}

/** Stamps group_members.last_read_at = now() for the signed-in user. */
export async function markTeamRead(
  supabase: SupabaseClient<Database>,
  groupId: string
): Promise<void> {
  const me = await getMyIdFast(supabase);
  if (!me) return;
  const { error } = await supabase
    .from("group_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", me);
  if (error) throw error;
}

export async function sendGroupMessage(
  supabase: SupabaseClient<Database>,
  groupId: string,
  content: string,
  opts: { mediaUrl?: string; mediaType?: string; kind?: "chat" | "announcement" } = {}
): Promise<GroupMessage> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("group_messages")
    .insert({
      group_id: groupId,
      sender_id: auth.user.id,
      content,
      media_url: opts.mediaUrl ?? "",
      media_type: opts.mediaType ?? "",
      kind: opts.kind ?? "chat",
    })
    .select(GROUP_MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as GroupMessage;
}
