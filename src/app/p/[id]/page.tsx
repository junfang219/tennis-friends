import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicSiteUrl } from "@/lib/siteUrl";
import { GuestRsvpForm } from "@/components/GuestRsvpForm";

// Public OG / canonical URL base.
const SITE_URL = publicSiteUrl();

type Params = { id: string };

type PublicAuthor = { id: string; name: string | null; profile_image_url: string | null };

type PublicLfpPost = {
  id: string;
  post_type: string | null;
  play_date: string | null;
  play_time: string | null;
  play_duration: number | null;
  court_location: string | null;
  game_type: string | null;
  players_needed: number | null;
  players_confirmed: number | null;
  skill_min: number | null;
  skill_max: number | null;
  content: string | null;
  author: PublicAuthor | null;
};

async function fetchLfpPost(id: string): Promise<PublicLfpPost | null> {
  // UUIDs identify a post unguessably, so URL = capability. We use the admin
  // client to bypass RLS for this read-only public view, then gate on
  // post_type so only "find_players" posts are ever rendered here.
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "id, post_type, play_date, play_time, play_duration, court_location, game_type, players_needed, players_confirmed, skill_min, skill_max, content, author:profiles!posts_author_id_fkey(id, name, profile_image_url)"
    )
    .eq("id", id)
    .eq("post_type", "find_players")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as PublicLfpPost;
  return row;
}

function formatPlayDate(playDate: string): string {
  const d = new Date(`${playDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return playDate;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatPlayTime(t: string): string {
  const [hh, mm] = t.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return t;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

function formatGameType(g: string): string {
  return g
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function formatSkill(min: number | null, max: number | null): string {
  if (min == null && max == null) return "";
  if (min != null && max != null) {
    if (min === max) return `NTRP ${min.toFixed(1)}`;
    return `NTRP ${min.toFixed(1)}–${max.toFixed(1)}`;
  }
  if (min != null) return `NTRP ${min.toFixed(1)}+`;
  return `NTRP up to ${max!.toFixed(1)}`;
}

function buildDescription(post: PublicLfpPost): string {
  const parts: string[] = [];
  const whenBits: string[] = [];
  if (post.play_date) whenBits.push(formatPlayDate(post.play_date));
  if (post.play_time) whenBits.push(formatPlayTime(post.play_time));
  if (whenBits.length) parts.push(whenBits.join(" · "));
  if (post.play_duration) parts.push(`${post.play_duration} min`);
  if (post.court_location) parts.push(post.court_location);
  const skill = formatSkill(post.skill_min, post.skill_max);
  if (skill) parts.push(skill);
  return parts.join(" · ");
}

function buildHeadline(post: PublicLfpPost): string {
  const need = post.players_needed ?? 0;
  const word = need === 1 ? "player" : "players";
  const type = post.game_type ? `${formatGameType(post.game_type)} tennis` : "tennis";
  return need > 0
    ? `Looking for ${need} ${word} — ${type}`
    : `Looking for players — ${type}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await fetchLfpPost(id);
  const canonicalUrl = `${SITE_URL}/p/${id}`;

  if (!post) {
    return {
      title: "Game not found · Tennis Friends",
      description: "This game post is no longer available.",
    };
  }

  const headline = buildHeadline(post);
  const description = buildDescription(post);
  const title = `🎾 ${headline}`;

  return {
    title,
    description,
    openGraph: {
      type: "website",
      url: canonicalUrl,
      title,
      description,
      siteName: "Tennis Friends",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
    alternates: { canonical: canonicalUrl },
  };
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  // Signed-in users get the full in-app experience (post modal in the feed)
  // instead of the stripped public preview.
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (user) redirect(`/?post=${id}`);

  const post = await fetchLfpPost(id);
  if (!post) notFound();

  const headline = buildHeadline(post);
  const author = post.author;
  const spotsLeft = Math.max(
    0,
    (post.players_needed ?? 0) - (post.players_confirmed ?? 0)
  );
  const isFull = post.players_needed != null && spotsLeft === 0;

  const signupHref = `/register?next=${encodeURIComponent(`/p/${id}`)}`;
  const loginHref = `/login?redirectTo=${encodeURIComponent(`/p/${id}`)}`;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-surface px-4 py-10">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <p className="text-xs uppercase tracking-widest font-bold text-court-green/70">
            Tennis Friends
          </p>
          <h1 className="font-display text-2xl font-bold text-court-green mt-1">
            You&apos;ve been invited to a game
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-court-green-pale/20 overflow-hidden">
          <div className="bg-gradient-to-br from-court-green to-court-green-soft px-6 py-5 text-white">
            <div className="flex items-center gap-3">
              {author?.profile_image_url ? (
                // Avoiding the Next/Image domain config dance for an
                // unauthenticated server page — plain img is fine here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={author.profile_image_url}
                  alt={author.name ?? "Host"}
                  className="w-12 h-12 rounded-full object-cover ring-2 ring-white/60"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                  {(author?.name ?? "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-ball-yellow/90 font-semibold">
                  Hosted by
                </p>
                <p className="font-semibold truncate">{author?.name ?? "A player"}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest font-bold text-court-green">
                {isFull ? "Full" : "Looking for players"}
              </p>
              <h2 className="font-display text-xl font-bold text-gray-900 mt-1">
                {headline}
              </h2>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {post.play_date && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Date
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {formatPlayDate(post.play_date)}
                  </dd>
                </div>
              )}
              {(post.play_time || post.play_duration) && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Time
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {post.play_time ? formatPlayTime(post.play_time) : ""}
                    {post.play_duration ? (
                      <span className="text-gray-500"> · {post.play_duration} min</span>
                    ) : null}
                  </dd>
                </div>
              )}
              {post.court_location && (
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Court
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {post.court_location}
                  </dd>
                </div>
              )}
              {post.game_type && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Type
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {formatGameType(post.game_type)}
                  </dd>
                </div>
              )}
              {formatSkill(post.skill_min, post.skill_max) && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Skill
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {formatSkill(post.skill_min, post.skill_max)}
                  </dd>
                </div>
              )}
              {post.players_needed != null && (
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    Spots
                  </dt>
                  <dd className="text-gray-900 font-medium mt-0.5">
                    {(post.players_confirmed ?? 0)}/{post.players_needed} confirmed
                    {!isFull && (
                      <span className="text-court-green ml-1">
                        · {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} open
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>

            {post.content && (
              <p className="text-sm text-gray-700 whitespace-pre-line border-t border-gray-100 pt-3">
                {post.content}
              </p>
            )}
          </div>

          <div className="px-6 py-5 bg-gray-50 border-t border-gray-100 space-y-2.5">
            <Link
              href={signupHref}
              className="block w-full text-center py-3 rounded-xl bg-court-green text-white font-semibold shadow-md hover:bg-court-green-soft transition-colors"
            >
              {isFull ? "Sign up to find your game" : "Sign up to join"}
            </Link>
            <Link
              href={loginHref}
              className="block w-full text-center py-3 rounded-xl bg-white text-court-green font-semibold border border-court-green-pale hover:bg-court-green-pale/30 transition-colors"
            >
              Already a member? Log in
            </Link>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">or</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <GuestRsvpForm
              postId={id}
              hostName={author?.name ?? "the host"}
              signupHref={signupHref}
            />

            <p className="text-[11px] text-center text-gray-400 pt-1">
              Tennis Friends is the social network for tennis players. Free to join.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
