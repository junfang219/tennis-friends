import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicSupabaseUrl } from "@/lib/supabase/env";
import type { ReportTarget } from "./contracts";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Evidence = { authorId: string; content: string; media: string[] };

const messageTables = {
  direct_message: "messages",
  chat_message: "chat_messages",
  team_message: "group_messages",
} as const;

export function reviewableMediaUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin === new URL(publicSupabaseUrl()).origin && !url.username && !url.password &&
        url.pathname.startsWith("/storage/v1/object/public/")) return url.href;
  } catch {
    return null;
  }
  return null;
}

// Use the reporter's session for every target read, including media. The
// elevated client must never read a target on behalf of an ordinary viewer.
export async function readReportEvidence(db: Client, target: ReportTarget, id: string): Promise<Evidence | null> {
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
