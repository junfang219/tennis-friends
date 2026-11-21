import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  viewerFrom: vi.fn(),
  getUser: vi.fn(),
  getPost: vi.fn(),
  notFound: vi.fn((): never => { throw new Error("not found"); }),
  redirect: vi.fn((url: string): never => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.adminFrom }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.viewerFrom }),
}));
vi.mock("@/lib/supabase/queries/posts", () => ({ getPost: mocks.getPost }));
vi.mock("@/lib/supabase/adapters", () => ({ toPostCamel: (post: unknown) => post }));
vi.mock("@/components/PostCard", () => ({
  default: ({ post }: { post: { content: string } }) => <p>{post.content}</p>,
}));
vi.mock("@/components/GuestRsvpForm", () => ({ GuestRsvpForm: () => <p>Guest RSVP</p> }));

import PostPage, { generateMetadata } from "./page";

const postId = "33333333-3333-4333-8333-333333333333";
const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const bookingId = "44444444-4444-4444-8444-444444444444";
const post = {
  id: postId,
  author_id: ownerId,
  post_type: "find_players",
  visibility: "private",
  content: "Owner's test session",
  court_location: "Test court",
  play_date: "2026-11-21",
  play_time: "13:30",
  players_needed: 1,
};

function queryFor(row: Record<string, unknown>) {
  let matches = true;
  const query = {
    select: () => query,
    eq: vi.fn((key: string, value: unknown) => {
      matches = matches && row[key] === value;
      return query;
    }),
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: matches ? row : null, error: null }),
  };
  return query;
}

const props = { params: Promise.resolve({ id: postId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  mocks.adminFrom.mockImplementation(() => queryFor(post));
  mocks.viewerFrom.mockImplementation(() => queryFor({
    id: bookingId, user_id: ownerId, session_post_id: postId,
  }));
  mocks.getPost.mockResolvedValue(post);
});

it("excludes a private Find players post from the public page and social metadata", async () => {
  await expect(PostPage(props)).rejects.toThrow("not found");
  const metadata = await generateMetadata(props);
  expect(metadata.title).toBe("Game not found · Tennis Friends");
  expect(metadata.openGraph).toBeUndefined();
});

it("preserves the preview and RSVP form for an eligible shared post", async () => {
  mocks.adminFrom.mockImplementation(() => queryFor({ ...post, visibility: "friends" }));
  const html = renderToStaticMarkup(await PostPage(props));
  expect(html).toContain("Guest RSVP");
  expect(html).toContain("Test court");
  expect((await generateMetadata(props)).description).toContain("Test court");
  expect(html).not.toContain("View saved booking");
});

it("shows the exact saved booking link to the post and booking owner", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } } });
  const html = renderToStaticMarkup(await PostPage(props));
  expect(html).toContain("View saved booking");
  expect(html).toContain(`/bookings?booking=${bookingId}`);
  expect(html).toContain("test session");
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});

it("withholds the booking link from a different signed-in account", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: otherId } } });
  await expect(PostPage(props)).rejects.toThrow(`redirect:/?post=${postId}`);
  expect(mocks.getPost).not.toHaveBeenCalled();
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});
