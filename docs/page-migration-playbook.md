# Page migration playbook

After the burn-down + compat shim, **the app typechecks** but most pages
still `fetch('/api/...')` against routes that no longer exist. The data
layer those pages should call is built and tested
(`src/lib/supabase/queries/`), and 60 / 60 integration tests confirm it
behaves correctly under RLS.

This doc captures the mechanical patterns so any contributor (or
follow-up Claude session) can finish the migration without re-deriving
the strategy.

## What's already migrated

| Page / component | Status |
|---|---|
| `/login`, `/register`, `/auth/reset`, `/auth/update-password`, `/auth/callback` | ✅ native Supabase Auth pages |
| `/onboarding` | ✅ `completeOnboarding(supabase, patch)` |
| `/profile` | ✅ load + save via `getMyProfile` / `updateMyProfile`; uploads/highlights still legacy |
| `/profile/[id]` | ✅ load via `getProfile` |
| `/notifications` | ✅ `listNotifications` + `markAllNotificationsRead` |
| `/` (home feed) | ✅ initial load + pull-to-refresh via `listFeed` |
| `MessageBell`, `NotificationBell` | ✅ realtime subscription |
| `/api/storage/sign-upload` | ✅ Supabase Storage signed-upload route |

## What still needs migration

About 217 `fetch('/api/...')` sites across 48 files. None of these
will work at runtime until migrated. They divide into two groups:

**Group A — query helper already exists, mechanical migration**
- `/friends`, `/friends/requests` — use `listFriends`, `listPendingRequests`, `sendFriendRequest`, `acceptFriendRequest`, `rejectFriendRequest`, `removeFriend`, `blockUser`, `unblockUser`
- `/chat/[userId]` — use `listDirectMessages`, `sendDirectMessage`, `markDmRead`
- `/chat` (inbox) — use `listDmThreads`
- `/groups`, `/groups/[id]` — use `listMyGroups`, `getGroup`, `listGroupMembers`, `listGroupMessages`, `sendGroupMessage`
- `/events`, `/events/[id]` — use `listEvents`, `getEvent`, `createEvent`, `listEventParticipants`, `signupForEvent`, `withdrawFromEvent`, `listEventMatches`
- `/courts`, `/courts/[id]` — use `listCourts`, `getCourt`, `addCourt`, `listCourtReviews`, `addCourtReview`
- `/search` — use `searchProfiles`
- `PostCard` (like/unlike/hide/comment) — use `likePost`, `unlikePost`, `hidePost`, `addComment`, `listComments`
- `PostComposer` (create post) — use `createPost`
- `FriendRequestButton` — use `sendFriendRequest`, `removeFriend`

**Group B — query helper needs to be added (and tested) first**
- `/chat/group/[chatId]` — needs `chat_messages` queries (sendChatMessage, listChatMessages, listChatParticipants)
- `/matchup` — needs `team_listings` queries (listTeamListings, createTeamListing)
- `/dashboard` — needs aggregation: upcoming events + team matches + practices for the user
- `/calendar` — same as dashboard plus iCal export shape
- `/invite/[token]` — needs `group_invites` queries (validateInvite, acceptInvite)
- `/events/new`, `/events/[id]/edit` — needs `updateEvent`
- `/groups/[id]/settings`, `/calendar`, `/chat`, `/files`, `/practice`, `/availability`, `/albums*` — each needs its own sub-resource query helpers (group_invites, team_matches, team_practices, match_availabilities, albums, album_items, group_files)
- `/chat/[userId]` + `/chat/group/*` reactions — needs `addReaction`, `removeReaction`
- `BottomNav` unread counts — needs an aggregated `getUnreadCounts` helper

## The migration pattern (per page)

### 1. Imports

```typescript
// Add at top:
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { funcA, funcB } from "@/lib/supabase/queries";
```

### 2. Replace `fetch('/api/X')` with the query call

Before:
```typescript
const res = await fetch("/api/foo");
const data = await res.json();
setFoo(data);
```

After:
```typescript
const supabase = createSupabaseBrowserClient();
const data = await listFoo(supabase);
setFoo(data);
```

### 3. Field-name shift: snake_case → camelCase

The Supabase queries return snake_case (matching Postgres column
names). Most existing page state is camelCase. Map at the boundary:

```typescript
const supabase = createSupabaseBrowserClient();
const p = await getMyProfile(supabase);
if (p) {
  setProfile({
    name: p.name,
    profileImageUrl: p.profile_image_url,   // ← rename
    skillLevel: p.skill_level,              // ← rename
    ntrpRating: p.ntrp_rating,              // ← rename
    // ...
  });
}
```

Eventually the page state should adopt snake_case natively. For now,
the boundary adapter is faster.

### 4. ID shape: cuid → uuid

Old fetch endpoints used cuid strings. Supabase uses uuids. Pages that
hold IDs in state don't care (both are opaque strings), but if any
code parsed cuid format (rare), it needs updating.

### 5. Auth errors

`fetch()` returned `401` for unauthenticated; query helpers either
return `null` (read paths) or `throw new Error("Not signed in")`
(write paths). Handle both:

```typescript
try {
  const data = await listFoo(supabase);
  if (data === null) router.replace("/login");
} catch (err) {
  setError(err instanceof Error ? err.message : String(err));
}
```

### 6. Realtime

Pages currently using `onAppEvent` from the deleted `/api/notifications/stream`
should switch to direct Supabase realtime subscriptions. See
`MessageBell` and `NotificationBell` for the pattern, or use the
`subscribeToTable` / `useRealtimeTable` helpers from
`src/lib/supabase/realtime.ts`.

## Adding a new query helper

When the page needs a query that doesn't exist yet, add it to the
appropriate `src/lib/supabase/queries/*.ts` file and write an
integration test in `tests/integration/queries.test.ts`. The pattern:

```typescript
export async function listFooByBar(
  supabase: SupabaseClient<Database>,
  barId: string
): Promise<Foo[]> {
  const { data, error } = await supabase
    .from("foos")
    .select(FOO_COLUMNS)
    .eq("bar_id", barId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Foo[];
}
```

```typescript
// in queries.test.ts
it("listFooByBar returns foos belonging to bar", async () => {
  // create a foo via admin, then verify alice can read it
  const list = await listFooByBar(alice.client, barId);
  expect(list.some((f) => f.id === fooId)).toBe(true);
});
```

Every new helper **must** ship with at least one integration test (per
project policy: prefer test coverage over production error reporting).

## What "done" looks like

- 0 `fetch('/api/...')` sites in `src/`
- All pages use Supabase queries
- All query helpers have integration test coverage
- `npm run test:integration` ≥ 80 tests, all green
- Lint clean in all new code
- Dev server starts (`npm run dev`) and the home page renders for a
  signed-in test user
- iPhone testing of the production build is the only remaining gate

## Estimated remaining effort

| Page | Existing query exists? | Approx effort |
|---|---|---|
| `/friends` | Yes (8 helpers) | 1.5h |
| `/chat/[userId]` | Yes | 30m |
| `/chat` inbox | Yes (listDmThreads) | 45m |
| `/chat/group/[chatId]` | No (chat_messages) | 1h + 30m for queries+tests |
| `/groups/[id]` (read-only) | Yes | 45m |
| `/groups/[id]/*` (all subpages) | Partial | 4h + 2h for queries+tests |
| `/events` listing | Yes | 30m |
| `/events/[id]` | Yes | 1h |
| `/events/new` + `/edit` | Yes + updateEvent | 1h + 30m for query |
| `/courts` + `/courts/[id]` | Yes | 1h |
| `/matchup` | No (team_listings) | 1h + 1h for queries+tests |
| `/search` | Yes (searchProfiles) | 30m |
| `/dashboard` + `/calendar` | No (aggregation) | 2h + 1.5h for queries+tests |
| `/invite/[token]` | No (group_invites) | 1h + 1h for queries+tests |
| `PostCard` | Yes | 1h |
| `PostComposer` | Yes (+ upload route exists) | 1h |
| `SharedPostCard` | Yes | 30m |
| `FriendRequestButton` | Yes | 20m |
| `BottomNav` unread | No (aggregator) | 30m + 30m for query |
| `SplitCostSheet`, `ReviewComposer`, etc. | Mostly yes | 2h total |

**Total estimate: ~25 hours** of focused mechanical migration + tests.

The "automated testing is feasible" line in the original directive
covers the query helpers (done — 60/60 integration tests, plus the RLS
+ realtime suites). Page-level e2e via Playwright is the next layer of
automation; once the migrations above are done the Playwright suite
can lock the user flows in place before iPhone testing.
