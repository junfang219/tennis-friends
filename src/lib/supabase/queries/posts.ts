"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Inserts } from "../types";

// Lean shape matching POST_COLUMNS. Excludes generated columns like
// broadcast_location that we never read on the client.
export interface PostRow {
  id: string;
  author_id: string;
  content: string;
  media_url: string;
  media_type: string;
  post_type: "regular" | "find_players" | "propose_team" | "event";
  play_date: string;
  play_time: string;
  play_duration: number;
  court_location: string;
  game_type: string;
  players_needed: number;
  players_confirmed: number;
  skill_min: number | null;
  skill_max: number | null;
  court_booked: boolean;
  is_complete: boolean;
  comments_disabled: boolean;
  manual_players: string;
  team_group_id: string;
  is_broadcast: boolean;
  broadcast_radius_mi: number;
  broadcast_lat: number | null;
  broadcast_lng: number | null;
  event_id: string | null;
  pinned_at: string | null;
  created_at: string;
  author: { id: string; name: string; profile_image_url: string };
  photos: { id: string; url: string; order: number }[];
  // Reverse-FK from chats.post_id. Populated when the auto-create-chat
  // trigger has fired (find_players post flipped to is_complete = true).
  // Embedded as an array because PostgREST doesn't know the chats.post_id
  // unique partial index makes this 0-or-1; we collapse to a scalar in
  // toPostCamel.
  session_chat: { id: string }[];
}

export type Post = PostRow & {
  like_count: number;
  comment_count: number;
  is_liked: boolean;
  // The signed-in user's own play_request against this post, if any.
  // Null when not signed in, when no request exists, or for the post's
  // own author. PostCard reads this to render the collapsed "Open team"
  // CTA for approved players (alongside the post creator).
  my_play_request: { id: string; status: string; note: string } | null;
  // The post's audience targets, resolved from post_targets. Empty arrays
  // mean a default friends-visibility post. PostCard reads these to render
  // the audience badge AND to pre-select the right groups when editing —
  // an empty list here would make an edit silently wipe the targets.
  groups: { id: string; name: string }[];
  friend_groups: { id: string; name: string }[];
  // Populated for cross-posts created when a new event is published
  // (post_type='event', event_id set). PostCard renders an EventChip
  // from this so the card shows date / venue / type at a glance.
  // Null for non-event posts and when the linked event was deleted.
  event: {
    id: string;
    title: string;
    event_type: string;
    start_date: string;
    end_date: string;
    venue_name: string;
    status: string;
  } | null;
};

export type PostInsert = Inserts<"posts">;

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  // NULL for top-level comments; set to the parent comment id for replies.
  parent_comment_id: string | null;
  created_at: string;
  // NULL until the author edits the comment. Set by a BEFORE UPDATE
  // trigger when content actually changes.
  updated_at: string | null;
  author: { id: string; name: string; profile_image_url: string };
}

const POST_COLUMNS = `
  id, author_id, content, media_url, media_type, post_type,
  play_date, play_time, play_duration, court_location, game_type,
  players_needed, players_confirmed, skill_min, skill_max, court_booked,
  is_complete, comments_disabled, manual_players, team_group_id,
  is_broadcast, broadcast_radius_mi, broadcast_lat, broadcast_lng,
  event_id, pinned_at, created_at,
  author:profiles!posts_author_id_fkey ( id, name, profile_image_url ),
  photos ( id, url, "order" ),
  session_chat:chats!chats_post_id_fkey ( id )
`;

/**
 * Fetch the feed for the signed-in user. RLS does the heavy lifting via the
 * can_see_post() helper: friend visibility + group targets + broadcasts +
 * event cross-posts + blocked-pair exclusion all happen server-side.
 */
export async function listFeed(
  supabase: SupabaseClient<Database>,
  opts: { limit?: number; before?: string } = {}
): Promise<Post[]> {
  let q = supabase
    .from("posts")
    .select(POST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);

  const { data: posts, error } = await q;
  if (error) throw error;
  if (!posts || posts.length === 0) return [];

  return enrichPosts(supabase, posts as unknown as PostRow[]);
}

/**
 * Fetch the posts targeted at a single group (the team page feed). Mirrors
 * listFeed, but inner-joins post_targets so only posts cross-posted to this
 * group come back. RLS still applies via can_see_post() — non-members get an
 * empty list. Ordered newest-first like the main feed.
 */
export async function listGroupFeed(
  supabase: SupabaseClient<Database>,
  groupId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<Post[]> {
  let q = supabase
    .from("posts")
    .select(`${POST_COLUMNS}, post_targets!inner ( group_id, target_kind )`)
    .eq("post_targets.target_kind", "group")
    .eq("post_targets.group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);

  const { data: posts, error } = await q;
  if (error) throw error;
  if (!posts || posts.length === 0) return [];

  return enrichPosts(supabase, posts as unknown as PostRow[]);
}

export async function getPost(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Post | null> {
  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [enriched] = await enrichPosts(supabase, [data as unknown as PostRow]);
  return enriched;
}

export async function listPostsByAuthor(
  supabase: SupabaseClient<Database>,
  authorId: string,
  opts: { limit?: number } = {}
): Promise<Post[]> {
  const { data, error } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw error;
  return enrichPosts(supabase, (data ?? []) as unknown as PostRow[]);
}

/** Add like_count, comment_count, is_liked to a batch of posts. */
async function enrichPosts(
  supabase: SupabaseClient<Database>,
  posts: PostRow[]
): Promise<Post[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id ?? null;

  // event_id values across this page of posts. Used to batch-fetch the
  // linked events without an N+1. Embedding via the posts_event_id_fkey
  // FK in POST_COLUMNS would be cleaner, but the listGroupFeed
  // post_targets!inner select already nests one relation — adding a
  // second embed there starts to bend PostgREST. One extra .in() query
  // is simpler and still O(1).
  const eventIds = Array.from(
    new Set(
      posts
        .map((p) => p.event_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [likesRes, commentsRes, myLikesRes, myRequestsRes, targetsRes, eventsRes] =
    await Promise.all([
      supabase.from("likes").select("post_id", { count: "exact", head: false }).in("post_id", ids),
      supabase
        .from("comments")
        .select("post_id", { count: "exact", head: false })
        .in("post_id", ids),
      me
        ? supabase.from("likes").select("post_id").eq("user_id", me).in("post_id", ids)
        : Promise.resolve({ data: [] as { post_id: string }[], error: null }),
      me
        ? supabase
            .from("play_requests")
            .select("id, post_id, status, note")
            .eq("user_id", me)
            .in("post_id", ids)
        : Promise.resolve({
            data: [] as { id: string; post_id: string; status: string; note: string }[],
            error: null,
          }),
      // Audience targets + their display names. RLS (post_targets_select_visible)
      // only returns rows for posts the viewer can already see, which these are.
      // The embedded group/friend_group name may be null if the viewer can't read
      // that row, so we fall back to the FK id as the source of truth.
      supabase
        .from("post_targets")
        .select(
          "post_id, target_kind, group_id, friend_group_id, groups ( id, name ), friend_groups ( id, name )"
        )
        .in("post_id", ids),
      eventIds.length > 0
        ? supabase
            .from("events")
            .select(
              "id, title, event_type, start_date, end_date, venue_name, status"
            )
            .in("id", eventIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              title: string;
              event_type: string;
              start_date: string;
              end_date: string;
              venue_name: string;
              status: string;
            }[],
            error: null,
          }),
    ]);

  if (targetsRes.error) throw targetsRes.error;
  if (likesRes.error) throw likesRes.error;
  if (commentsRes.error) throw commentsRes.error;
  if (myLikesRes.error) throw myLikesRes.error;
  if (myRequestsRes.error) throw myRequestsRes.error;
  if (eventsRes.error) throw eventsRes.error;

  const likeCount = new Map<string, number>();
  for (const row of likesRes.data ?? []) {
    likeCount.set(row.post_id, (likeCount.get(row.post_id) ?? 0) + 1);
  }
  const commentCount = new Map<string, number>();
  for (const row of commentsRes.data ?? []) {
    commentCount.set(row.post_id, (commentCount.get(row.post_id) ?? 0) + 1);
  }
  const myLiked = new Set((myLikesRes.data ?? []).map((r) => r.post_id));
  // post_id -> the signed-in user's request row (1:1 by unique
  // (post_id, user_id) index, so the map is unambiguous).
  const myRequestByPost = new Map<
    string,
    { id: string; status: string; note: string }
  >();
  for (const r of myRequestsRes.data ?? []) {
    myRequestByPost.set(r.post_id, { id: r.id, status: r.status, note: r.note });
  }

  const groupsByPost = new Map<string, { id: string; name: string }[]>();
  const friendGroupsByPost = new Map<string, { id: string; name: string }[]>();
  for (const row of (targetsRes.data ?? []) as TargetRow[]) {
    if (row.target_kind === "group" && row.group_id) {
      const arr = groupsByPost.get(row.post_id) ?? [];
      arr.push({ id: row.group_id, name: row.groups?.name ?? "" });
      groupsByPost.set(row.post_id, arr);
    } else if (row.target_kind === "friend_group" && row.friend_group_id) {
      const arr = friendGroupsByPost.get(row.post_id) ?? [];
      arr.push({ id: row.friend_group_id, name: row.friend_groups?.name ?? "" });
      friendGroupsByPost.set(row.post_id, arr);
    }
  }

  const eventById = new Map<
    string,
    {
      id: string;
      title: string;
      event_type: string;
      start_date: string;
      end_date: string;
      venue_name: string;
      status: string;
    }
  >();
  for (const e of eventsRes.data ?? []) {
    eventById.set(e.id, e);
  }

  return posts.map((p) => ({
    ...p,
    like_count: likeCount.get(p.id) ?? 0,
    comment_count: commentCount.get(p.id) ?? 0,
    is_liked: myLiked.has(p.id),
    my_play_request: myRequestByPost.get(p.id) ?? null,
    groups: groupsByPost.get(p.id) ?? [],
    friend_groups: friendGroupsByPost.get(p.id) ?? [],
    event: p.event_id ? eventById.get(p.event_id) ?? null : null,
  }));
}

// Shape of a post_targets row joined to its group/friend_group name. PostgREST
// types the embedded relations loosely (they can arrive as an object or null),
// so we narrow them here for the enrichPosts mapping.
type TargetRow = {
  post_id: string;
  target_kind: "group" | "friend_group";
  group_id: string | null;
  friend_group_id: string | null;
  groups: { id: string; name: string } | null;
  friend_groups: { id: string; name: string } | null;
};

export async function createPost(
  supabase: SupabaseClient<Database>,
  input: Omit<PostInsert, "author_id"> & { photoUrls?: string[] }
): Promise<Post> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");

  const { photoUrls = [], ...postInput } = input;
  const { data: row, error } = await supabase
    .from("posts")
    .insert({ ...postInput, author_id: auth.user.id })
    .select(POST_COLUMNS)
    .single();
  if (error) throw error;

  if (photoUrls.length > 0) {
    const photoRows = photoUrls.map((url, i) => ({
      post_id: row.id,
      url,
      order: i,
    }));
    const { error: photoErr } = await supabase.from("photos").insert(photoRows);
    if (photoErr) throw photoErr;
  }

  const fetched = await getPost(supabase, row.id);
  if (!fetched) throw new Error("Post vanished after insert");
  return fetched;
}

export async function deletePost(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
}

export async function likePost(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("likes")
    .insert({ post_id: postId, user_id: auth.user.id });
  if (error && !error.message.includes("duplicate")) throw error;
}

export async function unlikePost(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", auth.user.id);
  if (error) throw error;
}

export async function hidePost(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("hidden_posts")
    .insert({ post_id: postId, user_id: auth.user.id });
  if (error && !error.message.includes("duplicate")) throw error;
}

export async function listComments(
  supabase: SupabaseClient<Database>,
  postId: string
): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select(
      `id, post_id, author_id, content, parent_comment_id, created_at, updated_at,
       author:profiles!comments_author_id_fkey ( id, name, profile_image_url )`
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Comment[];
}

export async function addComment(
  supabase: SupabaseClient<Database>,
  postId: string,
  content: string,
  // Optional parent comment for threaded replies. Leave undefined / null
  // for top-level comments. The DB trigger reads this to decide whether
  // to notify the post author (top-level) or the parent comment's
  // author (reply).
  parentCommentId?: string | null
): Promise<Comment> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_id: auth.user.id,
      content,
      parent_comment_id: parentCommentId ?? null,
    })
    .select(
      `id, post_id, author_id, content, parent_comment_id, created_at, updated_at,
       author:profiles!comments_author_id_fkey ( id, name, profile_image_url )`
    )
    .single();
  if (error) throw error;
  return data as Comment;
}

/**
 * Edit the content of an existing comment. RLS (comments_update_self)
 * restricts this to the author. The BEFORE UPDATE trigger bumps
 * updated_at when content actually changes, so the returned row has
 * the new timestamp and the UI can show "(edited)".
 */
export async function updateComment(
  supabase: SupabaseClient<Database>,
  commentId: string,
  content: string
): Promise<Comment> {
  const { data, error } = await supabase
    .from("comments")
    .update({ content })
    .eq("id", commentId)
    .select(
      `id, post_id, author_id, content, parent_comment_id, created_at, updated_at,
       author:profiles!comments_author_id_fkey ( id, name, profile_image_url )`
    )
    .single();
  if (error) throw error;
  return data as Comment;
}

/**
 * Delete a comment. RLS restricts to the author. ON DELETE CASCADE on
 * the self-FK (comments.parent_comment_id) removes child replies, and
 * the FK from notifications.comment_id removes any notifications
 * still pointing at the row — both happen at the DB layer.
 */
export async function deleteComment(
  supabase: SupabaseClient<Database>,
  commentId: string
): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;
}
