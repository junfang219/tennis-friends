# Plan: Production-Ready Supabase Backend for TennisFriend

> **Status:** Approved 2026-05-20. Implementation in progress (Phase 0).
> **Source of truth:** This file. Update it as decisions evolve.
>
> **Locked-in decisions:**
> - Architecture: **Pure Supabase** (drop Prisma + NextAuth; use Supabase Auth + Storage + Realtime + RLS)
> - Type safety: `@supabase/supabase-js` + generated `database.types.ts`. Drizzle deferred.
> - Region: `us-west-1` (AWS Oregon)
> - User-data migration: **none required** — no production users yet beyond the developer; fresh DB is acceptable
> - DB branching: deferred (revisit when contributor count grows)
> - Supabase MCP: paid plan; user authenticates on demand for direct project interaction

## Context

TennisFriend currently runs on **Next.js 15 + Prisma 6 + SQLite (single file, no migrations) + NextAuth (JWT) + local-disk uploads + SSE for realtime**. The schema has grown to **73 Prisma models** and **119 API route handlers**, covering posts/feed, events, groups/teams, team chat, DMs, friends, court reviews, polls, expenses, push notifications, and more.

The current setup is fine for the seed-stage demo but has several **launch-blockers** for scaling to thousands of users:

- SQLite cannot handle concurrent writes, has no managed backup, won't survive Vercel redeploys
- No migration history → no safe schema evolution
- Uploads live in `public/uploads/` and are wiped on every deploy
- SSE polls every ~25s and pins one TCP connection per user
- Rate limiting is in-memory (resets on restart, breaks under horizontal scale)
- No password reset, no email verification, no session expiry, no observability, no input validation

**The goal:** Migrate the persistence, auth, file storage, and realtime layers to Supabase, while building a production-grade, type-safe TypeScript integration path that the frontend can consume cleanly. End state must support thousands of concurrent users with sub-second realtime latency.

**Chosen architecture (per user decision):** **Pure Supabase** — replace Prisma with `@supabase/supabase-js`, replace NextAuth with Supabase Auth, move uploads to Supabase Storage, replace SSE with Supabase Realtime, use Row-Level Security (RLS) instead of API-route authorization checks where possible.

---

## Type-Safety Strategy

Pure Supabase **does** offer strong TypeScript type safety. The plan uses three layers:

1. **Generated Database types** — `supabase gen types typescript --linked > src/lib/database.types.ts`. Produces a `Database` interface covering every table, view, enum, function, and column. Regenerated in CI on every migration.

2. **Typed client** — `createClient<Database>(...)` propagates types into the query builder. `.select('id, title, event_participants(user_id, status)')` returns precisely-typed nested rows; bad columns are caught at compile time.

3. **Optional Drizzle ORM overlay** *(decision deferred to Phase 1; see §"Open Decisions")* — if the team misses the Prisma-style DSL ergonomics (`include`, schema-as-code, migration generation), `drizzle-orm` layers cleanly on top of Supabase Postgres and gives Prisma-like TS DX while keeping Supabase Auth/Storage/Realtime native.

**Recommendation:** Start with raw `@supabase/supabase-js` + generated types. Re-evaluate Drizzle after Phase 2 if developer ergonomics feel rough. Avoid pulling in both Prisma *and* Supabase SDKs — that defeats the rewrite.

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Client (Next.js / React 19)                                   │
│  - @supabase/supabase-js (browser client, anon key)           │
│  - @supabase/ssr for cookie-based session in server comps     │
│  - Realtime subscriptions for chat / notifications / events   │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │   RLS-enforced reads/writes
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Supabase Project                                              │
│  ├─ Postgres 15 (managed, daily backups, PITR)                │
│  │   ├─ Tables (migrated 1:1 from Prisma schema)              │
│  │   ├─ Enums (FriendshipStatus, EventStatus, etc.)           │
│  │   ├─ RLS policies on every table                           │
│  │   ├─ Functions (Haversine distance, feed materializer)     │
│  │   └─ Indexes (incl. GIST for geo, partial for hot paths)   │
│  ├─ Auth (email/password, Google, Apple, phone OTP via Twilio)│
│  ├─ Storage (buckets: avatars, posts, albums, files)          │
│  ├─ Realtime (Postgres CDC → websocket subscriptions)         │
│  └─ Edge Functions (cron-style jobs, webhooks)                │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Next.js Server (Route Handlers — slim layer)                  │
│  Kept only for:                                               │
│   - Complex feed assembly (broadcast bounding-box + friends)  │
│   - Server-only operations (push notif fan-out, webhooks)     │
│   - Third-party integrations (Twilio, APNs, Nominatim)        │
│  Uses service-role Supabase client to bypass RLS where needed │
└──────────────────────────────────────────────────────────────┘
```

**Net effect on route count:** ~119 routes → estimated ~30 routes. Most CRUD becomes direct browser→Supabase calls protected by RLS.

---

## Schema Migration (SQLite → Postgres)

Plan to **rewrite the schema as SQL migration files** in `supabase/migrations/` rather than continuing with `schema.prisma`. The Prisma schema becomes the source for the *initial* SQL but is then retired.

### Mapping changes

| Prisma (SQLite) | Postgres / Supabase |
|---|---|
| `String` storing JSON (`Group.memberTypes`, `Group.reminderPrefs`, `Venue.amenities`, `Event.config`, `Post.score`) | `jsonb` |
| `String` status fields (`status`, `kind`, `role`, `mediaType`, `messageType`) | Native `ENUM` types |
| `@id @default(cuid())` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `DateTime` (stored as TEXT in SQLite) | `timestamptz` |
| `Float` for lat/lng | `double precision` + companion `geography(Point, 4326)` column for PostGIS distance queries |
| Bounding-box + JS Haversine for broadcast feed | PostGIS `ST_DWithin` index — eliminates client-side filtering |
| `bcryptjs` password hashes | Owned by Supabase Auth — drop our hashes after migration |
| `Account`, `Session`, `VerificationToken` (NextAuth tables) | Removed; replaced by `auth.users` (Supabase-managed) |

### User identity bridge

Supabase Auth uses `auth.users.id` (uuid) as the canonical user identity. Our domain `User` table becomes `public.profiles` with `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`. **Every existing FK on `User.id` (~31 relations) gets remapped to `profiles.id`.**

A trigger creates a `profiles` row automatically when a new `auth.users` row is inserted (so signup creates both atomically).

### Tables → new schema layout

All domain tables move to the default `public` schema, retaining their current names (snake_cased: `posts`, `event_participants`, `group_messages`, etc.). Generated types reflect this.

### Critical indexes to add

- `posts (is_broadcast, created_at DESC) WHERE is_broadcast = true` — partial index for broadcast feed
- `posts USING GIST (broadcast_location) WHERE is_broadcast = true` — PostGIS geo lookup
- `events USING GIST (event_location) WHERE visibility = 'public'` — radius queries
- `messages (sender_id, receiver_id, created_at DESC)` — DM thread lookup
- `chat_messages (chat_id, created_at DESC)` — chat scroll
- `group_messages (group_id, kind, created_at DESC)` — team chat scroll
- `notifications (user_id, read, created_at DESC)` — notification list

### Post-port consolidation review (added 2026-05-21)

After the initial port the live schema settled at **54 application tables**. Audit found three duplicate-shape clusters where consolidation reduces maintenance burden without sacrificing query plans or RLS scoping. Two additional indexes are needed to support common access patterns the original migration missed.

**Findings — keep as-is (justified)**

| Table cluster | Why split is correct |
|---|---|
| `messages`, `chat_messages`, `group_messages` | Each has distinct visibility rules + distinct relations. DMs are sender↔receiver pair; chat is many-to-many via `chat_participants`; group is many-to-many via `group_members` with announcement/kind discriminator. Unifying would force polymorphic foreign keys and complicate RLS. |
| `message_reactions` | Already the consolidated form — one table with `target_type` (`dm`/`group`/`chat`) + `target_id`. |
| `chat_participants`, `group_members`, `friend_group_members` | Each has different per-row state (mute/pin/hide/clear/read vs. role/member_type/archived vs. minimal join). State-machine divergence justifies the split. |
| `events`, `event_matches`, `event_participants` | Tournament/round-robin scheduling has different needs than ad-hoc team play. |
| `team_matches`, `team_practices`, `practice_series` | `practice_series` is the recurrence rule, `team_practices` are materialized instances, `team_matches` are competitive fixtures. |
| `bookings`, `booking_players` | Court bookings + their participants — semantics differ from event_participants (paid reservation vs. event signup). |
| `polls`, `poll_options`, `poll_votes` | Standard survey schema. |
| `notifications` | Single denormalized table with nullable refs. Watch: if nullable-FK count grows past ~6, move to a `metadata jsonb` column. |
| `hidden_posts`, `blocks` | Different granularities (per-post vs. per-user). |
| `direct_message_reads` | Per-pair read state — justified for query performance (avoid scanning messages to compute unread). |

**Findings — consolidate (proposed migrations)**

| # | Migration | What | Risk |
|---|---|---|---|
| 1 | `0010_consolidate_availabilities.sql` | Merge `match_availabilities` + `practice_availabilities` into `availabilities` with `event_kind` discriminator + nullable `match_id`/`practice_id` + CHECK constraint. Drop both legacy tables. Rewrite RLS + integration tests. | Medium — RLS rewrite + every availability query path |
| 2 | `0011_consolidate_expense_shares.sql` | Drop `guest_expense_shares`; add nullable `user_id` and `guest_name` columns to `expense_shares`; CHECK that exactly one is set. One settle endpoint instead of two. | Low |
| 3 | `0012_consolidate_post_targets.sql` | Collapse `post_groups` + `post_friend_groups` into `post_targets` with `target_kind`. Rewrite `can_see_post()` helper. | Medium — `can_see_post` is on the feed hot path |

**Additional indexes (migration `0013_access_pattern_indexes.sql`)**

| Index | Rationale |
|---|---|
| `events (start_date, end_date) WHERE status <> 'cancelled'` | `listEvents({ upcoming: true })` was doing a non-partial scan |
| `team_matches (match_date)` | `getDashboardUpcoming` filters team_matches by a 14-day date window |

**Maintenance hygiene (migration `0014_table_comments.sql`)**

`COMMENT ON TABLE` for every application table documenting its purpose + why splits exist (especially the messages-table triple). One-time write, big payoff for future reviewers.

**Explicitly deferred / not proposed**

- Unifying `messages` / `chat_messages` / `group_messages` — RLS divergence too high
- Unifying `chat_participants` / `group_members` / `friend_group_members` — state-machine divergence too high
- Touching `courts` / `venues` / `venue_courts` — curated-vs-user split has real semantics (ActiveNet metadata)

Each consolidation migration ships with a paired integration test asserting (a) all rows from the legacy table appear in the new table, (b) RLS still scopes correctly across the three personas (alice / bob = friend / carol = stranger), (c) `EXPLAIN ANALYZE` confirms the new indexes are used.

Since the project has no real users yet (memory: `project_no_real_users`), these migrations are safe to apply without a maintenance window.

---

## Row-Level Security (RLS) Policies

RLS is the **single biggest architectural shift** — and the biggest source of bugs if rushed. Every table needs explicit policies; **default-deny** until policies exist.

### Policy patterns the schema needs

| Table | Read policy | Write policy |
|---|---|---|
| `profiles` | Anyone authenticated can read non-private profiles; private profiles only readable by friends + self | Only `id = auth.uid()` can update |
| `posts` | Author + friends + targeted group members + targeted friend-group members + broadcast recipients in radius (computed via helper function) | Only `author_id = auth.uid()` can update/delete |
| `friendships` | Requester or addressee can read | Only requester can insert; both can update status (accept/reject) |
| `group_members` | Members of the group can read the roster | OWNER/MANAGER roles can insert/delete; members can update their own row (mute, pin, archive) |
| `group_messages` | Members of the group | Members can insert; only author or OWNER can delete |
| `messages` (DMs) | Sender or receiver only | Sender only |
| `events` | Visibility-scoped (see helper fn) | Owner + hostGroup managers |
| `event_participants` | Anyone who can read the event | Self-signup if `is_public_signup`; owner can manage all |
| `notifications` | `user_id = auth.uid()` only | Inserted by triggers / service role; user can mark read |
| `blocks` | Blocker only | Blocker only |
| `albums` / `album_items` / `group_files` | Group members | Members can add; OWNER/MANAGER can delete |
| `court_reviews` | Public read | Only `author_id = auth.uid()` |

### Helper SQL functions

Encapsulate complex visibility logic so policies stay readable:

- `is_friend(other_user uuid) returns boolean`
- `is_group_member(g uuid) returns boolean`
- `is_group_role(g uuid, allowed_roles text[]) returns boolean`
- `can_see_event(e events) returns boolean`
- `can_see_post(p posts) returns boolean`
- `is_blocked_pair(a uuid, b uuid) returns boolean`

Mark `SECURITY DEFINER` and `STABLE` so they're indexable and don't recurse through RLS.

---

## Auth Migration (NextAuth → Supabase Auth)

This is the trickiest user-facing migration. Plan:

### Providers to wire up in Supabase

- **Email + password** — built in, includes reset + email confirmation flows out of the box
- **Google OAuth** — configure with existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- **Apple OAuth** — configure with existing `APPLE_ID` / `APPLE_SECRET`
- **Phone OTP** — Supabase has Twilio integration; reuse `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_VERIFY_SERVICE_SID`. Drop the dev-only `"000000"` fallback (security gap).

### Session strategy

- Use `@supabase/ssr` for cookie-based sessions that work in Server Components, Route Handlers, and middleware.
- Set session lifetime to 7 days with refresh-token rotation.
- Add `middleware.ts` to refresh the session on every request and gate protected pages.

### User data migration

One-shot script (run during the cutover window):

1. For each existing `User` row, call `supabase.auth.admin.createUser({ email, phone, email_confirm: true, phone_confirm: !!phoneVerified })`. The user receives a password-reset email (Supabase-issued, branded).
2. Map old `User.id` → new `auth.users.id` in a translation table, then UPDATE every FK column in the domain schema.
3. After cutover, send a one-time email: "We've upgraded our login system — please reset your password to continue."

**Risk:** Users with active sessions get logged out. Phone-OTP users are unaffected (no password). Acceptable for a pre-launch product; document clearly in release notes.

### What gets deleted

- `src/lib/auth.ts` (NextAuth options)
- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/auth/register/route.ts` — replaced by client-side `supabase.auth.signUp`
- `src/app/api/auth/phone/send/route.ts` — replaced by `supabase.auth.signInWithOtp`
- `src/lib/session.ts` (`auth()` helper) — replaced by `createServerClient` + `supabase.auth.getUser()`
- `Account`, `Session`, `VerificationToken` Prisma models
- `bcryptjs`, `next-auth`, `@auth/prisma-adapter` deps

---

## File Storage Migration

### Buckets

| Bucket | Visibility | Contents | Size limit |
|---|---|---|---|
| `avatars` | public | profile + cover images | 10 MB |
| `posts` | public (signed URLs OK) | post photos, post videos, highlights | 100 MB |
| `albums` | public | group album items | 100 MB |
| `files` | private (signed URLs) | group file shares (PDF, docs, waivers) | 100 MB |
| `court-reviews` | public | court review photos | 10 MB |

### Upload flow

- Browser uploads **directly** to Supabase Storage using signed upload URLs minted by a small Next.js route handler that validates ownership + file size.
- Stop routing files through Next.js server (`/api/upload`). The current bottleneck (Next.js parses → writes to disk) goes away.
- Storage bucket policies mirror RLS rules on the rows that reference them.

### Migration of existing uploads

One-shot script:

1. Iterate `public/uploads/` directory.
2. For each file, infer owner from filename prefix (`{userId}-{timestamp}.{ext}`).
3. Upload to the matching bucket via service-role key.
4. Rewrite all DB columns referencing `/api/uploads/{filename}` to the new Supabase public URL.
5. Verify checksums; archive the original directory; only then delete locally.

---

## Realtime Migration

Replace `/api/notifications/stream` (SSE with 25s poll) with **Supabase Realtime subscriptions**:

### Channels to wire up

| Feature | Channel / source | Filter |
|---|---|---|
| 1:1 DM thread | `messages` table | `sender_id=eq.{me}` OR `receiver_id=eq.{me}` (two subs) |
| Group chat | `group_messages` table | `group_id=eq.{groupId}` |
| Session chat | `chat_messages` table | `chat_id=eq.{chatId}` |
| Notifications | `notifications` table | `user_id=eq.{me}` |
| Event live updates | `event_matches` + `event_participants` | `event_id=eq.{eventId}` |
| Typing indicators | Realtime Presence | broadcast channel per chat |

Realtime is filtered server-side using **RLS policies** (the same ones used for REST reads), so leaking is not possible if policies are correct.

### Reconnection / offline strategy

- `@supabase/supabase-js` auto-reconnects with exponential backoff.
- On reconnect, refetch the latest N messages via REST to catch anything missed.
- Track a `lastSeenSeq` per channel to detect gaps.

---

## API Route Reduction

Audit of the 119 existing routes — what survives vs. what dies:

### Dies (replaced by direct Supabase client + RLS)

- Most GET endpoints under `/api/groups/{id}/*`, `/api/profile`, `/api/users/{id}`, `/api/notifications`, `/api/messages`, `/api/chats/{id}/messages`, `/api/friends`, `/api/posts/like`, `/api/comments`, `/api/polls/*/vote`, `/api/events/{id}/standings`, `/api/devices/register`, etc.
- All of `/api/auth/*` except phone-OTP webhook (if needed).
- `/api/upload`, `/api/upload/file`, `/api/uploads/{filename}` — replaced by direct Storage uploads + Storage CDN.

### Survives (with rewrite to use Supabase service-role client)

- `GET /api/posts` — feed query is too complex for RLS-only (mixes friends + broadcasts + event cross-posts + bounding box). Keep as a server route that builds a single SQL query via Supabase, runs as `auth.uid()`.
- `POST /api/events/{id}/checkin`, `/respond`, `/dispute`, `/report`, `/confirm` — multi-row state machines deserve server validation.
- `POST /api/posts/join/*` — orchestration: insert PlayRequest + send notification + push.
- `POST /api/groups/{id}/invites` — email send via Resend.
- `GET /api/cron/event-reminders` — moves to **Supabase Edge Function** scheduled via `pg_cron`.
- `POST /api/devices/register` — APNs token registration (server only).
- `POST /api/auth/phone/send` — Twilio integration (already wired through Supabase Auth in new model; this route may die).
- `GET /api/calendar` (.ics export) — server only (needs templating).
- `GET /api/geocode` — Nominatim proxy (preserves rate limiting).
- `POST /api/report-issue`, `/api/report-missing-court` — Resend email.

### New routes

- `POST /api/storage/sign-upload` — mint signed upload URL after validating file size + ownership.
- `POST /api/webhooks/supabase-auth` — handle `user.created` to seed `profiles` row (or do it via SQL trigger — preferred).

---

## Frontend Integration

### Three client variants (per `@supabase/ssr` docs)

- **Browser client** (`createBrowserClient`) — anon key, used in Client Components for reads/writes and realtime
- **Server client** (`createServerClient`) — used in Server Components and Route Handlers; reads cookies via `next/headers`
- **Service-role client** (`createClient` with `SUPABASE_SERVICE_ROLE_KEY`) — server only, bypasses RLS; for cron jobs, webhooks, push fan-out

Wrap all three in `src/lib/supabase/{browser,server,admin}.ts`.

### React data-fetching pattern

- Prefer **Server Components** for initial render: fetch via `createServerClient`, pass typed data down as props.
- Use **TanStack Query (React Query)** in Client Components for mutations + revalidation. Realtime subs trigger `queryClient.invalidateQueries(...)`.
- Optimistic updates via React Query mutations.

### Type-safety entry point

```typescript
// src/lib/supabase/types.ts
export type Database = ...generated...
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Inserts<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
```

CI step: `npx supabase gen types typescript --linked > src/lib/database.types.ts` after every migration. Fail build if file is stale.

---

## Production Hardening (beyond migration)

These run in parallel with the Supabase migration:

- **Input validation** — install `zod`; build a `validate<T>()` helper used by every surviving route handler.
- **Error reporting** — Sentry (Next.js SDK + Supabase edge function integration).
- **Session expiry** — 7-day refresh-token rotation (Supabase default; just enable in dashboard).
- **CSRF** — Supabase auth cookies are SameSite=Lax; for state-changing routes that take JSON, validate `Origin` header.
- **Rate limiting** — replace in-memory limiter with Postgres-backed (or Upstash Redis) so it survives restart and works across instances.
- **Backup/PITR** — Supabase Pro plan provides daily backups + point-in-time recovery; turn on for production.
- **Observability** — Supabase dashboard for query insights; Sentry for app errors; Vercel Analytics for frontend perf.
- **Secrets rotation** — rotate the leaked Google/Resend secrets in `.env`; switch `.env` → `.env.local` and confirm `.gitignore`.

---

## Migration Phases

Six phases, sequenced to keep the app shippable at each step. Estimated effort assumes one developer working with AI assistance.

### Phase 0 — Foundations *(1–2 days)*

- User authenticates Supabase MCP; project work then happens via MCP tools (`list_projects`, `apply_migration`, `execute_sql`, `deploy_edge_function`, `get_advisors`, `get_logs`) plus the local CLI in tandem.
- User has a **paid Supabase plan** — daily backups, PITR, branching, and increased connection limits are available from day one.
- Install `@supabase/supabase-js`, `@supabase/ssr`, `supabase` CLI.
- Set up local Supabase stack (`supabase start`) for dev parity.
- Bootstrap migration directory `supabase/migrations/`.
- Set up testing scaffold (see §"Automated Testing" below).
- Add Sentry, Zod, Upstash Redis (rate limiter) as supporting deps.
- Rotate leaked dev secrets; lock down `.env`.

### Phase 1 — Schema port *(3–5 days)*

- Generate initial migration SQL from current Prisma schema (use `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` as a *starting* point, then hand-edit for Postgres-native types, enums, jsonb, PostGIS geography columns).
- Add helper functions (`is_friend`, `can_see_event`, etc.).
- Define enums for all status fields.
- Add indexes (especially partial + GIST).
- Apply migration to dev Supabase. Generate types. Confirm types compile against existing Prisma queries (to find rename gaps).
- **Critical files to read while doing this:** `prisma/schema.prisma`, `src/lib/events/visibility.ts`, `src/lib/eventGroup.ts`, `src/lib/teamGroup.ts`, `src/lib/groupRoles.ts`.

### Phase 2 — RLS policies + read-path migration *(5–7 days)*

- Write RLS policies for every table. Default-deny everywhere.
- Build the helper functions referenced by policies.
- **Migrate read-only API consumers first:** profile view, friends list, group roster, court reviews, calendar export — switch them to `supabase.from(...).select()` using server clients. Leave writes on Prisma temporarily.
- Add e2e tests (Playwright) for the read paths; this is the only safety net for RLS bugs.
- **Critical files to migrate first:** `src/app/profile/[id]/page.tsx`, `src/app/friends/page.tsx`, `src/app/groups/[id]/page.tsx`, `src/app/courts/[id]/page.tsx`, `src/app/calendar/page.tsx`.

### Phase 3 — Auth cutover *(3–4 days, high-risk)*

- Configure Supabase Auth providers in the Supabase dashboard.
- Build new login/register/reset pages using `supabase.auth.*`.
- Write migration script to copy users from `User` → `auth.users` + `profiles`.
- Run migration in staging; verify session lifecycle.
- Schedule cutover window for production: drain SSE connections, run migration, swap env vars, deploy.
- Send "please reset your password" email to all users post-cutover.
- **Critical files to replace/delete:** `src/lib/auth.ts`, `src/lib/session.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/login/page.tsx`, `src/app/register/page.tsx`. Add `src/middleware.ts` and `src/lib/supabase/{browser,server,admin}.ts`.

### Phase 4 — Storage + Realtime *(4–6 days)*

- Create buckets with policies.
- Build signed-upload route.
- Refactor `PostComposer`, profile image upload, album upload, group file upload, court review photo upload to use direct Supabase upload.
- Migrate existing `public/uploads/` content to buckets; rewrite URLs in DB.
- Replace SSE notification stream with Realtime subscription.
- Replace chat polling with Realtime subscriptions for `messages`, `group_messages`, `chat_messages`.
- **Critical files:** `src/app/api/upload/route.ts`, `src/app/api/uploads/[filename]/route.ts`, `src/lib/eventStream.ts`, `src/app/api/notifications/stream/route.ts`, components under `src/components/PostComposer.tsx`, `src/components/MessageBell.tsx`.

### Phase 5 — Write-path migration + route cleanup *(5–7 days)*

- Migrate write paths to direct Supabase calls one feature at a time: likes → comments → friend requests → poll votes → match availability → group messages → DMs.
- Delete superseded API routes as features cut over.
- Move event reminders cron to Supabase Edge Function + `pg_cron`.
- Reimplement push notification fan-out as a Postgres trigger that calls an Edge Function via `pg_net`.
- Final cleanup: drop Prisma, delete `schema.prisma`, remove `prisma/` directory, remove Prisma deps.

### Phase 6 — Production hardening *(3–4 days)*

- Sentry wiring + alerting rules.
- Load test (e.g., `k6`) the feed + chat + realtime channels with ~1K simulated users; tune indexes.
- Configure Supabase Pro: daily backups, PITR, custom domain, branded auth emails.
- Set up monitoring dashboards (Supabase, Sentry, Vercel).
- Document runbooks: how to read query insights, how to roll back a migration, how to rotate keys.

### Phase 7 — Schema consolidation *(1–2 days)*

Detailed in §"Post-port consolidation review" above. Lands after the read/write migration is stable but before launch.

- `0010_consolidate_availabilities.sql` + paired test
- `0011_consolidate_expense_shares.sql` + paired test
- `0012_consolidate_post_targets.sql` + paired test (also rewrites `can_see_post()`)
- `0013_access_pattern_indexes.sql` for the two missing partial / single-column indexes
- `0014_table_comments.sql` for the `COMMENT ON TABLE` pass

**Total estimated effort:** 4–6 weeks of focused work.

---

## Critical Files to Modify or Create

### New files

- `supabase/migrations/0001_init.sql` (and subsequent migration files)
- `supabase/seed.sql`
- `src/lib/supabase/browser.ts`, `server.ts`, `admin.ts`, `types.ts`
- `src/lib/database.types.ts` (generated)
- `src/middleware.ts` (Supabase session refresh)
- `supabase/functions/event-reminders/index.ts` (Edge Function)
- `scripts/migrate-users.ts` (one-shot Prisma → Supabase user migration)
- `scripts/migrate-uploads.ts` (one-shot file move to Storage)

### Files to delete (after migration completes)

- `prisma/schema.prisma` and entire `prisma/` directory
- `src/lib/prisma.ts`
- `src/lib/auth.ts`, `src/lib/session.ts`
- `src/app/api/auth/[...nextauth]/route.ts`, `register/route.ts`, `phone/send/route.ts`
- `src/app/api/upload/route.ts`, `src/app/api/uploads/[filename]/route.ts`
- `src/app/api/notifications/stream/route.ts`
- `src/lib/eventStream.ts` (SSE client)
- `src/lib/rateLimit.ts` (replaced with Upstash)
- Most files under `src/app/api/{groups,friends,messages,chats,notifications,polls,posts/like,comments}/**` after write-path cutover

### Files heavily modified

- Every page that fetches data — switches from `fetch('/api/...')` to `supabase.from(...).select()` or props from a Server Component
- `next.config.js` — add Supabase URL to `images.remotePatterns`
- `package.json` — swap deps
- `.env.example` — new `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### Reuse, don't recreate

- `src/lib/events/visibility.ts` — port the logic into a `can_see_event()` SQL function rather than rewriting; the existing branches (public/group/invited/participant/owner) map cleanly onto policy conditions
- `src/lib/groupRoles.ts` — keep TS constants for client UI; mirror as a Postgres enum
- `src/lib/courts-data/*.ts` — keep static venue data; seed `venues` table from it
- `src/lib/push.ts` — APNs integration code is reusable inside an Edge Function
- `src/lib/geocode.ts` — Nominatim wrapper unchanged

---

## Open Decisions to Confirm Before Phase 1

1. **Drizzle ORM?** Add `drizzle-orm` over Supabase for Prisma-like DX, or stay with raw `@supabase/supabase-js`? *(Default: raw SDK; re-evaluate after Phase 2.)*
2. **Region.** Which Supabase region — `us-west-1` (closest to current Seattle-area users) or multi-region later?
3. **User migration messaging.** Force password reset for all existing users, or attempt to import bcrypt hashes via Supabase Auth admin API (limited support)?
4. **Phone OTP fallback.** Confirm we're dropping the `"000000"` dev shortcut entirely — manual Twilio config required even in dev?
5. **Existing Court data.** Keep `src/lib/courts-data/*.ts` static, or import into `venues` table and treat as canonical?
6. **Use Supabase Branching?** Paid plan unlocks DB branching — useful for previewing migrations on PRs. Worth wiring into the CI flow?

---

## Automated Testing Strategy

**Principle: exhaust automated testing before asking the user to test on iPhone.** Manual device testing is the last line of defense, not the first.

### Test layers

| Layer | Tool | What it covers |
|---|---|---|
| **Unit** | Vitest | Pure logic: distance calc, RSVP status normalization, role guards (`groupRoles.ts`), visibility branch builders, geocode rate limiter, .ics generator, Zod schemas, signed-upload validators, push payload formatters |
| **Database / SQL** | `pgTAP` (or `vitest` + `pg`) against local Supabase | RLS policies, helper functions (`is_friend`, `can_see_event`), triggers (profile auto-creation), enums, indexes are actually used (EXPLAIN ANALYZE assertions) |
| **API / integration** | Vitest + supertest against `next dev` + local Supabase | Surviving route handlers — request/response shape, auth gates, error paths |
| **E2E (web)** | Playwright (headless Chromium) | Multi-user flows: sign up → onboard → create post → another user sees it → comments → notification arrives via Realtime. Run as different RLS personas to validate isolation. |
| **Visual regression** | Playwright `toHaveScreenshot()` | Critical screens: feed, event detail, group chat, profile. Catches CSS regressions without iPhone time. |
| **Load** | k6 | Feed @ 100 RPS, Realtime @ 1K concurrent subs, signed-upload @ 50 RPS |

### Coverage targets per phase

- **Phase 1 (schema):** pgTAP suite asserting every table has RLS enabled and a default-deny policy when no other policy applies. Helper functions get unit tests via SQL.
- **Phase 2 (reads + RLS):** Playwright suite with at minimum 3 personas (User A, User B = friend, User C = stranger). Every read path tested for each persona. **This is the safety net for RLS bugs and must be in place before Phase 3.**
- **Phase 3 (auth):** Vitest unit tests for the migration script (dry-run mode); Playwright e2e for sign-up → confirm → reset → re-login on every provider.
- **Phase 4 (storage + realtime):** Playwright multi-tab test for Realtime sub-1s message delivery. Vitest for signed-upload validation. Integration test for the migration script run against a snapshot of `public/uploads/`.
- **Phase 5 (writes):** Every migrated write path gets a Playwright happy-path + at least one RLS-rejection test.
- **Phase 6 (hardening):** k6 load tests in CI on a schedule (not every push).

### CI wiring

- GitHub Actions matrix: lint → typecheck → unit → integration → e2e → build.
- Local Supabase stack spun up in CI via `supabase start`.
- Type generation step: fail the build if `supabase/migrations/` changes but `src/lib/database.types.ts` wasn't regenerated.
- Playwright traces uploaded as artifacts on failure for fast debugging.

### When iPhone testing **is** required

Only after the automated suite passes, and only for things automation genuinely can't cover:
- iOS Safari-specific upload behavior (`.mov` extension fallback, HEIC handling)
- APNs push notification end-to-end delivery on real device
- Safe-area-inset CSS on actual notch hardware
- Camera/photo-library permission flows

For everything else (functional correctness, RLS isolation, Realtime delivery, layout, accessibility), automated tests are the bar.

---

## Verification Plan

Run after each phase; comprehensive run before launch. **All checks below should be implemented as automated tests in the appropriate suite — they're listed here as the verification narrative, but in practice they live in CI.**

### Phase 1 (Schema)
- `supabase db lint` clean.
- `supabase gen types typescript --linked` produces a non-empty types file.
- Manually `SELECT *` from every table in the dashboard; row counts match Prisma side.

### Phase 2 (Read paths + RLS)
- E2E test (Playwright) signs in as User A, asserts they can only see their friends' posts, their groups' rosters, public events in their radius.
- Sign in as User B (blocked by A), confirm cannot see A's posts.
- Sign in unauthenticated, confirm all RLS-protected tables return empty.

### Phase 3 (Auth)
- Sign-up email + password → email confirmation → login → reset password → re-login.
- Google OAuth flow.
- Apple OAuth flow.
- Phone OTP via Twilio (real number).
- Confirm `profiles` row auto-created via trigger.
- Confirm session cookie refreshes on slow page navigation.

### Phase 4 (Storage + Realtime)
- Upload a 50MB video; confirm Storage receives it and Post renders.
- Open chat in two browser windows; confirm sub-1s message delivery via Realtime.
- Disable network for 30s in one window; confirm messages backfill on reconnect.
- Send a notification (e.g., like a post); confirm receiver's notification badge updates without refresh.

### Phase 5 (Writes)
- Create post, like, comment, join, leave a group, RSVP a match, vote in a poll, settle an expense — all via direct Supabase calls.
- Confirm no `/api/posts/like`, `/api/comments`, etc. are called from the network tab.
- Confirm event reminders fire from the Edge Function on schedule.

### Phase 6 (Load + production)
- Load test: 1,000 concurrent connections on the chat realtime channel.
- Load test: 100 RPS on the feed endpoint; p95 < 500ms.
- Trigger a Sentry error from staging; confirm alert fires.
- Restore from PITR backup in staging; confirm data integrity.
- Run `supabase db dump` and verify schema matches `supabase/migrations/` history.

---

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| RLS policy bug leaks data | High | Default-deny; e2e tests with multiple personas; dashboard query review for every read path |
| User migration loses sessions | Certain | Schedule maintenance window; pre-announce; offer one-tap password reset email |
| Postgres connection limits hit at scale | Medium | Use Supabase's PgBouncer connection pooler; tune pool size; use Edge Functions for short-lived queries |
| Realtime channel fan-out cost surprises | Medium | Audit: one channel per chat is fine; one channel per user for notifications is fine; avoid one-channel-per-row |
| Drizzle vs. raw SDK indecision causes rework | Medium | Defer to Phase 2 review point; don't combine both |
| File migration drops uploads | Low | Checksum verify before deleting locals; keep `public/uploads/` archived for 30 days post-cutover |
| Local-dev divergence from Supabase Cloud | Medium | Use `supabase start` locally; same Postgres version; same migrations |
| Service-role key leaked | High impact / low likelihood | Server-side only; never bundled into client; rotate quarterly; alert on use in non-production |

---

## What Success Looks Like

- All 119 routes reduced to ~30 (mostly orchestration + integrations).
- Reads are RLS-enforced and type-safe end-to-end.
- File uploads survive deploys and hit a CDN.
- Chat messages arrive in < 500ms.
- Daily backups + PITR enabled.
- Sentry catches every error in production.
- Load test passes at 1K concurrent users with p95 < 500ms on feed.
- Zero secrets in the repo.
- A new developer can `git clone`, run `supabase start`, `npm dev`, and have a working local stack in 10 minutes.
