# Phase 5 cutover guide — migrating from Prisma + NextAuth to Supabase

## Status as of 2026-05-21

The legacy stack has been **burned down** (per user decision). The app
won't typecheck — exactly 36 errors remain, all in pages/components that
imported `next-auth/react` or `@prisma/client`. Each error is a guided
TODO for incremental migration.

**What survives:**
- `/login`, `/register`, `/auth/reset`, `/auth/update-password`,
  `/auth/callback` — Supabase Auth pages
- `/api/storage/sign-upload` — the one route built on Supabase
- All Supabase clients, RLS policies, Edge Function template
- The `useSupabaseUser()` hook in `src/lib/supabase/useUser.ts` for
  Client Components (replaces NextAuth's `useSession()`)
- 27 unit tests, 22 integration tests — all green against live Supabase

**What's gone:**
- Entire `prisma/` directory
- `src/lib/{prisma,auth,session,eventStream,rateLimit,push,teamGroup,sessionChat,eventGroup,eventCompetitive,tournamentAdvance,useArrivalDetection,friendship}.ts`
- `src/lib/events/visibility.ts` (now `public.can_see_event` SQL function)
- `src/types/next-auth.d.ts`
- 106 API route handlers under `src/app/api/` (all except `storage/sign-upload`)
- `@prisma/client`, `prisma`, `next-auth`, `@next-auth/prisma-adapter`,
  `bcryptjs` deps
- Prisma-dependent scripts in `scripts/`

**Estimated remaining effort:** 3-5 days of focused work for one developer.

This doc captures the mechanical patterns so the cutover can proceed
incrementally without re-deriving the strategy each time.

## Order of operations

1. **Pages and components that READ data** — replace `fetch('/api/...')`
   calls with direct `supabase.from(...).select(...)` calls. RLS already
   enforces visibility.
2. **Route handlers that survive** — see "Surviving routes" below. Replace
   their Prisma queries with Supabase queries; replace `auth()` with
   `requireSupabaseUser()`.
3. **Route handlers that die** — delete after their callers are migrated.
4. **Prisma teardown** — remove dependency, delete `prisma/` directory,
   delete `src/lib/prisma.ts`.
5. **NextAuth teardown** — remove dependency, delete `src/lib/auth.ts`
   and `src/lib/session.ts`, delete `src/app/api/auth/[...nextauth]/`,
   replace `/login` and `/register` with the new pages under `/auth/`.

## Per-call transformation patterns

### `useSession()` → `useSupabaseUser()` (Client Components)

Before:
```typescript
import { useSession } from "next-auth/react";

const { data: session, status } = useSession();
if (status === "loading") return <Spinner />;
if (!session?.user?.id) return <SignInPrompt />;
const userId = session.user.id; // cuid string
```

After:
```typescript
import { useSupabaseUser } from "@/lib/supabase/useUser";

const { user, loading } = useSupabaseUser();
if (loading) return <Spinner />;
if (!user) return <SignInPrompt />;
const userId = user.id; // uuid string — matches profiles.id
```

### `auth()` → `requireSupabaseUser()` (Server Components / Route Handlers)

Before:
```typescript
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  // ...
}
```

After:
```typescript
import { requireSupabaseUser } from "@/lib/supabase/auth";

export async function GET() {
  const user = await requireSupabaseUser();
  // user.id is the auth.users uuid — directly usable in Supabase queries
  // and matches every FK to profiles(id).
}
```

`requireSupabaseUser()` redirects to `/auth/login` for HTML routes. For
JSON routes, prefer `getSupabaseUser()` so you can return a typed 401
instead of a redirect.

### Prisma query → Supabase query

Before:
```typescript
import { prisma } from "@/lib/prisma";

const posts = await prisma.post.findMany({
  where: { authorId: userId },
  include: { likes: true, comments: true },
  orderBy: { createdAt: "desc" },
  take: 50,
});
```

After:
```typescript
import { createSupabaseServerClient } from "@/lib/supabase/server";

const supabase = await createSupabaseServerClient();
const { data: posts } = await supabase
  .from("posts")
  .select("*, likes(*), comments(*)")
  .eq("author_id", userId)
  .order("created_at", { ascending: false })
  .limit(50);
```

Column name shift: Prisma `camelCase` → Supabase `snake_case`. Type
errors will flag the rest.

### File upload → signed upload route

Before:
```typescript
const fd = new FormData();
fd.append("file", file);
const res = await fetch("/api/upload", { method: "POST", body: fd });
const { url } = await res.json();
```

After:
```typescript
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// 1. Ask the server for a signed URL.
const sigRes = await fetch("/api/storage/sign-upload", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    bucket: "posts",
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  }),
});
const { signedUrl, publicUrl } = await sigRes.json();

// 2. Upload directly to Supabase Storage (bypasses Next.js).
await fetch(signedUrl, { method: "PUT", body: file });

// publicUrl is what you persist on the row (post.media_url, etc.)
```

### SSE polling → Supabase Realtime

Before:
```typescript
useEffect(() => {
  const es = new EventSource("/api/notifications/stream");
  es.onmessage = (e) => handleEvent(JSON.parse(e.data));
  return () => es.close();
}, []);
```

After:
```typescript
import { useRealtimeTable } from "@/lib/supabase/realtime";

useRealtimeTable(
  {
    table: "notifications",
    event: "INSERT",
    filter: `user_id=eq.${me}`,
    onChange: (e) => handleEvent(e.new),
  },
  [me]
);
```

## Surviving route handlers (don't delete)

These genuinely need server-side logic that can't live entirely in RLS.
Keep them but rewrite to use the Supabase clients.

| Route | Why it survives |
|---|---|
| `POST /api/storage/sign-upload` | Mints signed upload URLs after validating size + ownership |
| `GET /api/posts` (feed) | Complex query: friends + broadcasts + event cross-posts + bounding-box. Single SQL query under the user's JWT. |
| `POST /api/posts/join/*` | Orchestration: insert PlayRequest + create notification + fan out push |
| `POST /api/events/{id}/{checkin,respond,dispute,report,confirm}` | Multi-row state machine; runs as service_role to bypass per-row RLS noise |
| `POST /api/groups/{id}/invites` | Email send via Resend |
| `POST /api/devices/register` | Server-only APNs token registration |
| `GET /api/calendar` | .ics export (templating); reads under user's session |
| `GET /api/geocode` | Nominatim proxy with rate limiting |
| `POST /api/report-issue` / `report-missing-court` | Resend email |
| `GET /auth/callback` | OAuth + email-confirmation code exchange (already migrated) |

## Routes to delete (after callers cut over)

Almost everything else under `src/app/api/`. The frontend should call
Supabase directly with the user's session JWT instead. RLS does the
authorization check that the route handler used to do by hand.

Concrete delete list:
- `/api/auth/[...nextauth]` and `/api/auth/register` and `/api/auth/phone/send`
- All of `/api/profile/*`, `/api/users/*`, `/api/notifications/*`,
  `/api/messages/*`, `/api/chats/{id}/messages`, `/api/friends/*`,
  `/api/comments`, `/api/polls/*/vote`, `/api/events/{id}/standings`,
  `/api/groups/{id}/messages`, `/api/groups/{id}/albums/*`,
  `/api/groups/{id}/files/*`, `/api/groups/{id}/practices/*`,
  `/api/posts/like`, `/api/posts/hide`
- `/api/upload`, `/api/uploads/[filename]` (legacy local-disk uploads)
- `/api/notifications/stream` (SSE)

## Code to delete

- `src/lib/auth.ts`, `src/lib/session.ts` (NextAuth)
- `src/lib/prisma.ts`
- `prisma/` directory
- `src/lib/eventStream.ts` (SSE client)
- `src/lib/rateLimit.ts` (replaced by Postgres-backed limiter — TBD)
- `src/lib/events/visibility.ts` (replaced by `can_see_event` SQL function)

## Dependencies to drop

```bash
npm uninstall @prisma/client @next-auth/prisma-adapter next-auth bcryptjs
npm uninstall -D prisma @types/bcryptjs
```

After this, `tsc --noEmit` will flag every file that still imports the
removed packages — that's your remaining migration TODO.

## Test discipline during the cutover

Per project policy (memory: `feedback_exhaust_automated_testing`),
exhaust automated tests at each phase:

- For each migrated route: add a Vitest integration test in
  `tests/integration/` that exercises the new code path as a real user.
- For pages with significant logic: add a Playwright test in `e2e/`.
- Run `npm run test:integration` after every change to catch RLS regressions.

Manual iPhone testing comes only after the automated suite passes,
reserved for things automation can't cover (HEIC, APNs, safe-area
insets, camera permissions).
