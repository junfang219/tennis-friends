import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicSupabaseUrl } from "@/lib/supabase/env";
import { parseManagedMediaPath } from "@/lib/supabase/storage";
import type { ReportTarget } from "./contracts";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Evidence = { authorId: string; content: string; media: string[] };

const messageTables = {
  direct_message: "messages",
  chat_message: "chat_messages",
  team_message: "group_messages",
} as const;

export function reviewableMediaUrl(value: string): string | null {
  if (parseManagedMediaPath(value)) return value;
  try {
    const url = new URL(value);
    if (url.origin !== new URL(publicSupabaseUrl()).origin || url.username || url.password) return null;
    const managed = url.pathname.replace(/^\/storage\/v1\/(object|render\/image)\/public\//, "/api/storage/media/");
    return parseManagedMediaPath(managed) ? managed : null;
  } catch {
    return null;
  }
}

// Use the reporter's session for every target read, including media. The
// elevated client must never read a target on behalf of an ordinary viewer.
export async function readReportEvidence(db: Client, target: ReportTarget, id: string): Promise<Evidence | null> {
  if (target === "profile") {
    const { data, error } = await db.from("profiles").select("id, name, bio, handle, profile_image_url, cover_image_url").eq("id", id).maybeSingle();
    if (error) throw error;
    return data && {
      authorId: data.id,
      content: [data.name, data.handle, data.bio].filter(Boolean).join("\n"),
      media: [data.profile_image_url, data.cover_image_url].filter(Boolean),
    };
  }
  if (target === "album") {
    const { data, error } = await db.from("albums").select("created_by_id, name, description").eq("id", id).maybeSingle();
    if (error) throw error;
    return data && { authorId: data.created_by_id, content: [data.name, data.description].filter(Boolean).join("\n"), media: [] };
  }
  if (target === "album_item") {
    const { data, error } = await db.from("album_items").select("added_by_id, caption, url").eq("id", id).maybeSingle();
    if (error) throw error;
    return data && { authorId: data.added_by_id, content: data.caption, media: [data.url] };
  }
  if (target === "court_review") {
    const { data, error } = await db.from("court_reviews").select("user_id, content").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const photos = await db.from("court_review_photos").select("url").eq("review_id", id).order("order").order("id");
    if (photos.error) throw photos.error;
    return { authorId: data.user_id, content: data.content, media: photos.data.map(photo => photo.url) };
  }
  if (target === "post") {
    const { data: post, error } = await db.from("posts").select("author_id, content").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!post) return null;
    const { data: photos, error: photoError } = await db.from("photos").select("url, thumbnail_url").eq("post_id", id).order("order").order("id");
    if (photoError) throw photoError;
    const attachments = photos ?? [];
    const media = [...attachments.map(photo => photo.url), ...attachments.map(photo => photo.thumbnail_url).filter(Boolean)];
    return { authorId: post.author_id, content: post.content, media };
  }
  if (target === "comment") {
    const { data, error } = await db.from("comments").select("author_id, content").eq("id", id).maybeSingle();
    if (error) throw error;
    return data && { authorId: data.author_id, content: data.content, media: [] };
  }
  const { data, error } = await db.from(messageTables[target])
    .select("sender_id, content, media_url").eq("id", id).maybeSingle();
  if (error) throw error;
  return data && { authorId: data.sender_id, content: data.content, media: data.media_url ? [data.media_url] : [] };
}

export async function getContentModerator() {
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  return user?.app_metadata?.content_moderator === true ? user : null;
}
