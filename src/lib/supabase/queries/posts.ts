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
}

export type Post = PostRow & {
  like_count: number;
  comment_count: number;
  is_liked: boolean;
};

export type PostInsert = Inserts<"posts">;

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
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
  photos ( id, url, "order" )
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

  const [likesRes, commentsRes, myLikesRes] = await Promise.all([
    supabase.from("likes").select("post_id", { count: "exact", head: false }).in("post_id", ids),
    supabase
      .from("comments")
      .select("post_id", { count: "exact", head: false })
      .in("post_id", ids),
    me
      ? supabase.from("likes").select("post_id").eq("user_id", me).in("post_id", ids)
      : Promise.resolve({ data: [] as { post_id: string }[], error: null }),
  ]);

  if (likesRes.error) throw likesRes.error;
  if (commentsRes.error) throw commentsRes.error;
  if (myLikesRes.error) throw myLikesRes.error;

  const likeCount = new Map<string, number>();
  for (const row of likesRes.data ?? []) {
    likeCount.set(row.post_id, (likeCount.get(row.post_id) ?? 0) + 1);
  }
  const commentCount = new Map<string, number>();
  for (const row of commentsRes.data ?? []) {
    commentCount.set(row.post_id, (commentCount.get(row.post_id) ?? 0) + 1);
  }
  const myLiked = new Set((myLikesRes.data ?? []).map((r) => r.post_id));

  return posts.map((p) => ({
    ...p,
    like_count: likeCount.get(p.id) ?? 0,
    comment_count: commentCount.get(p.id) ?? 0,
    is_liked: myLiked.has(p.id),
  }));
}

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
      `id, post_id, author_id, content, created_at,
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
  content: string
): Promise<Comment> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("comments")
    .insert({ post_id: postId, author_id: auth.user.id, content })
    .select(
      `id, post_id, author_id, content, created_at,
       author:profiles!comments_author_id_fkey ( id, name, profile_image_url )`
    )
    .single();
  if (error) throw error;
  return data as Comment;
}
