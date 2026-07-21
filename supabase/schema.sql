-- TennisFriend Supabase schema — canonical source of truth.
--
-- Pre-launch policy (memory: project_schema_single_source_of_truth):
-- This project has no real users yet, so we do NOT maintain a
-- forward-only migration chain. Instead, this single file represents
-- the desired-state of the database. To rebuild from scratch in a
-- fresh Supabase project:
--   1. Create a new project.
--   2. Execute this file end-to-end (via psql / dashboard / supabase db reset).
--   3. Run the integration tests (`npm run test:integration`).
--
-- The file is assembled by concatenating the 17 historical migration
-- steps in order. Once real users exist this becomes a snapshot point
-- and we switch BACK to a migration chain (see runbook).

-- =====================================================================
-- 0001_init
-- =====================================================================

-- TennisFriend initial schema (Postgres / Supabase)
--
-- Structure-only. RLS policies, helper functions for visibility, and
-- triggers that depend on app semantics (notification fan-out, push
-- payload assembly) land in later migrations once policies are in place.
--
-- Naming: snake_case tables (plural) + columns. uuid primary keys.
-- timestamptz timestamps. jsonb for structured JSON. PostGIS geography
-- for spatial columns with generated geometry + GIST indexes for hot paths.
--
-- User identity bridge:
--   profiles.id is the same uuid as auth.users.id. A trigger on
--   auth.users creates the matching profiles row on signup, so the
--   foreign key is always satisfied.

-- =========================================================================
-- Extensions
-- =========================================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()
create extension if not exists "postgis";  -- geography(Point, 4326)
create extension if not exists "citext";   -- case-insensitive email/handle
create extension if not exists "pg_net" with schema extensions; -- async HTTP from triggers
create extension if not exists "supabase_vault";                -- secret storage for trigger HTTP auth
create extension if not exists "btree_gist" with schema extensions; -- (uuid, tstzrange) EXCLUDE constraints

-- =========================================================================
-- Shared utility functions
-- =========================================================================

-- Touch updated_at on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =========================================================================
-- Enum types
--
-- Postgres enums give the generated TS types autocomplete values and
-- enforce the value set at the column level. Enums are used only where
-- the value space is stable; fuzzy fields (rsvp status defaults to '',
-- media_type empty-when-absent) stay as text with CHECK constraints.
-- =========================================================================

create type public.friendship_status         as enum ('pending', 'accepted', 'rejected');
create type public.group_role                as enum ('owner', 'manager', 'captain', 'member');
create type public.group_invite_status       as enum ('pending', 'accepted', 'cancelled', 'expired');
create type public.team_listing_status       as enum ('open', 'filled', 'closed');
create type public.team_listing_format       as enum ('singles', 'doubles', 'mixed_doubles', 'any');
-- 'note' is the Playbook entry: a personal journal entry that never appears
-- in the home feed and is gated by posts.visibility (private | friends).
create type public.post_type                 as enum ('regular', 'find_players', 'propose_team', 'event', 'note');
create type public.play_request_status       as enum ('pending', 'approved', 'rejected', 'withdrawn', 'removed');
create type public.event_status              as enum ('open', 'closed', 'active', 'completed', 'cancelled');
create type public.event_visibility          as enum ('public', 'group');
create type public.event_match_status        as enum ('proposed', 'declined', 'scheduled', 'in_progress', 'completed', 'cancelled');
create type public.event_participant_status  as enum ('registered', 'waitlist', 'withdrawn');
create type public.message_kind              as enum ('chat', 'announcement');
create type public.reaction_target           as enum ('dm', 'group', 'chat');
create type public.device_platform           as enum ('ios', 'android');
create type public.booking_status            as enum ('pending', 'confirmed', 'cancelled');
create type public.booking_player_status     as enum ('invited', 'accepted', 'declined');
create type public.notification_type         as enum (
  'comment',
  'like',
  'join_request',
  'request_approved',
  'request_rejected',
  'message_reaction',
  'event_invite',
  'friend_request',
  'group_invite_accepted',
  'reply',
  'event_signup',
  'event_match_report',
  'event_match_confirmed',
  'event_match_disputed',
  'event_ladder_challenge',
  'event_challenge_accepted',
  'event_challenge_declined',
  'availability_poll'
);

-- =========================================================================
-- Identity: profiles (mirrors auth.users)
-- =========================================================================

create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  email                citext unique,
  phone                text unique,
  name                 text not null default '',
  bio                  text not null default '',
  skill_level          text not null default 'intermediate',
  favorite_surface     text not null default 'hard',
  profile_image_url    text not null default '',
  cover_image_url      text not null default '',
  cover_offset_y       integer not null default 50,
  cover_scale          integer not null default 100,
  custom_tags          text not null default '',
  latitude             double precision,
  longitude            double precision,
  location             geography(Point, 4326) generated always as (
    case
      when latitude is not null and longitude is not null
      then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
    end
  ) stored,
  gender               text not null default '',
  age_range            text not null default '',
  rating_system        text not null default '',
  ntrp_rating          double precision,
  utr_rating           double precision,
  handle               citext unique,
  venmo_handle         text,
  paypal_handle        text,
  cashapp_handle       text,
  zelle_handle         text,
  onboarding_complete  boolean not null default false,
  is_private           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Presence heartbeat (last seen using the app), distinct from updated_at
  -- (last content edit). Powers the Discover "recently active" sort. Written
  -- by a throttled client heartbeat; the profiles_updated_at trigger below is
  -- scoped so these writes don't bump updated_at.
  last_active          timestamptz not null default now()
);

create index profiles_location_idx     on public.profiles using gist (location) where location is not null;
create index profiles_handle_idx       on public.profiles (handle) where handle is not null;
create index profiles_ntrp_idx         on public.profiles (ntrp_rating) where ntrp_rating is not null;
create index profiles_created_at_idx   on public.profiles (created_at desc);
create index profiles_last_active_idx  on public.profiles (last_active desc);

-- Auto-create a profile row when a new auth user signs up. Runs as
-- security definer so it can write to public.profiles regardless of RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Trim so trailing/leading whitespace can't sneak into profile.name from
  -- any path (UI signup, admin API, imports). Defense in depth alongside
  -- the trim() already done in the register form.
  insert into public.profiles (id, email, phone, name, profile_image_url)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      ''
    ),
    -- OAuth providers populate one of these. Google sets both;
    -- OpenID Connect spec uses 'picture'. Empty string falls through to
    -- Avatar's initials rendering for password signups.
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'picture'), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- Social graph
-- =========================================================================

create table public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        friendship_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendships_distinct_users check (requester_id <> addressee_id),
  constraint friendships_pair_unique unique (requester_id, addressee_id)
);
create index friendships_addressee_idx on public.friendships (addressee_id);
create index friendships_status_idx    on public.friendships (status);

create table public.blocks (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint blocks_distinct_users check (blocker_id <> blocked_id),
  constraint blocks_pair_unique unique (blocker_id, blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.friend_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index friend_groups_owner_idx on public.friend_groups (owner_id);

create table public.friend_group_members (
  id               uuid primary key default gen_random_uuid(),
  friend_group_id  uuid not null references public.friend_groups (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  constraint friend_group_members_unique unique (friend_group_id, user_id)
);
create index friend_group_members_user_idx on public.friend_group_members (user_id);

-- =========================================================================
-- Groups (teams / clubs)
-- =========================================================================

create table public.groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  image_url       text not null default '',
  cover_image_url text not null default '',
  cover_offset_y  integer not null default 50,
  cover_scale     integer not null default 100,
  owner_id        uuid not null references public.profiles (id) on delete restrict,
  member_types    jsonb not null default '[]'::jsonb,
  reminder_prefs  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index groups_owner_idx on public.groups (owner_id);

create table public.group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         group_role not null default 'member',
  member_type  text not null default '',
  created_at   timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,
  pinned_at    timestamptz,
  hidden_at    timestamptz,
  cleared_at   timestamptz,
  archived_at  timestamptz,
  constraint group_members_unique unique (group_id, user_id)
);
create index group_members_group_role_idx on public.group_members (group_id, role);
create index group_members_user_idx       on public.group_members (user_id);

create table public.group_invites (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  email          citext not null,
  invited_by_id  uuid not null references public.profiles (id) on delete restrict,
  token          text not null unique,
  role           group_role not null default 'member',
  member_type    text not null default '',
  status         group_invite_status not null default 'pending',
  expires_at     timestamptz not null,
  accepted_by_id uuid references public.profiles (id) on delete set null,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index group_invites_group_status_idx on public.group_invites (group_id, status);
create index group_invites_email_status_idx on public.group_invites (email, status);

create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  name        text not null,
  start_date  timestamptz,
  end_date    timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index seasons_group_active_idx on public.seasons (group_id, is_active);

create table public.team_listings (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  created_by_id uuid not null references public.profiles (id) on delete restrict,
  title         text not null,
  description   text not null default '',
  format        team_listing_format not null default 'any',
  ntrp_min      double precision,
  ntrp_max      double precision,
  city          text not null default '',
  status        team_listing_status not null default 'open',
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index team_listings_status_created_idx on public.team_listings (status, created_at desc);
create index team_listings_group_idx          on public.team_listings (group_id);

-- =========================================================================
-- Albums and files
-- =========================================================================

create table public.albums (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  name          text not null,
  description   text not null default '',
  cover_item_id uuid,
  created_by_id uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index albums_group_created_idx on public.albums (group_id, created_at desc);

create table public.album_items (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references public.albums (id) on delete cascade,
  url           text not null,
  media_type    text not null check (media_type in ('image', 'video')),
  caption       text not null default '',
  added_by_id   uuid not null references public.profiles (id) on delete restrict,
  "order"       integer not null default 0,
  created_at    timestamptz not null default now()
);
create index album_items_album_order_idx on public.album_items (album_id, "order");

-- Now that album_items exists, wire up the cover_item_id FK on albums.
alter table public.albums
  add constraint albums_cover_item_fk
  foreign key (cover_item_id) references public.album_items (id) on delete set null;

create table public.group_files (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  url            text not null,
  filename       text not null,
  mime_type      text not null default '',
  size_bytes     bigint not null default 0,
  description    text not null default '',
  uploaded_by_id uuid not null references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default now()
);
create index group_files_group_created_idx on public.group_files (group_id, created_at desc);

-- =========================================================================
-- Events (tournaments, mixers, clinics, round-robins, ladders)
-- =========================================================================

create table public.events (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete restrict,
  title             text not null,
  description       text not null default '',
  event_type        text not null,
  start_date        timestamptz not null,
  end_date          timestamptz not null,
  signup_deadline   timestamptz,
  is_public_signup  boolean not null default true,
  max_participants  integer,
  ntrp_min          double precision,
  ntrp_max          double precision,
  status            event_status not null default 'open',
  venue_name        text not null default '',
  venue_address     text not null default '',
  visibility        event_visibility not null default 'public',
  event_lat         double precision,
  event_lng         double precision,
  event_location    geography(Point, 4326) generated always as (
    case
      when event_lat is not null and event_lng is not null
      then st_setsrid(st_makepoint(event_lng, event_lat), 4326)::geography
    end
  ) stored,
  radius_mi         integer,
  host_group_id     uuid references public.groups (id) on delete set null,
  config            jsonb not null default '{}'::jsonb,
  cover_image_url   text not null default '',
  season_id         uuid references public.seasons (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index events_status_start_idx     on public.events (status, start_date);
create index events_owner_idx            on public.events (owner_id);
create index events_host_group_idx       on public.events (host_group_id);
create index events_season_idx           on public.events (season_id);
create index events_public_location_idx
  on public.events using gist (event_location)
  where visibility = 'public' and event_location is not null;

create table public.event_participants (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  status         event_participant_status not null default 'registered',
  registered_at  timestamptz not null default now(),
  checked_in_at  timestamptz,
  wins           integer not null default 0,
  losses         integer not null default 0,
  sets_won       integer not null default 0,
  sets_lost      integer not null default 0,
  points         integer not null default 0,
  -- Ladder-only: explicit rung. Populated by seed_ladder_lineup() and
  -- swapped by handle_ladder_match_completion() when a lower-ranked
  -- player wins. Null for non-ladder events and un-seeded ladders.
  ladder_rank    integer,
  constraint event_participants_unique unique (event_id, user_id)
);
create index event_participants_event_status_idx on public.event_participants (event_id, status);
create index event_participants_user_idx         on public.event_participants (user_id);
create unique index event_participants_event_ladder_rank_unique
  on public.event_participants (event_id, ladder_rank)
  where ladder_rank is not null;

create table public.event_matches (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  -- Nullable so tournament next-round rows can be created before both
  -- feeders complete — advance_tournament_winner fills the slot when
  -- each sibling match completes.
  player1_id    uuid references public.profiles (id) on delete restrict,
  player2_id    uuid references public.profiles (id) on delete restrict,
  player3_id    uuid references public.profiles (id) on delete set null,
  player4_id    uuid references public.profiles (id) on delete set null,
  round         integer,
  bracket_slot  text not null default '',
  scheduled_at  timestamptz,
  court_assign  text not null default '',
  score         text not null default '',
  winner_side   integer check (winner_side in (1, 2)),
  reported_by   uuid references public.profiles (id) on delete set null,
  confirmed_by  uuid references public.profiles (id) on delete set null,
  proposed_by   uuid references public.profiles (id) on delete set null,
  disputed_at   timestamptz,
  status        event_match_status not null default 'scheduled',
  created_at    timestamptz not null default now()
);
create index event_matches_event_status_idx on public.event_matches (event_id, status);
create index event_matches_event_round_idx  on public.event_matches (event_id, round);

-- =========================================================================
-- Posts (feed) and engagement
-- =========================================================================

create table public.posts (
  id                  uuid primary key default gen_random_uuid(),
  author_id           uuid not null references public.profiles (id) on delete cascade,
  content             text not null default '',
  post_type           post_type not null default 'regular',
  play_date           text not null default '',
  play_time           text not null default '',
  play_duration       integer not null default 90,
  court_location      text not null default '',
  -- When the author picked a court from the composer's typeahead, this
  -- stores the catalog id (Facility.courtId in src/lib/facilities.ts, of
  -- the form "tf-N"). Null for free-text entries that didn't match a
  -- catalog court. The display label always lives in court_location;
  -- this column only carries the link target so PostCard can render the
  -- court name as a /courts?selected=tf-N deep link.
  court_facility_id   text,
  game_type           text not null default '',
  players_needed      integer not null default 0,
  players_confirmed   integer not null default 0,
  skill_min           double precision,
  skill_max           double precision,
  court_booked        boolean not null default false,
  is_complete         boolean not null default false,
  comments_disabled   boolean not null default false,
  manual_players      text not null default '',
  -- IANA timezone the wall-clock play_date/play_time strings represent.
  -- Triggers cast `(play_date || play_time)::timestamp AT TIME ZONE
  -- play_timezone` so a user typing 6pm in Seattle gets interpreted as
  -- Pacific, not UTC. Default America/Los_Angeles for the launch
  -- market; the client should write Intl.DateTimeFormat().resolved
  -- Options().timeZone on each new post so travelers stay correct.
  play_timezone       text not null default 'America/Los_Angeles',
  team_group_id       text not null default '',
  is_broadcast        boolean not null default false,
  broadcast_radius_mi integer not null default 0,
  broadcast_lat       double precision,
  broadcast_lng       double precision,
  broadcast_location  geography(Point, 4326) generated always as (
    case
      when broadcast_lat is not null and broadcast_lng is not null
      then st_setsrid(st_makepoint(broadcast_lng, broadcast_lat), 4326)::geography
    end
  ) stored,
  event_id            uuid references public.events (id) on delete set null,
  pinned_at           timestamptz,
  -- Per-post audience gate evaluated by can_see_post. 'friends' (default)
  -- means the existing friends/targets/broadcast rules apply. 'private' is
  -- author-only and is what Playbook entries (post_type='note') ship as,
  -- short-circuiting can_see_post for non-authors with no fall-through.
  visibility          text         not null default 'friends'
                       check (visibility in ('friends', 'private')),
  created_at          timestamptz not null default now()
);
create index posts_author_created_idx     on public.posts (author_id, created_at desc);
create index posts_event_idx              on public.posts (event_id) where event_id is not null;
create index posts_broadcast_created_idx  on public.posts (created_at desc) where is_broadcast = true;
create index posts_broadcast_location_idx on public.posts using gist (broadcast_location) where is_broadcast = true and broadcast_location is not null;
-- Playbook tab query: one user's notes, pinned first, then newest.
-- Partial because notes are a small slice of the posts table.
create index posts_author_notes_created_idx
  on public.posts (author_id, pinned_at desc nulls last, created_at desc)
  where post_type = 'note';

-- Ordered media attached to a post — both photos and videos. The table
-- name is historical (it began as image-only); `kind` distinguishes the
-- two. `order` drives the carousel sequence. `thumbnail_url` is empty
-- for images and optional for videos (clients can render the first frame
-- via <video preload="metadata"> when absent).
create table public.photos (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  url           text not null,
  "order"       integer not null default 0,
  kind          text not null default 'image' check (kind in ('image', 'video')),
  thumbnail_url text not null default '',
  duration_ms   integer,
  created_at    timestamptz not null default now()
);
create index photos_post_order_idx on public.photos (post_id, "order");

create table public.post_groups (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  constraint post_groups_unique unique (post_id, group_id)
);
create index post_groups_group_idx on public.post_groups (group_id);

create table public.post_friend_groups (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.posts (id) on delete cascade,
  friend_group_id  uuid not null references public.friend_groups (id) on delete cascade,
  constraint post_friend_groups_unique unique (post_id, friend_group_id)
);
create index post_friend_groups_fg_idx on public.post_friend_groups (friend_group_id);

-- Playbook entries (post_type = 'note') can never be cross-posted to a
-- group or friend_group: a private journal entry on a team page would be
-- incoherent. Enforced at the targeting tables with a single shared
-- guard.
create or replace function public.guard_no_target_for_notes()
returns trigger
language plpgsql
as $$
begin
  if (select post_type from public.posts where id = new.post_id) = 'note' then
    raise exception 'Playbook entries (post_type = ''note'') cannot target groups or friend_groups';
  end if;
  return new;
end;
$$;

create trigger post_groups_no_notes_insert
  before insert on public.post_groups
  for each row execute function public.guard_no_target_for_notes();

create trigger post_friend_groups_no_notes_insert
  before insert on public.post_friend_groups
  for each row execute function public.guard_no_target_for_notes();

create table public.likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_unique unique (post_id, user_id)
);
create index likes_user_idx on public.likes (user_id);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now()
);
create index comments_post_created_idx on public.comments (post_id, created_at);
create index comments_author_idx       on public.comments (author_id);

create table public.hidden_posts (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.profiles (id) on delete cascade,
  post_id  uuid not null references public.posts (id) on delete cascade,
  constraint hidden_posts_unique unique (user_id, post_id)
);
create index hidden_posts_post_idx on public.hidden_posts (post_id);

create table public.play_requests (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     play_request_status not null default 'pending',
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint play_requests_unique unique (post_id, user_id)
);
create index play_requests_user_idx on public.play_requests (user_id);

-- =========================================================================
-- Polls (embedded in group_messages)
-- =========================================================================

create table public.polls (
  id            uuid primary key default gen_random_uuid(),
  question      text not null,
  is_multi      boolean not null default false,
  is_closed     boolean not null default false,
  created_by_id uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index polls_created_by_idx on public.polls (created_by_id);

create table public.poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls (id) on delete cascade,
  text        text not null,
  "order"     integer not null default 0,
  created_at  timestamptz not null default now()
);
create index poll_options_poll_order_idx on public.poll_options (poll_id, "order");

create table public.poll_votes (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.polls (id) on delete cascade,
  option_id   uuid not null references public.poll_options (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint poll_votes_unique unique (poll_id, user_id, option_id)
);
create index poll_votes_poll_user_idx on public.poll_votes (poll_id, user_id);
create index poll_votes_option_idx    on public.poll_votes (option_id);

-- =========================================================================
-- Messaging
-- =========================================================================

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  receiver_id     uuid not null references public.profiles (id) on delete cascade,
  content         text not null,
  media_url       text not null default '',
  media_type      text not null default '',
  shared_post_id  uuid references public.posts (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint messages_distinct_users check (sender_id <> receiver_id)
);
create index messages_thread_idx
  on public.messages (
    least(sender_id, receiver_id),
    greatest(sender_id, receiver_id),
    created_at desc
  );
create index messages_receiver_created_idx on public.messages (receiver_id, created_at desc);
create index messages_sender_created_idx   on public.messages (sender_id, created_at desc);

create table public.direct_message_reads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  other_id     uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,
  pinned_at    timestamptz,
  hidden_at    timestamptz,
  cleared_at   timestamptz,
  constraint direct_message_reads_unique unique (user_id, other_id),
  constraint direct_message_reads_distinct check (user_id <> other_id)
);

create table public.chats (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null default '',
  creator_id          uuid not null references public.profiles (id) on delete restrict,
  post_id             uuid references public.posts (id) on delete set null,
  friend_group_id     uuid unique references public.friend_groups (id) on delete cascade,
  session_end_at      timestamptz,
  manual_player_names text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index chats_post_idx          on public.chats (post_id) where post_id is not null;
create index chats_session_end_idx   on public.chats (session_end_at) where session_end_at is not null;
create index chats_creator_idx       on public.chats (creator_id);

create table public.chat_participants (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted        boolean not null default false,
  pinned_at    timestamptz,
  hidden_at    timestamptz,
  cleared_at   timestamptz,
  constraint chat_participants_unique unique (chat_id, user_id)
);
create index chat_participants_user_idx on public.chat_participants (user_id);

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  content     text not null,
  media_url   text not null default '',
  media_type  text not null default '',
  -- Optional link back to the expense this message announces. ON DELETE
  -- CASCADE: deleting an expense erases its companion announcement so
  -- the chat doesn't retain stale numbers. Nullable because most
  -- messages aren't expense announcements.
  expense_id  uuid references public.expenses (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index chat_messages_chat_created_idx on public.chat_messages (chat_id, created_at desc);
create index chat_messages_sender_idx       on public.chat_messages (sender_id);
create index chat_messages_expense_idx      on public.chat_messages (expense_id) where expense_id is not null;

-- Game-chat expiry. A "Game confirmed" chat carries session_end_at (the game's
-- end timestamp); DM and friend-group chats have session_end_at = null and are
-- never touched. Three days after the game ends the chat is purged, cascading to
-- chat_participants, chat_messages, and expenses. The client also hides these
-- immediately via isGameChatVisible (src/lib/gameChatExpiry.ts), so the nightly
-- sweep is purely storage reclamation, not the user-facing guarantee.
create or replace function public.delete_expired_game_chats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.chats
  where session_end_at is not null
    and session_end_at < now() - interval '3 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
-- pg_cron job (registered out-of-band like the other crons, kept here for
-- reference). Runs the purge nightly at 11:20 UTC (~4:20am America/Los_Angeles):
--   select cron.schedule(
--     'delete-expired-game-chats-daily', '20 11 * * *',
--     $$ select public.delete_expired_game_chats() $$);

create table public.group_messages (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  content         text not null,
  media_url       text not null default '',
  media_type      text not null default '',
  shared_post_id  uuid references public.posts (id) on delete set null,
  kind            message_kind not null default 'chat',
  notify_email    boolean not null default false,
  pinned_at       timestamptz,
  poll_id         uuid unique references public.polls (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index group_messages_group_kind_pinned_idx
  on public.group_messages (group_id, kind, pinned_at desc nulls last);
create index group_messages_group_created_idx
  on public.group_messages (group_id, created_at desc);

create table public.message_reactions (
  id            uuid primary key default gen_random_uuid(),
  target_type   reaction_target not null,
  target_id     uuid not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  emoji         text not null,
  created_at    timestamptz not null default now(),
  constraint message_reactions_unique unique (target_type, target_id, user_id, emoji)
);
create index message_reactions_target_idx on public.message_reactions (target_type, target_id);
create index message_reactions_user_idx   on public.message_reactions (user_id);

-- =========================================================================
-- Notifications + reminders
-- =========================================================================

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  type        notification_type not null,
  post_id     uuid references public.posts (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete cascade,
  message_id  uuid references public.messages (id) on delete cascade,
  event_id    uuid references public.events (id) on delete cascade,
  match_id    uuid references public.event_matches (id) on delete cascade,
  -- Set by the availability_poll notification flow; references the poll
  -- the recipient should deep-link into. NULL for non-poll notifications.
  -- Forward-referenced: availability_polls is created later in this schema,
  -- so the FK is wired via ALTER TABLE in section 0018.
  poll_id     uuid,
  emoji       text not null default '',
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_read_idx    on public.notifications (user_id, read, created_at desc);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_actor_idx        on public.notifications (actor_id);

create table public.reminder_sent (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,
  ref_id       text not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  hours_before integer not null,
  sent_at      timestamptz not null default now(),
  constraint reminder_sent_unique unique (kind, ref_id, user_id, hours_before)
);
create index reminder_sent_sent_at_idx on public.reminder_sent (sent_at);
create index reminder_sent_user_idx    on public.reminder_sent (user_id);

-- =========================================================================
-- Team matches, practices, availabilities
-- =========================================================================

create table public.team_matches (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  match_date  text not null,
  match_time  text not null default '',
  location    text not null,
  notes       text not null default '',
  home_away   text not null default '',
  shirt_color text not null default '',
  opponent    text not null default '',
  -- Optional link to a scouted opponent (opponent_teams). The free-text
  -- `opponent` above stays as the always-present label; this points at the
  -- richer scouting record (tennisrecord roster, ratings) when one exists.
  -- FK is added via ALTER below, after opponent_teams is created.
  opponent_team_id uuid,
  season_id   uuid references public.seasons (id) on delete set null,
  -- IANA timezone the wall-clock match_date/match_time strings
  -- represent. The event-reminders cron uses this to compute the
  -- reminder window in the user's local zone (Vercel runs UTC, so
  -- without this every Pacific match would be reminded 7-8h off).
  timezone    text not null default 'America/Los_Angeles',
  created_at  timestamptz not null default now()
);
create index team_matches_group_season_idx on public.team_matches (group_id, season_id);

create table public.match_availabilities (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.team_matches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default '',
  match_types  text not null default '',
  lineup_slot  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint match_availabilities_unique unique (match_id, user_id)
);
create index match_availabilities_user_idx on public.match_availabilities (user_id);

-- =========================================================================
-- Opponent scouting (tennisrecord)
--
-- A captain scouts an opponent team by pasting its tennisrecord team URL
-- (or team name). The server fetches + parses the public roster and caches
-- it here so the whole team can see who they're up against and how strong
-- they are. `opponent_teams` is scoped to the scouting group; the roster
-- snapshot lives in `opponent_players` and is replaced wholesale on each
-- refresh. `linked_group_id` optionally ties the opponent to an in-app team
-- when one exists (groundwork for cross-team scheduling later).
-- =========================================================================

create table public.opponent_teams (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups (id) on delete cascade,
  name             text not null,
  source           text not null default 'tennisrecord',
  source_url       text not null default '',
  source_team_key  text not null default '',
  linked_group_id  uuid references public.groups (id) on delete set null,
  -- Own-team marker: the captain's own tennisrecord team, used as the
  -- schedule source for league fan-out. At most one per group.
  is_own           boolean not null default false,
  last_fetched_at  timestamptz,
  fetch_status     text not null default '',
  fetch_error      text not null default '',
  created_by_id    uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index opponent_teams_group_idx on public.opponent_teams (group_id);
-- One scouting row per (group, tennisrecord team) so refresh upserts cleanly.
create unique index opponent_teams_group_key_unique
  on public.opponent_teams (group_id, source_team_key)
  where source_team_key <> '';
-- Enforce a single own-team row per group.
create unique index opponent_teams_one_own_per_group
  on public.opponent_teams (group_id)
  where is_own;

create table public.opponent_players (
  id                uuid primary key default gen_random_uuid(),
  opponent_team_id  uuid not null references public.opponent_teams (id) on delete cascade,
  name              text not null,
  source_player_url text not null default '',
  ntrp_rating       double precision,
  dynamic_rating    double precision,
  wins              integer not null default 0,
  losses            integer not null default 0,
  record_raw        text not null default '',
  "order"           integer not null default 0,
  created_at        timestamptz not null default now()
);
create index opponent_players_team_order_idx on public.opponent_players (opponent_team_id, "order");

-- Now that opponent_teams exists, wire up the deferred FK on team_matches.
alter table public.team_matches
  add constraint team_matches_opponent_team_fk
  foreign key (opponent_team_id) references public.opponent_teams (id) on delete set null;

create table public.practice_series (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups (id) on delete cascade,
  name           text not null,
  location       text not null,
  practice_time  text not null default '',
  notes          text not null default '',
  season_id      uuid references public.seasons (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index practice_series_group_season_idx on public.practice_series (group_id, season_id);

create table public.team_practices (
  id            uuid primary key default gen_random_uuid(),
  series_id     uuid not null references public.practice_series (id) on delete cascade,
  practice_date text not null,
  -- Same role as team_matches.timezone — the event-reminders cron
  -- needs to know the user's intended zone to land notifications at
  -- the right wall-clock time.
  timezone      text not null default 'America/Los_Angeles',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index team_practices_series_idx on public.team_practices (series_id);

create table public.practice_availabilities (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.team_practices (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint practice_availabilities_unique unique (practice_id, user_id)
);
create index practice_availabilities_user_idx on public.practice_availabilities (user_id);

-- =========================================================================
-- Expenses (per-chat cost split)
-- =========================================================================

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.chats (id) on delete cascade,
  payer_id     uuid not null references public.profiles (id) on delete restrict,
  amount_cents integer not null check (amount_cents >= 0),
  description  text not null default '',
  created_at   timestamptz not null default now()
);
create index expenses_chat_idx  on public.expenses (chat_id);
create index expenses_payer_idx on public.expenses (payer_id);

create table public.expense_shares (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  settled_at   timestamptz,
  constraint expense_shares_unique unique (expense_id, user_id)
);
create index expense_shares_user_idx on public.expense_shares (user_id);

create table public.guest_expense_shares (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  guest_name   text not null,
  amount_cents integer not null check (amount_cents >= 0),
  settled_at   timestamptz,
  constraint guest_expense_shares_unique unique (expense_id, guest_name)
);
create index guest_expense_shares_expense_idx on public.guest_expense_shares (expense_id);

-- =========================================================================
-- Courts, venues, bookings, reviews
-- =========================================================================

create table public.courts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  latitude      double precision not null,
  longitude     double precision not null,
  location      geography(Point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
  ) stored,
  notes         text not null default '',
  added_by_id   uuid not null references public.profiles (id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index courts_added_by_idx on public.courts (added_by_id);
create index courts_location_idx on public.courts using gist (location);

create table public.venues (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text not null,
  latitude      double precision not null,
  longitude     double precision not null,
  location      geography(Point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
  ) stored,
  neighborhood  text not null default '',
  amenities     jsonb not null default '[]'::jsonb,
  image_url     text not null default '',
  active_net_id text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index venues_location_idx on public.venues using gist (location);

create table public.venue_courts (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id) on delete cascade,
  court_number  integer not null,
  surface       text not null default 'hard',
  is_lighted    boolean not null default false,
  active_net_id text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint venue_courts_unique unique (venue_id, court_number)
);

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  court_id        uuid not null references public.venue_courts (id) on delete restrict,
  organizer_id    uuid not null references public.profiles (id) on delete restrict,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  status          booking_status not null default 'pending',
  active_net_url  text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bookings_time_order check (end_time > start_time),
  -- Per-court non-overlap: no two non-cancelled bookings on the same
  -- court may overlap. tstzrange '[)' is half-open so back-to-back
  -- bookings (end_time = next start_time) don't collide.
  constraint bookings_no_overlap_per_court exclude using gist (
    court_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status <> 'cancelled')
);
create index bookings_court_time_idx on public.bookings (court_id, start_time, end_time);
create index bookings_organizer_idx  on public.bookings (organizer_id);

create table public.booking_players (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     booking_player_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_players_unique unique (booking_id, user_id)
);
create index booking_players_user_idx on public.booking_players (user_id);

-- court_id is text (not uuid) and intentionally has no FK to courts(id):
-- the app uses two ID namespaces — UUIDs for user-added courts and "tf-N"
-- strings for the static catalog under data/tennis_courts.json. Both share
-- this reviews table. Orphan cleanup on user-added court deletion is
-- handled at the app layer.
create table public.court_reviews (
  id          uuid primary key default gen_random_uuid(),
  court_id    text not null,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  stars       integer not null check (stars between 1 and 5),
  content     text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint court_reviews_unique unique (court_id, user_id)
);
create index court_reviews_court_idx on public.court_reviews (court_id);

create table public.court_review_photos (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.court_reviews (id) on delete cascade,
  url         text not null,
  "order"     integer not null default 0,
  created_at  timestamptz not null default now()
);
create index court_review_photos_review_idx on public.court_review_photos (review_id, "order");

create table public.court_availability_reports (
  id           uuid primary key default gen_random_uuid(),
  -- See note on court_reviews.court_id: mixed UUID + tf-N namespace, no FK.
  court_id     text not null,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  has_empty    boolean not null,
  post_id      uuid references public.posts (id) on delete set null,
  reported_at  timestamptz not null default now()
);
create index court_availability_reports_court_idx on public.court_availability_reports (court_id, reported_at desc);
create index court_availability_reports_user_idx  on public.court_availability_reports (user_id, reported_at desc);

-- Overrides for the lat/lng of static-catalog facilities (data/tennis_courts.json).
-- Keyed by the catalog's text courtId (e.g. "tf-7"), intentionally no FK to
-- public.courts (which uses uuid for user-added courts only). The /courts
-- map overlays these rows on top of the bundled JSON so dev edits via the
-- IS_DEV "Edit pin" affordance show up for every user without a redeploy.
create table public.facility_pin_overrides (
  court_id    text primary key,
  latitude    double precision not null check (latitude between -90 and 90),
  longitude   double precision not null check (longitude between -180 and 180),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

-- Nightly snapshot of Seattle Parks court availability (ActiveNet), keyed by
-- the public center/resource IDs from data/activenet-seattle.json (no FK —
-- those live in a JSON seed, not a table). The snapshot-availability cron
-- captures the next ~15 days and upserts only BOOKABLE (status-0) days; this
-- lets /api/courts/availability serve "today" from the date's last bookable
-- night, since same-day online booking is disabled (ActiveNet returns nothing
-- for the current day). `windows` is a JSON array of {start,end} clock strings.
create table public.court_availability_snapshot (
  center_id    integer not null,
  resource_id  integer not null,
  date         date    not null,
  windows      jsonb   not null default '[]'::jsonb,
  day_status   integer not null,
  captured_at  timestamptz not null default now(),
  primary key (resource_id, date)
);
create index court_availability_snapshot_center_date_idx
  on public.court_availability_snapshot (center_id, date);

-- =========================================================================
-- Highlights (story-style media on profile)
-- =========================================================================

create table public.highlights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  media_url  text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  caption    text not null default '',
  created_at timestamptz not null default now()
);
create index highlights_user_created_idx on public.highlights (user_id, created_at desc);

-- =========================================================================
-- Device tokens (push notifications)
-- =========================================================================

create table public.device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   device_platform not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on public.device_tokens (user_id);

-- =========================================================================
-- updated_at triggers
-- =========================================================================

-- Scoped so a last_active-only write (the presence heartbeat) does NOT bump
-- updated_at; the trigger fires only when last_active is unchanged (real edits).
create trigger profiles_updated_at                before update on public.profiles                for each row when (old.last_active is not distinct from new.last_active) execute function public.set_updated_at();
create trigger groups_updated_at                  before update on public.groups                  for each row execute function public.set_updated_at();
create trigger group_invites_updated_at           before update on public.group_invites           for each row execute function public.set_updated_at();
create trigger seasons_updated_at                 before update on public.seasons                 for each row execute function public.set_updated_at();
create trigger team_listings_updated_at           before update on public.team_listings           for each row execute function public.set_updated_at();
create trigger albums_updated_at                  before update on public.albums                  for each row execute function public.set_updated_at();
create trigger events_updated_at                  before update on public.events                  for each row execute function public.set_updated_at();
create trigger friendships_updated_at             before update on public.friendships             for each row execute function public.set_updated_at();
create trigger friend_groups_updated_at           before update on public.friend_groups           for each row execute function public.set_updated_at();
create trigger play_requests_updated_at           before update on public.play_requests           for each row execute function public.set_updated_at();
create trigger polls_updated_at                   before update on public.polls                   for each row execute function public.set_updated_at();
create trigger chats_updated_at                   before update on public.chats                   for each row execute function public.set_updated_at();
create trigger match_availabilities_updated_at    before update on public.match_availabilities    for each row execute function public.set_updated_at();
create trigger opponent_teams_updated_at          before update on public.opponent_teams          for each row execute function public.set_updated_at();
create trigger practice_series_updated_at         before update on public.practice_series         for each row execute function public.set_updated_at();
create trigger team_practices_updated_at          before update on public.team_practices          for each row execute function public.set_updated_at();
create trigger practice_availabilities_updated_at before update on public.practice_availabilities for each row execute function public.set_updated_at();
create trigger venues_updated_at                  before update on public.venues                  for each row execute function public.set_updated_at();
create trigger venue_courts_updated_at            before update on public.venue_courts            for each row execute function public.set_updated_at();
create trigger bookings_updated_at                before update on public.bookings                for each row execute function public.set_updated_at();
create trigger booking_players_updated_at         before update on public.booking_players         for each row execute function public.set_updated_at();
create trigger court_reviews_updated_at           before update on public.court_reviews           for each row execute function public.set_updated_at();
create trigger device_tokens_updated_at           before update on public.device_tokens           for each row execute function public.set_updated_at();

-- =====================================================================
-- 0002_harden_helper_functions
-- =====================================================================

-- Tighten the two SECURITY DEFINER / search_path advisor warnings flagged
-- against the initial schema. RLS-related advisor noise stays as-is; that
-- gets resolved by the Phase 2 policies migration.

-- 1. Pin search_path for set_updated_at so untrusted schemas can't override
--    function resolution mid-trigger.
alter function public.set_updated_at()
  set search_path = public, pg_temp;

-- 2. handle_new_user is invoked only via the auth.users INSERT trigger.
--    Nothing should call it through the REST RPC endpoint, so revoke
--    EXECUTE from the public-facing roles. The supabase_auth_admin role
--    that the trigger fires under retains access via its default grants.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- =====================================================================
-- 0003_rls_helpers
-- =====================================================================

-- RLS helper functions.
--
-- These wrap visibility logic that's referenced from policies on multiple
-- tables. Keeping the logic in helpers (vs. inlining into every policy):
--   - readable policies
--   - one place to fix visibility bugs
--   - Postgres can cache STABLE function results within a query
--
-- All helpers are SECURITY INVOKER + STABLE + pinned search_path.
-- The block check is SECURITY DEFINER because it has to read rows the caller
-- doesn't own (a post author's blocks against me).

-- =========================================================================
-- Friendship / group membership / role
-- =========================================================================

create or replace function public.is_friend(other_user uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists(
    select 1 from public.friendships
    where status = 'accepted'
      and (
        (requester_id = auth.uid() and addressee_id = other_user)
        or (requester_id = other_user and addressee_id = auth.uid())
      )
  );
$$;

create or replace function public.is_group_member(g uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists(
    select 1 from public.group_members
    where group_id = g and user_id = auth.uid()
  );
$$;

create or replace function public.has_group_role(g uuid, min_role group_role)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists(
    select 1 from public.group_members
    where group_id = g
      and user_id = auth.uid()
      and case min_role
        when 'member'  then role in ('owner','manager','captain','member')
        when 'captain' then role in ('owner','manager','captain')
        when 'manager' then role in ('owner','manager')
        when 'owner'   then role  = 'owner'
      end
  );
$$;

create or replace function public.is_chat_participant(c uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists(
    select 1 from public.chat_participants
    where chat_id = c and user_id = auth.uid()
  );
$$;

-- =========================================================================
-- Block check (bidirectional)
--
-- SECURITY DEFINER because we need to read blocks rows the caller doesn't
-- own (e.g., "is the post author blocking me?" — author's row, not mine).
-- Returns boolean only so no PII is exposed.
-- =========================================================================

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

-- Lock down RPC exposure. Authenticated users can still call it from inside
-- a policy (RLS plans don't go through EXECUTE checking the same way), but
-- they can't hit it via /rest/v1/rpc/is_blocked directly.
revoke execute on function public.is_blocked(uuid, uuid) from anon, authenticated, public;
grant  execute on function public.is_blocked(uuid, uuid) to service_role;

-- =========================================================================
-- Event visibility
--
-- Five branches: owner / participant / group-scoped / public radius / invited
-- via notification. Matches src/lib/events/visibility.ts in the legacy
-- Prisma code.
-- =========================================================================

create or replace function public.can_see_event(e public.events)
returns boolean
language plpgsql
stable
security invoker
-- `extensions` is required so PL/pgSQL can resolve the `geography` type when
-- it compiles the body — the type lives in the extensions schema and the
-- `authenticated` role's default search_path doesn't include it.
set search_path = public, extensions
as $$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
begin
  if viewer is null then
    return false;
  end if;

  if e.owner_id = viewer then
    return true;
  end if;

  if exists(
    select 1 from public.event_participants
    where event_id = e.id and user_id = viewer
  ) then
    return true;
  end if;

  if e.visibility = 'group' then
    return e.host_group_id is not null
       and public.is_group_member(e.host_group_id);
  end if;

  if e.visibility = 'public'
     and e.event_location is not null
     and e.radius_mi is not null then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      return st_dwithin(viewer_loc, e.event_location, e.radius_mi * 1609.34);
    end if;
  end if;

  return exists(
    select 1 from public.notifications
    where event_id = e.id
      and user_id  = viewer
      and type     = 'event_invite'
  );
end;
$$;

-- =========================================================================
-- Post visibility
--
-- Branches: author / friend / explicit group target / explicit friend-group
-- target / broadcast in radius / event cross-post / blocked-pair exclusion.
-- =========================================================================

create or replace function public.can_see_post(p public.posts)
returns boolean
language plpgsql
stable
security invoker
-- See can_see_event above — `extensions` is required to resolve `geography`.
set search_path = public, extensions
as $$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
  has_group_targets boolean;
  has_fg_targets boolean;
  viewer_in_target_group boolean;
  viewer_in_target_fg boolean;
begin
  if viewer is null then
    return false;
  end if;

  if p.author_id = viewer then
    return true;
  end if;

  -- Playbook entries (post_type = 'note') default to private. Author
  -- returned true above; for everyone else, private means hidden with no
  -- fall-through to friend / target / broadcast / event visibility.
  if p.visibility = 'private' then
    return false;
  end if;

  -- Block check: bidirectional.
  if public.is_blocked(viewer, p.author_id) then
    return false;
  end if;

  -- Does this post have explicit visibility targets?
  has_group_targets := exists(select 1 from public.post_groups where post_id = p.id);
  has_fg_targets    := exists(select 1 from public.post_friend_groups where post_id = p.id);

  -- Targeted to specific groups: only members of those groups can see.
  if has_group_targets then
    viewer_in_target_group := exists(
      select 1 from public.post_groups pg
      join public.group_members gm on gm.group_id = pg.group_id
      where pg.post_id = p.id and gm.user_id = viewer
    );
    if viewer_in_target_group then
      return true;
    end if;
  end if;

  -- Targeted to friend groups: only members of those friend groups can see.
  if has_fg_targets then
    viewer_in_target_fg := exists(
      select 1 from public.post_friend_groups pfg
      join public.friend_group_members fgm on fgm.friend_group_id = pfg.friend_group_id
      where pfg.post_id = p.id and fgm.user_id = viewer
    );
    if viewer_in_target_fg then
      return true;
    end if;
  end if;

  -- If the post had explicit targeting and viewer wasn't a target, hide it
  -- (don't fall through to friend / broadcast visibility).
  if has_group_targets or has_fg_targets then
    return false;
  end if;

  -- Friend-of-author default visibility.
  if public.is_friend(p.author_id) then
    return true;
  end if;

  -- Broadcast post within radius of viewer's home location.
  if p.is_broadcast and p.broadcast_location is not null and p.broadcast_radius_mi > 0 then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      if st_dwithin(viewer_loc, p.broadcast_location, p.broadcast_radius_mi * 1609.34) then
        return true;
      end if;
    end if;
  end if;

  -- Event cross-post: visible if the underlying event is visible.
  if p.event_id is not null then
    return exists(
      select 1 from public.events e
      where e.id = p.event_id and public.can_see_event(e)
    );
  end if;

  return false;
end;
$$;

-- =====================================================================
-- 0004_rls_policies
-- =====================================================================

-- Row-Level Security policies for every public table.
--
-- Pattern: enable RLS, then declare explicit policies. Default-deny is the
-- safety net — if a policy is missing, the table is silently inaccessible to
-- anon/authenticated roles (service_role bypasses RLS).
--
-- Where the policy logic is non-trivial we call helpers from 0003_rls_helpers.
-- Stay consistent: same expression in USING and WITH CHECK unless they need
-- to differ semantically.

-- =========================================================================
-- Identity
-- =========================================================================

alter table public.profiles enable row level security;

create policy profiles_select_public on public.profiles
  for select to authenticated
  using (
    not is_private
    or id = auth.uid()
    or public.is_friend(id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Inserts/deletes are driven by the auth.users trigger, not REST.

-- =========================================================================
-- Social graph
-- =========================================================================

alter table public.friendships enable row level security;

create policy friendships_select_either on public.friendships
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friendships_insert_self on public.friendships
  for insert to authenticated
  with check (requester_id = auth.uid());

create policy friendships_update_either on public.friendships
  for update to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

create policy friendships_delete_either on public.friendships
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

alter table public.blocks enable row level security;

create policy blocks_select_self on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

create policy blocks_insert_self on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());

create policy blocks_delete_self on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());

alter table public.friend_groups enable row level security;

create policy friend_groups_select_owner on public.friend_groups
  for select to authenticated using (owner_id = auth.uid());

create policy friend_groups_insert_owner on public.friend_groups
  for insert to authenticated with check (owner_id = auth.uid());

create policy friend_groups_update_owner on public.friend_groups
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy friend_groups_delete_owner on public.friend_groups
  for delete to authenticated using (owner_id = auth.uid());

alter table public.friend_group_members enable row level security;

create policy friend_group_members_select on public.friend_group_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists(
      select 1 from public.friend_groups fg
      where fg.id = friend_group_id and fg.owner_id = auth.uid()
    )
  );

create policy friend_group_members_write_by_owner on public.friend_group_members
  for all to authenticated
  using (
    exists(
      select 1 from public.friend_groups fg
      where fg.id = friend_group_id and fg.owner_id = auth.uid()
    )
  )
  with check (
    exists(
      select 1 from public.friend_groups fg
      where fg.id = friend_group_id and fg.owner_id = auth.uid()
    )
  );

create policy friend_group_members_leave_self on public.friend_group_members
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================================
-- Groups
-- =========================================================================

alter table public.groups enable row level security;

-- Groups are discoverable by name/cover for the join flow even by non-members.
-- Stricter scoping (private groups) can be added later via a column.
create policy groups_select_all on public.groups
  for select to authenticated using (true);

create policy groups_insert_self on public.groups
  for insert to authenticated with check (owner_id = auth.uid());

create policy groups_update_managers on public.groups
  for update to authenticated
  using (public.has_group_role(id, 'manager'))
  with check (public.has_group_role(id, 'manager'));

create policy groups_delete_owner on public.groups
  for delete to authenticated using (owner_id = auth.uid());

alter table public.group_members enable row level security;

create policy group_members_select_member on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

create policy group_members_insert_manager on public.group_members
  for insert to authenticated
  with check (public.has_group_role(group_id, 'manager'));

create policy group_members_update_self_or_manager on public.group_members
  for update to authenticated
  using (user_id = auth.uid() or public.has_group_role(group_id, 'manager'))
  with check (user_id = auth.uid() or public.has_group_role(group_id, 'manager'));

create policy group_members_delete_self_or_manager on public.group_members
  for delete to authenticated
  using (user_id = auth.uid() or public.has_group_role(group_id, 'manager'));

alter table public.group_invites enable row level security;

create policy group_invites_select_manager on public.group_invites
  for select to authenticated
  using (public.has_group_role(group_id, 'manager'));

create policy group_invites_write_manager on public.group_invites
  for all to authenticated
  using (public.has_group_role(group_id, 'manager'))
  with check (public.has_group_role(group_id, 'manager'));

alter table public.seasons enable row level security;

create policy seasons_select_member on public.seasons
  for select to authenticated using (public.is_group_member(group_id));

create policy seasons_write_captain on public.seasons
  for all to authenticated
  using (public.has_group_role(group_id, 'captain'))
  with check (public.has_group_role(group_id, 'captain'));

alter table public.team_listings enable row level security;

-- Public-facing bulletin: anyone authenticated can browse.
create policy team_listings_select_all on public.team_listings
  for select to authenticated using (true);

create policy team_listings_write_captain on public.team_listings
  for all to authenticated
  using (public.has_group_role(group_id, 'captain'))
  with check (public.has_group_role(group_id, 'captain'));

-- =========================================================================
-- Albums + files
-- =========================================================================

alter table public.albums enable row level security;

create policy albums_select_member on public.albums
  for select to authenticated using (public.is_group_member(group_id));

create policy albums_insert_member on public.albums
  for insert to authenticated
  with check (public.is_group_member(group_id) and created_by_id = auth.uid());

create policy albums_update_captain on public.albums
  for update to authenticated
  using (public.has_group_role(group_id, 'captain'))
  with check (public.has_group_role(group_id, 'captain'));

create policy albums_delete_captain on public.albums
  for delete to authenticated using (public.has_group_role(group_id, 'captain'));

alter table public.album_items enable row level security;

create policy album_items_select_member on public.album_items
  for select to authenticated
  using (
    exists(
      select 1 from public.albums a
      where a.id = album_id and public.is_group_member(a.group_id)
    )
  );

create policy album_items_insert_member on public.album_items
  for insert to authenticated
  with check (
    added_by_id = auth.uid()
    and exists(
      select 1 from public.albums a
      where a.id = album_id and public.is_group_member(a.group_id)
    )
  );

create policy album_items_delete_owner_or_captain on public.album_items
  for delete to authenticated
  using (
    added_by_id = auth.uid()
    or exists(
      select 1 from public.albums a
      where a.id = album_id and public.has_group_role(a.group_id, 'captain')
    )
  );

alter table public.group_files enable row level security;

create policy group_files_select_member on public.group_files
  for select to authenticated using (public.is_group_member(group_id));

create policy group_files_insert_member on public.group_files
  for insert to authenticated
  with check (public.is_group_member(group_id) and uploaded_by_id = auth.uid());

create policy group_files_delete_owner_or_captain on public.group_files
  for delete to authenticated
  using (uploaded_by_id = auth.uid() or public.has_group_role(group_id, 'captain'));

-- =========================================================================
-- Events
-- =========================================================================

alter table public.events enable row level security;

create policy events_select_visible on public.events
  for select to authenticated using (public.can_see_event(events));

create policy events_insert_self on public.events
  for insert to authenticated with check (owner_id = auth.uid());

create policy events_update_owner on public.events
  for update to authenticated
  using (
    owner_id = auth.uid()
    or (host_group_id is not null and public.has_group_role(host_group_id, 'manager'))
  )
  with check (
    owner_id = auth.uid()
    or (host_group_id is not null and public.has_group_role(host_group_id, 'manager'))
  );

create policy events_delete_owner on public.events
  for delete to authenticated using (owner_id = auth.uid());

alter table public.event_participants enable row level security;

create policy event_participants_select_visible on public.event_participants
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists(
      select 1 from public.events e
      where e.id = event_id and public.can_see_event(e)
    )
  );

create policy event_participants_insert_self on public.event_participants
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(
      select 1 from public.events e
      where e.id = event_id and public.can_see_event(e) and e.is_public_signup
    )
  );

create policy event_participants_update_self_or_owner on public.event_participants
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

create policy event_participants_delete_self_or_owner on public.event_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

alter table public.event_matches enable row level security;

create policy event_matches_select_visible on public.event_matches
  for select to authenticated
  using (
    exists(select 1 from public.events e where e.id = event_id and public.can_see_event(e))
  );

-- Owners create / delete matches. UPDATE is also open to the four
-- player_id slots so report / confirm / dispute flows (which the
-- /api/events/[id]/matches/* routes used to gate server-side, but were
-- deleted in the burn-down) can be performed directly by the players
-- involved. Score/status state transitions are then policed by the
-- notify_on_event_match_status_change trigger.
create policy event_matches_insert_owner on public.event_matches
  for insert to authenticated
  with check (
    exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

create policy event_matches_update_owner_or_player on public.event_matches
  for update to authenticated
  using (
    exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
    or auth.uid() in (player1_id, player2_id, player3_id, player4_id)
  )
  with check (
    exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
    or auth.uid() in (player1_id, player2_id, player3_id, player4_id)
  );

create policy event_matches_delete_owner on public.event_matches
  for delete to authenticated
  using (
    exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  );

-- =========================================================================
-- Posts + engagement
-- =========================================================================

alter table public.posts enable row level security;

create policy posts_select_visible on public.posts
  for select to authenticated using (public.can_see_post(posts));

create policy posts_insert_self on public.posts
  for insert to authenticated with check (author_id = auth.uid());

create policy posts_update_author on public.posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy posts_delete_author on public.posts
  for delete to authenticated using (author_id = auth.uid());

alter table public.photos enable row level security;

create policy photos_select_visible on public.photos
  for select to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy photos_write_author on public.photos
  for all to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  )
  with check (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

alter table public.post_groups enable row level security;

create policy post_groups_select_visible on public.post_groups
  for select to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy post_groups_write_author on public.post_groups
  for all to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  )
  with check (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

alter table public.post_friend_groups enable row level security;

create policy post_friend_groups_select_visible on public.post_friend_groups
  for select to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy post_friend_groups_write_author on public.post_friend_groups
  for all to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  )
  with check (
    exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

alter table public.likes enable row level security;

create policy likes_select_visible on public.likes
  for select to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy likes_insert_self_on_visible on public.likes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy likes_delete_self on public.likes
  for delete to authenticated using (user_id = auth.uid());

alter table public.comments enable row level security;

create policy comments_select_visible on public.comments
  for select to authenticated
  using (
    exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy comments_insert_self on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists(
      select 1 from public.posts p
      where p.id = post_id
        and public.can_see_post(p)
        and not p.comments_disabled
    )
  );

create policy comments_delete_self on public.comments
  for delete to authenticated using (author_id = auth.uid());

alter table public.hidden_posts enable row level security;

create policy hidden_posts_self on public.hidden_posts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.play_requests enable row level security;

create policy play_requests_select_self_or_author on public.play_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

create policy play_requests_insert_self on public.play_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(select 1 from public.posts p where p.id = post_id and public.can_see_post(p))
  );

create policy play_requests_update_self_or_author on public.play_requests
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    or exists(select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
  );

create policy play_requests_delete_self on public.play_requests
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================================
-- Polls (embedded in group_messages)
-- =========================================================================

alter table public.polls enable row level security;

create policy polls_select_member on public.polls
  for select to authenticated
  using (
    -- A poll is reachable through its group_message; member of that group can see it.
    exists(
      select 1 from public.group_messages gm
      where gm.poll_id = polls.id and public.is_group_member(gm.group_id)
    )
    or created_by_id = auth.uid()
  );

create policy polls_insert_self on public.polls
  for insert to authenticated with check (created_by_id = auth.uid());

create policy polls_update_creator on public.polls
  for update to authenticated
  using (created_by_id = auth.uid())
  with check (created_by_id = auth.uid());

create policy polls_delete_creator on public.polls
  for delete to authenticated using (created_by_id = auth.uid());

alter table public.poll_options enable row level security;

create policy poll_options_select on public.poll_options
  for select to authenticated
  using (
    exists(
      select 1 from public.polls p where p.id = poll_id
        and (p.created_by_id = auth.uid()
          or exists(select 1 from public.group_messages gm where gm.poll_id = p.id and public.is_group_member(gm.group_id)))
    )
  );

create policy poll_options_write_creator on public.poll_options
  for all to authenticated
  using (exists(select 1 from public.polls p where p.id = poll_id and p.created_by_id = auth.uid()))
  with check (exists(select 1 from public.polls p where p.id = poll_id and p.created_by_id = auth.uid()));

alter table public.poll_votes enable row level security;

create policy poll_votes_select_member on public.poll_votes
  for select to authenticated
  using (
    exists(
      select 1 from public.polls p where p.id = poll_id
        and (p.created_by_id = auth.uid()
          or exists(select 1 from public.group_messages gm where gm.poll_id = p.id and public.is_group_member(gm.group_id)))
    )
  );

create policy poll_votes_insert_self on public.poll_votes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(
      select 1 from public.polls p where p.id = poll_id
        and exists(select 1 from public.group_messages gm where gm.poll_id = p.id and public.is_group_member(gm.group_id))
        and not p.is_closed
    )
  );

create policy poll_votes_delete_self on public.poll_votes
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================================
-- Messaging
-- =========================================================================

alter table public.messages enable row level security;

create policy messages_select_pair on public.messages
  for select to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

create policy messages_insert_self_unblocked on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not public.is_blocked(auth.uid(), receiver_id)
  );

create policy messages_delete_sender on public.messages
  for delete to authenticated using (sender_id = auth.uid());

alter table public.direct_message_reads enable row level security;

create policy dm_reads_self on public.direct_message_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.chats enable row level security;

create policy chats_select_participant on public.chats
  for select to authenticated
  using (public.is_chat_participant(id) or creator_id = auth.uid());

create policy chats_insert_self on public.chats
  for insert to authenticated with check (creator_id = auth.uid());

create policy chats_update_creator on public.chats
  for update to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create policy chats_delete_creator on public.chats
  for delete to authenticated using (creator_id = auth.uid());

alter table public.chat_participants enable row level security;

create policy chat_participants_select_member on public.chat_participants
  for select to authenticated
  using (user_id = auth.uid() or public.is_chat_participant(chat_id));

create policy chat_participants_insert_member_or_creator on public.chat_participants
  for insert to authenticated
  with check (
    public.is_chat_participant(chat_id)
    or exists(select 1 from public.chats c where c.id = chat_id and c.creator_id = auth.uid())
  );

create policy chat_participants_update_self on public.chat_participants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy chat_participants_delete_self_or_creator on public.chat_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.chats c where c.id = chat_id and c.creator_id = auth.uid())
  );

alter table public.chat_messages enable row level security;

create policy chat_messages_select_member on public.chat_messages
  for select to authenticated using (public.is_chat_participant(chat_id));

create policy chat_messages_insert_member on public.chat_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_chat_participant(chat_id));

create policy chat_messages_delete_sender on public.chat_messages
  for delete to authenticated using (sender_id = auth.uid());

create policy chat_messages_update_sender on public.chat_messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

alter table public.group_messages enable row level security;

create policy group_messages_select_member on public.group_messages
  for select to authenticated using (public.is_group_member(group_id));

create policy group_messages_insert_member on public.group_messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_group_member(group_id));

create policy group_messages_delete_sender_or_manager on public.group_messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.has_group_role(group_id, 'manager'));

alter table public.message_reactions enable row level security;

-- Reactions are polymorphic. Visibility delegates to the target table.
create policy message_reactions_select_visible on public.message_reactions
  for select to authenticated
  using (
    case target_type
      when 'dm'    then exists(select 1 from public.messages m
                               where m.id = target_id
                                 and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
      when 'group' then exists(select 1 from public.group_messages gm
                               where gm.id = target_id and public.is_group_member(gm.group_id))
      when 'chat'  then exists(select 1 from public.chat_messages cm
                               where cm.id = target_id and public.is_chat_participant(cm.chat_id))
    end
  );

create policy message_reactions_insert_self on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and case target_type
      when 'dm'    then exists(select 1 from public.messages m
                               where m.id = target_id
                                 and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
      when 'group' then exists(select 1 from public.group_messages gm
                               where gm.id = target_id and public.is_group_member(gm.group_id))
      when 'chat'  then exists(select 1 from public.chat_messages cm
                               where cm.id = target_id and public.is_chat_participant(cm.chat_id))
    end
  );

create policy message_reactions_delete_self on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================================
-- Notifications
-- =========================================================================

alter table public.notifications enable row level security;

create policy notifications_select_self on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy notifications_update_self on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_self on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- Inserts come from server-side fan-out (service_role), no policy needed.

alter table public.reminder_sent enable row level security;
-- No policies: service_role only.

-- =========================================================================
-- Team matches + practices + availabilities
-- =========================================================================

alter table public.team_matches enable row level security;

create policy team_matches_select_member on public.team_matches
  for select to authenticated using (public.is_group_member(group_id));

create policy team_matches_write_captain on public.team_matches
  for all to authenticated
  using (public.has_group_role(group_id, 'captain'))
  with check (public.has_group_role(group_id, 'captain'));

alter table public.match_availabilities enable row level security;

create policy match_availabilities_select_member on public.match_availabilities
  for select to authenticated
  using (
    exists(select 1 from public.team_matches tm
           where tm.id = match_id and public.is_group_member(tm.group_id))
  );

create policy match_availabilities_upsert_self on public.match_availabilities
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(select 1 from public.team_matches tm
               where tm.id = match_id and public.is_group_member(tm.group_id))
  );

create policy match_availabilities_update_self_or_captain on public.match_availabilities
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.team_matches tm
              where tm.id = match_id and public.has_group_role(tm.group_id, 'captain'))
  )
  with check (
    user_id = auth.uid()
    or exists(select 1 from public.team_matches tm
              where tm.id = match_id and public.has_group_role(tm.group_id, 'captain'))
  );

create policy match_availabilities_delete_self on public.match_availabilities
  for delete to authenticated using (user_id = auth.uid());

-- Opponent scouting: any member of the scouting team can read; only captains
-- can add / refresh / link / remove (mirrors team_matches_write_captain).
alter table public.opponent_teams enable row level security;

create policy opponent_teams_select_member on public.opponent_teams
  for select to authenticated using (public.is_group_member(group_id));

create policy opponent_teams_write_captain on public.opponent_teams
  for all to authenticated
  using (public.can_run_group(group_id))
  with check (public.can_run_group(group_id));

alter table public.opponent_players enable row level security;

create policy opponent_players_select_member on public.opponent_players
  for select to authenticated
  using (
    exists(select 1 from public.opponent_teams ot
           where ot.id = opponent_team_id and public.is_group_member(ot.group_id))
  );

create policy opponent_players_write_captain on public.opponent_players
  for all to authenticated
  using (
    exists(select 1 from public.opponent_teams ot
           where ot.id = opponent_team_id and public.can_run_group(ot.group_id))
  )
  with check (
    exists(select 1 from public.opponent_teams ot
           where ot.id = opponent_team_id and public.can_run_group(ot.group_id))
  );

alter table public.practice_series enable row level security;

create policy practice_series_select_member on public.practice_series
  for select to authenticated using (public.is_group_member(group_id));

create policy practice_series_write_captain on public.practice_series
  for all to authenticated
  using (public.has_group_role(group_id, 'captain'))
  with check (public.has_group_role(group_id, 'captain'));

alter table public.team_practices enable row level security;

create policy team_practices_select_member on public.team_practices
  for select to authenticated
  using (
    exists(select 1 from public.practice_series ps
           where ps.id = series_id and public.is_group_member(ps.group_id))
  );

create policy team_practices_write_captain on public.team_practices
  for all to authenticated
  using (
    exists(select 1 from public.practice_series ps
           where ps.id = series_id and public.has_group_role(ps.group_id, 'captain'))
  )
  with check (
    exists(select 1 from public.practice_series ps
           where ps.id = series_id and public.has_group_role(ps.group_id, 'captain'))
  );

alter table public.practice_availabilities enable row level security;

create policy practice_availabilities_select_member on public.practice_availabilities
  for select to authenticated
  using (
    exists(
      select 1 from public.team_practices tp
      join public.practice_series ps on ps.id = tp.series_id
      where tp.id = practice_id and public.is_group_member(ps.group_id)
    )
  );

create policy practice_availabilities_upsert_self on public.practice_availabilities
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists(
      select 1 from public.team_practices tp
      join public.practice_series ps on ps.id = tp.series_id
      where tp.id = practice_id and public.is_group_member(ps.group_id)
    )
  );

create policy practice_availabilities_update_self on public.practice_availabilities
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy practice_availabilities_delete_self on public.practice_availabilities
  for delete to authenticated using (user_id = auth.uid());

-- =========================================================================
-- Expenses
-- =========================================================================

alter table public.expenses enable row level security;

create policy expenses_select_participant on public.expenses
  for select to authenticated using (public.is_chat_participant(chat_id));

create policy expenses_insert_participant on public.expenses
  for insert to authenticated
  with check (payer_id = auth.uid() and public.is_chat_participant(chat_id));

create policy expenses_update_payer on public.expenses
  for update to authenticated
  using (payer_id = auth.uid())
  with check (payer_id = auth.uid());

create policy expenses_delete_payer on public.expenses
  for delete to authenticated using (payer_id = auth.uid());

alter table public.expense_shares enable row level security;

create policy expense_shares_select_participant on public.expense_shares
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.expenses e
              where e.id = expense_id and public.is_chat_participant(e.chat_id))
  );

create policy expense_shares_write_payer on public.expense_shares
  for all to authenticated
  using (
    exists(select 1 from public.expenses e
           where e.id = expense_id and e.payer_id = auth.uid())
  )
  with check (
    exists(select 1 from public.expenses e
           where e.id = expense_id and e.payer_id = auth.uid())
  );

create policy expense_shares_update_self_settle on public.expense_shares
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.guest_expense_shares enable row level security;

create policy guest_expense_shares_select_participant on public.guest_expense_shares
  for select to authenticated
  using (
    exists(select 1 from public.expenses e
           where e.id = expense_id and public.is_chat_participant(e.chat_id))
  );

create policy guest_expense_shares_write_payer on public.guest_expense_shares
  for all to authenticated
  using (
    exists(select 1 from public.expenses e
           where e.id = expense_id and e.payer_id = auth.uid())
  )
  with check (
    exists(select 1 from public.expenses e
           where e.id = expense_id and e.payer_id = auth.uid())
  );

-- =========================================================================
-- Courts + venues + bookings + reviews
-- =========================================================================

alter table public.courts enable row level security;

create policy courts_select_all on public.courts
  for select to authenticated using (true);

create policy courts_insert_self on public.courts
  for insert to authenticated with check (added_by_id = auth.uid());

create policy courts_update_self on public.courts
  for update to authenticated
  using (added_by_id = auth.uid())
  with check (added_by_id = auth.uid());

create policy courts_delete_self on public.courts
  for delete to authenticated using (added_by_id = auth.uid());

alter table public.venues enable row level security;

create policy venues_select_all on public.venues
  for select to authenticated using (true);
-- venues + venue_courts are catalog data; writes via service_role only.

alter table public.venue_courts enable row level security;

create policy venue_courts_select_all on public.venue_courts
  for select to authenticated using (true);

alter table public.bookings enable row level security;

create policy bookings_select_member on public.bookings
  for select to authenticated
  using (
    organizer_id = auth.uid()
    or exists(select 1 from public.booking_players bp
              where bp.booking_id = bookings.id and bp.user_id = auth.uid())
  );

create policy bookings_insert_organizer on public.bookings
  for insert to authenticated with check (organizer_id = auth.uid());

create policy bookings_update_organizer on public.bookings
  for update to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

create policy bookings_delete_organizer on public.bookings
  for delete to authenticated using (organizer_id = auth.uid());

alter table public.booking_players enable row level security;

create policy booking_players_select_member on public.booking_players
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists(select 1 from public.bookings b
              where b.id = booking_id and b.organizer_id = auth.uid())
  );

create policy booking_players_write_organizer on public.booking_players
  for all to authenticated
  using (
    exists(select 1 from public.bookings b
           where b.id = booking_id and b.organizer_id = auth.uid())
  )
  with check (
    exists(select 1 from public.bookings b
           where b.id = booking_id and b.organizer_id = auth.uid())
  );

create policy booking_players_update_self on public.booking_players
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.court_reviews enable row level security;

create policy court_reviews_select_all on public.court_reviews
  for select to authenticated using (true);

create policy court_reviews_insert_self on public.court_reviews
  for insert to authenticated with check (user_id = auth.uid());

create policy court_reviews_update_self on public.court_reviews
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy court_reviews_delete_self on public.court_reviews
  for delete to authenticated using (user_id = auth.uid());

alter table public.court_review_photos enable row level security;

create policy court_review_photos_select_all on public.court_review_photos
  for select to authenticated using (true);

create policy court_review_photos_write_author on public.court_review_photos
  for all to authenticated
  using (
    exists(select 1 from public.court_reviews cr
           where cr.id = review_id and cr.user_id = auth.uid())
  )
  with check (
    exists(select 1 from public.court_reviews cr
           where cr.id = review_id and cr.user_id = auth.uid())
  );

alter table public.court_availability_reports enable row level security;

create policy court_availability_reports_select_all on public.court_availability_reports
  for select to authenticated using (true);

create policy court_availability_reports_insert_self on public.court_availability_reports
  for insert to authenticated with check (user_id = auth.uid());

create policy court_availability_reports_delete_self on public.court_availability_reports
  for delete to authenticated using (user_id = auth.uid());

alter table public.facility_pin_overrides enable row level security;

-- Anyone (including signed-out visitors) can read overrides — the map needs
-- them to render the correct coords for every user.
create policy facility_pin_overrides_select_all
  on public.facility_pin_overrides
  for select to anon, authenticated using (true);

-- Writes restricted to the developer's email at the policy level. Production
-- builds strip the UI via the IS_DEV constant; this is the defense-in-depth
-- gate so a curious authenticated user can't bypass the client by calling
-- supabase.from() directly.
create policy facility_pin_overrides_write_developer
  on public.facility_pin_overrides
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'junfang219@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'junfang219@gmail.com');

-- Public court availability — anyone may read; only the snapshot cron writes,
-- and it uses the service-role admin client (which bypasses RLS), so there is
-- intentionally no insert/update policy.
alter table public.court_availability_snapshot enable row level security;

create policy court_availability_snapshot_select_all
  on public.court_availability_snapshot
  for select to anon, authenticated using (true);

-- =========================================================================
-- Highlights + device tokens
-- =========================================================================

alter table public.highlights enable row level security;

create policy highlights_select_all on public.highlights
  for select to authenticated using (true);

create policy highlights_write_self on public.highlights
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.device_tokens enable row level security;

create policy device_tokens_self on public.device_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- spatial_ref_sys is a PostGIS-owned catalog table. Supabase doesn't grant us
-- ownership of it, so we cannot ALTER it to enable RLS. The advisor warning
-- about it is accepted as a known false positive — PostGIS reference data
-- has no privacy concern (it ships with every Postgres+PostGIS install).

-- =====================================================================
-- 0005_grant_is_blocked_to_authenticated
-- =====================================================================

-- Policies on `messages` (and any future cross-user write check) reference
-- public.is_blocked directly. Authenticated users need EXECUTE so RLS can
-- evaluate. Anon stays REVOKEd. The function returns only a boolean; no PII
-- exposure beyond what the caller already has access to.

grant execute on function public.is_blocked(uuid, uuid) to authenticated;

-- =====================================================================
-- 0006_helpers_security_definer
-- =====================================================================

-- is_group_member, has_group_role, and is_chat_participant query the same
-- tables that have RLS policies referencing them. With SECURITY INVOKER the
-- planner can choke on the recursion; with SECURITY DEFINER the helper
-- bypasses RLS internally. Safe because each helper checks membership for
-- auth.uid() only — no privilege escalation is possible.

create or replace function public.is_group_member(g uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.group_members
    where group_id = g and user_id = auth.uid()
  );
$$;

create or replace function public.has_group_role(g uuid, min_role group_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.group_members
    where group_id = g
      and user_id = auth.uid()
      and case min_role
        when 'member'  then role in ('owner','manager','captain','member')
        when 'captain' then role in ('owner','manager','captain')
        when 'manager' then role in ('owner','manager')
        when 'owner'   then role  = 'owner'
      end
  );
$$;

create or replace function public.is_chat_participant(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.chat_participants
    where chat_id = c and user_id = auth.uid()
  );
$$;

-- is_friend stays SECURITY INVOKER: friendships RLS already permits users to
-- see rows involving them, so the function works inside the caller's
-- permissions without recursion concerns.

revoke execute on function public.is_group_member(uuid) from anon, public;
revoke execute on function public.has_group_role(uuid, group_role) from anon, public;
revoke execute on function public.is_chat_participant(uuid) from anon, public;
grant  execute on function public.is_group_member(uuid) to authenticated;
grant  execute on function public.has_group_role(uuid, group_role) to authenticated;
grant  execute on function public.is_chat_participant(uuid) to authenticated;

-- =====================================================================
-- 0007_can_see_helpers_security_definer
-- =====================================================================

-- can_see_post queries post_groups / post_friend_groups whose RLS policies
-- themselves reference can_see_post — direct recursion. Same for can_see_event
-- via event_participants and notifications. SECURITY DEFINER breaks the cycle
-- without affecting visibility semantics: the function still uses auth.uid()
-- internally and returns only a boolean, so the caller can't see anything
-- they couldn't already deduce.
--
-- can_see_post is inlined (rather than calling is_friend) because the function
-- now bypasses RLS — calling is_friend (SECURITY INVOKER) from a DEFINER
-- function would unexpectedly run as the original caller's privileges anyway,
-- but keeping the membership check inline is simpler to reason about.

create or replace function public.can_see_event(e public.events)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
begin
  if viewer is null then
    return false;
  end if;

  if e.owner_id = viewer then
    return true;
  end if;

  if exists(
    select 1 from public.event_participants
    where event_id = e.id and user_id = viewer
  ) then
    return true;
  end if;

  if e.visibility = 'group' then
    return e.host_group_id is not null
       and exists(
         select 1 from public.group_members
         where group_id = e.host_group_id and user_id = viewer
       );
  end if;

  if e.visibility = 'public'
     and e.event_location is not null
     and e.radius_mi is not null then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      return st_dwithin(viewer_loc, e.event_location, e.radius_mi * 1609.34);
    end if;
  end if;

  return exists(
    select 1 from public.notifications
    where event_id = e.id
      and user_id  = viewer
      and type     = 'event_invite'
  );
end;
$$;

create or replace function public.can_see_post(p public.posts)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
  has_group_targets boolean;
  has_fg_targets boolean;
  viewer_in_target_group boolean;
  viewer_in_target_fg boolean;
begin
  if viewer is null then
    return false;
  end if;

  if p.author_id = viewer then
    return true;
  end if;

  if public.is_blocked(viewer, p.author_id) then
    return false;
  end if;

  has_group_targets := exists(select 1 from public.post_groups where post_id = p.id);
  has_fg_targets    := exists(select 1 from public.post_friend_groups where post_id = p.id);

  if has_group_targets then
    viewer_in_target_group := exists(
      select 1 from public.post_groups pg
      join public.group_members gm on gm.group_id = pg.group_id
      where pg.post_id = p.id and gm.user_id = viewer
    );
    if viewer_in_target_group then
      return true;
    end if;
  end if;

  if has_fg_targets then
    viewer_in_target_fg := exists(
      select 1 from public.post_friend_groups pfg
      join public.friend_group_members fgm on fgm.friend_group_id = pfg.friend_group_id
      where pfg.post_id = p.id and fgm.user_id = viewer
    );
    if viewer_in_target_fg then
      return true;
    end if;
  end if;

  if has_group_targets or has_fg_targets then
    return false;
  end if;

  if exists(
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = viewer and addressee_id = p.author_id)
        or (requester_id = p.author_id and addressee_id = viewer))
  ) then
    return true;
  end if;

  if p.is_broadcast and p.broadcast_location is not null and p.broadcast_radius_mi > 0 then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      if st_dwithin(viewer_loc, p.broadcast_location, p.broadcast_radius_mi * 1609.34) then
        return true;
      end if;
    end if;
  end if;

  if p.event_id is not null then
    return exists(
      select 1 from public.events e
      where e.id = p.event_id and public.can_see_event(e)
    );
  end if;

  return false;
end;
$$;

revoke execute on function public.can_see_event(public.events) from anon, public;
revoke execute on function public.can_see_post(public.posts) from anon, public;
grant  execute on function public.can_see_event(public.events) to authenticated;
grant  execute on function public.can_see_post(public.posts) to authenticated;

-- =====================================================================
-- 0008_storage_buckets
-- =====================================================================

-- Supabase Storage buckets for TennisFriend.
--
-- Bucket conventions:
--   - avatars       — profile/cover images. Public reads, owner writes.
--   - posts         — feed media (photos, videos). Public reads, author writes.
--   - albums        — group album items. Public reads (linked from public group
--                     albums); writes gated by group membership at the row level.
--   - files         — group document store (waivers, schedules). Private reads
--                     via signed URLs; group-member writes.
--   - court-reviews — review photos. Public reads, author writes.
--
-- Object naming convention: <userId>/<timestamp>-<rand>.<ext>
-- The first path segment is the owner uuid. Policies use that to enforce
-- "only the uploader can mutate" without needing extra metadata columns.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',       'avatars',       true,  10 * 1024 * 1024,   array['image/jpeg','image/png','image/webp','image/gif']),
  ('posts',         'posts',         true,  100 * 1024 * 1024,  array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/webm','video/quicktime']),
  ('albums',        'albums',        true,  100 * 1024 * 1024,  array['image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/webm','video/quicktime']),
  ('files',         'files',         false, 100 * 1024 * 1024,  null),
  ('court-reviews', 'court-reviews', true,  10 * 1024 * 1024,   array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy storage_avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy storage_posts_read on storage.objects
  for select using (bucket_id = 'posts');

create policy storage_albums_read on storage.objects
  for select using (bucket_id = 'albums');

create policy storage_court_reviews_read on storage.objects
  for select using (bucket_id = 'court-reviews');

create policy storage_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('avatars','posts','albums','files','court-reviews')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =====================================================================
-- 0009_realtime_publication
-- =====================================================================

-- Enable Postgres logical replication (CDC) on the tables the app subscribes
-- to via Supabase Realtime. RLS still applies to the broadcast stream, so
-- only rows the subscriber would see via REST are delivered.
--
-- Add tables here as new realtime use cases appear. Don't enable everything
-- by default — every replicated INSERT/UPDATE/DELETE goes over the wire.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.group_messages;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.event_matches;
alter publication supabase_realtime add table public.event_participants;
alter publication supabase_realtime add table public.likes;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.play_requests;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.poll_votes;

-- =====================================================================
-- 0010_consolidate_availabilities
-- =====================================================================

-- Migration 0010: Unify match_availabilities + practice_availabilities into a
-- single `availabilities` table with an event_kind discriminator.
--
-- Per schema-review.md: both legacy tables have the same shape (user RSVPs to
-- a scheduled event). Splitting them forced duplicated RLS policies and
-- duplicated query helpers. The match-specific extras (`match_types`,
-- `lineup_slot`) become nullable columns on the unified table; they're
-- meaningless when event_kind = 'practice'.

CREATE TYPE availability_event_kind AS ENUM ('match', 'practice');

CREATE TABLE availabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind availability_event_kind NOT NULL,
  match_id uuid REFERENCES team_matches(id) ON DELETE CASCADE,
  practice_id uuid REFERENCES team_practices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT '',
  match_types text NOT NULL DEFAULT '',
  lineup_slot text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_kind = 'match' AND match_id IS NOT NULL AND practice_id IS NULL) OR
    (event_kind = 'practice' AND practice_id IS NOT NULL AND match_id IS NULL)
  ),
  UNIQUE (match_id, user_id),
  UNIQUE (practice_id, user_id)
);

-- Copy data from the legacy tables. We're pre-launch with no real users yet
-- (memory: project_no_real_users), so any stale rows are disposable.
INSERT INTO availabilities (event_kind, match_id, user_id, status, match_types, lineup_slot, created_at, updated_at)
SELECT 'match'::availability_event_kind, match_id, user_id, status, match_types, lineup_slot, created_at, updated_at
FROM match_availabilities;

INSERT INTO availabilities (event_kind, practice_id, user_id, status, created_at, updated_at)
SELECT 'practice'::availability_event_kind, practice_id, user_id, status, created_at, updated_at
FROM practice_availabilities;

-- Indexes for the dominant access patterns: load all availabilities for one
-- match or one practice (member roster + RSVP rollup).
CREATE INDEX availabilities_match_idx ON availabilities (match_id) WHERE match_id IS NOT NULL;
CREATE INDEX availabilities_practice_idx ON availabilities (practice_id) WHERE practice_id IS NOT NULL;
CREATE INDEX availabilities_user_idx ON availabilities (user_id);

-- updated_at trigger (matches the existing pattern for the table this replaces).
CREATE TRIGGER availabilities_set_updated_at
  BEFORE UPDATE ON availabilities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS policies replicate the union of the two legacy tables' policies.
ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;

-- SELECT: group members of the parent match or practice's group.
CREATE POLICY availabilities_select_member ON availabilities
  FOR SELECT TO authenticated USING (
    (
      match_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_matches tm
        WHERE tm.id = availabilities.match_id
          AND is_group_member(tm.group_id)
      )
    )
    OR (
      practice_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_practices tp
        JOIN practice_series ps ON ps.id = tp.series_id
        WHERE tp.id = availabilities.practice_id
          AND is_group_member(ps.group_id)
      )
    )
  );

-- INSERT: only self, and only if member of the parent group.
CREATE POLICY availabilities_upsert_self ON availabilities
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND (
      (
        match_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM team_matches tm
          WHERE tm.id = availabilities.match_id
            AND is_group_member(tm.group_id)
        )
      )
      OR (
        practice_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM team_practices tp
          JOIN practice_series ps ON ps.id = tp.series_id
          WHERE tp.id = availabilities.practice_id
            AND is_group_member(ps.group_id)
        )
      )
    )
  );

-- UPDATE: self always; captains+ on matches can update anyone's row.
CREATE POLICY availabilities_update_self_or_captain ON availabilities
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      match_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_matches tm
        WHERE tm.id = availabilities.match_id
          AND has_group_role(tm.group_id, 'captain'::group_role)
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (
      match_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_matches tm
        WHERE tm.id = availabilities.match_id
          AND has_group_role(tm.group_id, 'captain'::group_role)
      )
    )
  );

-- DELETE: self only.
CREATE POLICY availabilities_delete_self ON availabilities
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Drop the legacy tables and their RLS policies (cascade removes policies + indexes).
DROP TABLE match_availabilities;
DROP TABLE practice_availabilities;

COMMENT ON TABLE availabilities IS
  'User RSVPs for both team matches and team practices. The event_kind discriminator + CHECK constraint enforces that exactly one of match_id/practice_id is set. Replaces match_availabilities + practice_availabilities (migration 0010).';

-- =====================================================================
-- 0011_consolidate_expense_shares
-- =====================================================================

-- Migration 0011: Collapse guest_expense_shares into expense_shares with a
-- nullable user_id + nullable guest_name column. CHECK ensures exactly one
-- is set. One settle path + one shares-by-expense query replaces the
-- previous UNION pattern.

-- Make user_id nullable + add guest_name + the partial unique indexes that
-- replace the implicit "no duplicates" guarantee of the two-table layout.
ALTER TABLE expense_shares
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN guest_name text;

-- Migrate guest rows into the unified table.
INSERT INTO expense_shares (expense_id, user_id, guest_name, amount_cents, settled_at)
SELECT expense_id, NULL, guest_name, amount_cents, settled_at
FROM guest_expense_shares;

-- Enforce the discriminator: exactly one identifier must be set.
ALTER TABLE expense_shares
  ADD CONSTRAINT expense_shares_identifier_check CHECK (
    (user_id IS NOT NULL AND guest_name IS NULL)
    OR (user_id IS NULL AND guest_name IS NOT NULL)
  );

-- Index the guest_name path used by the settle UI; user_id already has its FK.
CREATE INDEX expense_shares_guest_idx ON expense_shares (expense_id, guest_name) WHERE guest_name IS NOT NULL;

-- RLS: the existing user-id policy keeps working for user rows; widen the
-- "participant" select policy so it also surfaces guest rows the chat
-- participant can see (chat-participant gate via expenses.chat_id is already
-- in the select policy). The existing payer-write policy already covers
-- guest rows because it's gated by expenses.payer_id.

-- Add a NEW self-settle-friendly policy variant that lets payers settle
-- guest rows (no user_id on a guest, so the legacy "user_id = auth.uid()"
-- update policy can never apply to them). The payer already has ALL access
-- via expense_shares_write_payer, so no new policy is strictly needed.

-- Drop the legacy table + its policies (CASCADE not needed since no FK
-- points at it).
DROP TABLE guest_expense_shares;

COMMENT ON TABLE expense_shares IS
  'Per-participant share of an expense. user_id (registered user) and guest_name (non-user) are mutually exclusive — exactly one is set, enforced by expense_shares_identifier_check. Replaces guest_expense_shares (migration 0011).';

-- =====================================================================
-- 0012_consolidate_post_targets
-- =====================================================================

-- Migration 0012: Collapse post_groups + post_friend_groups into post_targets
-- with a target_kind discriminator. can_see_post() now queries one table
-- instead of two.

CREATE TYPE post_target_kind AS ENUM ('group', 'friend_group');

CREATE TABLE post_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_kind post_target_kind NOT NULL,
  group_id uuid REFERENCES groups(id) ON DELETE CASCADE,
  friend_group_id uuid REFERENCES friend_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (target_kind = 'group' AND group_id IS NOT NULL AND friend_group_id IS NULL)
    OR (target_kind = 'friend_group' AND friend_group_id IS NOT NULL AND group_id IS NULL)
  ),
  UNIQUE (post_id, group_id),
  UNIQUE (post_id, friend_group_id)
);

-- Indexes for the dominant access patterns (can_see_post + listFeed enrichment).
CREATE INDEX post_targets_post_idx ON post_targets (post_id);
CREATE INDEX post_targets_group_idx ON post_targets (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX post_targets_friend_group_idx ON post_targets (friend_group_id) WHERE friend_group_id IS NOT NULL;

-- Copy legacy data.
INSERT INTO post_targets (post_id, target_kind, group_id)
SELECT post_id, 'group'::post_target_kind, group_id FROM post_groups;

INSERT INTO post_targets (post_id, target_kind, friend_group_id)
SELECT post_id, 'friend_group'::post_target_kind, friend_group_id FROM post_friend_groups;

-- Rewrite can_see_post to query the unified table.
CREATE OR REPLACE FUNCTION public.can_see_post(p posts)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
  has_targets boolean;
  viewer_in_target boolean;
begin
  if viewer is null then
    return false;
  end if;

  if p.author_id = viewer then
    return true;
  end if;

  if public.is_blocked(viewer, p.author_id) then
    return false;
  end if;

  has_targets := exists(select 1 from public.post_targets where post_id = p.id);

  if has_targets then
    -- Either targeted at a group the viewer's a member of...
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.group_members gm on gm.group_id = pt.group_id
      where pt.post_id = p.id
        and pt.target_kind = 'group'
        and gm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    -- ...or targeted at a friend group the viewer belongs to.
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.friend_group_members fgm on fgm.friend_group_id = pt.friend_group_id
      where pt.post_id = p.id
        and pt.target_kind = 'friend_group'
        and fgm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    -- Targeted posts that don't match: no fallthrough.
    return false;
  end if;

  -- Untargeted: friends-of-author can see it.
  if exists(
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = viewer and addressee_id = p.author_id)
        or (requester_id = p.author_id and addressee_id = viewer))
  ) then
    return true;
  end if;

  -- Untargeted broadcast: location-gated.
  if p.is_broadcast and p.broadcast_location is not null and p.broadcast_radius_mi > 0 then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      if st_dwithin(viewer_loc, p.broadcast_location, p.broadcast_radius_mi * 1609.34) then
        return true;
      end if;
    end if;
  end if;

  -- Posts cross-posted from an event the viewer can see.
  if p.event_id is not null then
    return exists(
      select 1 from public.events e
      where e.id = p.event_id and public.can_see_event(e)
    );
  end if;

  return false;
end;
$function$;

-- RLS on the new table: same shape as the two legacy tables had — readable
-- if you can see the parent post; writable by the post's author.
ALTER TABLE post_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY post_targets_select_visible ON post_targets
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_targets.post_id
        AND can_see_post(p.*)
    )
  );

CREATE POLICY post_targets_write_author ON post_targets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_targets.post_id
        AND p.author_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_targets.post_id
        AND p.author_id = auth.uid()
    )
  );

-- Drop the legacy tables. CASCADE removes their RLS policies + indexes.
DROP TABLE post_groups;
DROP TABLE post_friend_groups;

COMMENT ON TABLE post_targets IS
  'Audience targets for a post. target_kind + the corresponding (group_id | friend_group_id) FK identifies which audience can see the post. Replaces post_groups + post_friend_groups (migration 0012).';

-- =====================================================================
-- 0013_access_pattern_indexes
-- =====================================================================

-- Migration 0013: Two missing indexes for access patterns the original
-- 0001_init.sql didn't cover.

-- listEvents({ upcoming: true }) filters events by status and start_date.
-- The original schema indexes events(start_date) but the planner has to scan
-- cancelled rows. Partial index on the active subset is leaner.
CREATE INDEX events_upcoming_idx
  ON events (start_date, end_date)
  WHERE status <> 'cancelled';

-- getDashboardUpcoming filters team_matches by match_date in a 14-day window.
CREATE INDEX team_matches_match_date_idx
  ON team_matches (match_date);

-- =====================================================================
-- 0014_table_comments
-- =====================================================================

-- Migration 0014: Document every application table with COMMENT ON TABLE.
-- A schema-archeologist tax: cheap to write once, expensive to recover later.

-- ============== Identity / social ==============

COMMENT ON TABLE profiles IS
  'Public profile mirror of auth.users. Created automatically by the handle_new_user() trigger on auth.users insert. id is a uuid FK to auth.users(id).';

COMMENT ON TABLE friendships IS
  'Symmetric friend graph stored as a single directed row (requester -> addressee). status = pending|accepted enforced via friendship_status enum. RLS allows either party to read.';

COMMENT ON TABLE blocks IS
  'Per-user block list. Asymmetric: a row (blocker, blocked) hides the blocked user''s content from the blocker AND prevents the blocked user from initiating contact. Checked by is_blocked() helper used in can_see_post / can_see_event.';

COMMENT ON TABLE friend_groups IS
  'User-owned named subgroups of friends (e.g. "Doubles squad", "Sunday morning crew"). Used to target a post at a slice of the friend graph rather than all friends.';

COMMENT ON TABLE friend_group_members IS
  'Membership of a friend_group. Owner-only writable.';

-- ============== Feed / posts ==============

COMMENT ON TABLE posts IS
  'Core feed item. post_type discriminates regular / find_players / propose_team / event. Targeting via post_targets (group or friend_group). Untargeted posts default to friend-graph visibility, with broadcast posts adding a location-gated radius. Visibility is computed by can_see_post(p posts).';

COMMENT ON COLUMN public.posts.manual_players IS
  'Comma-separated guest names for find_players posts. Limitation: guest names that contain commas are split into multiple entries. Acceptable for the current dataset (Seattle-area player nicknames); revisit if real names with commas (e.g. "Smith, Jr.") become common.';

COMMENT ON TABLE post_targets IS
  'Audience targets for a post. target_kind + the corresponding (group_id | friend_group_id) FK identifies which audience can see the post. Replaces post_groups + post_friend_groups (migration 0012).';

COMMENT ON TABLE photos IS
  'Photos attached to a post. order column drives the carousel display sequence.';

COMMENT ON TABLE likes IS
  'Per-(post,user) like row. Composite unique constraint enforces single like per user. listFeed enrichment counts these.';

COMMENT ON TABLE comments IS
  'Top-level comments on a post. No threading by design.';

COMMENT ON TABLE hidden_posts IS
  'Soft-hide for non-author posts. The hiding user no longer sees the post in their feed; the post itself is untouched. Separate from blocks (which apply to all of an author''s posts).';

COMMENT ON TABLE play_requests IS
  'Join-a-game requests against a find_players post. status = pending|approved|rejected. Approval increments posts.players_confirmed; reaching players_needed flips posts.is_complete.';

COMMENT ON TABLE highlights IS
  'Story-style media on a profile. Ordered by created_at desc.';

-- ============== Messages (kept split — RLS divergence justifies it) ==============

COMMENT ON TABLE messages IS
  'Direct messages between two users (sender_id -> receiver_id). RLS: only sender or receiver can read. Kept separate from chat_messages / group_messages because the visibility shape differs (no chat_participants / group_members join needed).';

COMMENT ON TABLE chat_messages IS
  'Messages in a chat (session/group). Visibility via chat_participants. Kept separate from group_messages because chats can be lightweight session-backed (auto-created when a find_players post fills) without owning the heavier group_members state machine.';

COMMENT ON TABLE group_messages IS
  'Messages in a team (group). Visibility via group_members. Adds an announcement kind (which triggers email fan-out via the reminder cron) and a poll_id link that chat_messages lacks.';

COMMENT ON TABLE message_reactions IS
  'Polymorphic reactions across all three message tables. target_type (dm|chat|group) + target_id identifies the parent. One row per (target, user, emoji). Already in the consolidated form a separate-tables design would have to fall back to.';

COMMENT ON TABLE direct_message_reads IS
  'Per-pair read state for DMs. Keyed (user_id, other_id). Exists for query performance — computing unread by scanning messages would be expensive at scale. Also stores cleared_at for per-user soft-clear.';

COMMENT ON TABLE chats IS
  'A chat — many-to-many of profiles via chat_participants. Backing concept for both session chats (auto-created from a filled find_players post) and friend-group chats. friend_group_id is non-null when the chat backs a friend_group.';

COMMENT ON TABLE chat_participants IS
  'Membership of a chat with rich per-row state: muted, pinned_at, hidden_at (soft-leave), cleared_at (soft-clear history), last_read_at. State machine divergence from group_members justifies keeping these separate.';

-- ============== Groups / teams ==============

COMMENT ON TABLE groups IS
  'A team / club. Owner-managed. member_types is a jsonb array of strings used by the UI to tag group_members. reminder_prefs is a jsonb config for the practice/match reminder cron.';

COMMENT ON TABLE group_members IS
  'Membership of a group with role (owner|manager|captain|member), member_type (free-form, from groups.member_types), and archived_at (soft-leave). Different from chat_participants because the captain/manager role hierarchy drives privileged operations.';

COMMENT ON TABLE group_invites IS
  'Token-based join invites. The Edge Function that emails these is gone — token must currently be shared out-of-band until the email dispatch function is reinstated.';

COMMENT ON TABLE group_files IS
  'Shared file uploads for a group (PDFs, docs, signed waivers). Storage backed by the files bucket.';

COMMENT ON TABLE team_listings IS
  'MatchUp bulletin posts — a group manager publishes a need ("looking for a 4th, NTRP 3.5–4.0 in Seattle"). Discoverable by anyone via /matchup; converts to a play_request when someone responds.';

-- ============== Events / matches / practices ==============

COMMENT ON TABLE events IS
  'Tournaments / round-robins / mixers / clinics. visibility = public | group. Public events use the PostGIS event_location + radius_mi for radius-based discovery; group events restrict visibility to host_group_id''s members. status drives the lifecycle.';

COMMENT ON TABLE event_participants IS
  'Signups for an event. status = registered | waitlist | withdrawn. wins/losses/sets/points are aggregated from event_matches for standings.';

COMMENT ON TABLE event_matches IS
  'Individual matches inside an event (tournament bracket, round-robin pairings, ladder rungs). Lots of nullable state because matches go through proposed → scheduled → in_progress → completed and the relevant fields differ per stage.';

COMMENT ON TABLE seasons IS
  'A named time window for a group. Acts as a parent for team_matches and team_practices, supporting per-season standings.';

COMMENT ON TABLE team_matches IS
  'Group-level competitive fixtures (vs. event_matches which are part of a structured event). Tied to a season for standings aggregation.';

COMMENT ON TABLE practice_series IS
  'Recurrence rule for a team practice (e.g. "every Tuesday 6pm at Magnuson"). The team_practices table materializes individual instances.';

COMMENT ON TABLE team_practices IS
  'Individual practice instances materialized from a practice_series. RSVPs go to the availabilities table.';

COMMENT ON TABLE availabilities IS
  'User RSVPs for both team matches and team practices. event_kind discriminator + CHECK constraint enforces that exactly one of match_id/practice_id is set. Replaces match_availabilities + practice_availabilities (migration 0010).';

-- ============== Notifications / device tokens ==============

COMMENT ON TABLE notifications IS
  'User-facing notifications: comment, like, join_request, friend_request, event_invite, group_invite_accepted, message_reaction, request_approved/rejected. Nullable FKs (post_id, comment_id, message_id, event_id, match_id) point to whatever the notification is about. If these grow past ~6 cols, move to a single metadata jsonb instead.';

COMMENT ON TABLE device_tokens IS
  'Push notification tokens. (user_id, token) unique. platform = ios | android.';

COMMENT ON TABLE reminder_sent IS
  'Idempotency log for the reminder cron — guarantees we don''t double-send the same lead-time reminder to the same target.';

-- ============== Courts / venues ==============

COMMENT ON TABLE venues IS
  'Curated facilities (e.g. Seattle Parks ActiveNet locations). venue_courts holds the individual courts within. Separate from the user-added courts table — the curated set has ActiveNet metadata that user-added courts don''t.';

COMMENT ON TABLE venue_courts IS
  'Individual numbered courts inside a curated venue.';

COMMENT ON TABLE courts IS
  'User-added courts (not from the curated ActiveNet set). Considered for consolidation with venues but kept separate because the schemas (ActiveNet metadata vs. user-supplied notes) diverge.';

COMMENT ON TABLE court_reviews IS
  'User reviews of a court. 1–5 star rating plus text + photos.';

COMMENT ON TABLE court_review_photos IS
  'Photos attached to a court review. Ordered by order column.';

COMMENT ON TABLE court_availability_reports IS
  'Crowd-sourced "is the court available right now?" reports. Has a rate-limit guard (one report per user per court per N minutes) enforced in the query helper.';

COMMENT ON TABLE bookings IS
  'Court reservations. Sister to event_participants but with payment / time-slot semantics; not unified because the use cases barely overlap.';

COMMENT ON TABLE booking_players IS
  'Players included in a court booking. Many-to-many between bookings and profiles.';

-- ============== Albums / files / expenses / polls ==============

COMMENT ON TABLE albums IS
  'Group-level photo albums.';

COMMENT ON TABLE album_items IS
  'Individual photos within an album.';

COMMENT ON TABLE expenses IS
  'Expense incurred by a chat participant (court fees, balls, dinner). payer_id covers the entire amount initially; expense_shares partitions it among participants.';

COMMENT ON TABLE expense_shares IS
  'Per-participant share of an expense. user_id (registered user) and guest_name (non-user) are mutually exclusive — exactly one is set, enforced by expense_shares_identifier_check. Replaces guest_expense_shares (migration 0011).';

COMMENT ON TABLE polls IS
  'Standalone polls. Linked to a group_messages row via group_messages.poll_id rather than a polls.group_id column — that way the same poll table can in principle be reused outside the team-chat context.';

COMMENT ON TABLE poll_options IS
  'Choices for a poll. order drives display sequence.';

COMMENT ON TABLE poll_votes IS
  'Per-(poll, user, option) vote row. is_multi on the parent poll determines whether a user can have multiple option rows.';

-- =====================================================================
-- 0015_rls_initplan_optimization
-- =====================================================================

-- Migration 0015: Rewrite every RLS policy that calls auth.uid() directly
-- to wrap the call in (SELECT auth.uid()). This is Supabase's recommended
-- pattern — the planner evaluates the subselect once per query instead of
-- once per row (the auth_rls_initplan advisor warning).
--
-- All policies are dropped + recreated with semantically identical logic;
-- the only change is the auth.uid() → (SELECT auth.uid()) wrap.

-- ============== profiles ==============

DROP POLICY profiles_select_public ON profiles;
CREATE POLICY profiles_select_public ON profiles
  FOR SELECT TO authenticated
  USING ((NOT is_private) OR (id = (SELECT auth.uid())) OR is_friend(id));

DROP POLICY profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ============== friendships ==============

DROP POLICY friendships_select_either ON friendships;
CREATE POLICY friendships_select_either ON friendships
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

DROP POLICY friendships_insert_self ON friendships;
CREATE POLICY friendships_insert_self ON friendships
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = (SELECT auth.uid()));

DROP POLICY friendships_update_either ON friendships;
CREATE POLICY friendships_update_either ON friendships
  FOR UPDATE TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()))
  WITH CHECK (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

DROP POLICY friendships_delete_either ON friendships;
CREATE POLICY friendships_delete_either ON friendships
  FOR DELETE TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()));

-- ============== blocks ==============

DROP POLICY blocks_select_self ON blocks;
CREATE POLICY blocks_select_self ON blocks FOR SELECT TO authenticated USING (blocker_id = (SELECT auth.uid()));

DROP POLICY blocks_insert_self ON blocks;
CREATE POLICY blocks_insert_self ON blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = (SELECT auth.uid()));

DROP POLICY blocks_delete_self ON blocks;
CREATE POLICY blocks_delete_self ON blocks FOR DELETE TO authenticated USING (blocker_id = (SELECT auth.uid()));

-- ============== friend_groups + friend_group_members ==============

DROP POLICY friend_groups_select_owner ON friend_groups;
CREATE POLICY friend_groups_select_owner ON friend_groups FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

DROP POLICY friend_groups_insert_owner ON friend_groups;
CREATE POLICY friend_groups_insert_owner ON friend_groups FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY friend_groups_update_owner ON friend_groups;
CREATE POLICY friend_groups_update_owner ON friend_groups FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY friend_groups_delete_owner ON friend_groups;
CREATE POLICY friend_groups_delete_owner ON friend_groups FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

DROP POLICY friend_group_members_select ON friend_group_members;
CREATE POLICY friend_group_members_select ON friend_group_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())
  ));

DROP POLICY friend_group_members_write_by_owner ON friend_group_members;
CREATE POLICY friend_group_members_write_by_owner ON friend_group_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())));

DROP POLICY friend_group_members_leave_self ON friend_group_members;
CREATE POLICY friend_group_members_leave_self ON friend_group_members FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============== groups + group_members + group_messages ==============

DROP POLICY groups_insert_self ON groups;
CREATE POLICY groups_insert_self ON groups FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY groups_delete_owner ON groups;
CREATE POLICY groups_delete_owner ON groups FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

DROP POLICY group_members_select_member ON group_members;
CREATE POLICY group_members_select_member ON group_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR is_group_member(group_id));

DROP POLICY group_members_update_self_or_manager ON group_members;
CREATE POLICY group_members_update_self_or_manager ON group_members FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR has_group_role(group_id, 'manager'::group_role))
  WITH CHECK (user_id = (SELECT auth.uid()) OR has_group_role(group_id, 'manager'::group_role));

DROP POLICY group_members_delete_self_or_manager ON group_members;
CREATE POLICY group_members_delete_self_or_manager ON group_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR has_group_role(group_id, 'manager'::group_role));

DROP POLICY group_messages_insert_member ON group_messages;
CREATE POLICY group_messages_insert_member ON group_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND is_group_member(group_id));

DROP POLICY group_messages_delete_sender_or_manager ON group_messages;
CREATE POLICY group_messages_delete_sender_or_manager ON group_messages FOR DELETE TO authenticated
  USING (sender_id = (SELECT auth.uid()) OR has_group_role(group_id, 'manager'::group_role));

-- ============== albums + album_items + group_files ==============

DROP POLICY albums_insert_member ON albums;
CREATE POLICY albums_insert_member ON albums FOR INSERT TO authenticated
  WITH CHECK (is_group_member(group_id) AND created_by_id = (SELECT auth.uid()));

DROP POLICY album_items_insert_member ON album_items;
CREATE POLICY album_items_insert_member ON album_items FOR INSERT TO authenticated
  WITH CHECK (added_by_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM albums a WHERE a.id = album_items.album_id AND is_group_member(a.group_id)
  ));

DROP POLICY album_items_delete_owner_or_captain ON album_items;
CREATE POLICY album_items_delete_owner_or_captain ON album_items FOR DELETE TO authenticated
  USING (added_by_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM albums a WHERE a.id = album_items.album_id AND has_group_role(a.group_id, 'captain'::group_role)
  ));

DROP POLICY group_files_insert_member ON group_files;
CREATE POLICY group_files_insert_member ON group_files FOR INSERT TO authenticated
  WITH CHECK (is_group_member(group_id) AND uploaded_by_id = (SELECT auth.uid()));

DROP POLICY group_files_delete_owner_or_captain ON group_files;
CREATE POLICY group_files_delete_owner_or_captain ON group_files FOR DELETE TO authenticated
  USING (uploaded_by_id = (SELECT auth.uid()) OR has_group_role(group_id, 'captain'::group_role));

-- ============== events + event_participants + event_matches ==============

DROP POLICY events_insert_self ON events;
CREATE POLICY events_insert_self ON events FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY events_update_owner ON events;
CREATE POLICY events_update_owner ON events FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR (host_group_id IS NOT NULL AND has_group_role(host_group_id, 'manager'::group_role)))
  WITH CHECK (owner_id = (SELECT auth.uid()) OR (host_group_id IS NOT NULL AND has_group_role(host_group_id, 'manager'::group_role)));

DROP POLICY events_delete_owner ON events;
CREATE POLICY events_delete_owner ON events FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

DROP POLICY event_participants_select_visible ON event_participants;
CREATE POLICY event_participants_select_visible ON event_participants FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_participants.event_id AND can_see_event(e.*)
  ));

DROP POLICY event_participants_insert_self ON event_participants;
CREATE POLICY event_participants_insert_self ON event_participants FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_participants.event_id AND can_see_event(e.*) AND e.is_public_signup
  ));

DROP POLICY event_participants_update_self_or_owner ON event_participants;
CREATE POLICY event_participants_update_self_or_owner ON event_participants FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_participants.event_id AND e.owner_id = (SELECT auth.uid())
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_participants.event_id AND e.owner_id = (SELECT auth.uid())
  ));

DROP POLICY event_participants_delete_self_or_owner ON event_participants;
CREATE POLICY event_participants_delete_self_or_owner ON event_participants FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM events e WHERE e.id = event_participants.event_id AND e.owner_id = (SELECT auth.uid())
  ));

DROP POLICY event_matches_write_owner ON event_matches;
CREATE POLICY event_matches_write_owner ON event_matches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())));

-- ============== posts + post_targets + photos + likes + comments + hidden_posts ==============

DROP POLICY posts_insert_self ON posts;
CREATE POLICY posts_insert_self ON posts FOR INSERT TO authenticated WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY posts_update_author ON posts;
CREATE POLICY posts_update_author ON posts FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid())) WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY posts_delete_author ON posts;
CREATE POLICY posts_delete_author ON posts FOR DELETE TO authenticated USING (author_id = (SELECT auth.uid()));

DROP POLICY post_targets_write_author ON post_targets;
CREATE POLICY post_targets_write_author ON post_targets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())));

DROP POLICY photos_write_author ON photos;
CREATE POLICY photos_write_author ON photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())));

DROP POLICY likes_insert_self_on_visible ON likes;
CREATE POLICY likes_insert_self_on_visible ON likes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM posts p WHERE p.id = likes.post_id AND can_see_post(p.*)
  ));

DROP POLICY likes_delete_self ON likes;
CREATE POLICY likes_delete_self ON likes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY comments_insert_self ON comments;
CREATE POLICY comments_insert_self ON comments FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM posts p WHERE p.id = comments.post_id AND can_see_post(p.*) AND NOT p.comments_disabled
  ));

DROP POLICY comments_delete_self ON comments;
CREATE POLICY comments_delete_self ON comments FOR DELETE TO authenticated USING (author_id = (SELECT auth.uid()));

DROP POLICY hidden_posts_self ON hidden_posts;
CREATE POLICY hidden_posts_self ON hidden_posts FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY play_requests_select_self_or_author ON play_requests;
CREATE POLICY play_requests_select_self_or_author ON play_requests FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM posts p WHERE p.id = play_requests.post_id AND p.author_id = (SELECT auth.uid())
  ));

DROP POLICY play_requests_insert_self ON play_requests;
CREATE POLICY play_requests_insert_self ON play_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM posts p WHERE p.id = play_requests.post_id AND can_see_post(p.*)
  ));

DROP POLICY play_requests_update_self_or_author ON play_requests;
CREATE POLICY play_requests_update_self_or_author ON play_requests FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM posts p WHERE p.id = play_requests.post_id AND p.author_id = (SELECT auth.uid())
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM posts p WHERE p.id = play_requests.post_id AND p.author_id = (SELECT auth.uid())
  ));

DROP POLICY play_requests_delete_self ON play_requests;
CREATE POLICY play_requests_delete_self ON play_requests FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY highlights_write_self ON highlights;
CREATE POLICY highlights_write_self ON highlights FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ============== polls + poll_options + poll_votes ==============

DROP POLICY polls_select_member ON polls;
CREATE POLICY polls_select_member ON polls FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM group_messages gm WHERE gm.poll_id = polls.id AND is_group_member(gm.group_id)
  ) OR created_by_id = (SELECT auth.uid()));

DROP POLICY polls_insert_self ON polls;
CREATE POLICY polls_insert_self ON polls FOR INSERT TO authenticated WITH CHECK (created_by_id = (SELECT auth.uid()));

DROP POLICY polls_update_creator ON polls;
CREATE POLICY polls_update_creator ON polls FOR UPDATE TO authenticated
  USING (created_by_id = (SELECT auth.uid())) WITH CHECK (created_by_id = (SELECT auth.uid()));

DROP POLICY polls_delete_creator ON polls;
CREATE POLICY polls_delete_creator ON polls FOR DELETE TO authenticated USING (created_by_id = (SELECT auth.uid()));

DROP POLICY poll_options_select ON poll_options;
CREATE POLICY poll_options_select ON poll_options FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND (
    p.created_by_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM group_messages gm WHERE gm.poll_id = p.id AND is_group_member(gm.group_id))
  )));

DROP POLICY poll_options_write_creator ON poll_options;
CREATE POLICY poll_options_write_creator ON poll_options FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())));

DROP POLICY poll_votes_select_member ON poll_votes;
CREATE POLICY poll_votes_select_member ON poll_votes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_votes.poll_id AND (
    p.created_by_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM group_messages gm WHERE gm.poll_id = p.id AND is_group_member(gm.group_id))
  )));

DROP POLICY poll_votes_insert_self ON poll_votes;
CREATE POLICY poll_votes_insert_self ON poll_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM polls p WHERE p.id = poll_votes.poll_id AND EXISTS (
      SELECT 1 FROM group_messages gm WHERE gm.poll_id = p.id AND is_group_member(gm.group_id)
    ) AND NOT p.is_closed
  ));

DROP POLICY poll_votes_delete_self ON poll_votes;
CREATE POLICY poll_votes_delete_self ON poll_votes FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============== messages + chats + chat_messages + chat_participants + dm_reads + message_reactions ==============

DROP POLICY messages_select_pair ON messages;
CREATE POLICY messages_select_pair ON messages FOR SELECT TO authenticated
  USING (sender_id = (SELECT auth.uid()) OR receiver_id = (SELECT auth.uid()));

DROP POLICY messages_insert_self_unblocked ON messages;
CREATE POLICY messages_insert_self_unblocked ON messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND NOT is_blocked((SELECT auth.uid()), receiver_id));

DROP POLICY messages_delete_sender ON messages;
CREATE POLICY messages_delete_sender ON messages FOR DELETE TO authenticated USING (sender_id = (SELECT auth.uid()));

DROP POLICY dm_reads_self ON direct_message_reads;
CREATE POLICY dm_reads_self ON direct_message_reads FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY chats_select_participant ON chats;
CREATE POLICY chats_select_participant ON chats FOR SELECT TO authenticated
  USING (is_chat_participant(id) OR creator_id = (SELECT auth.uid()));

DROP POLICY chats_insert_self ON chats;
CREATE POLICY chats_insert_self ON chats FOR INSERT TO authenticated WITH CHECK (creator_id = (SELECT auth.uid()));

DROP POLICY chats_update_creator ON chats;
CREATE POLICY chats_update_creator ON chats FOR UPDATE TO authenticated
  USING (creator_id = (SELECT auth.uid())) WITH CHECK (creator_id = (SELECT auth.uid()));

DROP POLICY chats_delete_creator ON chats;
CREATE POLICY chats_delete_creator ON chats FOR DELETE TO authenticated USING (creator_id = (SELECT auth.uid()));

DROP POLICY chat_participants_select_member ON chat_participants;
CREATE POLICY chat_participants_select_member ON chat_participants FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR is_chat_participant(chat_id));

DROP POLICY chat_participants_insert_member_or_creator ON chat_participants;
CREATE POLICY chat_participants_insert_member_or_creator ON chat_participants FOR INSERT TO authenticated
  WITH CHECK (is_chat_participant(chat_id) OR EXISTS (
    SELECT 1 FROM chats c WHERE c.id = chat_participants.chat_id AND c.creator_id = (SELECT auth.uid())
  ));

DROP POLICY chat_participants_update_self ON chat_participants;
CREATE POLICY chat_participants_update_self ON chat_participants FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY chat_participants_delete_self_or_creator ON chat_participants;
CREATE POLICY chat_participants_delete_self_or_creator ON chat_participants FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM chats c WHERE c.id = chat_participants.chat_id AND c.creator_id = (SELECT auth.uid())
  ));

DROP POLICY chat_messages_insert_member ON chat_messages;
CREATE POLICY chat_messages_insert_member ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid()) AND is_chat_participant(chat_id));

DROP POLICY chat_messages_delete_sender ON chat_messages;
CREATE POLICY chat_messages_delete_sender ON chat_messages FOR DELETE TO authenticated USING (sender_id = (SELECT auth.uid()));

DROP POLICY message_reactions_select_visible ON message_reactions;
CREATE POLICY message_reactions_select_visible ON message_reactions FOR SELECT TO authenticated
  USING (CASE target_type
    WHEN 'dm'::reaction_target THEN EXISTS (
      SELECT 1 FROM messages m WHERE m.id = message_reactions.target_id AND (m.sender_id = (SELECT auth.uid()) OR m.receiver_id = (SELECT auth.uid()))
    )
    WHEN 'group'::reaction_target THEN EXISTS (
      SELECT 1 FROM group_messages gm WHERE gm.id = message_reactions.target_id AND is_group_member(gm.group_id)
    )
    WHEN 'chat'::reaction_target THEN EXISTS (
      SELECT 1 FROM chat_messages cm WHERE cm.id = message_reactions.target_id AND is_chat_participant(cm.chat_id)
    )
    ELSE NULL::boolean
  END);

DROP POLICY message_reactions_insert_self ON message_reactions;
CREATE POLICY message_reactions_insert_self ON message_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND CASE target_type
    WHEN 'dm'::reaction_target THEN EXISTS (
      SELECT 1 FROM messages m WHERE m.id = message_reactions.target_id AND (m.sender_id = (SELECT auth.uid()) OR m.receiver_id = (SELECT auth.uid()))
    )
    WHEN 'group'::reaction_target THEN EXISTS (
      SELECT 1 FROM group_messages gm WHERE gm.id = message_reactions.target_id AND is_group_member(gm.group_id)
    )
    WHEN 'chat'::reaction_target THEN EXISTS (
      SELECT 1 FROM chat_messages cm WHERE cm.id = message_reactions.target_id AND is_chat_participant(cm.chat_id)
    )
    ELSE NULL::boolean
  END);

DROP POLICY message_reactions_delete_self ON message_reactions;
CREATE POLICY message_reactions_delete_self ON message_reactions FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============== notifications ==============

DROP POLICY notifications_select_self ON notifications;
CREATE POLICY notifications_select_self ON notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY notifications_update_self ON notifications;
CREATE POLICY notifications_update_self ON notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY notifications_delete_self ON notifications;
CREATE POLICY notifications_delete_self ON notifications FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============== expenses + expense_shares ==============

DROP POLICY expenses_insert_participant ON expenses;
CREATE POLICY expenses_insert_participant ON expenses FOR INSERT TO authenticated
  WITH CHECK (payer_id = (SELECT auth.uid()) AND is_chat_participant(chat_id));

DROP POLICY expenses_update_payer ON expenses;
CREATE POLICY expenses_update_payer ON expenses FOR UPDATE TO authenticated
  USING (payer_id = (SELECT auth.uid())) WITH CHECK (payer_id = (SELECT auth.uid()));

DROP POLICY expenses_delete_payer ON expenses;
CREATE POLICY expenses_delete_payer ON expenses FOR DELETE TO authenticated USING (payer_id = (SELECT auth.uid()));

DROP POLICY expense_shares_select_participant ON expense_shares;
CREATE POLICY expense_shares_select_participant ON expense_shares FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND is_chat_participant(e.chat_id)
  ));

DROP POLICY expense_shares_write_payer ON expense_shares;
CREATE POLICY expense_shares_write_payer ON expense_shares FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())));

DROP POLICY expense_shares_update_self_settle ON expense_shares;
CREATE POLICY expense_shares_update_self_settle ON expense_shares FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ============== courts + court_reviews + court_review_photos + court_availability_reports + bookings + booking_players ==============

DROP POLICY courts_insert_self ON courts;
CREATE POLICY courts_insert_self ON courts FOR INSERT TO authenticated WITH CHECK (added_by_id = (SELECT auth.uid()));

DROP POLICY courts_update_self ON courts;
CREATE POLICY courts_update_self ON courts FOR UPDATE TO authenticated
  USING (added_by_id = (SELECT auth.uid())) WITH CHECK (added_by_id = (SELECT auth.uid()));

DROP POLICY courts_delete_self ON courts;
CREATE POLICY courts_delete_self ON courts FOR DELETE TO authenticated USING (added_by_id = (SELECT auth.uid()));

DROP POLICY court_reviews_insert_self ON court_reviews;
CREATE POLICY court_reviews_insert_self ON court_reviews FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY court_reviews_update_self ON court_reviews;
CREATE POLICY court_reviews_update_self ON court_reviews FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY court_reviews_delete_self ON court_reviews;
CREATE POLICY court_reviews_delete_self ON court_reviews FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY court_review_photos_write_author ON court_review_photos;
CREATE POLICY court_review_photos_write_author ON court_review_photos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())));

DROP POLICY court_availability_reports_insert_self ON court_availability_reports;
CREATE POLICY court_availability_reports_insert_self ON court_availability_reports FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY court_availability_reports_delete_self ON court_availability_reports;
CREATE POLICY court_availability_reports_delete_self ON court_availability_reports FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY bookings_select_member ON bookings;
CREATE POLICY bookings_select_member ON bookings FOR SELECT TO authenticated
  USING (organizer_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM booking_players bp WHERE bp.booking_id = bookings.id AND bp.user_id = (SELECT auth.uid())
  ));

DROP POLICY bookings_insert_organizer ON bookings;
CREATE POLICY bookings_insert_organizer ON bookings FOR INSERT TO authenticated WITH CHECK (organizer_id = (SELECT auth.uid()));

DROP POLICY bookings_update_organizer ON bookings;
CREATE POLICY bookings_update_organizer ON bookings FOR UPDATE TO authenticated
  USING (organizer_id = (SELECT auth.uid())) WITH CHECK (organizer_id = (SELECT auth.uid()));

DROP POLICY bookings_delete_organizer ON bookings;
CREATE POLICY bookings_delete_organizer ON bookings FOR DELETE TO authenticated USING (organizer_id = (SELECT auth.uid()));

DROP POLICY booking_players_select_member ON booking_players;
CREATE POLICY booking_players_select_member ON booking_players FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())
  ));

DROP POLICY booking_players_update_self ON booking_players;
CREATE POLICY booking_players_update_self ON booking_players FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY booking_players_write_organizer ON booking_players;
CREATE POLICY booking_players_write_organizer ON booking_players FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())));

-- ============== availabilities + device_tokens ==============

-- Renamed from availabilities_upsert_self and extended with a captain bypass
-- for matches, so captains can pre-assign a lineup slot to a member who
-- hasn't RSVP'd yet (mirrors the UPDATE policy below).
DROP POLICY availabilities_upsert_self ON availabilities;
CREATE POLICY availabilities_insert_self_or_captain ON availabilities FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (SELECT auth.uid()) AND (
      (match_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_matches tm WHERE tm.id = availabilities.match_id AND is_group_member(tm.group_id)
      ))
      OR (practice_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_practices tp JOIN practice_series ps ON ps.id = tp.series_id
        WHERE tp.id = availabilities.practice_id AND is_group_member(ps.group_id)
      ))
    ))
    OR (match_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_matches tm WHERE tm.id = availabilities.match_id AND has_group_role(tm.group_id, 'captain'::group_role)
    ))
  );

DROP POLICY availabilities_update_self_or_captain ON availabilities;
CREATE POLICY availabilities_update_self_or_captain ON availabilities FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (match_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM team_matches tm WHERE tm.id = availabilities.match_id AND has_group_role(tm.group_id, 'captain'::group_role)
  )))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (match_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM team_matches tm WHERE tm.id = availabilities.match_id AND has_group_role(tm.group_id, 'captain'::group_role)
  )));

DROP POLICY availabilities_delete_self ON availabilities;
CREATE POLICY availabilities_delete_self ON availabilities FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY device_tokens_self ON device_tokens;
CREATE POLICY device_tokens_self ON device_tokens FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- =====================================================================
-- 0016_collapse_permissive_policy_overlaps
-- =====================================================================

-- Migration 0016: Address the multiple_permissive_policies advisor.
--
-- Pattern: every `_write_X` policy was FOR ALL, so it overlapped with the
-- corresponding `_select_X` policy on the SELECT command (and sometimes
-- with a `_update_self` policy on UPDATE). The planner has to evaluate
-- every applicable permissive policy and OR them, which is wasted work.
--
-- Fix: split each FOR ALL into separate FOR INSERT / FOR UPDATE / FOR
-- DELETE policies, and merge any pair that targets the same command.

-- ============== booking_players ==============

DROP POLICY booking_players_write_organizer ON booking_players;
DROP POLICY booking_players_update_self ON booking_players;

CREATE POLICY booking_players_insert_organizer ON booking_players FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())));

CREATE POLICY booking_players_update_self_or_organizer ON booking_players FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())
  ));

CREATE POLICY booking_players_delete_organizer ON booking_players FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_players.booking_id AND b.organizer_id = (SELECT auth.uid())));

-- ============== court_review_photos ==============

DROP POLICY court_review_photos_write_author ON court_review_photos;

CREATE POLICY court_review_photos_insert_author ON court_review_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())));

CREATE POLICY court_review_photos_update_author ON court_review_photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())));

CREATE POLICY court_review_photos_delete_author ON court_review_photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM court_reviews cr WHERE cr.id = court_review_photos.review_id AND cr.user_id = (SELECT auth.uid())));

-- ============== event_matches ==============

DROP POLICY event_matches_write_owner ON event_matches;

CREATE POLICY event_matches_insert_owner ON event_matches FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())));

CREATE POLICY event_matches_update_owner ON event_matches FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())));

CREATE POLICY event_matches_delete_owner ON event_matches FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_matches.event_id AND e.owner_id = (SELECT auth.uid())));

-- ============== expense_shares ==============

DROP POLICY expense_shares_write_payer ON expense_shares;
DROP POLICY expense_shares_update_self_settle ON expense_shares;

CREATE POLICY expense_shares_insert_payer ON expense_shares FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())));

CREATE POLICY expense_shares_update_self_or_payer ON expense_shares FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())
  ))
  WITH CHECK (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())
  ));

CREATE POLICY expense_shares_delete_payer ON expense_shares FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM expenses e WHERE e.id = expense_shares.expense_id AND e.payer_id = (SELECT auth.uid())));

-- ============== friend_group_members ==============

DROP POLICY friend_group_members_write_by_owner ON friend_group_members;
DROP POLICY friend_group_members_leave_self ON friend_group_members;

CREATE POLICY friend_group_members_insert_owner ON friend_group_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())));

CREATE POLICY friend_group_members_update_owner ON friend_group_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())));

CREATE POLICY friend_group_members_delete_self_or_owner ON friend_group_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR EXISTS (
    SELECT 1 FROM friend_groups fg WHERE fg.id = friend_group_members.friend_group_id AND fg.owner_id = (SELECT auth.uid())
  ));

-- ============== group_invites ==============

DROP POLICY group_invites_write_manager ON group_invites;

CREATE POLICY group_invites_insert_manager ON group_invites FOR INSERT TO authenticated
  WITH CHECK (has_group_role(group_id, 'manager'::group_role));

CREATE POLICY group_invites_update_manager ON group_invites FOR UPDATE TO authenticated
  USING (has_group_role(group_id, 'manager'::group_role))
  WITH CHECK (has_group_role(group_id, 'manager'::group_role));

CREATE POLICY group_invites_delete_manager ON group_invites FOR DELETE TO authenticated
  USING (has_group_role(group_id, 'manager'::group_role));

-- ============== highlights ==============

DROP POLICY highlights_write_self ON highlights;

CREATE POLICY highlights_insert_self ON highlights FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY highlights_update_self ON highlights FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY highlights_delete_self ON highlights FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============== photos ==============

DROP POLICY photos_write_author ON photos;

CREATE POLICY photos_insert_author ON photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())));

CREATE POLICY photos_update_author ON photos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())));

CREATE POLICY photos_delete_author ON photos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = photos.post_id AND p.author_id = (SELECT auth.uid())));

-- ============== poll_options ==============

DROP POLICY poll_options_write_creator ON poll_options;

CREATE POLICY poll_options_insert_creator ON poll_options FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())));

CREATE POLICY poll_options_update_creator ON poll_options FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())));

CREATE POLICY poll_options_delete_creator ON poll_options FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM polls p WHERE p.id = poll_options.poll_id AND p.created_by_id = (SELECT auth.uid())));

-- ============== post_targets ==============

DROP POLICY post_targets_write_author ON post_targets;

CREATE POLICY post_targets_insert_author ON post_targets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())));

CREATE POLICY post_targets_update_author ON post_targets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())));

CREATE POLICY post_targets_delete_author ON post_targets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_targets.post_id AND p.author_id = (SELECT auth.uid())));

-- ============== practice_series + seasons + team_listings + team_matches ==============
-- (all share the same "manager/captain writes, member reads" shape)

DROP POLICY practice_series_write_captain ON practice_series;
CREATE POLICY practice_series_insert_captain ON practice_series FOR INSERT TO authenticated WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY practice_series_update_captain ON practice_series FOR UPDATE TO authenticated
  USING (has_group_role(group_id, 'captain'::group_role)) WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY practice_series_delete_captain ON practice_series FOR DELETE TO authenticated USING (has_group_role(group_id, 'captain'::group_role));

DROP POLICY seasons_write_captain ON seasons;
CREATE POLICY seasons_insert_captain ON seasons FOR INSERT TO authenticated WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY seasons_update_captain ON seasons FOR UPDATE TO authenticated
  USING (has_group_role(group_id, 'captain'::group_role)) WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY seasons_delete_captain ON seasons FOR DELETE TO authenticated USING (has_group_role(group_id, 'captain'::group_role));

DROP POLICY team_listings_write_captain ON team_listings;
CREATE POLICY team_listings_insert_captain ON team_listings FOR INSERT TO authenticated WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY team_listings_update_captain ON team_listings FOR UPDATE TO authenticated
  USING (has_group_role(group_id, 'captain'::group_role)) WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY team_listings_delete_captain ON team_listings FOR DELETE TO authenticated USING (has_group_role(group_id, 'captain'::group_role));

DROP POLICY team_matches_write_captain ON team_matches;
CREATE POLICY team_matches_insert_captain ON team_matches FOR INSERT TO authenticated WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY team_matches_update_captain ON team_matches FOR UPDATE TO authenticated
  USING (has_group_role(group_id, 'captain'::group_role)) WITH CHECK (has_group_role(group_id, 'captain'::group_role));
CREATE POLICY team_matches_delete_captain ON team_matches FOR DELETE TO authenticated USING (has_group_role(group_id, 'captain'::group_role));

-- ============== team_practices (captain gated via the parent series) ==============

DROP POLICY team_practices_write_captain ON team_practices;
CREATE POLICY team_practices_insert_captain ON team_practices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM practice_series ps WHERE ps.id = team_practices.series_id AND has_group_role(ps.group_id, 'captain'::group_role)));
CREATE POLICY team_practices_update_captain ON team_practices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM practice_series ps WHERE ps.id = team_practices.series_id AND has_group_role(ps.group_id, 'captain'::group_role)))
  WITH CHECK (EXISTS (SELECT 1 FROM practice_series ps WHERE ps.id = team_practices.series_id AND has_group_role(ps.group_id, 'captain'::group_role)));
CREATE POLICY team_practices_delete_captain ON team_practices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM practice_series ps WHERE ps.id = team_practices.series_id AND has_group_role(ps.group_id, 'captain'::group_role)));

-- =====================================================================
-- 0017_index_foreign_keys
-- =====================================================================

-- Migration 0017: Add covering indexes for every foreign key the
-- advisor flagged. Each FK column without an index forces a sequential
-- scan when the planner needs to resolve the join.

-- album_items, albums
CREATE INDEX IF NOT EXISTS album_items_added_by_id_idx ON album_items (added_by_id);
CREATE INDEX IF NOT EXISTS albums_cover_item_idx ON albums (cover_item_id);
CREATE INDEX IF NOT EXISTS albums_created_by_id_idx ON albums (created_by_id);

-- court reports + reviews
CREATE INDEX IF NOT EXISTS court_availability_reports_post_id_idx ON court_availability_reports (post_id);
CREATE INDEX IF NOT EXISTS court_reviews_user_id_idx ON court_reviews (user_id);

-- direct_message_reads partner side
CREATE INDEX IF NOT EXISTS direct_message_reads_other_id_idx ON direct_message_reads (other_id);

-- event_matches — every player slot + reporter / confirmer / proposer
CREATE INDEX IF NOT EXISTS event_matches_player1_id_idx ON event_matches (player1_id);
CREATE INDEX IF NOT EXISTS event_matches_player2_id_idx ON event_matches (player2_id);
CREATE INDEX IF NOT EXISTS event_matches_player3_id_idx ON event_matches (player3_id) WHERE player3_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_matches_player4_id_idx ON event_matches (player4_id) WHERE player4_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_matches_reported_by_idx ON event_matches (reported_by) WHERE reported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_matches_confirmed_by_idx ON event_matches (confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_matches_proposed_by_idx ON event_matches (proposed_by) WHERE proposed_by IS NOT NULL;

-- group files + invites
CREATE INDEX IF NOT EXISTS group_files_uploaded_by_id_idx ON group_files (uploaded_by_id);
CREATE INDEX IF NOT EXISTS group_invites_invited_by_id_idx ON group_invites (invited_by_id);
CREATE INDEX IF NOT EXISTS group_invites_accepted_by_id_idx ON group_invites (accepted_by_id) WHERE accepted_by_id IS NOT NULL;

-- group_messages — sender and shared_post
CREATE INDEX IF NOT EXISTS group_messages_sender_id_idx ON group_messages (sender_id);
CREATE INDEX IF NOT EXISTS group_messages_shared_post_id_idx ON group_messages (shared_post_id) WHERE shared_post_id IS NOT NULL;

-- messages shared_post
CREATE INDEX IF NOT EXISTS messages_shared_post_id_idx ON messages (shared_post_id) WHERE shared_post_id IS NOT NULL;

-- notifications: post / comment / message / event / match (all optional)
CREATE INDEX IF NOT EXISTS notifications_post_id_idx ON notifications (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_comment_id_idx ON notifications (comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_message_id_idx ON notifications (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_event_id_idx ON notifications (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_match_id_idx ON notifications (match_id) WHERE match_id IS NOT NULL;

-- poll_votes per user
CREATE INDEX IF NOT EXISTS poll_votes_user_id_idx ON poll_votes (user_id);

-- practice_series + team_matches season FKs
CREATE INDEX IF NOT EXISTS practice_series_season_id_idx ON practice_series (season_id) WHERE season_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_matches_season_id_idx ON team_matches (season_id) WHERE season_id IS NOT NULL;

-- team_listings created_by
CREATE INDEX IF NOT EXISTS team_listings_created_by_id_idx ON team_listings (created_by_id);

-- ============================================================
-- TEST FIXTURE TEARDOWN HELPER
-- ============================================================
--
-- auth.admin.deleteUser fails silently when the user owns rows behind a
-- RESTRICT foreign key (groups.owner_id, events.owner_id, etc.). Without
-- this helper, integration-test teardown leaves orphan fixtures (107 such
-- profiles piled up during the Prisma->Supabase migration test runs).
--
-- Hard guard: refuses to run against any user whose email isn't on the
-- @tennisfriend.test domain, so misuse can't wipe real accounts.

-- Internal helper: hard-delete every RESTRICT-blocking row owned by `uid`
-- across the schema, so a subsequent auth.users delete can cascade through
-- profiles without tripping a foreign key. Shared by both
-- cleanup_user_for_test (test teardown) and delete_my_account (user-driven
-- account deletion from Settings) so the two stay in lockstep.
CREATE OR REPLACE FUNCTION public._delete_user_owned_rows(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.album_items WHERE added_by_id = uid;
  DELETE FROM public.albums WHERE created_by_id = uid;
  DELETE FROM public.booking_players
    WHERE booking_id IN (SELECT id FROM public.bookings WHERE organizer_id = uid);
  DELETE FROM public.bookings WHERE organizer_id = uid;
  DELETE FROM public.chat_messages
    WHERE chat_id IN (SELECT id FROM public.chats WHERE creator_id = uid);
  DELETE FROM public.chat_participants
    WHERE chat_id IN (SELECT id FROM public.chats WHERE creator_id = uid);
  DELETE FROM public.chats WHERE creator_id = uid;
  DELETE FROM public.courts WHERE added_by_id = uid;
  DELETE FROM public.event_matches
    WHERE player1_id = uid OR player2_id = uid;
  DELETE FROM public.event_participants
    WHERE event_id IN (SELECT id FROM public.events WHERE owner_id = uid);
  DELETE FROM public.events WHERE owner_id = uid;
  DELETE FROM public.expense_shares
    WHERE expense_id IN (SELECT id FROM public.expenses WHERE payer_id = uid);
  DELETE FROM public.expenses WHERE payer_id = uid;
  DELETE FROM public.group_files WHERE uploaded_by_id = uid;
  DELETE FROM public.group_invites WHERE invited_by_id = uid;
  DELETE FROM public.poll_votes
    WHERE poll_id IN (SELECT id FROM public.polls WHERE created_by_id = uid);
  DELETE FROM public.polls WHERE created_by_id = uid;
  DELETE FROM public.team_listings WHERE created_by_id = uid;
  DELETE FROM public.groups WHERE owner_id = uid;
  DELETE FROM public.friend_groups WHERE owner_id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public._delete_user_owned_rows(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_user_for_test(uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = uid AND email LIKE '%@tennisfriend.test'
  ) THEN
    RAISE EXCEPTION 'cleanup_user_for_test refuses non-test user %', uid;
  END IF;

  PERFORM public._delete_user_owned_rows(uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_user_for_test(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cleanup_user_for_test(uuid) FROM PUBLIC, anon, authenticated;

-- User-driven account self-deletion. Called by /api/account/delete after the
-- user double-confirms in Settings → Danger zone. Operates only on the
-- caller's own rows (auth.uid()); the API route follows up with storage
-- cleanup + auth.admin.deleteUser to remove the profile + auth record.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._delete_user_owned_rows(uid);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- ============================================================
-- FRIEND-REQUEST NOTIFICATION
-- ============================================================
--
-- Create a 'friend_request' notification row for the addressee whenever a
-- pending friendship is inserted. Without this trigger the addressee
-- never sees the request in their bell — what June Fang hit when
-- Chaoran sent her one through the UI.

CREATE OR REPLACE FUNCTION public.notify_friend_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, actor_id, type)
    VALUES (NEW.addressee_id, NEW.requester_id, 'friend_request');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notify_request ON public.friendships;
CREATE TRIGGER friendships_notify_request
  AFTER INSERT ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_friend_request();

-- When a pending friendship is cancelled (requester), rejected (addressee),
-- or accepted (addressee), the matching notification becomes stale and is
-- removed so the addressee's bell stays in sync with the actual state.

CREATE OR REPLACE FUNCTION public.cleanup_friend_request_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_user uuid;
  target_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.addressee_id;
    target_actor := OLD.requester_id;
  ELSE
    -- Only fire when transitioning away from pending.
    IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
      target_user := NEW.addressee_id;
      target_actor := NEW.requester_id;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  DELETE FROM public.notifications
  WHERE user_id = target_user
    AND actor_id = target_actor
    AND type = 'friend_request';

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS friendships_cleanup_notification_delete ON public.friendships;
CREATE TRIGGER friendships_cleanup_notification_delete
  AFTER DELETE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_friend_request_notification();

DROP TRIGGER IF EXISTS friendships_cleanup_notification_update ON public.friendships;
CREATE TRIGGER friendships_cleanup_notification_update
  AFTER UPDATE OF status ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_friend_request_notification();

-- ============================================================
-- COUNT-USER-FRIENDS HELPER
-- ============================================================
--
-- The friendships RLS policy (friendships_select_either) only exposes
-- rows where the viewer is a participant, so a client-side `count(*)`
-- on another user returns 0. The profile chip ("N friends") needs the
-- target user's count regardless of viewer. SECURITY DEFINER bypasses
-- the row filter but the function returns only an integer — no PII or
-- friend identity escapes beyond what is already publicly shown on the
-- profile card.

CREATE OR REPLACE FUNCTION public.count_user_friends(user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.friendships
  WHERE status = 'accepted'
    AND (requester_id = user_id OR addressee_id = user_id);
$$;

REVOKE EXECUTE ON FUNCTION public.count_user_friends(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_user_friends(uuid) TO authenticated;

-- ============================================================
-- AUTO SESSION-CHAT ON POST COMPLETE
-- ============================================================
--
-- Recreates the pre-Supabase behavior (commit 578a043): when a
-- find_players post flips to is_complete = true, spin up a group chat
-- with the author + every approved player, plus a templated "Game
-- confirmed" message. The PostCard's collapsed/confirmed view depends
-- on this chat existing — without it the "Open chat" CTA falls back
-- to "Details" and the players have no way to coordinate.

-- Belt-and-suspenders: at-most-one chat per post.
CREATE UNIQUE INDEX IF NOT EXISTS chats_post_id_unique
  ON public.chats (post_id) WHERE post_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_session_chat_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat_id      uuid;
  v_play_dt      timestamptz;
  v_session_end  timestamptz;
  v_chat_name    text;
  v_players      text;
  v_message      text;
  v_duration     integer;
  v_location     text;
  v_location_md  text;
BEGIN
  IF NEW.is_complete IS NOT TRUE OR NEW.post_type <> 'find_players' THEN
    RETURN NEW;
  END IF;

  BEGIN
    -- Wall-clock parse: NEW.play_date + NEW.play_time are
    -- user-local strings (e.g. "2026-07-15", "18:00"). Cast to a
    -- naive timestamp first, then bind via AT TIME ZONE so the
    -- parser uses the user's zone rather than the server's UTC.
    v_play_dt := ((NEW.play_date || ' ' || NEW.play_time || ':00')::timestamp
                  AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'));
  EXCEPTION WHEN OTHERS THEN
    v_play_dt := now() + interval '24 hours';
  END;
  v_duration := COALESCE(NULLIF(NEW.play_duration, 0), 90);
  v_session_end := v_play_dt + (v_duration || ' minutes')::interval;
  v_location := COALESCE(NULLIF(NEW.court_location, ''), 'TBD');
  -- When the post is tied to a catalog court, embed a markdown-style
  -- link in the chat message so the renderer in renderChatMessage.tsx
  -- can turn the location line into a clickable jump to /courts. Plain
  -- text fallback for free-text locations and the 'TBD' placeholder.
  v_location_md := CASE
    WHEN NEW.court_facility_id IS NOT NULL AND NULLIF(NEW.court_location, '') IS NOT NULL
      THEN '[' || NEW.court_location || '](/courts?selected=' || NEW.court_facility_id || ')'
    ELSE v_location
  END;

  -- Render the chat title in the user's zone so the displayed time
  -- matches what they typed.
  v_chat_name := trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'Mon FMDD')) || ' · '
              || v_location || ' · '
              || trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'FMHH12:MI AM'));

  -- ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING:
  -- backstops the chats_post_id_unique partial index against the
  -- race where two concurrent is_complete=true updates both pass
  -- an EXISTS precheck. With ON CONFLICT, the loser silently
  -- noops (v_chat_id stays NULL) instead of raising a
  -- unique_violation that would roll back the entire UPDATE
  -- (players_confirmed + is_complete reverting).
  INSERT INTO public.chats (name, creator_id, post_id, session_end_at, manual_player_names)
  VALUES (v_chat_name, NEW.author_id, NEW.id, v_session_end, COALESCE(NEW.manual_players, ''))
  ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_chat_id;
  IF v_chat_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT v_chat_id, NEW.author_id
  UNION
  SELECT v_chat_id, pr.user_id
  FROM public.play_requests pr
  WHERE pr.post_id = NEW.id AND pr.status = 'approved';

  SELECT string_agg(name, ', ' ORDER BY ord) INTO v_players FROM (
    SELECT p.name, 0 AS ord
    FROM public.profiles p WHERE p.id = NEW.author_id
    UNION ALL
    SELECT p.name, ROW_NUMBER() OVER (ORDER BY pr.created_at) AS ord
    FROM public.play_requests pr
    JOIN public.profiles p ON p.id = pr.user_id
    WHERE pr.post_id = NEW.id AND pr.status = 'approved'
  ) s;

  v_players := concat_ws(
    ', ',
    NULLIF(v_players, ''),
    NULLIF(NEW.manual_players, '')
  );

  v_message := E'🎾 Game confirmed!\n'
            || E'📅 ' || trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'Mon FMDD at FMHH12:MI AM'))
            || ' (' || v_duration || E' min)\n'
            || E'📍 ' || v_location_md || E'\n'
            || 'Players: ' || COALESCE(v_players, '') || E'\n\n'
            || 'See you on court!';

  INSERT INTO public.chat_messages (chat_id, sender_id, content)
  VALUES (v_chat_id, NEW.author_id, v_message);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_create_session_chat ON public.posts;
CREATE TRIGGER posts_create_session_chat
  AFTER UPDATE OF is_complete ON public.posts
  FOR EACH ROW
  WHEN (NEW.is_complete = true)
  EXECUTE FUNCTION public.create_session_chat_on_complete();

DROP TRIGGER IF EXISTS posts_create_session_chat_insert ON public.posts;
CREATE TRIGGER posts_create_session_chat_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  WHEN (NEW.is_complete = true)
  EXECUTE FUNCTION public.create_session_chat_on_complete();

-- Keep chats.session_end_at in sync with the post's timing: if the
-- post owner edits play_date / play_time / play_duration after the
-- chat is created, recompute the end-of-game timestamp so any
-- archive / cleanup logic that keys off session_end_at sees the
-- latest value.
CREATE OR REPLACE FUNCTION public.sync_chat_session_end_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat_id     uuid;
  v_play_dt     timestamptz;
  v_duration    integer;
  v_session_end timestamptz;
  v_tz          text;
BEGIN
  IF NEW.post_type <> 'find_players' THEN RETURN NEW; END IF;
  IF OLD.play_date     IS NOT DISTINCT FROM NEW.play_date
     AND OLD.play_time IS NOT DISTINCT FROM NEW.play_time
     AND OLD.play_duration IS NOT DISTINCT FROM NEW.play_duration
     AND OLD.play_timezone IS NOT DISTINCT FROM NEW.play_timezone THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_chat_id FROM chats WHERE post_id = NEW.id LIMIT 1;
  IF v_chat_id IS NULL THEN RETURN NEW; END IF;

  v_tz := COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles');
  BEGIN
    v_play_dt := ((NEW.play_date || ' ' || NEW.play_time || ':00')::timestamp AT TIME ZONE v_tz);
  EXCEPTION WHEN OTHERS THEN
    v_play_dt := NULL;
  END;
  IF v_play_dt IS NULL THEN RETURN NEW; END IF;
  v_duration    := COALESCE(NULLIF(NEW.play_duration, 0), 90);
  v_session_end := v_play_dt + (v_duration || ' minutes')::interval;

  UPDATE chats SET session_end_at = v_session_end WHERE id = v_chat_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_sync_chat_session_end ON public.posts;
CREATE TRIGGER posts_sync_chat_session_end
  AFTER UPDATE OF play_date, play_time, play_duration, play_timezone ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_chat_session_end_at();

-- ============================================================
-- TEAM GROUP CREATION ON PROPOSE_TEAM COMPLETION
-- ============================================================
--
-- Mirrors create_session_chat_on_complete, but for propose_team posts:
-- when one fills up (is_complete flips true), spin up a real Group with
-- the author as owner + approved play_request users as members, post a
-- welcome group_message, and link the new group back via
-- posts.team_group_id. PostCard reads team_group_id (surfaced as
-- teamGroupId by the adapter) to render the collapsed "Open team" CTA
-- and to show the new team on /groups ("Your Teams"). Lost in the
-- Prisma -> Supabase burn-down (was src/lib/teamGroup.ts), restored
-- here as a SECURITY DEFINER trigger so every code path that flips
-- is_complete = true creates the group, idempotently.

CREATE OR REPLACE FUNCTION public.create_team_group_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id    uuid;
  v_team_name   text;
  v_author_name text;
  v_message     text;
BEGIN
  IF NEW.is_complete IS NOT TRUE OR NEW.post_type <> 'propose_team' THEN
    RETURN NEW;
  END IF;

  -- Idempotency: team_group_id defaults to '' on the posts table, so
  -- check both null and empty. If the column is already populated, a
  -- group exists and we must not create a second one.
  IF NEW.team_group_id IS NOT NULL AND NEW.team_group_id <> '' THEN
    RETURN NEW;
  END IF;

  SELECT NULLIF(trim(name), '') INTO v_author_name FROM public.profiles WHERE id = NEW.author_id;
  -- For propose_team posts, court_location holds the user-entered
  -- team name (see PostComposer). Fall back order: explicit
  -- court_location → "{author}'s Team" → bare "Team". The NULLIF on
  -- the SELECT above prevents the empty-name case from yielding the
  -- cosmetic-bad "'s Team".
  v_team_name := COALESCE(
    NULLIF(trim(NEW.court_location), ''),
    CASE WHEN v_author_name IS NULL THEN 'Team'
         ELSE v_author_name || '''s Team' END
  );

  INSERT INTO public.groups (name, owner_id)
  VALUES (v_team_name, NEW.author_id)
  RETURNING id INTO v_group_id;

  -- Author as owner + every approved play_request user as member.
  -- UNION (not UNION ALL) deduplicates in case the author somehow has
  -- an approved request to their own post; ON CONFLICT belt-and-
  -- suspenders against the (group_id, user_id) unique constraint.
  INSERT INTO public.group_members (group_id, user_id, role)
  SELECT v_group_id, NEW.author_id, 'owner'::group_role
  UNION
  SELECT v_group_id, pr.user_id, 'member'::group_role
  FROM public.play_requests pr
  WHERE pr.post_id = NEW.id AND pr.status = 'approved'
  ON CONFLICT (group_id, user_id) DO NOTHING;

  v_message := E'🏆 Team formed!\n'
            || 'Welcome to ' || v_team_name || E' — let''s organize practice and matches.';

  INSERT INTO public.group_messages (group_id, sender_id, content)
  VALUES (v_group_id, NEW.author_id, v_message);

  -- Link the post to the new group. Updating team_group_id (not
  -- is_complete) does not re-fire the AFTER UPDATE OF is_complete
  -- trigger, so no recursion.
  UPDATE public.posts
  SET team_group_id = v_group_id::text
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_create_team_group ON public.posts;
CREATE TRIGGER posts_create_team_group
  AFTER UPDATE OF is_complete ON public.posts
  FOR EACH ROW
  WHEN (NEW.is_complete = true)
  EXECUTE FUNCTION public.create_team_group_on_complete();

DROP TRIGGER IF EXISTS posts_create_team_group_insert ON public.posts;
CREATE TRIGGER posts_create_team_group_insert
  AFTER INSERT ON public.posts
  FOR EACH ROW
  WHEN (NEW.is_complete = true)
  EXECUTE FUNCTION public.create_team_group_on_complete();

-- ============================================================
-- NOTIFICATION SIDE EFFECTS
-- ============================================================
--
-- Recreates the per-action notification fan-out that
-- /api/posts/like, /api/comments, /api/posts/join,
-- /api/posts/join/respond, and /api/messages/reactions all did before
-- they were deleted in the Prisma → Supabase burn-down (86f26a5).
-- SECURITY DEFINER because notifications has no INSERT policy (only
-- the recipient can SELECT/UPDATE/DELETE their own).

-- ----- likes → "like" to post author --------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_author_id uuid;
BEGIN
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  VALUES (v_author_id, NEW.user_id, 'like', NEW.post_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS likes_notify ON public.likes;
CREATE TRIGGER likes_notify AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

-- ----- comments → "comment" to author + "reply" to other commenters --
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_author_id uuid;
BEGIN
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL THEN RETURN NEW; END IF;

  IF v_author_id <> NEW.author_id THEN
    INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
    VALUES (v_author_id, NEW.author_id, 'comment', NEW.post_id, NEW.id);
  END IF;

  -- Explicit ::notification_type cast: SELECT-INSERT doesn't implicit-
  -- coerce text → enum the way VALUES does.
  INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
  SELECT DISTINCT c.author_id, NEW.author_id, 'reply'::notification_type, NEW.post_id, NEW.id
  FROM comments c
  WHERE c.post_id = NEW.post_id
    AND c.author_id <> NEW.author_id
    AND c.author_id <> v_author_id
    AND c.id <> NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS comments_notify ON public.comments;
CREATE TRIGGER comments_notify AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

-- ----- play_requests INSERT → "join_request" to post author ----------
CREATE OR REPLACE FUNCTION public.notify_on_join_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_author_id uuid;
BEGIN
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  VALUES (v_author_id, NEW.user_id, 'join_request', NEW.post_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS play_requests_notify_insert ON public.play_requests;
CREATE TRIGGER play_requests_notify_insert AFTER INSERT ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_join_request();

-- Re-application path: the C1 fix in requestToJoin re-uses an existing
-- play_requests row (rejected/withdrawn/removed → pending) instead of
-- INSERTing a fresh one. Without this AFTER UPDATE branch, the post
-- author never sees a notification for the second attempt.
CREATE OR REPLACE FUNCTION public.notify_on_join_request_reapply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_author_id uuid;
BEGIN
  IF NEW.status <> 'pending' OR OLD.status = 'pending'
     OR OLD.status NOT IN ('rejected','withdrawn','removed') THEN
    RETURN NEW;
  END IF;
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  VALUES (v_author_id, NEW.user_id, 'join_request', NEW.post_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS play_requests_notify_reapply ON public.play_requests;
CREATE TRIGGER play_requests_notify_reapply
  AFTER UPDATE OF status ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_join_request_reapply();

-- ----- play_requests status flip → request_approved / request_rejected ----
CREATE OR REPLACE FUNCTION public.notify_on_play_request_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_author_id uuid;
  v_notif_type notification_type;
BEGIN
  IF OLD.status <> 'pending' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  v_notif_type := CASE NEW.status WHEN 'approved' THEN 'request_approved'::notification_type
                                  ELSE 'request_rejected'::notification_type END;
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  VALUES (NEW.user_id, v_author_id, v_notif_type, NEW.post_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS play_requests_notify_response ON public.play_requests;
CREATE TRIGGER play_requests_notify_response
  AFTER UPDATE OF status ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_play_request_response();

-- ----- message_reactions → "message_reaction" to DM sender (only) ----
CREATE OR REPLACE FUNCTION public.notify_on_message_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sender_id uuid;
BEGIN
  IF NEW.target_type <> 'dm' THEN RETURN NEW; END IF;
  SELECT sender_id INTO v_sender_id FROM messages WHERE id = NEW.target_id;
  IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, message_id, emoji)
  VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_reactions_notify ON public.message_reactions;
CREATE TRIGGER message_reactions_notify AFTER INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message_reaction();

-- ============================================================
-- EVENT PARTICIPANT CAPACITY + WAITLIST + SIGNUP NOTIFICATION
-- ============================================================
--
-- Recreates /api/events/[id]/signup's server-side orchestration
-- (capacity check, waitlist promotion, owner notification).

-- BEFORE INSERT: capacity → waitlist, plus restored guards from
-- /api/events/[id]/signup that the burn-down dropped:
--   - Tournament signup lock once the bracket is seeded (>=1 event_matches).
--   - NTRP gate when the event sets ntrp_min / ntrp_max.
CREATE OR REPLACE FUNCTION public.enforce_event_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event       events%ROWTYPE;
  v_rating      double precision;
  v_count       integer;
  v_match_count integer;
BEGIN
  IF NEW.status <> 'registered' THEN RETURN NEW; END IF;

  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;
  IF v_event.id IS NULL THEN RETURN NEW; END IF;

  IF v_event.event_type = 'tournament' THEN
    SELECT count(*) INTO v_match_count FROM event_matches
      WHERE event_id = NEW.event_id;
    IF v_match_count > 0 THEN
      RAISE EXCEPTION 'Bracket is live — signups are locked'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_event.ntrp_min IS NOT NULL OR v_event.ntrp_max IS NOT NULL THEN
    SELECT ntrp_rating INTO v_rating FROM profiles WHERE id = NEW.user_id;
    IF v_rating IS NULL THEN
      RAISE EXCEPTION 'Set your NTRP rating in your profile to sign up for this event'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_event.ntrp_min IS NOT NULL AND v_rating < v_event.ntrp_min THEN
      RAISE EXCEPTION 'NTRP % required for this event', v_event.ntrp_min
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_event.ntrp_max IS NOT NULL AND v_rating > v_event.ntrp_max THEN
      RAISE EXCEPTION 'NTRP % max for this event', v_event.ntrp_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_event.max_participants IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM event_participants
    WHERE event_id = NEW.event_id AND status = 'registered';
  IF v_count >= v_event.max_participants THEN NEW.status := 'waitlist'; END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS event_participants_enforce_capacity ON public.event_participants;
CREATE TRIGGER event_participants_enforce_capacity
  BEFORE INSERT ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_capacity();

CREATE OR REPLACE FUNCTION public.promote_event_waitlist()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_promoted_id uuid;
BEGIN
  IF OLD.status <> 'registered' OR NEW.status <> 'withdrawn' THEN RETURN NEW; END IF;
  SELECT id INTO v_promoted_id FROM event_participants
  WHERE event_id = NEW.event_id AND status = 'waitlist'
  ORDER BY registered_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_promoted_id IS NOT NULL THEN
    UPDATE event_participants SET status = 'registered' WHERE id = v_promoted_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS event_participants_promote_waitlist ON public.event_participants;
CREATE TRIGGER event_participants_promote_waitlist
  AFTER UPDATE OF status ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.promote_event_waitlist();

CREATE OR REPLACE FUNCTION public.notify_on_event_signup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner_id uuid;
BEGIN
  SELECT owner_id INTO v_owner_id FROM events WHERE id = NEW.event_id;
  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, event_id)
  VALUES (v_owner_id, NEW.user_id, 'event_signup', NEW.event_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS event_participants_notify_signup ON public.event_participants;
CREATE TRIGGER event_participants_notify_signup
  AFTER INSERT ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_event_signup();

-- ============================================================
-- POST PLAY_REQUEST WITHDRAW / REMOVE FAN-OUT
-- ============================================================
--
-- Restores the side-effects from /api/posts/join/cancel and
-- /api/posts/join/remove. When an APPROVED play_request flips to
-- 'withdrawn' (requester cancels) or 'removed' (post author kicks them):
--   - decrement posts.players_confirmed and clear is_complete so the
--     slot is free again,
--   - DM the counterparty (author for withdraw, removed player for
--     remove) with shared_post_id linked to the post card.
-- PENDING -> withdrawn is just a UI cancel — no counter to free, no DM.
CREATE OR REPLACE FUNCTION public.handle_play_request_withdraw_or_remove()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post        posts%ROWTYPE;
  v_actor_name  text;
  v_content     text;
  v_target_user uuid;
  v_note_trim   text;
BEGIN
  IF NEW.status NOT IN ('withdrawn', 'removed') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status <> 'approved' THEN RETURN NEW; END IF;

  SELECT * INTO v_post FROM posts WHERE id = NEW.post_id;
  IF v_post.id IS NULL THEN RETURN NEW; END IF;

  -- Counter math (players_confirmed + is_complete) is owned by
  -- recount_post_players_confirmed, fired via play_requests_recount_
  -- post. This trigger only owns the DM fan-out — previously it
  -- also decremented manually, which double-counted once the
  -- recount path landed.
  v_note_trim := NULLIF(trim(NEW.note), '');

  IF NEW.status = 'withdrawn' THEN
    v_target_user := v_post.author_id;
    SELECT name INTO v_actor_name FROM profiles WHERE id = NEW.user_id;
    v_content := COALESCE(v_actor_name, 'A player')
              || ' withdrew from your game'
              || CASE WHEN v_note_trim IS NOT NULL
                      THEN ': "' || v_note_trim || '"' ELSE '' END;
    IF v_target_user IS NOT NULL AND v_target_user <> NEW.user_id THEN
      INSERT INTO messages (sender_id, receiver_id, content, shared_post_id)
      VALUES (NEW.user_id, v_target_user, v_content, NEW.post_id);
    END IF;
  ELSE
    v_target_user := NEW.user_id;
    SELECT name INTO v_actor_name FROM profiles WHERE id = v_post.author_id;
    v_content := COALESCE(v_actor_name, 'The organizer')
              || ' removed you from the game'
              || CASE WHEN v_note_trim IS NOT NULL
                      THEN ': "' || v_note_trim || '"' ELSE '' END;
    IF v_target_user IS NOT NULL AND v_target_user <> v_post.author_id THEN
      INSERT INTO messages (sender_id, receiver_id, content, shared_post_id)
      VALUES (v_post.author_id, v_target_user, v_content, NEW.post_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS play_requests_withdraw_or_remove ON public.play_requests;
CREATE TRIGGER play_requests_withdraw_or_remove
  AFTER UPDATE OF status ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_play_request_withdraw_or_remove();

-- ============================================================
-- EVENT MATCH STATUS FAN-OUT (report / confirm / dispute)
-- ============================================================
--
-- Restores the side-effects of
--   /api/events/[id]/matches/[matchId]/report,
--   /api/events/[id]/matches/[matchId]/confirm,
--   /api/events/[id]/matches/[matchId]/dispute.
-- Fires notifications on every status transition. Events no longer get
-- an auto-created backing group chat, so this is notification-only.
CREATE OR REPLACE FUNCTION public.notify_on_event_match_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid;
  v_other_id uuid;
  v_reporter uuid;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'in_progress' AND OLD.status <> 'in_progress'
     AND NEW.reported_by IS NOT NULL THEN
    v_actor := NEW.reported_by;
    v_other_id := CASE WHEN v_actor = NEW.player1_id
                       THEN NEW.player2_id ELSE NEW.player1_id END;
    IF v_other_id IS NOT NULL AND v_other_id <> v_actor THEN
      INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
      VALUES (v_other_id, v_actor, 'event_match_report'::notification_type,
              NEW.event_id, NEW.id);
    END IF;

  ELSIF NEW.status = 'completed' AND OLD.status = 'in_progress'
        AND NEW.confirmed_by IS NOT NULL THEN
    v_actor    := NEW.confirmed_by;
    v_reporter := NEW.reported_by;
    IF v_reporter IS NOT NULL AND v_reporter <> v_actor THEN
      INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
      VALUES (v_reporter, v_actor, 'event_match_confirmed'::notification_type,
              NEW.event_id, NEW.id);
    END IF;

  ELSIF NEW.status = 'scheduled' AND OLD.status = 'in_progress'
        AND NEW.disputed_at IS NOT NULL
        AND OLD.disputed_at IS DISTINCT FROM NEW.disputed_at THEN
    v_reporter := OLD.reported_by;
    v_other_id := CASE WHEN v_reporter = NEW.player1_id
                       THEN NEW.player2_id ELSE NEW.player1_id END;
    IF v_reporter IS NOT NULL AND v_other_id IS NOT NULL
       AND v_reporter <> v_other_id THEN
      INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
      VALUES (v_reporter, v_other_id, 'event_match_disputed'::notification_type,
              NEW.event_id, NEW.id);
    END IF;

  -- Ladder challenge accepted: proposed -> scheduled.
  ELSIF NEW.status = 'scheduled' AND OLD.status = 'proposed' THEN
    v_actor := NEW.player2_id;
    IF NEW.proposed_by IS NOT NULL AND NEW.proposed_by <> v_actor THEN
      INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
      VALUES (NEW.proposed_by, v_actor,
              'event_challenge_accepted'::notification_type, NEW.event_id, NEW.id);
    END IF;

  -- Ladder challenge declined: proposed -> declined.
  ELSIF NEW.status = 'declined' AND OLD.status = 'proposed' THEN
    v_actor := NEW.player2_id;
    IF NEW.proposed_by IS NOT NULL AND NEW.proposed_by <> v_actor THEN
      INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
      VALUES (NEW.proposed_by, v_actor,
              'event_challenge_declined'::notification_type, NEW.event_id, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matches_status_fanout ON public.event_matches;
CREATE TRIGGER event_matches_status_fanout
  AFTER UPDATE ON public.event_matches
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_event_match_status_change();

-- BEFORE UPDATE gate: stop a malicious player from setting
-- reported_by / confirmed_by / proposed_by / player2_id to someone
-- else's uuid. event_matches_update_owner_or_player permits the four
-- player slots to UPDATE the row, and the AFTER trigger above
-- impersonates whoever those columns name. The gate forces those
-- "actor" columns to remain self (or NULL for clears) unless the
-- event owner is the writer. Skipped when auth.uid() is NULL
-- (SECURITY DEFINER cascades from trigger functions, cron, tests).
CREATE OR REPLACE FUNCTION public.enforce_event_match_actor_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
BEGIN
  IF v_caller IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO v_owner FROM events WHERE id = NEW.event_id;
  IF v_owner = v_caller THEN RETURN NEW; END IF;

  IF NEW.reported_by IS DISTINCT FROM OLD.reported_by
     AND NEW.reported_by IS NOT NULL
     AND NEW.reported_by <> v_caller THEN
    RAISE EXCEPTION 'reported_by must be the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
     AND NEW.confirmed_by IS NOT NULL
     AND NEW.confirmed_by <> v_caller THEN
    RAISE EXCEPTION 'confirmed_by must be the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     AND NEW.proposed_by IS NOT NULL
     AND NEW.proposed_by <> v_caller THEN
    RAISE EXCEPTION 'proposed_by must be the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Score / winner_side may only be written by:
  --  (a) the event owner (handled above),
  --  (b) a player whose own auth.uid() ends up in NEW.reported_by
  --      (the legitimate report path — already gated above to
  --      require self), or
  --  (c) a player CLEARING them as part of a dispute (NEW values
  --      empty/null AND NEW.disputed_at freshly set).
  IF (NEW.winner_side IS DISTINCT FROM OLD.winner_side
      OR NEW.score IS DISTINCT FROM OLD.score) THEN
    IF NEW.reported_by IS NOT NULL AND NEW.reported_by = v_caller THEN
      NULL;
    ELSIF NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
          AND NEW.disputed_at IS NOT NULL
          AND COALESCE(NEW.score, '') = ''
          AND NEW.winner_side IS NULL THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'score / winner_side may only be set by the reporter or event owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF OLD.status = 'proposed' AND NEW.status IN ('scheduled', 'declined')
     AND NEW.player2_id IS DISTINCT FROM OLD.player2_id THEN
    RAISE EXCEPTION 'cannot reassign player2 while responding to a challenge'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'proposed' AND NEW.status IN ('scheduled', 'declined')
     AND NEW.player2_id IS NOT NULL AND NEW.player2_id <> v_caller THEN
    RAISE EXCEPTION 'only the challenged player can respond'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matches_enforce_actors ON public.event_matches;
CREATE TRIGGER event_matches_enforce_actors
  BEFORE UPDATE ON public.event_matches
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_match_actor_columns();

-- INSERT trigger: ladder challenge propose -> notify challenged player.
CREATE OR REPLACE FUNCTION public.notify_on_event_match_proposed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  IF NEW.status <> 'proposed' OR NEW.proposed_by IS NULL OR NEW.player2_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT event_type INTO v_event_type FROM events WHERE id = NEW.event_id;
  IF v_event_type <> 'ladder' THEN RETURN NEW; END IF;

  IF NEW.player2_id <> NEW.proposed_by THEN
    INSERT INTO notifications (user_id, actor_id, type, event_id, match_id)
    VALUES (NEW.player2_id, NEW.proposed_by,
            'event_ladder_challenge'::notification_type, NEW.event_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matches_notify_proposed ON public.event_matches;
CREATE TRIGGER event_matches_notify_proposed
  AFTER INSERT ON public.event_matches
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_event_match_proposed();

-- ============================================================
-- TOURNAMENT BRACKET: seed + winner advancement
-- ============================================================
--
-- seed_event_bracket() is organizer-only and idempotent (refuses if
-- any event_matches row already exists). The pairs argument comes
-- from src/lib/eventCompetitive.ts::seedBracket so the seeding
-- algorithm lives in one place. Byes are auto-advanced.
CREATE OR REPLACE FUNCTION public.seed_event_bracket(
  p_event_id uuid,
  p_pairs    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_event      events%ROWTYPE;
  v_existing   integer;
  v_total      integer;
  v_size       integer;
  v_p1         uuid;
  v_p2         uuid;
  v_slot       text;
  v_inserted   integer := 0;
  v_idx        integer := 0;
  v_pair       jsonb;
  v_match_id   uuid;
  v_byes       uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.owner_id <> v_caller THEN
    RAISE EXCEPTION 'Only the organizer can seed the bracket'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.event_type <> 'tournament' THEN
    RAISE EXCEPTION 'Only tournament events have a bracket'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_existing FROM event_matches WHERE event_id = p_event_id;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Bracket already seeded' USING ERRCODE = 'unique_violation';
  END IF;

  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RAISE EXCEPTION 'pairs must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_total := jsonb_array_length(p_pairs);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'Need at least one pair' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_size := v_total;
  IF (v_size & (v_size - 1)) <> 0 THEN
    RAISE EXCEPTION 'pairs.length must be a power of two' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_idx IN 0 .. v_total - 1 LOOP
    v_pair := p_pairs->v_idx;
    IF jsonb_typeof(v_pair) <> 'array' OR jsonb_array_length(v_pair) <> 2 THEN
      RAISE EXCEPTION 'pairs[%] must be a 2-element array', v_idx
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_p1 := NULLIF(v_pair->>0, '')::uuid;
    v_p2 := NULLIF(v_pair->>1, '')::uuid;
    v_slot := 'R1-' || (v_idx + 1)::text;

    IF v_p1 IS NULL AND v_p2 IS NULL THEN
      CONTINUE;
    END IF;

    IF v_p1 IS NULL OR v_p2 IS NULL THEN
      -- Bye: auto-completed so the cascade picks up the lone player.
      -- INSERT doesn't fire the AFTER UPDATE advance trigger, so we
      -- call the helper directly after the loop (see below).
      INSERT INTO event_matches (
        event_id, player1_id, player2_id, status, bracket_slot, round,
        score, winner_side
      ) VALUES (
        p_event_id, COALESCE(v_p1, v_p2), NULL, 'completed', v_slot, 1, '', 1
      )
      RETURNING id INTO v_match_id;
      v_byes := array_append(v_byes, v_match_id);
    ELSE
      INSERT INTO event_matches (
        event_id, player1_id, player2_id, status, bracket_slot, round
      ) VALUES (
        p_event_id, v_p1, v_p2, 'scheduled', v_slot, 1
      );
    END IF;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- Cascade-advance every bye after the round-1 inserts so siblings
  -- exist by the time we walk the bracket.
  IF cardinality(v_byes) > 0 THEN
    FOR v_idx IN 1 .. cardinality(v_byes) LOOP
      PERFORM public.advance_event_match_to_next_round(v_byes[v_idx]);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('seeded', v_inserted);
END;
$$;
REVOKE ALL ON FUNCTION public.seed_event_bracket(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.seed_event_bracket(uuid, jsonb) TO authenticated;

-- post_event_rotation_round() is the mixer counterpart to
-- seed_event_bracket: organizer-only, mixer-only, atomic insert of all
-- pairings for one round. Idempotent — refuses if any event_matches
-- row already exists for (event_id, round). Pairs come from
-- src/lib/eventCompetitive.ts::mixerPairings so the deterministic
-- shuffle lives in one place and clients can retry without producing
-- duplicate or shifted assignments. p_bye is informational only — the
-- bye player isn't recorded as a match; callers display it from the
-- RPC's response.
CREATE OR REPLACE FUNCTION public.post_event_rotation_round(
  p_event_id uuid,
  p_round    integer,
  p_pairs    jsonb,
  p_bye      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_event    events%ROWTYPE;
  v_existing integer;
  v_total    integer;
  v_idx      integer;
  v_pair     jsonb;
  v_p1       uuid;
  v_p2       uuid;
  v_inserted integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.owner_id <> v_caller THEN
    RAISE EXCEPTION 'Only the organizer can post rotations'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.event_type <> 'mixer' THEN
    RAISE EXCEPTION 'Rotations are only for mixers'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_round IS NULL OR p_round < 1 THEN
    RAISE EXCEPTION 'round must be >= 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_existing
    FROM event_matches
   WHERE event_id = p_event_id AND round = p_round;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Round % already exists', p_round
      USING ERRCODE = 'unique_violation';
  END IF;

  IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' THEN
    RAISE EXCEPTION 'pairs must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_total := jsonb_array_length(p_pairs);
  IF v_total < 1 THEN
    RAISE EXCEPTION 'Need at least one pair'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_idx IN 0 .. v_total - 1 LOOP
    v_pair := p_pairs->v_idx;
    IF jsonb_typeof(v_pair) <> 'array' OR jsonb_array_length(v_pair) <> 2 THEN
      RAISE EXCEPTION 'pairs[%] must be a 2-element array', v_idx
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_p1 := NULLIF(v_pair->>0, '')::uuid;
    v_p2 := NULLIF(v_pair->>1, '')::uuid;
    IF v_p1 IS NULL OR v_p2 IS NULL THEN
      RAISE EXCEPTION 'pairs[%]: both slots required for a mixer pair', v_idx
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_p1 = v_p2 THEN
      RAISE EXCEPTION 'pairs[%]: a player cannot be paired with themselves', v_idx
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO event_matches (
      event_id, player1_id, player2_id, status, round, court_assign
    ) VALUES (
      p_event_id, v_p1, v_p2, 'scheduled', p_round, 'Court ' || (v_idx + 1)::text
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object('round', p_round, 'pairs', v_inserted, 'bye', p_bye);
END;
$$;
REVOKE ALL ON FUNCTION public.post_event_rotation_round(uuid, integer, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.post_event_rotation_round(uuid, integer, jsonb, uuid) TO authenticated;

-- generate_round_robin_schedule(): organizer-only, round-robin-only,
-- atomic insert of every match for every round. Schedule comes from
-- src/lib/eventCompetitive.ts::roundRobinSinglesSchedule so the
-- deterministic Berger fixture lives in one place. Idempotent — refuses
-- if any event_matches row already exists for the event. p_schedule
-- shape: [{ "round": int, "pairs": [[uuid,uuid], ...], "bye": uuid|null }].
CREATE OR REPLACE FUNCTION public.generate_round_robin_schedule(
  p_event_id uuid,
  p_schedule jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_event    events%ROWTYPE;
  v_existing integer;
  v_round_obj jsonb;
  v_round_num integer;
  v_pairs    jsonb;
  v_pair     jsonb;
  v_p1       uuid;
  v_p2       uuid;
  v_idx      integer;
  v_court    integer;
  v_inserted integer := 0;
  v_rounds   integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.owner_id <> v_caller THEN
    RAISE EXCEPTION 'Only the organizer can generate the schedule'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.event_type <> 'round_robin' THEN
    RAISE EXCEPTION 'Schedule generation is only for round-robin events'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotent: refuse if any matches already exist for this event.
  -- Same shape as seed_event_bracket — re-running silently would
  -- duplicate the entire schedule.
  SELECT count(*) INTO v_existing
    FROM event_matches
   WHERE event_id = p_event_id;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Schedule already generated for this event'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN
    RAISE EXCEPTION 'schedule must be a JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_array_length(p_schedule) < 1 THEN
    RAISE EXCEPTION 'schedule must contain at least one round'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_round_obj IN SELECT * FROM jsonb_array_elements(p_schedule) LOOP
    IF jsonb_typeof(v_round_obj) <> 'object' THEN
      RAISE EXCEPTION 'each schedule entry must be an object'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_round_num := NULLIF(v_round_obj->>'round','')::integer;
    v_pairs := v_round_obj->'pairs';
    IF v_round_num IS NULL OR v_round_num < 1 THEN
      RAISE EXCEPTION 'round must be >= 1'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_pairs IS NULL OR jsonb_typeof(v_pairs) <> 'array' THEN
      RAISE EXCEPTION 'pairs must be a JSON array for round %', v_round_num
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_court := 1;
    FOR v_idx IN 0 .. jsonb_array_length(v_pairs) - 1 LOOP
      v_pair := v_pairs->v_idx;
      IF jsonb_typeof(v_pair) <> 'array' OR jsonb_array_length(v_pair) <> 2 THEN
        RAISE EXCEPTION 'round % pairs[%] must be a 2-element array',
          v_round_num, v_idx USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_p1 := NULLIF(v_pair->>0, '')::uuid;
      v_p2 := NULLIF(v_pair->>1, '')::uuid;
      IF v_p1 IS NULL OR v_p2 IS NULL THEN
        RAISE EXCEPTION 'round % pairs[%]: both slots required',
          v_round_num, v_idx USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF v_p1 = v_p2 THEN
        RAISE EXCEPTION 'round % pairs[%]: a player cannot be paired with themselves',
          v_round_num, v_idx USING ERRCODE = 'invalid_parameter_value';
      END IF;
      INSERT INTO event_matches (
        event_id, player1_id, player2_id, status, round, court_assign
      ) VALUES (
        p_event_id, v_p1, v_p2, 'scheduled', v_round_num, 'Court ' || v_court::text
      );
      v_court := v_court + 1;
      v_inserted := v_inserted + 1;
    END LOOP;
    v_rounds := v_rounds + 1;
  END LOOP;

  RETURN jsonb_build_object('rounds', v_rounds, 'matches', v_inserted);
END;
$$;
REVOKE ALL ON FUNCTION public.generate_round_robin_schedule(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.generate_round_robin_schedule(uuid, jsonb) TO authenticated;

-- advance_event_match_to_next_round: shared helper containing the
-- bracket advancement algorithm. Called both by the AFTER UPDATE
-- trigger (advance_tournament_winner) and inline by
-- seed_event_bracket for bye rows (which are inserted as
-- status='completed' and would otherwise sit stranded — INSERTs
-- don't fire AFTER UPDATE triggers).
CREATE OR REPLACE FUNCTION public.advance_event_match_to_next_round(
  p_match_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match       event_matches%ROWTYPE;
  v_event       events%ROWTYPE;
  v_winner_id   uuid;
  v_round       integer;
  v_slot_idx    integer;
  v_next_round  integer;
  v_next_idx    integer;
  v_next_slot   text;
  v_is_upper    boolean;
  v_sibling_id  uuid;
  v_next_id     uuid;
  v_slot_match  text[];
BEGIN
  SELECT * INTO v_match FROM event_matches WHERE id = p_match_id;
  IF v_match.id IS NULL OR v_match.status <> 'completed' THEN RETURN; END IF;
  IF v_match.winner_side IS NULL OR v_match.bracket_slot = ''
     OR v_match.bracket_slot IS NULL THEN RETURN; END IF;

  SELECT * INTO v_event FROM events WHERE id = v_match.event_id;
  IF v_event.event_type <> 'tournament' THEN RETURN; END IF;

  v_slot_match := regexp_match(v_match.bracket_slot, '^R([0-9]+)-([0-9]+)$');
  IF v_slot_match IS NULL THEN RETURN; END IF;
  v_round    := (v_slot_match[1])::int;
  v_slot_idx := (v_slot_match[2])::int;

  v_winner_id := CASE WHEN v_match.winner_side = 1
                      THEN v_match.player1_id ELSE v_match.player2_id END;
  IF v_winner_id IS NULL THEN RETURN; END IF;

  v_next_round := v_round + 1;
  v_next_idx   := CEIL(v_slot_idx::numeric / 2)::int;
  v_next_slot  := 'R' || v_next_round || '-' || v_next_idx;
  v_is_upper   := (v_slot_idx % 2) = 1;

  SELECT id INTO v_sibling_id
  FROM event_matches
  WHERE event_id = v_match.event_id
    AND bracket_slot = 'R' || v_round || '-'
        || CASE WHEN v_is_upper THEN v_slot_idx + 1 ELSE v_slot_idx - 1 END;
  -- Final match completed (no sibling, slot 1): bracket is done.
  IF v_sibling_id IS NULL AND v_slot_idx = 1 THEN
    RETURN;
  END IF;

  SELECT id INTO v_next_id
  FROM event_matches
  WHERE event_id = v_match.event_id AND bracket_slot = v_next_slot;

  IF v_next_id IS NOT NULL THEN
    UPDATE event_matches
    SET player1_id = CASE WHEN v_is_upper THEN v_winner_id ELSE player1_id END,
        player2_id = CASE WHEN NOT v_is_upper THEN v_winner_id ELSE player2_id END
    WHERE id = v_next_id;
  ELSE
    INSERT INTO event_matches (
      event_id, player1_id, player2_id, status, bracket_slot, round
    ) VALUES (
      v_match.event_id,
      CASE WHEN v_is_upper THEN v_winner_id ELSE NULL END,
      CASE WHEN NOT v_is_upper THEN v_winner_id ELSE NULL END,
      'scheduled',
      v_next_slot,
      v_next_round
    );
  END IF;
END;
$$;
-- Internal helper only — invoked from triggers + seed_event_bracket
-- inside the database. Exposing it as an RPC would let an
-- authenticated client advance arbitrary brackets.
REVOKE ALL ON FUNCTION public.advance_event_match_to_next_round(uuid) FROM public, anon, authenticated;

-- advance_tournament_winner trigger: delegates to the helper above.
CREATE OR REPLACE FUNCTION public.advance_tournament_winner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  PERFORM public.advance_event_match_to_next_round(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matches_advance_tournament ON public.event_matches;
CREATE TRIGGER event_matches_advance_tournament
  AFTER UPDATE ON public.event_matches
  FOR EACH ROW EXECUTE FUNCTION public.advance_tournament_winner();

-- ============================================================
-- LADDER LINEUP + CHALLENGE RPCs
-- ============================================================
--
-- seed_ladder_lineup() assigns the initial 1..N rungs by NTRP (with
-- signup time as a tiebreaker so unrated players don't get a random
-- order). Idempotent: refuses once any participant already has a
-- ladder_rank. propose_ladder_challenge() prefers the seeded
-- ladder_rank when present and falls back to the points-derived rank
-- otherwise. handle_ladder_match_completion() swaps rungs when a
-- lower-ranked player wins, which is the actual ladder dynamic.
CREATE OR REPLACE FUNCTION public.seed_ladder_lineup(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_event   events%ROWTYPE;
  v_seeded  integer;
  v_ranked  integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.owner_id <> v_caller THEN
    RAISE EXCEPTION 'Only the organizer can seed the ladder'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.event_type <> 'ladder' THEN
    RAISE EXCEPTION 'Lineup seeding is only for ladder events'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_seeded
    FROM event_participants
   WHERE event_id = p_event_id AND ladder_rank IS NOT NULL;
  IF v_seeded > 0 THEN
    RAISE EXCEPTION 'Ladder lineup already seeded for this event'
      USING ERRCODE = 'unique_violation';
  END IF;

  WITH ordered AS (
    SELECT ep.id,
           ROW_NUMBER() OVER (
             ORDER BY p.ntrp_rating DESC NULLS LAST,
                      ep.registered_at ASC,
                      ep.user_id ASC
           ) AS rk
    FROM event_participants ep
    JOIN profiles p ON p.id = ep.user_id
    WHERE ep.event_id = p_event_id AND ep.status = 'registered'
  )
  UPDATE event_participants ep
     SET ladder_rank = o.rk
    FROM ordered o
   WHERE ep.id = o.id;
  GET DIAGNOSTICS v_ranked = ROW_COUNT;

  IF v_ranked = 0 THEN
    RAISE EXCEPTION 'No registered players to seed'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN jsonb_build_object('seeded', v_ranked);
END;
$$;
REVOKE ALL ON FUNCTION public.seed_ladder_lineup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.seed_ladder_lineup(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.propose_ladder_challenge(
  p_event_id     uuid,
  p_opponent_id  uuid,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_court_assign text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_event    events%ROWTYPE;
  v_max_gap  integer;
  v_my_rank  integer;
  v_opp_rank integer;
  v_existing uuid;
  v_new_id   uuid;
  v_seeded   integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_opponent_id IS NULL OR p_opponent_id = v_caller THEN
    RAISE EXCEPTION 'Pick a valid opponent' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.event_type <> 'ladder' THEN
    RAISE EXCEPTION 'Only ladder events accept challenges'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_event.status IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'Event is closed' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM event_participants
    WHERE event_id = p_event_id AND user_id = v_caller AND status = 'registered'
  ) OR NOT EXISTS (
    SELECT 1 FROM event_participants
    WHERE event_id = p_event_id AND user_id = p_opponent_id AND status = 'registered'
  ) THEN
    RAISE EXCEPTION 'Both players must be registered'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id INTO v_existing FROM event_matches
  WHERE event_id = p_event_id
    AND status IN ('proposed','scheduled','in_progress')
    AND (
      (player1_id = v_caller AND player2_id = p_opponent_id)
      OR
      (player1_id = p_opponent_id AND player2_id = v_caller)
    )
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'There''s already an open match between you two'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*) INTO v_seeded
    FROM event_participants
   WHERE event_id = p_event_id AND ladder_rank IS NOT NULL;

  IF v_seeded > 0 THEN
    SELECT
      (SELECT ladder_rank FROM event_participants
        WHERE event_id = p_event_id AND user_id = v_caller),
      (SELECT ladder_rank FROM event_participants
        WHERE event_id = p_event_id AND user_id = p_opponent_id)
    INTO v_my_rank, v_opp_rank;
  ELSE
    WITH ranked AS (
      SELECT user_id,
             ROW_NUMBER() OVER (
               ORDER BY points DESC,
                        (sets_won - sets_lost) DESC,
                        losses ASC,
                        user_id ASC
             ) AS rank
      FROM event_participants
      WHERE event_id = p_event_id AND status = 'registered'
    )
    SELECT
      (SELECT rank FROM ranked WHERE user_id = v_caller),
      (SELECT rank FROM ranked WHERE user_id = p_opponent_id)
    INTO v_my_rank, v_opp_rank;
  END IF;

  IF v_my_rank IS NULL OR v_opp_rank IS NULL THEN
    RAISE EXCEPTION 'Rank not available' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_opp_rank >= v_my_rank THEN
    RAISE EXCEPTION 'You can only challenge players ranked above you'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_max_gap := COALESCE(
    NULLIF((v_event.config->>'ladderMaxGap'), '')::int,
    3
  );
  IF (v_my_rank - v_opp_rank) > v_max_gap THEN
    RAISE EXCEPTION 'Challenge limited to % ranks above you', v_max_gap
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO event_matches (
    event_id, player1_id, player2_id, proposed_by,
    scheduled_at, court_assign, status
  ) VALUES (
    p_event_id, v_caller, p_opponent_id, v_caller,
    p_scheduled_at, COALESCE(p_court_assign, ''), 'proposed'
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.propose_ladder_challenge(uuid, uuid, timestamptz, text) FROM public;
GRANT EXECUTE ON FUNCTION public.propose_ladder_challenge(uuid, uuid, timestamptz, text) TO authenticated;

-- Trigger: when a ladder match completes, swap rungs if the lower
-- ranked player (higher rank number) won. Uses a temporary -1 stash
-- to dodge the (event_id, ladder_rank) unique index during the swap.
CREATE OR REPLACE FUNCTION public.handle_ladder_match_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event       events%ROWTYPE;
  v_winner_id   uuid;
  v_loser_id    uuid;
  v_winner_rank integer;
  v_loser_rank  integer;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW.winner_side IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_event FROM events WHERE id = NEW.event_id;
  IF v_event.event_type <> 'ladder' THEN
    RETURN NEW;
  END IF;

  IF NEW.winner_side = 1 THEN
    v_winner_id := NEW.player1_id;
    v_loser_id  := NEW.player2_id;
  ELSE
    v_winner_id := NEW.player2_id;
    v_loser_id  := NEW.player1_id;
  END IF;

  SELECT ladder_rank INTO v_winner_rank
    FROM event_participants
   WHERE event_id = NEW.event_id AND user_id = v_winner_id;
  SELECT ladder_rank INTO v_loser_rank
    FROM event_participants
   WHERE event_id = NEW.event_id AND user_id = v_loser_id;

  IF v_winner_rank IS NULL OR v_loser_rank IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_winner_rank <= v_loser_rank THEN
    RETURN NEW;
  END IF;

  UPDATE event_participants
     SET ladder_rank = -1
   WHERE event_id = NEW.event_id AND user_id = v_winner_id;
  UPDATE event_participants
     SET ladder_rank = v_winner_rank
   WHERE event_id = NEW.event_id AND user_id = v_loser_id;
  UPDATE event_participants
     SET ladder_rank = v_loser_rank
   WHERE event_id = NEW.event_id AND user_id = v_winner_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_ladder_match_completion ON public.event_matches;
CREATE TRIGGER handle_ladder_match_completion
AFTER UPDATE ON public.event_matches
FOR EACH ROW
EXECUTE FUNCTION public.handle_ladder_match_completion();

-- ============================================================
-- recompute_event_standings — refresh aggregate columns
-- ============================================================
--
-- StandingsTable reads event_participants.{wins,losses,sets_won,
-- sets_lost,points}. These were updated server-side in the old
-- /report endpoint via prisma.eventParticipant.update — gone with
-- the burn-down. Restored as a trigger that fires after every
-- material change to a match row and rewrites the aggregates from
-- scratch from completed event_matches. Done as a full recompute
-- per event (not incremental) to stay correct under dispute / edit
-- without retracing prior deltas.
CREATE OR REPLACE FUNCTION public.recompute_event_standings_for(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH match_breakdown AS (
    SELECT
      em.id,
      em.player1_id,
      em.player2_id,
      em.player3_id,
      em.player4_id,
      em.winner_side,
      em.score,
      (
        SELECT COALESCE(SUM(CASE WHEN s.a > s.b THEN 1 ELSE 0 END), 0)
        FROM regexp_split_to_table(em.score, '[,;]') AS raw
        CROSS JOIN LATERAL (
          SELECT
            (regexp_match(raw, '^\s*(\d+)\s*[-:/]\s*(\d+)'))[1]::int AS a,
            (regexp_match(raw, '^\s*(\d+)\s*[-:/]\s*(\d+)'))[2]::int AS b
        ) s
        WHERE s.a IS NOT NULL AND s.b IS NOT NULL
      ) AS side1_sets,
      (
        SELECT COALESCE(SUM(CASE WHEN s.b > s.a THEN 1 ELSE 0 END), 0)
        FROM regexp_split_to_table(em.score, '[,;]') AS raw
        CROSS JOIN LATERAL (
          SELECT
            (regexp_match(raw, '^\s*(\d+)\s*[-:/]\s*(\d+)'))[1]::int AS a,
            (regexp_match(raw, '^\s*(\d+)\s*[-:/]\s*(\d+)'))[2]::int AS b
        ) s
        WHERE s.a IS NOT NULL AND s.b IS NOT NULL
      ) AS side2_sets
    FROM event_matches em
    WHERE em.event_id = p_event_id AND em.status = 'completed' AND em.winner_side IN (1, 2)
  ),
  per_user AS (
    SELECT player1_id AS uid, 1 AS w, 0 AS l, side1_sets AS sw, side2_sets AS sl, 3 AS pts
      FROM match_breakdown WHERE winner_side = 1 AND player1_id IS NOT NULL
    UNION ALL
    SELECT player3_id, 1, 0, side1_sets, side2_sets, 3
      FROM match_breakdown WHERE winner_side = 1 AND player3_id IS NOT NULL
    UNION ALL
    SELECT player2_id, 0, 1, side2_sets, side1_sets, 0
      FROM match_breakdown WHERE winner_side = 1 AND player2_id IS NOT NULL
    UNION ALL
    SELECT player4_id, 0, 1, side2_sets, side1_sets, 0
      FROM match_breakdown WHERE winner_side = 1 AND player4_id IS NOT NULL
    UNION ALL
    SELECT player2_id, 1, 0, side2_sets, side1_sets, 3
      FROM match_breakdown WHERE winner_side = 2 AND player2_id IS NOT NULL
    UNION ALL
    SELECT player4_id, 1, 0, side2_sets, side1_sets, 3
      FROM match_breakdown WHERE winner_side = 2 AND player4_id IS NOT NULL
    UNION ALL
    SELECT player1_id, 0, 1, side1_sets, side2_sets, 0
      FROM match_breakdown WHERE winner_side = 2 AND player1_id IS NOT NULL
    UNION ALL
    SELECT player3_id, 0, 1, side1_sets, side2_sets, 0
      FROM match_breakdown WHERE winner_side = 2 AND player3_id IS NOT NULL
  ),
  aggregated AS (
    SELECT uid,
           SUM(w)::int AS wins,
           SUM(l)::int AS losses,
           SUM(sw)::int AS sets_won,
           SUM(sl)::int AS sets_lost,
           SUM(pts)::int AS points
    FROM per_user
    GROUP BY uid
  )
  UPDATE event_participants ep
  SET wins      = COALESCE(a.wins, 0),
      losses    = COALESCE(a.losses, 0),
      sets_won  = COALESCE(a.sets_won, 0),
      sets_lost = COALESCE(a.sets_lost, 0),
      points    = COALESCE(a.points, 0)
  FROM (SELECT user_id FROM event_participants WHERE event_id = p_event_id) ep_ids
  LEFT JOIN aggregated a ON a.uid = ep_ids.user_id
  WHERE ep.event_id = p_event_id AND ep.user_id = ep_ids.user_id;
END;
$$;
-- Internal helper only — invoked by recompute_event_standings_trigger
-- on event_matches changes. Exposing it as an RPC lets any client
-- force a standings recompute for arbitrary events.
REVOKE ALL ON FUNCTION public.recompute_event_standings_for(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_event_standings_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_event_standings_for(OLD.event_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' OR
     OLD.status     IS DISTINCT FROM NEW.status OR
     OLD.score      IS DISTINCT FROM NEW.score OR
     OLD.winner_side IS DISTINCT FROM NEW.winner_side
  THEN
    PERFORM public.recompute_event_standings_for(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_matches_recompute_standings ON public.event_matches;
CREATE TRIGGER event_matches_recompute_standings
  AFTER INSERT OR UPDATE OR DELETE ON public.event_matches
  FOR EACH ROW EXECUTE FUNCTION public.recompute_event_standings_trigger();

-- ============================================================
-- GROUP OWNER AUTO-ADD (fixes bootstrap chicken-and-egg)
-- ============================================================
--
-- group_members_insert_manager requires has_group_role('manager') —
-- but a brand-new group owner has no group_members row yet, so the
-- very first INSERT they make to add themselves RLS-rejects. The
-- legacy CreateGroupForm silently swallowed the error, leaving the
-- /groups page showing the team via groups.owner_id while every
-- is_group_member() gate downstream returned false. Fixed by an
-- AFTER INSERT trigger that always writes the owner row, idempotent
-- under ON CONFLICT so propose_team's create_team_group_on_complete
-- SECURITY DEFINER path that also attempts the insert stays correct.
CREATE OR REPLACE FUNCTION public.auto_add_group_owner_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groups_auto_add_owner ON public.groups;
CREATE TRIGGER groups_auto_add_owner
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.auto_add_group_owner_member();

-- ============================================================
-- EVENT CHECK-IN: organizer-only column gate
-- ============================================================
-- /api/events/[id]/checkin was organizer-only; the burn-down opened
-- the column to "self or owner" via RLS, so a player can self-check-in.
-- A BEFORE UPDATE trigger gated to checked_in_at restores the gate
-- without disturbing the more permissive update policy used by
-- registered_at / status flips.
CREATE OR REPLACE FUNCTION public.enforce_event_checkin_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF OLD.checked_in_at IS NOT DISTINCT FROM NEW.checked_in_at THEN
    RETURN NEW;
  END IF;
  SELECT owner_id INTO v_owner FROM public.events WHERE id = NEW.event_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'Only the event organizer can check players in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_participants_checkin_owner_only ON public.event_participants;
CREATE TRIGGER event_participants_checkin_owner_only
  BEFORE UPDATE OF checked_in_at ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_checkin_owner();

-- ============================================================
-- PRACTICE SERIES ANNOUNCEMENT
-- ============================================================
-- /api/groups/[id]/practices posted "📣 New practice series scheduled"
-- into the group chat. Restored as an AFTER INSERT trigger. Attributes
-- the message to the caller (RLS already restricts inserts to
-- captains+ via practice_series_write_captain), with a fallback to the
-- group owner for service-role inserts in tests / scripts.
CREATE OR REPLACE FUNCTION public.announce_practice_series()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_msg    text;
BEGIN
  IF v_caller IS NULL THEN
    SELECT owner_id INTO v_caller FROM public.groups WHERE id = NEW.group_id;
  END IF;
  IF v_caller IS NULL THEN RETURN NEW; END IF;

  v_msg := '📣 New practice series scheduled: ' || NEW.name
        || CASE WHEN NULLIF(trim(NEW.practice_time), '') IS NOT NULL
                THEN ' (' || NEW.practice_time || ')'
                ELSE '' END
        || ' @ ' || NEW.location;

  INSERT INTO public.group_messages (group_id, sender_id, content)
  VALUES (NEW.group_id, v_caller, v_msg);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS practice_series_announce ON public.practice_series;
CREATE TRIGGER practice_series_announce
  AFTER INSERT ON public.practice_series
  FOR EACH ROW EXECUTE FUNCTION public.announce_practice_series();

-- ============================================================
-- EDGE-FUNCTION DISPATCH (pg_net)
-- ============================================================
--
-- Thin wrapper triggers use to fire-and-forget POST to a Supabase
-- Edge Function. The project URL + anon JWT live in Supabase Vault
-- so they aren't hard-coded across trigger bodies; both must be
-- seeded once via `SELECT vault.create_secret(value, name, ...)` —
-- the names are `supabase_url` and `supabase_anon_key`. Missing
-- secrets degrade the call to a no-op rather than raising, so the
-- primary write succeeds in environments where edge functions
-- aren't configured (preview branches, fresh forks).
--
-- pg_net lives in the `net` schema; the request lands in
-- net.http_request_queue and migrates to net._http_response as the
-- background worker processes it. We also append a row to
-- edge_function_dispatch_log so integration tests and operators have
-- a durable signal independent of pg_net's transient queue.
CREATE TABLE IF NOT EXISTS public.edge_function_dispatch_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fn_name     text NOT NULL,
  body        jsonb NOT NULL,
  request_id  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edge_function_dispatch_log_fn_created_idx
  ON public.edge_function_dispatch_log (fn_name, created_at DESC);
ALTER TABLE public.edge_function_dispatch_log ENABLE ROW LEVEL SECURITY;
-- No policies = no access for authenticated/anon. service_role
-- bypasses RLS by default, which is what tests and ops use.

CREATE OR REPLACE FUNCTION public.invoke_edge_function(
  fn_name text,
  body    jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  v_url       text;
  v_anon_key  text;
  v_secret    text;
  v_request   bigint;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  SELECT decrypted_secret INTO v_anon_key
    FROM vault.decrypted_secrets WHERE name = 'supabase_anon_key' LIMIT 1;
  -- Layered defense: verify_jwt accepts the public anon key, so we
  -- attach an HMAC-style shared secret that the edge function
  -- validates against its own env var. Without this, anyone with the
  -- anon key could POST directly to push-fanout / group-invite-email
  -- and spam pushes / relay email.
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'edge_function_trigger_secret' LIMIT 1;

  IF v_url IS NULL OR v_anon_key IS NULL THEN
    INSERT INTO public.edge_function_dispatch_log (fn_name, body, request_id)
    VALUES (fn_name, body, NULL);
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := v_url || '/functions/v1/' || fn_name,
    body    := body,
    headers := jsonb_build_object(
                 'Authorization',     'Bearer ' || v_anon_key,
                 'Content-Type',      'application/json',
                 'X-Trigger-Secret',  COALESCE(v_secret, '')
               ),
    timeout_milliseconds := 5000
  ) INTO v_request;

  INSERT INTO public.edge_function_dispatch_log (fn_name, body, request_id)
  VALUES (fn_name, body, v_request);

  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_edge_function(text, jsonb) FROM public;

-- ============================================================
-- GROUP INVITE EMAIL (Resend via edge function)
-- ============================================================
--
-- Replaces the deleted sendInviteEmail() call from
-- /api/groups/[id]/invites. The Edge Function (supabase/functions/
-- group-invite-email/) reads RESEND_API_KEY from its own secrets;
-- when unset the function no-ops gracefully. The trigger fires
-- async via pg_net so a transient Resend outage can't roll back
-- the invite write.
CREATE OR REPLACE FUNCTION public.dispatch_group_invite_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_name    text;
  v_inviter_name text;
BEGIN
  SELECT name INTO v_team_name FROM public.groups WHERE id = NEW.group_id;
  SELECT name INTO v_inviter_name FROM public.profiles WHERE id = NEW.invited_by_id;

  PERFORM public.invoke_edge_function(
    'group-invite-email',
    jsonb_build_object(
      'to',           NEW.email,
      'inviter_name', COALESCE(v_inviter_name, 'A teammate'),
      'team_name',    COALESCE(v_team_name, 'a tennis team'),
      'token',        NEW.token,
      'expires_at',   to_char(NEW.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_invites_send_email ON public.group_invites;
CREATE TRIGGER group_invites_send_email
  AFTER INSERT ON public.group_invites
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_group_invite_email();

-- ============================================================
-- GROUP INVITE TOKEN RPCs (replaces deleted /api/invites/[token]/*)
-- ============================================================
--
-- group_invites RLS gates SELECT/UPDATE on has_group_role(g, 'manager').
-- The invitee isn't a member yet — without these RPCs the redeem flow
-- silently RLS-rejected. accept_group_invite enforces the
-- email-match guard that the deleted route had, so a leaked token
-- can't be redeemed by an unrelated account.
CREATE OR REPLACE FUNCTION public.get_invite_by_token(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv     group_invites%ROWTYPE;
  v_group   groups%ROWTYPE;
  v_inviter text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_inv FROM group_invites WHERE token = p_token;
  IF v_inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_group FROM groups WHERE id = v_inv.group_id;
  SELECT name INTO v_inviter FROM profiles WHERE id = v_inv.invited_by_id;
  -- Note: v_inv.email is deliberately NOT exposed here. The token is
  -- the bearer secret; anyone with it (including anon) could otherwise
  -- resolve the URL to a PII email address. accept_group_invite
  -- enforces the email-match check server-side against auth.users.
  RETURN jsonb_build_object(
    'id',             v_inv.id,
    'group_id',       v_inv.group_id,
    'invited_by_id',  v_inv.invited_by_id,
    'token',          v_inv.token,
    'role',           v_inv.role,
    'member_type',    v_inv.member_type,
    'status',         v_inv.status,
    'expires_at',     v_inv.expires_at,
    'accepted_by_id', v_inv.accepted_by_id,
    'accepted_at',    v_inv.accepted_at,
    'created_at',     v_inv.created_at,
    'updated_at',     v_inv.updated_at,
    'group',          jsonb_build_object(
      'id',        v_group.id,
      'name',      v_group.name,
      'image_url', v_group.image_url
    ),
    'inviter_name',   COALESCE(v_inviter, '')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_invite_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invite_by_token(text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.accept_group_invite(
  p_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_email  text;
  v_inv    group_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Missing token' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_caller;
  SELECT * INTO v_inv FROM group_invites WHERE token = p_token;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status = 'accepted' THEN
    -- Don't echo group_id on a duplicate redemption: a leaked URL
    -- would otherwise let anyone confirm which group the invite
    -- points to without ever matching the invited email.
    RETURN jsonb_build_object('ok', true, 'already_accepted', true);
  END IF;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'This invite was cancelled' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF lower(v_email) <> lower(v_inv.email::text) THEN
    RAISE EXCEPTION 'This invite is for a different email address'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Pre-existing membership wins: don't demote a user who's already
  -- a manager/captain just because a stale 'member' invite gets
  -- redeemed. ON CONFLICT DO NOTHING preserves the higher role.
  INSERT INTO group_members (group_id, user_id, role, member_type)
  VALUES (v_inv.group_id, v_caller, v_inv.role, COALESCE(v_inv.member_type, ''))
  ON CONFLICT (group_id, user_id) DO NOTHING;

  UPDATE group_invites
  SET status         = 'accepted',
      accepted_by_id = v_caller,
      accepted_at    = now()
  WHERE id = v_inv.id;

  -- Notify the inviter via SECURITY DEFINER write (notifications has
  -- no INSERT RLS for authenticated).
  INSERT INTO notifications (user_id, actor_id, type)
  VALUES (v_inv.invited_by_id, v_caller, 'group_invite_accepted'::notification_type);

  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.group_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_group_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;

-- ============================================================
-- PUSH FAN-OUT TRIGGERS (G12)
-- ============================================================
--
-- Replaces the pushToUsers() calls from /api/messages, /api/chats/
-- [id]/messages, /api/groups/[id]/messages, and /api/messages/
-- reactions that the burn-down dropped. The actual APN HTTP/2 +
-- ES256 JWT delivery lives in supabase/functions/push-fanout, so
-- APNS_* secrets stay scoped to that function — Postgres only knows
-- "post a JSON banner request" and goes through invoke_edge_function.

CREATE OR REPLACE FUNCTION public.push_on_dm_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_body        text;
BEGIN
  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  v_body := COALESCE(NULLIF(trim(NEW.content), ''), '[media]');
  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  jsonb_build_array(NEW.receiver_id),
      'title',     COALESCE(v_sender_name, 'A teammate'),
      'body',      left(v_body, 200),
      'thread_id', 'dm:' || NEW.sender_id::text,
      'data',      jsonb_build_object(
                     'kind',       'dm',
                     'sender_id',  NEW.sender_id::text,
                     'message_id', NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_push_fanout ON public.messages;
CREATE TRIGGER messages_push_fanout
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.push_on_dm_insert();

CREATE OR REPLACE FUNCTION public.push_on_chat_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_chat_name   text;
  v_recipients  uuid[];
  v_body        text;
BEGIN
  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_chat_name   FROM public.chats    WHERE id = NEW.chat_id;
  SELECT array_agg(user_id) INTO v_recipients
  FROM public.chat_participants
  WHERE chat_id = NEW.chat_id AND user_id <> NEW.sender_id;

  IF v_recipients IS NULL OR cardinality(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  v_body := COALESCE(v_sender_name, 'A player')
         || ': '
         || left(COALESCE(NULLIF(trim(NEW.content), ''), '[media]'), 180);

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  to_jsonb(v_recipients),
      'title',     COALESCE(v_chat_name, 'Session chat'),
      'body',      v_body,
      'thread_id', 'chat:' || NEW.chat_id::text,
      'data',      jsonb_build_object(
                     'kind',       'chat',
                     'chat_id',    NEW.chat_id::text,
                     'message_id', NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_push_fanout ON public.chat_messages;
CREATE TRIGGER chat_messages_push_fanout
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.push_on_chat_message_insert();

CREATE OR REPLACE FUNCTION public.push_on_group_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_group_name  text;
  v_recipients  uuid[];
  v_body        text;
BEGIN
  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;
  SELECT name INTO v_group_name  FROM public.groups   WHERE id = NEW.group_id;
  SELECT array_agg(user_id) INTO v_recipients
  FROM public.group_members
  WHERE group_id = NEW.group_id
    AND user_id <> NEW.sender_id
    AND muted = false
    AND archived_at IS NULL;

  IF v_recipients IS NULL OR cardinality(v_recipients) = 0 THEN
    RETURN NEW;
  END IF;

  v_body := COALESCE(v_sender_name, 'A teammate')
         || ': '
         || left(COALESCE(NULLIF(trim(NEW.content), ''), '[media]'), 180);

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  to_jsonb(v_recipients),
      'title',     COALESCE(v_group_name, 'Team chat'),
      'body',      v_body,
      'thread_id', 'group:' || NEW.group_id::text,
      'data',      jsonb_build_object(
                     'kind',       'group',
                     'group_id',   NEW.group_id::text,
                     'message_id', NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_messages_push_fanout ON public.group_messages;
CREATE TRIGGER group_messages_push_fanout
  AFTER INSERT ON public.group_messages
  FOR EACH ROW EXECUTE FUNCTION public.push_on_group_message_insert();

CREATE OR REPLACE FUNCTION public.push_on_message_reaction_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id    uuid;
  v_actor_name  text;
  v_body        text;
BEGIN
  IF NEW.target_type = 'dm' THEN
    SELECT sender_id INTO v_owner_id FROM public.messages WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'chat' THEN
    SELECT sender_id INTO v_owner_id FROM public.chat_messages WHERE id = NEW.target_id;
  ELSIF NEW.target_type = 'group' THEN
    SELECT sender_id INTO v_owner_id FROM public.group_messages WHERE id = NEW.target_id;
  END IF;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.user_id;
  v_body := COALESCE(v_actor_name, 'Someone')
         || ' reacted ' || NEW.emoji || ' to your message';

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids', jsonb_build_array(v_owner_id),
      'title',    'New reaction',
      'body',     v_body,
      'data',     jsonb_build_object(
                    'kind',        'reaction',
                    'target_type', NEW.target_type::text,
                    'target_id',   NEW.target_id::text,
                    'emoji',       NEW.emoji
                  )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_reactions_push_fanout ON public.message_reactions;
CREATE TRIGGER message_reactions_push_fanout
  AFTER INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.push_on_message_reaction_insert();

-- ============================================================
-- INVITE_TO_EVENT RPC (replaces /api/events/[id]/invite)
-- ============================================================
--
-- The notifications table has no INSERT policy for `authenticated` —
-- all writes go through SECURITY DEFINER fan-out. So client-side
-- "supabase.from('notifications').insert(...)" for event invites
-- silently RLS-violates. This RPC re-implements the original guards:
--   - Caller must own the event (organizer-only invite).
--   - Targets must be accepted friends of the caller.
--   - Skip targets already on event_participants (they know).
--   - Skip targets that have a prior 'event_invite' notification from
--     the same actor on the same event (don't double-ping).
-- Returns { invited: <count of new notification rows> }.
CREATE OR REPLACE FUNCTION public.invite_to_event(
  p_event_id uuid,
  p_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_event   events%ROWTYPE;
  v_invited integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'userIds array required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_event.owner_id <> v_caller THEN
    RAISE EXCEPTION 'Only the organizer can invite' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH input AS (
    SELECT DISTINCT uid FROM unnest(p_user_ids) AS uid
    WHERE uid IS NOT NULL AND uid <> v_caller
  ),
  friends AS (
    SELECT requester_id AS uid FROM friendships
      WHERE addressee_id = v_caller AND status = 'accepted'
    UNION
    SELECT addressee_id AS uid FROM friendships
      WHERE requester_id = v_caller AND status = 'accepted'
  ),
  inserted AS (
    INSERT INTO notifications (user_id, actor_id, type, event_id)
    SELECT i.uid, v_caller, 'event_invite'::notification_type, p_event_id
    FROM input i
    WHERE EXISTS (SELECT 1 FROM friends f WHERE f.uid = i.uid)
      AND NOT EXISTS (SELECT 1 FROM event_participants ep
                      WHERE ep.event_id = p_event_id AND ep.user_id = i.uid)
      AND NOT EXISTS (SELECT 1 FROM notifications n
                      WHERE n.type = 'event_invite'
                        AND n.event_id = p_event_id
                        AND n.actor_id = v_caller
                        AND n.user_id = i.uid)
    RETURNING 1
  )
  SELECT count(*) INTO v_invited FROM inserted;

  RETURN jsonb_build_object('invited', v_invited);
END;
$$;
REVOKE ALL ON FUNCTION public.invite_to_event(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_to_event(uuid, uuid[]) TO authenticated;

-- ============================================================
-- REPORT_COURT_AVAILABILITY RPC
-- (replaces /api/courts/[id]/availability-reports)
-- ============================================================
--
-- The route was deleted in the burn-down; ArrivalReportModal still
-- POSTs to it and 404s. Restores the guards inline:
--   - Caller signed in.
--   - When tied to a post: caller is author OR APPROVED play_request;
--     post has a valid play_date+play_time; "now" is in [start - 30m, end].
--   - Same-user dedupe: drop repeats within the last 30 min for the court.
-- IP-based rate limiting is dropped (Postgres has no source IP); the
-- per-user dedupe handles the realistic spam case.
CREATE OR REPLACE FUNCTION public.report_court_availability(
  p_court_id  text,
  p_has_empty boolean,
  p_post_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller        uuid := auth.uid();
  v_post          posts%ROWTYPE;
  v_start         timestamptz;
  v_end           timestamptz;
  v_now           timestamptz := now();
  v_window_before interval := interval '30 minutes';
  v_dedupe_window interval := interval '30 minutes';
  v_is_participant boolean;
  v_recent_id     uuid;
  v_tz            text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_court_id IS NULL OR length(trim(p_court_id)) = 0 THEN
    RAISE EXCEPTION 'Missing court_id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_has_empty IS NULL THEN
    RAISE EXCEPTION 'has_empty required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_post_id IS NOT NULL THEN
    SELECT * INTO v_post FROM posts WHERE id = p_post_id;
    IF v_post.id IS NULL THEN
      RAISE EXCEPTION 'Game not found' USING ERRCODE = 'no_data_found';
    END IF;

    v_is_participant := v_post.author_id = v_caller
      OR EXISTS (
        SELECT 1 FROM play_requests
        WHERE post_id = p_post_id
          AND user_id = v_caller
          AND status = 'approved'
      );
    IF NOT v_is_participant THEN
      RAISE EXCEPTION 'Not a participant' USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_tz := COALESCE(NULLIF(v_post.play_timezone, ''), 'America/Los_Angeles');
    IF v_post.play_date <> '' AND v_post.play_time <> '' THEN
      BEGIN
        -- Wall-clock parse in the post's zone so the arrival-window
        -- check operates on the user's intended local time, not UTC.
        v_start := ((v_post.play_date || ' ' || v_post.play_time || ':00')::timestamp AT TIME ZONE v_tz);
      EXCEPTION WHEN OTHERS THEN
        v_start := NULL;
      END;
    END IF;
    IF v_start IS NULL THEN
      RAISE EXCEPTION 'Game has no valid start' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_end := v_start + (COALESCE(NULLIF(v_post.play_duration, 0), 90) || ' minutes')::interval;
    IF v_now < v_start - v_window_before OR v_now > v_end THEN
      RAISE EXCEPTION 'Outside game window' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  SELECT id INTO v_recent_id FROM court_availability_reports
    WHERE court_id = p_court_id
      AND user_id  = v_caller
      AND reported_at > v_now - v_dedupe_window
    LIMIT 1;
  IF v_recent_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduped', true);
  END IF;

  INSERT INTO court_availability_reports (court_id, user_id, has_empty, post_id)
  VALUES (p_court_id, v_caller, p_has_empty, p_post_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.report_court_availability(text, boolean, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.report_court_availability(text, boolean, uuid) TO authenticated;

-- ============================================================
-- THREADED COMMENT REPLIES
-- ============================================================
--
-- Add a self-FK so a comment can be a reply to another comment on the
-- same post. Top-level comments leave parent_comment_id NULL.
-- ON DELETE CASCADE so deleting a parent comment removes its replies.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid
  REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS comments_parent_idx
  ON public.comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Rewrite notify_on_comment to thread replies:
--   * Top-level (parent_comment_id IS NULL) → notify post author with
--     type='comment'. The previous broadcast-to-every-other-commenter
--     "reply" notification is dropped — too noisy once threaded
--     replies exist.
--   * Reply (parent_comment_id IS NOT NULL) → notify the parent
--     comment's author with type='reply'.
-- Self-actions skipped at both layers.
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_post_author uuid;
  v_parent_author uuid;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN
    SELECT author_id INTO v_post_author FROM posts WHERE id = NEW.post_id;
    IF v_post_author IS NULL OR v_post_author = NEW.author_id THEN
      RETURN NEW;
    END IF;
    INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
    VALUES (v_post_author, NEW.author_id, 'comment', NEW.post_id, NEW.id);
  ELSE
    SELECT author_id INTO v_parent_author FROM comments WHERE id = NEW.parent_comment_id;
    IF v_parent_author IS NULL OR v_parent_author = NEW.author_id THEN
      RETURN NEW;
    END IF;
    INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id)
    VALUES (v_parent_author, NEW.author_id, 'reply'::notification_type, NEW.post_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================
-- COMMENT EDIT (author-only UPDATE + updated_at indicator)
-- ============================================================
--
-- The original `comments_delete_self` policy lets authors remove their
-- own comments. Mirror that with an UPDATE policy so authors can edit
-- the content too. WITH CHECK locks author_id so editing can't be
-- used to transfer ownership.
CREATE POLICY comments_update_self ON public.comments
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()));

-- updated_at: NULL = never edited; the bell-bubble UI shows "(edited)"
-- when it's set. A BEFORE UPDATE trigger only bumps it when the
-- content actually changed, so other flags (read, notification
-- dedup, etc.) don't falsely advertise an edit.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.bump_comment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_bump_updated_at ON public.comments;
CREATE TRIGGER comments_bump_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.bump_comment_updated_at();

-- Migration: link chat_messages back to the expense it announces, so the
-- companion message can be updated when the payer edits the expense and
-- removed when they delete it. ON DELETE CASCADE: deleting an expense
-- erases its announcement so the chat doesn't retain stale numbers.
ALTER TABLE public.chat_messages
  ADD COLUMN expense_id uuid REFERENCES public.expenses (id) ON DELETE CASCADE;
CREATE INDEX chat_messages_expense_idx
  ON public.chat_messages (expense_id)
  WHERE expense_id IS NOT NULL;

-- Allow senders to update their own chat message (needed by the
-- expense-edit → announcement-rewrite flow). Previously chat_messages
-- only had select/insert/delete policies.
CREATE POLICY chat_messages_update_sender ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (sender_id = (SELECT auth.uid()))
  WITH CHECK (sender_id = (SELECT auth.uid()));

-- =====================================================================
-- Migration: independent multi-role team membership.
--
-- Replaces the single hierarchical group_role (owner>manager>captain>member)
-- on group_members.role with an independent role SET (group_members.roles).
--   * manager  -> ADMIN  capabilities (roster, settings, invites, roles)
--   * captain  -> OPS    capabilities (matches, practices, availability,
--                                      announcements, files, albums)
-- The two are independent — neither implies the other. Ownership stays a
-- single, transferable groups.owner_id that ALWAYS grants both capabilities,
-- so owners need no entry in their roles array.
-- has_group_role(g, min_role) is replaced by can_admin_group(g)/can_run_group(g).
-- =====================================================================

CREATE TYPE public.group_member_role AS ENUM ('manager', 'captain');

-- group_members.roles (set). Backfill preserves each member's effective powers
-- (an old manager outranked captain, so it gets both); then drop role.
ALTER TABLE public.group_members ADD COLUMN roles public.group_member_role[];
UPDATE public.group_members
SET roles = CASE role
  WHEN 'manager' THEN ARRAY['manager','captain']::public.group_member_role[]
  WHEN 'captain' THEN ARRAY['captain']::public.group_member_role[]
  ELSE                ARRAY[]::public.group_member_role[]
END;
ALTER TABLE public.group_members
  ALTER COLUMN roles SET DEFAULT ARRAY[]::public.group_member_role[],
  ALTER COLUMN roles SET NOT NULL;

ALTER TABLE public.group_invites ADD COLUMN roles public.group_member_role[];
UPDATE public.group_invites
SET roles = CASE role
  WHEN 'manager' THEN ARRAY['manager','captain']::public.group_member_role[]
  WHEN 'captain' THEN ARRAY['captain']::public.group_member_role[]
  WHEN 'owner'   THEN ARRAY['manager','captain']::public.group_member_role[]
  ELSE                ARRAY[]::public.group_member_role[]
END;
ALTER TABLE public.group_invites
  ALTER COLUMN roles SET DEFAULT ARRAY[]::public.group_member_role[],
  ALTER COLUMN roles SET NOT NULL;

-- Capability functions (SECURITY DEFINER so they don't recurse into
-- group_members RLS when used inside its own policies).
CREATE OR REPLACE FUNCTION public.can_admin_group(g uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.groups gr
                 WHERE gr.id = g AND gr.owner_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.group_members gm
                 WHERE gm.group_id = g AND gm.user_id = (SELECT auth.uid())
                   AND 'manager' = ANY(gm.roles));
$$;
CREATE OR REPLACE FUNCTION public.can_run_group(g uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.groups gr
                 WHERE gr.id = g AND gr.owner_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.group_members gm
                 WHERE gm.group_id = g AND gm.user_id = (SELECT auth.uid())
                   AND 'captain' = ANY(gm.roles));
$$;
REVOKE EXECUTE ON FUNCTION public.can_admin_group(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_run_group(uuid)   FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.can_admin_group(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_run_group(uuid)   TO authenticated;

-- Recreate every policy that referenced has_group_role.
-- ADMIN (can_admin_group):
DROP POLICY IF EXISTS groups_update_managers ON public.groups;
CREATE POLICY groups_update_managers ON public.groups
  FOR UPDATE TO authenticated
  USING (public.can_admin_group(id)) WITH CHECK (public.can_admin_group(id));
DROP POLICY IF EXISTS group_members_insert_manager ON public.group_members;
CREATE POLICY group_members_insert_manager ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_members_update_self_or_manager ON public.group_members;
CREATE POLICY group_members_update_self_or_manager ON public.group_members
  FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.can_admin_group(group_id))
  WITH CHECK ((user_id = (SELECT auth.uid())) OR public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_members_delete_self_or_manager ON public.group_members;
CREATE POLICY group_members_delete_self_or_manager ON public.group_members
  FOR DELETE TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_invites_select_manager ON public.group_invites;
CREATE POLICY group_invites_select_manager ON public.group_invites
  FOR SELECT TO authenticated USING (public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_invites_insert_manager ON public.group_invites;
CREATE POLICY group_invites_insert_manager ON public.group_invites
  FOR INSERT TO authenticated WITH CHECK (public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_invites_update_manager ON public.group_invites;
CREATE POLICY group_invites_update_manager ON public.group_invites
  FOR UPDATE TO authenticated
  USING (public.can_admin_group(group_id)) WITH CHECK (public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_invites_delete_manager ON public.group_invites;
CREATE POLICY group_invites_delete_manager ON public.group_invites
  FOR DELETE TO authenticated USING (public.can_admin_group(group_id));
DROP POLICY IF EXISTS group_messages_delete_sender_or_manager ON public.group_messages;
CREATE POLICY group_messages_delete_sender_or_manager ON public.group_messages
  FOR DELETE TO authenticated
  USING ((sender_id = (SELECT auth.uid())) OR public.can_admin_group(group_id));
DROP POLICY IF EXISTS events_update_owner ON public.events;
CREATE POLICY events_update_owner ON public.events
  FOR UPDATE TO authenticated
  USING ((owner_id = (SELECT auth.uid())) OR ((host_group_id IS NOT NULL) AND public.can_admin_group(host_group_id)))
  WITH CHECK ((owner_id = (SELECT auth.uid())) OR ((host_group_id IS NOT NULL) AND public.can_admin_group(host_group_id)));

-- OPS (can_run_group):
DROP POLICY IF EXISTS seasons_insert_captain ON public.seasons;
CREATE POLICY seasons_insert_captain ON public.seasons
  FOR INSERT TO authenticated WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS seasons_update_captain ON public.seasons;
CREATE POLICY seasons_update_captain ON public.seasons
  FOR UPDATE TO authenticated USING (public.can_run_group(group_id)) WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS seasons_delete_captain ON public.seasons;
CREATE POLICY seasons_delete_captain ON public.seasons
  FOR DELETE TO authenticated USING (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_listings_insert_captain ON public.team_listings;
CREATE POLICY team_listings_insert_captain ON public.team_listings
  FOR INSERT TO authenticated WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_listings_update_captain ON public.team_listings;
CREATE POLICY team_listings_update_captain ON public.team_listings
  FOR UPDATE TO authenticated USING (public.can_run_group(group_id)) WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_listings_delete_captain ON public.team_listings;
CREATE POLICY team_listings_delete_captain ON public.team_listings
  FOR DELETE TO authenticated USING (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_matches_insert_captain ON public.team_matches;
CREATE POLICY team_matches_insert_captain ON public.team_matches
  FOR INSERT TO authenticated WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_matches_update_captain ON public.team_matches;
CREATE POLICY team_matches_update_captain ON public.team_matches
  FOR UPDATE TO authenticated USING (public.can_run_group(group_id)) WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_matches_delete_captain ON public.team_matches;
CREATE POLICY team_matches_delete_captain ON public.team_matches
  FOR DELETE TO authenticated USING (public.can_run_group(group_id));
DROP POLICY IF EXISTS practice_series_insert_captain ON public.practice_series;
CREATE POLICY practice_series_insert_captain ON public.practice_series
  FOR INSERT TO authenticated WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS practice_series_update_captain ON public.practice_series;
CREATE POLICY practice_series_update_captain ON public.practice_series
  FOR UPDATE TO authenticated USING (public.can_run_group(group_id)) WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS practice_series_delete_captain ON public.practice_series;
CREATE POLICY practice_series_delete_captain ON public.practice_series
  FOR DELETE TO authenticated USING (public.can_run_group(group_id));
DROP POLICY IF EXISTS team_practices_insert_captain ON public.team_practices;
CREATE POLICY team_practices_insert_captain ON public.team_practices
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.practice_series ps
                      WHERE ps.id = team_practices.series_id AND public.can_run_group(ps.group_id)));
DROP POLICY IF EXISTS team_practices_update_captain ON public.team_practices;
CREATE POLICY team_practices_update_captain ON public.team_practices
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.practice_series ps
                 WHERE ps.id = team_practices.series_id AND public.can_run_group(ps.group_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.practice_series ps
                      WHERE ps.id = team_practices.series_id AND public.can_run_group(ps.group_id)));
DROP POLICY IF EXISTS team_practices_delete_captain ON public.team_practices;
CREATE POLICY team_practices_delete_captain ON public.team_practices
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.practice_series ps
                 WHERE ps.id = team_practices.series_id AND public.can_run_group(ps.group_id)));
DROP POLICY IF EXISTS albums_update_captain ON public.albums;
CREATE POLICY albums_update_captain ON public.albums
  FOR UPDATE TO authenticated USING (public.can_run_group(group_id)) WITH CHECK (public.can_run_group(group_id));
DROP POLICY IF EXISTS albums_delete_captain ON public.albums;
CREATE POLICY albums_delete_captain ON public.albums
  FOR DELETE TO authenticated USING (public.can_run_group(group_id));
DROP POLICY IF EXISTS album_items_delete_owner_or_captain ON public.album_items;
CREATE POLICY album_items_delete_owner_or_captain ON public.album_items
  FOR DELETE TO authenticated
  USING ((added_by_id = (SELECT auth.uid()))
         OR EXISTS (SELECT 1 FROM public.albums a
                    WHERE a.id = album_items.album_id AND public.can_run_group(a.group_id)));
DROP POLICY IF EXISTS group_files_delete_owner_or_captain ON public.group_files;
CREATE POLICY group_files_delete_owner_or_captain ON public.group_files
  FOR DELETE TO authenticated
  USING ((uploaded_by_id = (SELECT auth.uid())) OR public.can_run_group(group_id));
DROP POLICY IF EXISTS availabilities_update_self_or_captain ON public.availabilities;
CREATE POLICY availabilities_update_self_or_captain ON public.availabilities
  FOR UPDATE TO authenticated
  USING ((user_id = (SELECT auth.uid()))
         OR ((match_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_matches tm
              WHERE tm.id = availabilities.match_id AND public.can_run_group(tm.group_id)))
         OR ((practice_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_practices tp
              JOIN public.practice_series ps ON ps.id = tp.series_id
              WHERE tp.id = availabilities.practice_id AND public.can_run_group(ps.group_id))))
  WITH CHECK ((user_id = (SELECT auth.uid()))
         OR ((match_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_matches tm
              WHERE tm.id = availabilities.match_id AND public.can_run_group(tm.group_id)))
         OR ((practice_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_practices tp
              JOIN public.practice_series ps ON ps.id = tp.series_id
              WHERE tp.id = availabilities.practice_id AND public.can_run_group(ps.group_id))));
DROP POLICY IF EXISTS availabilities_insert_self_or_captain ON public.availabilities;
CREATE POLICY availabilities_insert_self_or_captain ON public.availabilities
  FOR INSERT TO authenticated
  WITH CHECK (
    ((user_id = (SELECT auth.uid()))
       AND (((match_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_matches tm
              WHERE tm.id = availabilities.match_id AND public.is_group_member(tm.group_id)))
            OR ((practice_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_practices tp
              JOIN public.practice_series ps ON ps.id = tp.series_id
              WHERE tp.id = availabilities.practice_id AND public.is_group_member(ps.group_id)))))
    OR ((match_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_matches tm
              WHERE tm.id = availabilities.match_id AND public.can_run_group(tm.group_id)))
    OR ((practice_id IS NOT NULL) AND EXISTS (SELECT 1 FROM public.team_practices tp
              JOIN public.practice_series ps ON ps.id = tp.series_id
              WHERE tp.id = availabilities.practice_id AND public.can_run_group(ps.group_id)))
  );

-- Role writers switched from role to roles.
CREATE OR REPLACE FUNCTION public.auto_add_group_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, roles)
  VALUES (NEW.id, NEW.owner_id, ARRAY[]::group_member_role[])
  ON CONFLICT (group_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_group_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_id    uuid;
  v_team_name   text;
  v_author_name text;
  v_message     text;
BEGIN
  IF NEW.is_complete IS NOT TRUE OR NEW.post_type <> 'propose_team' THEN RETURN NEW; END IF;
  IF NEW.team_group_id IS NOT NULL AND NEW.team_group_id <> '' THEN RETURN NEW; END IF;

  SELECT NULLIF(trim(name), '') INTO v_author_name FROM profiles WHERE id = NEW.author_id;
  v_team_name := COALESCE(
    NULLIF(trim(NEW.court_location), ''),
    CASE WHEN v_author_name IS NULL THEN 'Team' ELSE v_author_name || '''s Team' END
  );

  INSERT INTO groups (name, owner_id) VALUES (v_team_name, NEW.author_id) RETURNING id INTO v_group_id;

  INSERT INTO group_members (group_id, user_id, roles)
  SELECT v_group_id, NEW.author_id, ARRAY[]::group_member_role[]
  UNION
  SELECT v_group_id, pr.user_id, ARRAY[]::group_member_role[]
  FROM play_requests pr
  WHERE pr.post_id = NEW.id AND pr.status = 'approved'
  ON CONFLICT (group_id, user_id) DO NOTHING;

  v_message := E'🏆 Team formed!\n' || 'Welcome to ' || v_team_name || E' — let''s organize practice and matches.';
  INSERT INTO group_messages (group_id, sender_id, content) VALUES (v_group_id, NEW.author_id, v_message);
  UPDATE posts SET team_group_id = v_group_id::text WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- accept_group_invite: write roles from the invite; pre-existing membership
-- wins (DO NOTHING preserves the member's current roles — an admin adjusts later).
CREATE OR REPLACE FUNCTION public.accept_group_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_email  text;
  v_inv    group_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RAISE EXCEPTION 'Missing token' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_caller;
  SELECT * INTO v_inv FROM group_invites WHERE token = p_token;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_inv.status = 'accepted' THEN RETURN jsonb_build_object('ok', true, 'already_accepted', true); END IF;
  IF v_inv.status = 'cancelled' THEN RAISE EXCEPTION 'This invite was cancelled' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN RAISE EXCEPTION 'This invite has expired' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF lower(v_email) <> lower(v_inv.email::text) THEN RAISE EXCEPTION 'This invite is for a different email address' USING ERRCODE = 'insufficient_privilege'; END IF;

  INSERT INTO group_members (group_id, user_id, roles, member_type)
  VALUES (v_inv.group_id, v_caller, v_inv.roles, COALESCE(v_inv.member_type, ''))
  ON CONFLICT (group_id, user_id) DO NOTHING;

  UPDATE group_invites SET status = 'accepted', accepted_by_id = v_caller, accepted_at = now() WHERE id = v_inv.id;
  INSERT INTO notifications (user_id, actor_id, type)
  VALUES (v_inv.invited_by_id, v_caller, 'group_invite_accepted'::notification_type);
  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_invite_by_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv     group_invites%ROWTYPE;
  v_group   groups%ROWTYPE;
  v_inviter text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_inv FROM group_invites WHERE token = p_token;
  IF v_inv.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_group FROM groups WHERE id = v_inv.group_id;
  SELECT name INTO v_inviter FROM profiles WHERE id = v_inv.invited_by_id;
  RETURN jsonb_build_object(
    'id', v_inv.id, 'group_id', v_inv.group_id, 'invited_by_id', v_inv.invited_by_id,
    'token', v_inv.token, 'roles', v_inv.roles, 'member_type', v_inv.member_type,
    'status', v_inv.status, 'expires_at', v_inv.expires_at, 'accepted_by_id', v_inv.accepted_by_id,
    'accepted_at', v_inv.accepted_at, 'created_at', v_inv.created_at, 'updated_at', v_inv.updated_at,
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'image_url', v_group.image_url),
    'inviter_name', COALESCE(v_inviter, '')
  );
END;
$$;

-- Guard: only an admin may change a member's roles; only the owner may
-- grant/revoke the Manager role. Non-role self-updates pass untouched.
CREATE OR REPLACE FUNCTION public.guard_group_member_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- trusted backend / service role
  IF NEW.roles IS NOT DISTINCT FROM OLD.roles THEN RETURN NEW; END IF;
  IF NOT public.can_admin_group(OLD.group_id) THEN
    RAISE EXCEPTION 'Only a team admin can change member roles' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (('manager' = ANY(NEW.roles)) IS DISTINCT FROM ('manager' = ANY(OLD.roles))) THEN
    SELECT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = OLD.group_id AND g.owner_id = auth.uid())
      INTO v_is_owner;
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Only the team owner can change the Manager role' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_group_member_roles() FROM anon, authenticated, public;
DROP TRIGGER IF EXISTS group_members_guard_roles ON public.group_members;
CREATE TRIGGER group_members_guard_roles
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_member_roles();

-- Guard: owner_id changes only when the current owner initiates them
-- (via transfer_group_ownership). Admins editing other group fields can't.
CREATE OR REPLACE FUNCTION public.guard_group_owner_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- trusted backend / service role
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND OLD.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.guard_group_owner_id() FROM anon, authenticated, public;
DROP TRIGGER IF EXISTS groups_guard_owner_id ON public.groups;
CREATE TRIGGER groups_guard_owner_id
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.guard_group_owner_id();

-- Explicit ownership transfer. New owner must be a member; the outgoing owner
-- is kept on as manager+captain so the founder isn't stranded.
CREATE OR REPLACE FUNCTION public.transfer_group_ownership(p_group_id uuid, p_new_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT owner_id INTO v_owner FROM public.groups WHERE id = p_group_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Team not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_owner <> v_caller THEN RAISE EXCEPTION 'Only the current owner can transfer ownership' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_new_owner_id = v_owner THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = p_new_owner_id) THEN
    RAISE EXCEPTION 'New owner must be a member of the team' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.group_members
    SET roles = ARRAY['manager','captain']::group_member_role[]
    WHERE group_id = p_group_id AND user_id = v_owner;
  UPDATE public.groups SET owner_id = p_new_owner_id WHERE id = p_group_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.transfer_group_ownership(uuid, uuid) TO authenticated;

-- Drop legacy hierarchy fn + columns (has_group_role is a SQL fn that depends
-- on the role column, so it must go first).
DROP FUNCTION IF EXISTS public.has_group_role(uuid, group_role);
DROP INDEX IF EXISTS public.group_members_group_role_idx;
ALTER TABLE public.group_members DROP COLUMN role;
ALTER TABLE public.group_invites DROP COLUMN role;

-- =====================================================================
-- Migration: wire up Seasons. New team_matches / practice_series / events
-- are auto-tagged with the host group's active season (season_id), so the
-- calendar and future per-season views can scope by season.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.active_season_id(g uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.seasons
  WHERE group_id = g AND is_active
  ORDER BY created_at DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.active_season_id(uuid) FROM anon, public;

-- team_matches + practice_series carry group_id directly.
CREATE OR REPLACE FUNCTION public.set_active_season_from_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.season_id IS NULL THEN
    NEW.season_id := public.active_season_id(NEW.group_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_active_season_from_group() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS team_matches_set_season ON public.team_matches;
CREATE TRIGGER team_matches_set_season
  BEFORE INSERT ON public.team_matches
  FOR EACH ROW EXECUTE FUNCTION public.set_active_season_from_group();

DROP TRIGGER IF EXISTS practice_series_set_season ON public.practice_series;
CREATE TRIGGER practice_series_set_season
  BEFORE INSERT ON public.practice_series
  FOR EACH ROW EXECUTE FUNCTION public.set_active_season_from_group();

-- events are season-scoped only when hosted by a team.
CREATE OR REPLACE FUNCTION public.set_active_season_from_host_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.season_id IS NULL AND NEW.host_group_id IS NOT NULL THEN
    NEW.season_id := public.active_season_id(NEW.host_group_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_active_season_from_host_group() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS events_set_season ON public.events;
CREATE TRIGGER events_set_season
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_active_season_from_host_group();

-- =====================================================================
-- Migration: group invites can target a phone number instead of an email.
-- Exactly one of (email, phone) is set per row. The email-dispatch
-- trigger is gated so phone invites don't try to email an empty address.
-- accept_group_invite matches caller's auth.users.phone for phone invites
-- (stripping the leading '+' since auth.users.phone is stored without it).
-- =====================================================================

ALTER TABLE public.group_invites
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.group_invites
  DROP CONSTRAINT IF EXISTS group_invites_email_xor_phone;
ALTER TABLE public.group_invites
  ADD CONSTRAINT group_invites_email_xor_phone
  CHECK ((email IS NOT NULL)::int + (phone IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS group_invites_phone_status_idx
  ON public.group_invites (phone, status)
  WHERE phone IS NOT NULL;

DROP TRIGGER IF EXISTS group_invites_send_email ON public.group_invites;
CREATE TRIGGER group_invites_send_email
  AFTER INSERT ON public.group_invites
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL)
  EXECUTE FUNCTION public.dispatch_group_invite_email();

-- Two invite paths: email-bound (recipient-matched, email dispatch via
-- group-invite-email edge function) OR bearer link (null email — anyone
-- signed in with the token can accept, delivered via the inviter's own
-- share sheet to Messages / WhatsApp / etc.). The phone column was
-- removed: collecting a phone number to attach to a bearer link added
-- no value beyond labeling.
ALTER TABLE public.group_invites
  DROP CONSTRAINT IF EXISTS group_invites_email_xor_phone;
DROP INDEX IF EXISTS public.group_invites_phone_status_idx;
ALTER TABLE public.group_invites DROP COLUMN IF EXISTS phone;
DROP FUNCTION IF EXISTS public.dispatch_group_invite_sms();

CREATE OR REPLACE FUNCTION public.accept_group_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller       uuid := auth.uid();
  v_caller_email text;
  v_inv          group_invites%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RAISE EXCEPTION 'Missing token' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  SELECT * INTO v_inv FROM group_invites WHERE token = p_token;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_inv.status = 'accepted' THEN RETURN jsonb_build_object('ok', true, 'already_accepted', true); END IF;
  IF v_inv.status = 'cancelled' THEN RAISE EXCEPTION 'This invite was cancelled' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < now() THEN RAISE EXCEPTION 'This invite has expired' USING ERRCODE = 'invalid_parameter_value'; END IF;

  -- Email-bound invites require a match. Bearer (email IS NULL) invites
  -- accept any signed-in user — the token is the credential.
  IF v_inv.email IS NOT NULL THEN
    IF v_caller_email IS NULL OR lower(v_caller_email) <> lower(v_inv.email::text) THEN
      RAISE EXCEPTION 'This invite is for a different email address' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO group_members (group_id, user_id, roles, member_type)
  VALUES (v_inv.group_id, v_caller, v_inv.roles, COALESCE(v_inv.member_type, ''))
  ON CONFLICT (group_id, user_id) DO NOTHING;

  UPDATE group_invites SET status = 'accepted', accepted_by_id = v_caller, accepted_at = now() WHERE id = v_inv.id;
  INSERT INTO notifications (user_id, actor_id, type)
  VALUES (v_inv.invited_by_id, v_caller, 'group_invite_accepted'::notification_type);
  RETURN jsonb_build_object('ok', true, 'group_id', v_inv.group_id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_group_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_group_invite(text) TO authenticated;

-- =====================================================================
-- 0018_availability_polls
--
-- "Availability-first" complement to the captain-posts-match flow.
-- The captain opens a poll on a chosen set of dates (e.g. specific
-- weekends), and each member submits one or more free-form blocks
-- (start, end) per date (length >= min_block_minutes, default 2h).
-- The poll page computes a ranked list of overlap windows; converting
-- a winning slot uses the existing Add Match form (prefilled date+time)
-- so team_matches stays the single source of truth.
-- =====================================================================

CREATE TABLE public.availability_polls (
  id                  uuid primary key default gen_random_uuid(),
  group_id            uuid not null references public.groups (id) on delete cascade,
  created_by_id       uuid not null references public.profiles (id) on delete restrict,
  title               text not null default '',
  candidate_dates     date[] not null,
  min_players         integer not null default 4 check (min_players >= 1),
  min_block_minutes   integer not null default 120 check (min_block_minutes >= 30),
  timezone            text not null default 'America/Los_Angeles',
  status              text not null default 'open' check (status in ('open','closed')),
  closed_at           timestamptz,
  resulting_match_id  uuid references public.team_matches (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  CHECK (array_length(candidate_dates, 1) between 1 and 60)
);
CREATE INDEX availability_polls_group_status_idx
  ON public.availability_polls (group_id, status);

CREATE TRIGGER availability_polls_updated_at
  BEFORE UPDATE ON public.availability_polls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.availability_poll_responses (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references public.availability_polls (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- jsonb array: [{ "date":"YYYY-MM-DD", "start":"HH:MM", "end":"HH:MM" }, ...]
  -- A single row per (poll, member); replacing the array is a plain upsert.
  blocks      jsonb not null default '[]'::jsonb
              CHECK (jsonb_typeof(blocks) = 'array'),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX availability_poll_responses_poll_idx
  ON public.availability_poll_responses (poll_id);
CREATE INDEX availability_poll_responses_user_idx
  ON public.availability_poll_responses (user_id);

CREATE TRIGGER availability_poll_responses_updated_at
  BEFORE UPDATE ON public.availability_poll_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Wire the forward-referenced FK from notifications.poll_id (declared in
-- the notifications block above) to the now-created polls table.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_poll_id_fkey
  FOREIGN KEY (poll_id) REFERENCES public.availability_polls (id) ON DELETE CASCADE;

-- RLS: mirrors team_matches (members read; captains write).
ALTER TABLE public.availability_polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY availability_polls_select_member ON public.availability_polls
  FOR SELECT TO authenticated USING (public.is_group_member(group_id));

CREATE POLICY availability_polls_insert_captain ON public.availability_polls
  FOR INSERT TO authenticated
  WITH CHECK (public.can_run_group(group_id) AND created_by_id = (SELECT auth.uid()));

CREATE POLICY availability_polls_update_captain ON public.availability_polls
  FOR UPDATE TO authenticated
  USING (public.can_run_group(group_id))
  WITH CHECK (public.can_run_group(group_id));

CREATE POLICY availability_polls_delete_captain ON public.availability_polls
  FOR DELETE TO authenticated
  USING (public.can_run_group(group_id));

ALTER TABLE public.availability_poll_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY poll_responses_select_member ON public.availability_poll_responses
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.availability_polls p
      WHERE p.id = poll_id AND public.is_group_member(p.group_id)
    )
  );

CREATE POLICY poll_responses_insert_self ON public.availability_poll_responses
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.availability_polls p
      WHERE p.id = poll_id
        AND public.is_group_member(p.group_id)
        AND p.status = 'open'
    )
  );

CREATE POLICY poll_responses_update_self ON public.availability_poll_responses
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY poll_responses_delete_self ON public.availability_poll_responses
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Realtime so the captain's ranked-window view live-updates as members submit.
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_poll_responses;

-- =====================================================================
-- Circles & Clubs (migrations clubs_a / clubs_b / clubs_c)
-- =====================================================================
--
-- Two friend-group kinds:
--   circle — legacy private, owner-curated list of the owner's friends.
--   club   — invite-grown community: ANY member can invite their OWN
--            accepted friends (who need not know the owner). Invitees get
--            a bell notification + push, accept via accept_club_invite()
--            (membership + auto-join of the club chat) or decline via a
--            plain status UPDATE. Clubs reuse the existing friend_group
--            plumbing: post_targets / can_see_post() visibility and
--            chats.friend_group_id chat backing work unchanged.

CREATE TYPE public.friend_group_kind AS ENUM ('circle', 'club');

ALTER TABLE public.friend_groups
  ADD COLUMN kind public.friend_group_kind NOT NULL DEFAULT 'circle';

CREATE TYPE public.friend_group_invite_status AS ENUM ('pending', 'accepted', 'declined');

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'club_invite';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'club_invite_accepted';

-- is_friend_group_member: SECURITY DEFINER so friend_groups /
-- friend_group_members policies can reference membership without the
-- mutual-policy recursion that bit groups/group_members (see
-- 0006_helpers_security_definer). Safe: checks auth.uid() only.
CREATE OR REPLACE FUNCTION public.is_friend_group_member(fg uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.friend_group_members
    WHERE friend_group_id = fg AND user_id = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_friend_group_member(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.is_friend_group_member(uuid) TO authenticated;

-- Club invitations. One live row per (club, invitee); a declined row is
-- flipped back to 'pending' on re-invite rather than re-inserted.
CREATE TABLE public.friend_group_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  friend_group_id uuid NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  inviter_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status          public.friend_group_invite_status NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_group_invites_distinct CHECK (inviter_id <> invitee_id),
  CONSTRAINT friend_group_invites_unique UNIQUE (friend_group_id, invitee_id)
);
CREATE INDEX friend_group_invites_invitee_idx ON public.friend_group_invites (invitee_id, status);
CREATE INDEX friend_group_invites_inviter_idx ON public.friend_group_invites (inviter_id);

CREATE TRIGGER friend_group_invites_updated_at
  BEFORE UPDATE ON public.friend_group_invites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.friend_group_invites IS
  'Club (friend_groups.kind=club) invitations. Any member may invite their own accepted friends; the invitee accepts via accept_club_invite() or declines via a status UPDATE.';

-- Deep-link FK so club_invite notifications can route to the club.
-- Follows the nullable poll_id precedent.
ALTER TABLE public.notifications
  ADD COLUMN friend_group_id uuid REFERENCES public.friend_groups(id) ON DELETE CASCADE;

-- friend_groups: members (clubs grow beyond the owner's friends) can now
-- read the row; writes stay owner-only. Also fixes circle members not being
-- able to resolve the group name on posts targeted at the circle.
DROP POLICY friend_groups_select_owner ON public.friend_groups;
CREATE POLICY friend_groups_select_member ON public.friend_groups
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR public.is_friend_group_member(id));

-- friend_group_members: members can see the full roster (needed for club
-- cards + invite-picker exclusion). Uses the DEFINER helper, not an inline
-- self-referencing EXISTS, to avoid policy recursion.
DROP POLICY friend_group_members_select ON public.friend_group_members;
CREATE POLICY friend_group_members_select ON public.friend_group_members
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_friend_group_member(friend_group_id)
    OR EXISTS(
      SELECT 1 FROM public.friend_groups fg
      WHERE fg.id = friend_group_id AND fg.owner_id = (SELECT auth.uid())
    )
  );
-- (friend_group_members_write_by_owner and friend_group_members_leave_self
-- remain as-is; club member inserts go through the accept_club_invite RPC.)

ALTER TABLE public.friend_group_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY friend_group_invites_select ON public.friend_group_invites
  FOR SELECT TO authenticated
  USING (
    inviter_id = (SELECT auth.uid())
    OR invitee_id = (SELECT auth.uid())
    OR public.is_friend_group_member(friend_group_id)
  );

-- Any club member may invite, but only their own accepted friends, and
-- only into clubs (never circles).
CREATE POLICY friend_group_invites_insert_member ON public.friend_group_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    inviter_id = (SELECT auth.uid())
    AND status = 'pending'
    AND public.is_friend_group_member(friend_group_id)
    AND public.is_friend(invitee_id)
    AND EXISTS(
      SELECT 1 FROM public.friend_groups fg
      WHERE fg.id = friend_group_id AND fg.kind = 'club'
    )
  );

-- Invitee declines via UPDATE (accept goes through the RPC). Inviter may
-- re-send a declined invite (flip back to pending).
CREATE POLICY friend_group_invites_update_invitee ON public.friend_group_invites
  FOR UPDATE TO authenticated
  USING (invitee_id = (SELECT auth.uid()))
  WITH CHECK (invitee_id = (SELECT auth.uid()));

CREATE POLICY friend_group_invites_update_inviter ON public.friend_group_invites
  FOR UPDATE TO authenticated
  USING (inviter_id = (SELECT auth.uid()))
  WITH CHECK (inviter_id = (SELECT auth.uid()) AND status = 'pending');

CREATE POLICY friend_group_invites_delete_inviter ON public.friend_group_invites
  FOR DELETE TO authenticated
  USING (inviter_id = (SELECT auth.uid()));

-- Bell notification + push banner when an invite lands (insert, or a
-- declined row re-sent back to pending).
CREATE OR REPLACE FUNCTION public.notify_club_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter_name text;
  v_club_name    text;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'declined' AND NEW.status = 'pending') THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, actor_id, type, friend_group_id)
  VALUES (NEW.invitee_id, NEW.inviter_id, 'club_invite', NEW.friend_group_id);

  SELECT name INTO v_inviter_name FROM public.profiles WHERE id = NEW.inviter_id;
  SELECT name INTO v_club_name FROM public.friend_groups WHERE id = NEW.friend_group_id;

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  jsonb_build_array(NEW.invitee_id),
      'title',     COALESCE(v_inviter_name, 'A player'),
      'body',      'invited you to join ' || COALESCE(v_club_name, 'a club'),
      'thread_id', 'club_invite:' || NEW.friend_group_id::text,
      'data',      jsonb_build_object(
                     'kind',            'club_invite',
                     'friend_group_id', NEW.friend_group_id::text,
                     'invite_id',       NEW.id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_group_invites_notify_insert ON public.friend_group_invites;
CREATE TRIGGER friend_group_invites_notify_insert
  AFTER INSERT ON public.friend_group_invites
  FOR EACH ROW EXECUTE FUNCTION public.notify_club_invite();

DROP TRIGGER IF EXISTS friend_group_invites_notify_resend ON public.friend_group_invites;
CREATE TRIGGER friend_group_invites_notify_resend
  AFTER UPDATE OF status ON public.friend_group_invites
  FOR EACH ROW EXECUTE FUNCTION public.notify_club_invite();

-- Remove the stale bell row once the invite is no longer pending
-- (accepted, declined, or cancelled/deleted).
CREATE OR REPLACE FUNCTION public.cleanup_club_invite_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitee uuid;
  v_inviter uuid;
  v_club    uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_invitee := OLD.invitee_id; v_inviter := OLD.inviter_id; v_club := OLD.friend_group_id;
  ELSIF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    v_invitee := NEW.invitee_id; v_inviter := NEW.inviter_id; v_club := NEW.friend_group_id;
  ELSE
    RETURN NULL;
  END IF;

  DELETE FROM public.notifications
  WHERE user_id = v_invitee
    AND actor_id = v_inviter
    AND type = 'club_invite'
    AND friend_group_id = v_club;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS friend_group_invites_cleanup_delete ON public.friend_group_invites;
CREATE TRIGGER friend_group_invites_cleanup_delete
  AFTER DELETE ON public.friend_group_invites
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_club_invite_notification();

DROP TRIGGER IF EXISTS friend_group_invites_cleanup_update ON public.friend_group_invites;
CREATE TRIGGER friend_group_invites_cleanup_update
  AFTER UPDATE OF status ON public.friend_group_invites
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_club_invite_notification();

-- Accept = three privileged writes (membership, chat join, inviter
-- notification) that plain client RLS can't do atomically — so an RPC,
-- modeled on accept_group_invite.
CREATE OR REPLACE FUNCTION public.accept_club_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inv    friend_group_invites%ROWTYPE;
  v_chat   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_inv FROM friend_group_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.invitee_id <> v_caller THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'already_accepted', true,
                              'friend_group_id', v_inv.friend_group_id);
  END IF;

  INSERT INTO friend_group_members (friend_group_id, user_id)
  VALUES (v_inv.friend_group_id, v_caller)
  ON CONFLICT (friend_group_id, user_id) DO NOTHING;

  -- Club chats are created in create_club, but be defensive.
  SELECT id INTO v_chat FROM chats WHERE friend_group_id = v_inv.friend_group_id;
  IF v_chat IS NULL THEN
    INSERT INTO chats (name, creator_id, friend_group_id)
    SELECT fg.name, fg.owner_id, fg.id FROM friend_groups fg
    WHERE fg.id = v_inv.friend_group_id
    RETURNING id INTO v_chat;
    INSERT INTO chat_participants (chat_id, user_id)
    SELECT v_chat, fgm.user_id FROM friend_group_members fgm
    WHERE fgm.friend_group_id = v_inv.friend_group_id
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO chat_participants (chat_id, user_id)
    VALUES (v_chat, v_caller)
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE friend_group_invites SET status = 'accepted' WHERE id = v_inv.id;

  INSERT INTO notifications (user_id, actor_id, type, friend_group_id)
  VALUES (v_inv.inviter_id, v_caller, 'club_invite_accepted', v_inv.friend_group_id);

  RETURN jsonb_build_object('ok', true,
                            'friend_group_id', v_inv.friend_group_id,
                            'chat_id', v_chat);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_club_invite(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_club_invite(uuid) TO authenticated;

-- create_club: club row + creator membership + chat + creator participant
-- in one transaction, then the initial invites (each re-validated against
-- the caller's accepted friendships — the RPC is DEFINER so RLS WITH CHECK
-- doesn't run here).
CREATE OR REPLACE FUNCTION public.create_club(p_name text, p_invitee_ids uuid[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_club   uuid;
  v_chat   uuid;
  v_id     uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Club name is required';
  END IF;

  INSERT INTO friend_groups (name, owner_id, kind)
  VALUES (trim(p_name), v_caller, 'club')
  RETURNING id INTO v_club;

  INSERT INTO friend_group_members (friend_group_id, user_id)
  VALUES (v_club, v_caller);

  INSERT INTO chats (name, creator_id, friend_group_id)
  VALUES (trim(p_name), v_caller, v_club)
  RETURNING id INTO v_chat;

  INSERT INTO chat_participants (chat_id, user_id)
  VALUES (v_chat, v_caller);

  FOREACH v_id IN ARRAY COALESCE(p_invitee_ids, '{}') LOOP
    IF v_id <> v_caller AND EXISTS(
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = v_caller AND addressee_id = v_id)
          OR (requester_id = v_id AND addressee_id = v_caller))
    ) THEN
      INSERT INTO friend_group_invites (friend_group_id, inviter_id, invitee_id)
      VALUES (v_club, v_caller, v_id)
      ON CONFLICT (friend_group_id, invitee_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('club_id', v_club, 'chat_id', v_chat);
END;
$$;
REVOKE ALL ON FUNCTION public.create_club(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.create_club(text, uuid[]) TO authenticated;

-- Default privileges grant EXECUTE to anon; strip it from the new club
-- functions (matches the 0006 revoke-from-anon pattern).
REVOKE EXECUTE ON FUNCTION public.accept_club_invite(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_club(text, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_club_invite() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_club_invite_notification() FROM anon, authenticated;

-- Invitees need the club row (name) to render "X invited you to join {club}"
-- on the requests page. No recursion: friend_group_invites' SELECT policy
-- only references auth.uid() and the DEFINER membership helper.
DROP POLICY friend_groups_select_member ON public.friend_groups;
CREATE POLICY friend_groups_select_member ON public.friend_groups
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.is_friend_group_member(id)
    OR EXISTS(
      SELECT 1 FROM public.friend_group_invites i
      WHERE i.friend_group_id = id
        AND i.invitee_id = (SELECT auth.uid())
        AND i.status = 'pending'
    )
  );

-- Two fixes to the clubs RLS:
--
-- 1. friend_groups_select_member's invite clause wrote `i.friend_group_id
--    = id`, which Postgres resolved to i.id (the invites table's own
--    column) — invitees could never read the club name.
-- 2. friend_group_invites_insert_member queried friend_groups while
--    friend_groups' SELECT policy queried friend_group_invites back —
--    relation-level policy cycle → "infinite recursion detected" (42P17)
--    on every member-driven invite INSERT.
--
-- Both are fixed the way 0006 fixed groups/group_members: tiny SECURITY
-- DEFINER helpers so policies never cross-reference each other's tables.

CREATE OR REPLACE FUNCTION public.is_club(fg uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.friend_groups
    WHERE id = fg AND kind = 'club'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_club(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.is_club(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_pending_club_invite(fg uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.friend_group_invites
    WHERE friend_group_id = fg
      AND invitee_id = auth.uid()
      AND status = 'pending'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_pending_club_invite(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.has_pending_club_invite(uuid) TO authenticated;

DROP POLICY friend_groups_select_member ON public.friend_groups;
CREATE POLICY friend_groups_select_member ON public.friend_groups
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR public.is_friend_group_member(id)
    OR public.has_pending_club_invite(id)
  );

DROP POLICY friend_group_invites_insert_member ON public.friend_group_invites;
CREATE POLICY friend_group_invites_insert_member ON public.friend_group_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    inviter_id = (SELECT auth.uid())
    AND status = 'pending'
    AND public.is_friend_group_member(friend_group_id)
    AND public.is_friend(invitee_id)
    AND public.is_club(friend_group_id)
  );

-- =====================================================================
-- 0013_chat_looking_for_player
-- =====================================================================
-- Looking-for-Player requests fired off from inside a chat. The feed post
-- (post_type = 'find_players') is audience-scoped to exactly the chat it was
-- created from, and a card (shared_post_id) is dropped into that chat.
--
-- Two new post_targets kinds extend the existing group / friend_group model:
--   'user' → a single person (1-on-1 DM)
--   'chat' → an ad-hoc session/game chat's participant set
-- (team chats reuse 'group'; club chats reuse 'friend_group'.)
--
-- NOTE: the ALTER TYPE ... ADD VALUE statements must commit before the new
-- literals are referenced (in the CHECK / can_see_post below). When applying
-- to a live DB via Supabase MCP, run this enum block as its OWN migration,
-- then the remainder as a second migration. In a fresh schema.sql replay
-- (psql autocommit) the sequential order below is sufficient.

ALTER TYPE post_target_kind ADD VALUE IF NOT EXISTS 'user';
ALTER TYPE post_target_kind ADD VALUE IF NOT EXISTS 'chat';

-- post_targets: two new nullable FK columns for the new kinds.
ALTER TABLE public.post_targets
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chat_id        uuid REFERENCES public.chats (id)    ON DELETE CASCADE;

-- Replace the original (unnamed) CHECK that only allowed group / friend_group.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = 'public.post_targets'::regclass
     AND contype  = 'c';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.post_targets DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.post_targets
  ADD CONSTRAINT post_targets_kind_col_ck CHECK (
    (target_kind = 'group'        AND group_id        IS NOT NULL AND friend_group_id IS NULL AND target_user_id IS NULL AND chat_id IS NULL)
    OR (target_kind = 'friend_group' AND friend_group_id IS NOT NULL AND group_id IS NULL AND target_user_id IS NULL AND chat_id IS NULL)
    OR (target_kind = 'user'      AND target_user_id  IS NOT NULL AND group_id IS NULL AND friend_group_id IS NULL AND chat_id IS NULL)
    OR (target_kind = 'chat'      AND chat_id         IS NOT NULL AND group_id IS NULL AND friend_group_id IS NULL AND target_user_id IS NULL)
  );

-- One target row per (post, audience). Partial so the group/friend_group
-- uniqueness already declared on the table is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS post_targets_post_user_uq ON public.post_targets (post_id, target_user_id) WHERE target_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS post_targets_post_chat_uq ON public.post_targets (post_id, chat_id)        WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_targets_user_idx ON public.post_targets (target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_targets_chat_idx ON public.post_targets (chat_id)        WHERE chat_id IS NOT NULL;

-- can_see_post: add the 'user' and 'chat' branches inside the targeted block.
CREATE OR REPLACE FUNCTION public.can_see_post(p posts)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
  has_targets boolean;
  viewer_in_target boolean;
begin
  if viewer is null then
    return false;
  end if;

  if p.author_id = viewer then
    return true;
  end if;

  if public.is_blocked(viewer, p.author_id) then
    return false;
  end if;

  has_targets := exists(select 1 from public.post_targets where post_id = p.id);

  if has_targets then
    -- Either targeted at a group the viewer's a member of...
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.group_members gm on gm.group_id = pt.group_id
      where pt.post_id = p.id
        and pt.target_kind = 'group'
        and gm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    -- ...or targeted at a friend group the viewer belongs to...
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.friend_group_members fgm on fgm.friend_group_id = pt.friend_group_id
      where pt.post_id = p.id
        and pt.target_kind = 'friend_group'
        and fgm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    -- ...or targeted directly at the viewer (1-on-1 chat request)...
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      where pt.post_id = p.id
        and pt.target_kind = 'user'
        and pt.target_user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    -- ...or targeted at a session chat the viewer participates in.
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      where pt.post_id = p.id
        and pt.target_kind = 'chat'
        and public.is_chat_participant(pt.chat_id)
    );
    if viewer_in_target then
      return true;
    end if;

    -- Targeted posts that don't match: no fallthrough.
    return false;
  end if;

  -- Untargeted: friends-of-author can see it.
  if exists(
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = viewer and addressee_id = p.author_id)
        or (requester_id = p.author_id and addressee_id = viewer))
  ) then
    return true;
  end if;

  -- Untargeted broadcast: location-gated.
  if p.is_broadcast and p.broadcast_location is not null and p.broadcast_radius_mi > 0 then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      if st_dwithin(viewer_loc, p.broadcast_location, p.broadcast_radius_mi * 1609.34) then
        return true;
      end if;
    end if;
  end if;

  -- Posts cross-posted from an event the viewer can see.
  if p.event_id is not null then
    return exists(
      select 1 from public.events e
      where e.id = p.event_id and public.can_see_event(e)
    );
  end if;

  return false;
end;
$function$;

revoke execute on function public.can_see_post(public.posts) from anon, public;
grant  execute on function public.can_see_post(public.posts) to authenticated;

-- Session-chat messages can now embed a shared post card (DMs and group
-- messages already carry this column).
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS shared_post_id uuid REFERENCES public.posts (id) ON DELETE SET NULL;

-- =====================================================================
-- 0014_react_notify_all_chats
-- =====================================================================
-- Reacting to a message now notifies the message's sender in ALL chat
-- surfaces, not just DMs. The notify trigger previously early-returned for
-- target_type <> 'dm'. Session/team reactions reference chat_messages /
-- group_messages, which the notifications table couldn't point at — so add
-- two nullable FK columns alongside the existing message_id (DM).

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS chat_message_id  uuid REFERENCES public.chat_messages (id)  ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS group_message_id uuid REFERENCES public.group_messages (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.notify_on_message_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sender_id uuid;
BEGIN
  IF NEW.target_type = 'dm' THEN
    SELECT sender_id INTO v_sender_id FROM messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    INSERT INTO notifications (user_id, actor_id, type, message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  ELSIF NEW.target_type = 'chat' THEN
    SELECT sender_id INTO v_sender_id FROM chat_messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    INSERT INTO notifications (user_id, actor_id, type, chat_message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  ELSIF NEW.target_type = 'group' THEN
    SELECT sender_id INTO v_sender_id FROM group_messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    INSERT INTO notifications (user_id, actor_id, type, group_message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_reactions_notify ON public.message_reactions;
CREATE TRIGGER message_reactions_notify AFTER INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message_reaction();

-- =====================================================================
-- 0015_can_see_post_private_guard
-- =====================================================================
-- Restore the `visibility = 'private'` short-circuit that the posts.visibility
-- column comment promises and that the original can_see_post() carried. It was
-- dropped during the post_targets consolidation (migration 0007) and stayed
-- missing through the 0013 rewrite, leaving private Playbook entries
-- (post_type='note', visibility='private', no targets) readable by the author's
-- friends via the untargeted friends-of-author fallthrough. Author still sees
-- their own post (returns above); everyone else is hard-stopped for private.

CREATE OR REPLACE FUNCTION public.can_see_post(p posts)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  viewer uuid := auth.uid();
  viewer_loc geography;
  has_targets boolean;
  viewer_in_target boolean;
begin
  if viewer is null then
    return false;
  end if;

  if p.author_id = viewer then
    return true;
  end if;

  -- Private posts (Playbook notes) are author-only: hard stop for everyone
  -- else, no fall-through to friend / target / broadcast / event visibility.
  if p.visibility = 'private' then
    return false;
  end if;

  if public.is_blocked(viewer, p.author_id) then
    return false;
  end if;

  has_targets := exists(select 1 from public.post_targets where post_id = p.id);

  if has_targets then
    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.group_members gm on gm.group_id = pt.group_id
      where pt.post_id = p.id
        and pt.target_kind = 'group'
        and gm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    viewer_in_target := exists(
      select 1 from public.post_targets pt
      join public.friend_group_members fgm on fgm.friend_group_id = pt.friend_group_id
      where pt.post_id = p.id
        and pt.target_kind = 'friend_group'
        and fgm.user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    viewer_in_target := exists(
      select 1 from public.post_targets pt
      where pt.post_id = p.id
        and pt.target_kind = 'user'
        and pt.target_user_id = viewer
    );
    if viewer_in_target then
      return true;
    end if;

    viewer_in_target := exists(
      select 1 from public.post_targets pt
      where pt.post_id = p.id
        and pt.target_kind = 'chat'
        and public.is_chat_participant(pt.chat_id)
    );
    if viewer_in_target then
      return true;
    end if;

    return false;
  end if;

  if exists(
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = viewer and addressee_id = p.author_id)
        or (requester_id = p.author_id and addressee_id = viewer))
  ) then
    return true;
  end if;

  if p.is_broadcast and p.broadcast_location is not null and p.broadcast_radius_mi > 0 then
    select location into viewer_loc from public.profiles where id = viewer;
    if viewer_loc is not null then
      if st_dwithin(viewer_loc, p.broadcast_location, p.broadcast_radius_mi * 1609.34) then
        return true;
      end if;
    end if;
  end if;

  if p.event_id is not null then
    return exists(
      select 1 from public.events e
      where e.id = p.event_id and public.can_see_event(e)
    );
  end if;

  return false;
end;
$function$;

revoke execute on function public.can_see_post(public.posts) from anon, public;
grant  execute on function public.can_see_post(public.posts) to authenticated;

-- =====================================================================
-- 0016_chat_lfp_audience_lifecycle_and_reaction_notif_cleanup
-- =====================================================================

-- (a) A chat-scoped Looking-for-Player post's whole audience is one
-- post_targets row (target_kind 'user' or 'chat'). The FK uses ON DELETE
-- CASCADE, so if the targeted user deletes their account (or the session chat
-- is purged) that row vanishes and the post -- still visibility='friends' --
-- would fall through can_see_post() to the author's friends. Delete the
-- dependent post BEFORE the cascade fires. Only posts whose SOLE audience is
-- the departing user/chat are removed.
CREATE OR REPLACE FUNCTION public.delete_orphaned_chat_scoped_posts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    DELETE FROM public.posts p
    WHERE EXISTS (
      SELECT 1 FROM public.post_targets pt
      WHERE pt.post_id = p.id AND pt.target_kind = 'user' AND pt.target_user_id = OLD.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.post_targets pt2
      WHERE pt2.post_id = p.id
        AND NOT (pt2.target_kind = 'user' AND pt2.target_user_id = OLD.id)
    );
  ELSIF TG_TABLE_NAME = 'chats' THEN
    DELETE FROM public.posts p
    WHERE EXISTS (
      SELECT 1 FROM public.post_targets pt
      WHERE pt.post_id = p.id AND pt.target_kind = 'chat' AND pt.chat_id = OLD.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.post_targets pt2
      WHERE pt2.post_id = p.id
        AND NOT (pt2.target_kind = 'chat' AND pt2.chat_id = OLD.id)
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS profiles_delete_orphaned_chat_posts ON public.profiles;
CREATE TRIGGER profiles_delete_orphaned_chat_posts BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.delete_orphaned_chat_scoped_posts();

DROP TRIGGER IF EXISTS chats_delete_orphaned_chat_posts ON public.chats;
CREATE TRIGGER chats_delete_orphaned_chat_posts BEFORE DELETE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.delete_orphaned_chat_scoped_posts();

-- (b) Reaction notifications are keyed to the message, not the reaction row, so
-- a swap (remove a reaction then add another) or a toggle-off left stale
-- notifications behind. Keep exactly one message_reaction notification per
-- (recipient, actor, message): AFTER INSERT clears any prior one before
-- inserting; a new AFTER DELETE path clears it on toggle-off.
CREATE OR REPLACE FUNCTION public.notify_on_message_reaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sender_id uuid;
BEGIN
  IF NEW.target_type = 'dm' THEN
    SELECT sender_id INTO v_sender_id FROM messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = NEW.user_id AND message_id = NEW.target_id;
    INSERT INTO notifications (user_id, actor_id, type, message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  ELSIF NEW.target_type = 'chat' THEN
    SELECT sender_id INTO v_sender_id FROM chat_messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = NEW.user_id AND chat_message_id = NEW.target_id;
    INSERT INTO notifications (user_id, actor_id, type, chat_message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  ELSIF NEW.target_type = 'group' THEN
    SELECT sender_id INTO v_sender_id FROM group_messages WHERE id = NEW.target_id;
    IF v_sender_id IS NULL OR v_sender_id = NEW.user_id THEN RETURN NEW; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = NEW.user_id AND group_message_id = NEW.target_id;
    INSERT INTO notifications (user_id, actor_id, type, group_message_id, emoji)
    VALUES (v_sender_id, NEW.user_id, 'message_reaction', NEW.target_id, NEW.emoji);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_reactions_notify ON public.message_reactions;
CREATE TRIGGER message_reactions_notify AFTER INSERT ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message_reaction();

CREATE OR REPLACE FUNCTION public.unnotify_on_message_reaction_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sender_id uuid;
BEGIN
  IF OLD.target_type = 'dm' THEN
    SELECT sender_id INTO v_sender_id FROM messages WHERE id = OLD.target_id;
    IF v_sender_id IS NULL THEN RETURN OLD; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = OLD.user_id AND message_id = OLD.target_id;
  ELSIF OLD.target_type = 'chat' THEN
    SELECT sender_id INTO v_sender_id FROM chat_messages WHERE id = OLD.target_id;
    IF v_sender_id IS NULL THEN RETURN OLD; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = OLD.user_id AND chat_message_id = OLD.target_id;
  ELSIF OLD.target_type = 'group' THEN
    SELECT sender_id INTO v_sender_id FROM group_messages WHERE id = OLD.target_id;
    IF v_sender_id IS NULL THEN RETURN OLD; END IF;
    DELETE FROM notifications
      WHERE type = 'message_reaction' AND user_id = v_sender_id
        AND actor_id = OLD.user_id AND group_message_id = OLD.target_id;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS message_reactions_unnotify ON public.message_reactions;
CREATE TRIGGER message_reactions_unnotify AFTER DELETE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.unnotify_on_message_reaction_delete();

-- =====================================================================
-- 0023_club_qr_invite_link
--
-- Reusable QR invite for a CLUB (friend_groups kind='club'). Clubs only
-- supported friend-to-friend invites (friend_group_invites.invitee_id FK to
-- profiles), so there was no way to bring in a NON-user. This adds a stable
-- per-club bearer link: any member surfaces a QR that encodes
-- /club-invite/<token>; the recipient registers (web-first) and lands in the
-- club chat (/chat/group/<chatId>). One link per club (the QR is stable); the
-- token is the credential, so it is NOT consumed on use — many people join
-- from the same code.
-- =====================================================================

CREATE TABLE public.friend_group_invite_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  friend_group_id uuid NOT NULL REFERENCES public.friend_groups(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  created_by_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A reusable QR link is a standing bearer token. It expires so a leaked /
  -- over-shared code stops working on its own; get_or_create slides the window
  -- forward every time a member views the QR, so links in active use never die
  -- while abandoned ones lapse. See CLUB_INVITE_LINK_TTL in the RPCs below.
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT friend_group_invite_links_one_per_group UNIQUE (friend_group_id)
);

ALTER TABLE public.friend_group_invite_links ENABLE ROW LEVEL SECURITY;

-- ---- Club membership cap ------------------------------------------------
-- Clubs grow via an open QR link (any member reshares; any signed-in user
-- auto-joins). Without a ceiling a leaked link could admit thousands, and the
-- per-message push fan-out + chat_participants loads are O(members). Cap club
-- size at the data layer so EVERY insert path is covered — the DEFINER accept
-- RPCs, the owner-only RLS insert, and any future path — in one place.
-- Circles are owner-curated (no open link) and are intentionally exempt.
-- Note: a returning member re-opening the link is exempt, so re-clicks on a
-- full club don't error. The count/insert pair is not serialized, so a burst
-- of simultaneous joins can overshoot the cap by a few — acceptable here.
CREATE OR REPLACE FUNCTION public.enforce_club_member_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind  text;
  v_count integer;
BEGIN
  SELECT kind INTO v_kind FROM friend_groups WHERE id = NEW.friend_group_id;
  IF v_kind IS DISTINCT FROM 'club' THEN
    RETURN NEW;  -- cap applies to clubs only
  END IF;
  -- Existing members pass (re-redeeming the link is a no-op, not a new seat).
  IF EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE friend_group_id = NEW.friend_group_id AND user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM friend_group_members
    WHERE friend_group_id = NEW.friend_group_id;
  IF v_count >= 100 THEN  -- CLUB_MEMBER_CAP
    RAISE EXCEPTION 'Club is full (maximum 100 members)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_club_member_cap ON public.friend_group_members;
CREATE TRIGGER trg_enforce_club_member_cap
  BEFORE INSERT ON public.friend_group_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_club_member_cap();

-- Members may read their club's link to render/re-share the QR. All writes go
-- through the DEFINER RPCs below (no INSERT/UPDATE/DELETE policy = denied).
CREATE POLICY friend_group_invite_links_select_member ON public.friend_group_invite_links
  FOR SELECT TO authenticated
  USING (public.is_friend_group_member(friend_group_id));

-- Fetch-or-create the club's stable QR link. Any member; idempotent.
CREATE OR REPLACE FUNCTION public.get_or_create_club_invite_link(p_friend_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_token   text;
  v_name    text;
  v_owner   uuid;
  v_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.is_friend_group_member(p_friend_group_id) THEN
    RAISE EXCEPTION 'Only a club member can create an invite' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT name, owner_id INTO v_name, v_owner FROM friend_groups WHERE id = p_friend_group_id AND kind = 'club';
  IF v_name IS NULL THEN RAISE EXCEPTION 'Club not found' USING ERRCODE = 'no_data_found'; END IF;

  SELECT token INTO v_token FROM friend_group_invite_links WHERE friend_group_id = p_friend_group_id;
  IF v_token IS NULL THEN
    -- gen_random_uuid (not pgcrypto's gen_random_bytes, which isn't on the
    -- public search_path under Supabase). Two uuids = 256 bits of entropy.
    INSERT INTO friend_group_invite_links (friend_group_id, token, created_by_id)
    VALUES (
      p_friend_group_id,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      v_caller
    )
    ON CONFLICT (friend_group_id) DO UPDATE SET friend_group_id = excluded.friend_group_id
    RETURNING token INTO v_token;
  END IF;

  -- Slide the expiry window forward each time a member surfaces the QR
  -- (CLUB_INVITE_LINK_TTL = 30 days). A link in active use never lapses; a
  -- leaked link nobody reshares expires on its own.
  UPDATE friend_group_invite_links
    SET expires_at = now() + interval '30 days'
    WHERE friend_group_id = p_friend_group_id
    RETURNING expires_at INTO v_expires;

  -- is_owner drives the owner-only "Reset link" action in the UI.
  RETURN jsonb_build_object(
    'token', v_token, 'club_name', v_name,
    'friend_group_id', p_friend_group_id, 'is_owner', v_owner = v_caller,
    'expires_at', v_expires
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_club_invite_link(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_or_create_club_invite_link(uuid) TO authenticated;

-- Reset/rotate the club's QR link (owner-only). Minting a new token instantly
-- invalidates the old QR for everyone, so this is gated on ownership, not mere
-- membership — the escape hatch for a leaked/over-shared code.
CREATE OR REPLACE FUNCTION public.rotate_club_invite_link(p_friend_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_name    text;
  v_token   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT owner_id, name INTO v_owner, v_name FROM friend_groups WHERE id = p_friend_group_id AND kind = 'club';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Club not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_owner <> v_caller THEN
    RAISE EXCEPTION 'Only the club owner can reset the invite link' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO friend_group_invite_links (friend_group_id, token, created_by_id, expires_at)
  VALUES (p_friend_group_id, v_token, v_caller, now() + interval '30 days')
  ON CONFLICT (friend_group_id)
    DO UPDATE SET token = excluded.token, created_by_id = excluded.created_by_id,
                  created_at = now(), expires_at = excluded.expires_at
  RETURNING token, expires_at INTO v_token, v_expires;

  RETURN jsonb_build_object('token', v_token, 'club_name', v_name, 'friend_group_id', p_friend_group_id,
                            'is_owner', true, 'expires_at', v_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_club_invite_link(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.rotate_club_invite_link(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_club_invite_link(uuid) TO authenticated;

-- Public preview of a link (club name + inviter) for the /club-invite landing
-- page, including the not-yet-signed-in case (granted to anon).
CREATE OR REPLACE FUNCTION public.get_club_invite_link(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_link    friend_group_invite_links%ROWTYPE;
  v_name    text;
  v_inviter text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM friend_group_invite_links WHERE token = p_token;
  IF v_link.id IS NULL THEN RETURN NULL; END IF;
  SELECT name INTO v_name FROM friend_groups WHERE id = v_link.friend_group_id;
  SELECT name INTO v_inviter FROM profiles WHERE id = v_link.created_by_id;
  -- expired lets the landing page show a "link expired" state before the
  -- visitor bothers creating an account (accept also re-checks server-side).
  RETURN jsonb_build_object(
    'friend_group_id', v_link.friend_group_id,
    'club_name', COALESCE(v_name, ''),
    'inviter_name', COALESCE(v_inviter, ''),
    'expired', v_link.expires_at < now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_club_invite_link(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_club_invite_link(text) TO anon, authenticated;

-- Redeem a club link: join the club + its chat. Not consumed (reusable). The
-- link creator is notified only when a genuinely new member joins.
CREATE OR REPLACE FUNCTION public.accept_club_invite_link(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_link   friend_group_invite_links%ROWTYPE;
  v_chat   uuid;
  v_added  integer;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN RAISE EXCEPTION 'Missing token' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT * INTO v_link FROM friend_group_invite_links WHERE token = p_token;
  IF v_link.id IS NULL THEN RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_link.expires_at < now() THEN
    RAISE EXCEPTION 'This invite link has expired' USING ERRCODE = 'no_data_found';
  END IF;

  -- The club member cap is enforced by trg_enforce_club_member_cap on this
  -- INSERT: a new member past the cap raises 'Club is full'; an existing
  -- member is exempt, so re-redeeming the link stays a harmless no-op.
  INSERT INTO friend_group_members (friend_group_id, user_id)
  VALUES (v_link.friend_group_id, v_caller)
  ON CONFLICT (friend_group_id, user_id) DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Club chats are created in create_club, but be defensive (mirror accept_club_invite).
  SELECT id INTO v_chat FROM chats WHERE friend_group_id = v_link.friend_group_id;
  IF v_chat IS NULL THEN
    INSERT INTO chats (name, creator_id, friend_group_id)
    SELECT fg.name, fg.owner_id, fg.id FROM friend_groups fg WHERE fg.id = v_link.friend_group_id
    RETURNING id INTO v_chat;
    INSERT INTO chat_participants (chat_id, user_id)
    SELECT v_chat, fgm.user_id FROM friend_group_members fgm WHERE fgm.friend_group_id = v_link.friend_group_id
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO chat_participants (chat_id, user_id)
    VALUES (v_chat, v_caller) ON CONFLICT DO NOTHING;
  END IF;

  IF v_added > 0 THEN
    INSERT INTO notifications (user_id, actor_id, type, friend_group_id)
    VALUES (v_link.created_by_id, v_caller, 'club_invite_accepted', v_link.friend_group_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'friend_group_id', v_link.friend_group_id, 'chat_id', v_chat);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_club_invite_link(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.accept_club_invite_link(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_club_invite_link(text) TO authenticated;

-- =====================================================================
-- team_expenses (consolidated — folds prior steps 0013_group_expenses,
-- 0014_expense_payments, 0015_expense_column_settled,
-- 0016_settle_expense_columns_rpc, 0017_expense_cell_settlements)
-- =====================================================================

-- The team Expenses tab. Widens the per-chat `expenses` table to ALSO be scoped
-- to a TEAM (group) and linked to a match / practice / custom event, adds
-- multiple payers per event (expense_payments), and per-(member, bill)
-- settlement (expense_settlements). Chat "Split a cost" is unchanged: a bill is
-- either chat-scoped (chat_id + payer_id) or group-scoped (group_id), never both
-- — enforced by expenses_scope_check. This step lives at the end of the file so
-- the capability helpers (is_group_member, can_run_group) already exist.
--
-- Net per member for a group column = owed share (expense_shares) − amount paid
-- (expense_payments); a settled cell (expense_settlements row) drops out.

-- ---- expenses: group / event scope ---------------------------------------
ALTER TABLE public.expenses ALTER COLUMN chat_id  DROP NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN payer_id DROP NOT NULL;

ALTER TABLE public.expenses
  ADD COLUMN group_id      uuid REFERENCES public.groups (id)         ON DELETE CASCADE,
  ADD COLUMN created_by_id uuid REFERENCES public.profiles (id)       ON DELETE SET NULL,
  ADD COLUMN source_kind   text,
  ADD COLUMN match_id      uuid REFERENCES public.team_matches (id)   ON DELETE SET NULL,
  ADD COLUMN practice_id   uuid REFERENCES public.team_practices (id) ON DELETE SET NULL,
  ADD COLUMN event_label   text;

-- Exactly one scope: a chat bill or a group bill, never both / neither.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_scope_check CHECK (
    (chat_id IS NOT NULL AND group_id IS NULL)
    OR (chat_id IS NULL AND group_id IS NOT NULL)
  );

-- Chat bills keep a single payer; group bills leave payer_id NULL and record
-- their payers in expense_payments instead.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_chat_payer_check CHECK (chat_id IS NULL OR payer_id IS NOT NULL);

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_source_kind_check CHECK (
    source_kind IS NULL OR source_kind IN ('match', 'practice', 'custom')
  );

-- For group bills, source_kind drives which link column must be set; a custom
-- event carries a free-text label instead of an event id. Chat bills are exempt.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_group_source_check CHECK (
    group_id IS NULL OR (
      (source_kind = 'match'    AND match_id    IS NOT NULL AND practice_id IS NULL) OR
      (source_kind = 'practice' AND practice_id IS NOT NULL AND match_id    IS NULL) OR
      (source_kind = 'custom'   AND match_id IS NULL AND practice_id IS NULL
                                AND event_label IS NOT NULL AND event_label <> '')
    )
  );

CREATE INDEX expenses_group_idx ON public.expenses (group_id, created_at) WHERE group_id IS NOT NULL;

COMMENT ON COLUMN public.expenses.group_id IS
  'Set for team-scoped bills (the Expenses tab). Mutually exclusive with chat_id (expenses_scope_check).';
COMMENT ON COLUMN public.expenses.source_kind IS
  'For group bills: match | practice | custom. Drives which of match_id/practice_id/event_label is set (expenses_group_source_check).';

-- ---- expenses RLS (group scope; ADDITIVE to the existing chat policies) ----
-- Any team member can SEE their team's bills.
CREATE POLICY expenses_select_group_member ON public.expenses FOR SELECT TO authenticated
  USING (group_id IS NOT NULL AND public.is_group_member(group_id));

-- Any team member can ADD a bill; they must stamp themselves as the creator
-- (the payer(s) can be other members).
CREATE POLICY expenses_insert_group_member ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (group_id IS NOT NULL AND public.is_group_member(group_id) AND created_by_id = (SELECT auth.uid()));

-- The bill's creator or a captain/owner can edit or delete it.
CREATE POLICY expenses_update_group_editor ON public.expenses FOR UPDATE TO authenticated
  USING (group_id IS NOT NULL AND (created_by_id = (SELECT auth.uid()) OR public.can_run_group(group_id)))
  WITH CHECK (group_id IS NOT NULL AND (created_by_id = (SELECT auth.uid()) OR public.can_run_group(group_id)));

CREATE POLICY expenses_delete_group_editor ON public.expenses FOR DELETE TO authenticated
  USING (group_id IS NOT NULL AND (created_by_id = (SELECT auth.uid()) OR public.can_run_group(group_id)));

-- ---- expense_shares RLS (group scope) ------------------------------------
CREATE POLICY expense_shares_select_group_member ON public.expense_shares FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_shares.expense_id AND e.group_id IS NOT NULL
                   AND public.is_group_member(e.group_id)));

CREATE POLICY expense_shares_write_group_editor ON public.expense_shares FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_shares.expense_id AND e.group_id IS NOT NULL
                   AND (e.created_by_id = (SELECT auth.uid()) OR public.can_run_group(e.group_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_shares.expense_id AND e.group_id IS NOT NULL
                   AND (e.created_by_id = (SELECT auth.uid()) OR public.can_run_group(e.group_id))));

-- ---- expense_payments: multiple payers per team bill ---------------------
CREATE TABLE public.expense_payments (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),
  constraint expense_payments_unique unique (expense_id, user_id)
);
CREATE INDEX expense_payments_expense_idx ON public.expense_payments (expense_id);

ALTER TABLE public.expense_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY expense_payments_select_group_member ON public.expense_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_payments.expense_id AND e.group_id IS NOT NULL
                   AND public.is_group_member(e.group_id)));

CREATE POLICY expense_payments_write_group_editor ON public.expense_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_payments.expense_id AND e.group_id IS NOT NULL
                   AND (e.created_by_id = (SELECT auth.uid()) OR public.can_run_group(e.group_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_payments.expense_id AND e.group_id IS NOT NULL
                   AND (e.created_by_id = (SELECT auth.uid()) OR public.can_run_group(e.group_id))));

COMMENT ON TABLE public.expense_payments IS
  'Who paid how much toward a team expense (supports multiple payers per event). Chat bills do not use this table — they keep a single expenses.payer_id.';

-- ---- expense_settlements: per-(member, bill) settled cell ----------------
CREATE TABLE public.expense_settlements (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  settled_at  timestamptz not null default now(),
  constraint expense_settlements_unique unique (expense_id, user_id)
);
CREATE INDEX expense_settlements_expense_idx ON public.expense_settlements (expense_id);

ALTER TABLE public.expense_settlements ENABLE ROW LEVEL SECURITY;

-- Members read their team's settlements; writes go through the RPC below.
CREATE POLICY expense_settlements_select_group_member ON public.expense_settlements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e
                 WHERE e.id = expense_settlements.expense_id AND e.group_id IS NOT NULL
                   AND public.is_group_member(e.group_id)));

COMMENT ON TABLE public.expense_settlements IS
  'One row per settled (member, bill) cell: member <user_id> has squared up their part of bill <expense_id>. Settled cells drop out of running net totals / payouts (kept as history in the Grid).';

-- Settle / re-open a set of (expense, member) cells. RLS can't scope an UPDATE
-- to a single column, so settling goes through this SECURITY DEFINER RPC, which
-- re-checks permission per cell — the caller must be involved in that bill
-- (participant or payer) or be the creator / a captain — and only ever touches
-- expense_settlements.
CREATE OR REPLACE FUNCTION public.set_expense_cells_settled(p_pairs jsonb, p_settled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT (x->>'e')::uuid AS expense_id, (x->>'u')::uuid AS user_id
    FROM jsonb_array_elements(p_pairs) x
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = r.expense_id AND e.group_id IS NOT NULL
        AND public.is_group_member(e.group_id)
        AND (
          public.can_run_group(e.group_id)
          OR e.created_by_id = (SELECT auth.uid())
          OR EXISTS (SELECT 1 FROM public.expense_shares s   WHERE s.expense_id = e.id  AND s.user_id  = (SELECT auth.uid()))
          OR EXISTS (SELECT 1 FROM public.expense_payments pm WHERE pm.expense_id = e.id AND pm.user_id = (SELECT auth.uid()))
        )
    ) THEN
      IF p_settled THEN
        INSERT INTO public.expense_settlements (expense_id, user_id)
        VALUES (r.expense_id, r.user_id) ON CONFLICT (expense_id, user_id) DO NOTHING;
      ELSE
        DELETE FROM public.expense_settlements WHERE expense_id = r.expense_id AND user_id = r.user_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_expense_cells_settled(jsonb, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.set_expense_cells_settled(jsonb, boolean) TO authenticated;

-- =========================================================================
-- Court availability alerts
--
-- A user subscribes to a Seattle Parks venue (catalog facility id "tf-N") for
-- a specific day or repeating weekdays, optionally narrowed to a time-of-day
-- window, and is notified (push and/or email) when ANY reservable court at that
-- venue has an open bookable slot. The /api/cron/court-alerts job polls live
-- ActiveNet every ~15 min for just the venues/dates that have active alerts and
-- dispatches; court_alert_sent makes each (alert, date) fire at most once.
-- =========================================================================

-- court_id namespace matches court_reviews / court_availability_reports: the
-- app-side catalog id "tf-N" (data/tennis_courts.json), not a DB table, so no FK.
create table if not exists public.court_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  court_id      text not null,
  mode          text not null check (mode in ('once', 'repeat')),
  -- mode='once': the single bookable date to watch.
  target_date   date,
  -- mode='repeat': JS getDay() values to watch (0=Sun … 6=Sat).
  weekdays      smallint[],
  -- Time-of-day window as "HH:mm" clock strings; null = any time.
  start_time    text,
  end_time      text,
  notify_push   boolean not null default true,
  notify_email  boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  -- Exactly one of (target_date, weekdays) is set, per mode.
  constraint court_alerts_mode_shape check (
    (mode = 'once'   and target_date is not null and weekdays is null) or
    (mode = 'repeat' and weekdays is not null and array_length(weekdays, 1) > 0 and target_date is null)
  ),
  -- At least one delivery channel.
  constraint court_alerts_has_channel check (notify_push or notify_email)
);
create index if not exists court_alerts_active_idx on public.court_alerts (active) where active;
create index if not exists court_alerts_user_idx   on public.court_alerts (user_id, created_at desc);

alter table public.court_alerts enable row level security;

create policy court_alerts_select_self on public.court_alerts
  for select to authenticated using (user_id = (select auth.uid()));
create policy court_alerts_insert_self on public.court_alerts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy court_alerts_update_self on public.court_alerts
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy court_alerts_delete_self on public.court_alerts
  for delete to authenticated using (user_id = (select auth.uid()));

-- Idempotency: one fire per (alert, date). Mirrors reminder_sent — guards
-- against duplicate sends across the overlapping cron ticks of a single
-- opening. Only the service-role cron touches it.
create table if not exists public.court_alert_sent (
  id          uuid primary key default gen_random_uuid(),
  alert_id    uuid not null references public.court_alerts (id) on delete cascade,
  date        date not null,
  created_at  timestamptz not null default now(),
  constraint court_alert_sent_unique unique (alert_id, date)
);
create index if not exists court_alert_sent_alert_idx on public.court_alert_sent (alert_id);
-- RLS on with no policies locks the table to clients; service role bypasses RLS.
alter table public.court_alert_sent enable row level security;

-- In-app bell entry for a fired alert. court_id is the catalog "tf-N" deep-link
-- target (no FK — same reasoning as court_alerts.court_id).
alter type public.notification_type add value if not exists 'court_available';
alter table public.notifications add column if not exists court_id text;

-- pg_cron job (registered out-of-band like the other crons, kept here for
-- reference). Polls /api/cron/court-alerts every 15 min with the cron_secret
-- bearer pulled from Vault:
--   select cron.schedule(
--     'court-alerts-poll', '*/15 * * * *',
--     $$ SELECT net.http_get(
--          url := 'https://mytennisfriends.com/api/cron/court-alerts',
--          headers := jsonb_build_object('Authorization',
--            'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                          WHERE name='cron_secret' LIMIT 1)),
--          timeout_milliseconds := 60000) $$);

-- =========================================================================
-- Personal calendar events
--
-- A user's own manual entries on /calendar, shown alongside find-players
-- games, team matches, and team practices. Private to the owner (RLS self).
-- Wall-clock date/time/timezone strings, matching team_matches/team_practices
-- so the same parsing/reminder helpers apply.
-- =========================================================================
create table if not exists public.personal_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  title            text not null,
  event_date       text not null,                          -- 'YYYY-MM-DD'
  event_time       text not null default '',               -- 'HH:MM' or '' (all-day)
  duration_minutes integer,                                 -- optional
  location         text not null default '',
  -- Optional catalog court link ("tf-N") when the location was picked from the
  -- court typeahead; null for free-text. Mirrors posts.court_facility_id.
  court_facility_id text,
  notes            text not null default '',
  timezone         text not null default 'America/Los_Angeles',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists personal_events_user_date_idx
  on public.personal_events (user_id, event_date);

alter table public.personal_events enable row level security;

create policy personal_events_select_self on public.personal_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy personal_events_insert_self on public.personal_events
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy personal_events_update_self on public.personal_events
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy personal_events_delete_self on public.personal_events
  for delete to authenticated using (user_id = (select auth.uid()));

-- ============== open albums to all members ==============
-- Albums are a shared team space: any member may create (already allowed by
-- albums_insert_member), edit, and add photos. Editing is opened to all members;
-- deleting an album is limited to its creator or a captain (matches the album
-- detail page's canDeleteAlbum = isAlbumCreator || isCaptainOrAbove).
drop policy if exists albums_update_captain on public.albums;
drop policy if exists albums_update_member  on public.albums;
create policy albums_update_member on public.albums
  for update to authenticated
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists albums_delete_captain          on public.albums;
drop policy if exists albums_delete_owner_or_captain on public.albums;
create policy albums_delete_owner_or_captain on public.albums
  for delete to authenticated
  using (public.can_run_group(group_id) or created_by_id = (select auth.uid()));

-- =====================================================================
-- 0019_guest_roster_placeholders
--
-- Lower the signup barrier for the Team feature: a captain can put a
-- teammate's NAME on the roster before that person has an account
-- ("placeholder" member), share a per-person link so they RSVP without
-- registering, and have that slot + its RSVPs fold into a real account
-- when they later sign up. Mirrors the proven expense_shares guest
-- discriminator (migration 0011): a group_members row is now EITHER a
-- real member (user_id) XOR a placeholder (placeholder_name). The
-- availabilities table gains member_id as the universal roster join key
-- so both kinds of member key their RSVP cells the same way.
-- =====================================================================

-- ---- group_members: allow account-less placeholder rows ----
ALTER TABLE public.group_members
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN placeholder_name  text,
  ADD COLUMN placeholder_email citext,        -- captain-only, private, optional
  ADD COLUMN placeholder_phone text,          -- captain-only, private, optional
  ADD COLUMN claim_token       text UNIQUE,   -- per-person magic link / claim credential
  ADD COLUMN claim_expires_at  timestamptz;

-- Real member (user_id) XOR placeholder (placeholder_name) — same shape as
-- expense_shares_identifier_check.
ALTER TABLE public.group_members ADD CONSTRAINT group_members_identity_check CHECK (
  (user_id IS NOT NULL AND placeholder_name IS NULL)
  OR (user_id IS NULL AND placeholder_name IS NOT NULL)
);

-- The existing group_members_unique (group_id, user_id) constraint STAYS:
-- SQL treats NULLs as distinct, so it already permits many placeholder rows
-- (user_id NULL) per group while still keeping real members unique. Keeping
-- it also preserves the many ON CONFLICT (group_id, user_id) upserts in the
-- owner-auto-add trigger, accept_group_invite, etc.
CREATE INDEX group_members_claim_token_idx
  ON public.group_members (claim_token) WHERE claim_token IS NOT NULL;

-- ---- groups: optional shared "self-add" roster link ----
ALTER TABLE public.groups
  ADD COLUMN roster_link_token      text UNIQUE,
  ADD COLUMN roster_link_expires_at timestamptz;

-- ---- availabilities: member_id is the universal roster identity ----
ALTER TABLE public.availabilities
  ADD COLUMN member_id uuid REFERENCES public.group_members(id) ON DELETE CASCADE;

-- Backfill from existing (group,user) pairs. All current rows are real
-- members, so user_id resolves a member row in the event's group.
UPDATE public.availabilities a SET member_id = gm.id
  FROM public.team_matches tm
  JOIN public.group_members gm ON gm.group_id = tm.group_id
  WHERE a.match_id = tm.id AND gm.user_id = a.user_id AND a.event_kind = 'match';
UPDATE public.availabilities a SET member_id = gm.id
  FROM public.team_practices tp
  JOIN public.practice_series ps ON ps.id = tp.series_id
  JOIN public.group_members gm ON gm.group_id = ps.group_id
  WHERE a.practice_id = tp.id AND gm.user_id = a.user_id AND a.event_kind = 'practice';

-- Drop any orphan rows that couldn't be matched (pre-launch, disposable data)
-- so the NOT NULL below can't fail.
DELETE FROM public.availabilities WHERE member_id IS NULL;

ALTER TABLE public.availabilities ALTER COLUMN member_id SET NOT NULL;
-- Placeholders have no user_id; keep user_id denormalized for real members so
-- the existing profiles embed keeps resolving.
ALTER TABLE public.availabilities ALTER COLUMN user_id DROP NOT NULL;

-- Swap the per-event uniqueness from user_id to member_id. Full unique indexes
-- (NOT partial) so ON CONFLICT (match_id, member_id) / (practice_id, member_id)
-- can infer them — and because NULLs are distinct, the inapplicable column
-- (e.g. match_id on a practice row) never causes a false collision, exactly as
-- the original UNIQUE(match_id,user_id)/(practice_id,user_id) constraints did.
ALTER TABLE public.availabilities DROP CONSTRAINT availabilities_match_id_user_id_key;
ALTER TABLE public.availabilities DROP CONSTRAINT availabilities_practice_id_user_id_key;
CREATE UNIQUE INDEX availabilities_match_member_uidx
  ON public.availabilities (match_id, member_id);
CREATE UNIQUE INDEX availabilities_practice_member_uidx
  ON public.availabilities (practice_id, member_id);
CREATE INDEX availabilities_member_idx ON public.availabilities (member_id);

COMMENT ON COLUMN public.group_members.placeholder_name IS
  'Set for account-less placeholder roster members. Mutually exclusive with user_id (group_members_identity_check). Claimed into a real account via claim_roster_placeholder.';
COMMENT ON COLUMN public.availabilities.member_id IS
  'Universal roster identity for the RSVP — references group_members(id) for both real and placeholder members. user_id is a denormalized convenience, NULL for placeholders.';

-- =====================================================================
-- 0020_guest_roster_rpcs
--
-- RPCs for the guest-RSVP flow. Captain-facing ones are gated by
-- can_run_group; guest-facing ones are SECURITY DEFINER and granted to
-- anon, with the per-person claim_token (or the group roster_link_token)
-- acting as the bearer credential — modeled on get_invite_by_token /
-- accept_group_invite. The token scopes every guest read/write to a
-- single roster slot, so anon callers never touch the rest of the team.
-- =====================================================================

-- Captain: bulk-add placeholder members. p_people is a JSON array of
-- objects {name, email?, phone?}. Returns [{id, name, token}].
CREATE OR REPLACE FUNCTION public.add_roster_placeholders(p_group_id uuid, p_people jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_person  jsonb;
  v_name    text;
  v_token   text;
  v_id      uuid;
  v_out     jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can add roster members' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_people) <> 'array' THEN
    RAISE EXCEPTION 'people must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    v_name := trim(coalesce(v_person->>'name', ''));
    CONTINUE WHEN v_name = '';
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.group_members
      (group_id, user_id, roles, placeholder_name, placeholder_email, placeholder_phone,
       claim_token, claim_expires_at)
    VALUES
      (p_group_id, NULL, '{}'::group_member_role[], v_name,
       NULLIF(trim(coalesce(v_person->>'email', '')), '')::citext,
       NULLIF(trim(coalesce(v_person->>'phone', '')), ''),
       v_token, now() + interval '90 days')
    RETURNING id INTO v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_name, 'token', v_token);
  END LOOP;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.add_roster_placeholders(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_placeholders(uuid, jsonb) TO authenticated;

-- Captain: mint (or rotate) the shared self-add roster link. Returns the token.
CREATE OR REPLACE FUNCTION public.mint_roster_link(p_group_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can manage the roster link' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.groups
    SET roster_link_token = v_token, roster_link_expires_at = now() + interval '90 days'
    WHERE id = p_group_id;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.mint_roster_link(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mint_roster_link(uuid) TO authenticated;

-- Captain: revoke the shared self-add link.
CREATE OR REPLACE FUNCTION public.revoke_roster_link(p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can manage the roster link' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.groups SET roster_link_token = NULL, roster_link_expires_at = NULL WHERE id = p_group_id;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_roster_link(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revoke_roster_link(uuid) TO authenticated;

-- Resolve a placeholder group_members row by its claim token, raising on
-- missing / non-placeholder / expired. SECURITY DEFINER helper shared by the
-- guest RPCs (not granted to anyone directly).
CREATE OR REPLACE FUNCTION public.guest_resolve_placeholder(p_token text)
RETURNS public.group_members LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ph public.group_members%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'Missing link' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_ph FROM public.group_members
    WHERE claim_token = p_token AND placeholder_name IS NOT NULL;
  IF v_ph.id IS NULL THEN RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'no_data_found'; END IF;
  IF v_ph.claim_expires_at IS NOT NULL AND v_ph.claim_expires_at < now() THEN
    RAISE EXCEPTION 'This link has expired — ask your captain for a new one' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN v_ph;
END;
$$;
REVOKE ALL ON FUNCTION public.guest_resolve_placeholder(text) FROM public, anon, authenticated;

-- Shared self-add: a guest opens the team roster link and types their name;
-- we create a placeholder and hand back its per-person claim token.
CREATE OR REPLACE FUNCTION public.guest_create_placeholder(p_group_token text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid;
  v_name  text := trim(coalesce(p_name, ''));
  v_count integer;
  v_token text;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'Please enter your name' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT id INTO v_group FROM public.groups
    WHERE roster_link_token = p_group_token
      AND (roster_link_expires_at IS NULL OR roster_link_expires_at > now());
  IF v_group IS NULL THEN RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'no_data_found'; END IF;

  -- Cheap anti-abuse: cap placeholders created through the shared link.
  SELECT count(*) INTO v_count FROM public.group_members
    WHERE group_id = v_group AND placeholder_name IS NOT NULL;
  IF v_count >= 200 THEN RAISE EXCEPTION 'This roster is full' USING ERRCODE = 'check_violation'; END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.group_members (group_id, user_id, roles, placeholder_name, claim_token, claim_expires_at)
  VALUES (v_group, NULL, '{}'::group_member_role[], v_name, v_token, now() + interval '90 days');

  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_create_placeholder(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_create_placeholder(text, text) TO anon, authenticated;

-- Guest read: returns ONLY what the bearer needs — team name/image, their own
-- display name, the upcoming schedule with their own RSVP and aggregate counts.
-- Never returns other members' names or contact info.
CREATE OR REPLACE FUNCTION public.guest_roster_view(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph        public.group_members%ROWTYPE;
  v_group     public.groups%ROWTYPE;
  v_matches   jsonb;
  v_practices jsonb;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);
  SELECT * INTO v_group FROM public.groups WHERE id = v_ph.group_id;

  SELECT coalesce(jsonb_agg(m ORDER BY (m->>'date'), (m->>'time')), '[]'::jsonb) INTO v_matches
  FROM (
    SELECT jsonb_build_object(
      'id', tm.id, 'event_kind', 'match',
      'date', tm.match_date, 'time', tm.match_time, 'location', tm.location,
      'opponent', tm.opponent, 'notes', tm.notes,
      'my_status', (SELECT status FROM public.availabilities WHERE match_id = tm.id AND member_id = v_ph.id),
      'counts', (SELECT jsonb_build_object(
          'playing',     count(*) FILTER (WHERE status = 'playing'),
          'maybe',       count(*) FILTER (WHERE status = 'maybe'),
          'not_playing', count(*) FILTER (WHERE status = 'not_playing'))
        FROM public.availabilities WHERE match_id = tm.id)
    ) AS m
    FROM public.team_matches tm
    WHERE tm.group_id = v_ph.group_id
      -- Keep a match visible through the end of its OWN day: compare against
      -- "today" in the match's timezone, not the server's (UTC) date.
      AND tm.match_date >= (now() AT TIME ZONE coalesce(nullif(tm.timezone, ''), 'America/Los_Angeles'))::date::text
  ) q;

  SELECT coalesce(jsonb_agg(p ORDER BY (p->>'date'), (p->>'time')), '[]'::jsonb) INTO v_practices
  FROM (
    SELECT jsonb_build_object(
      'id', tp.id, 'event_kind', 'practice',
      'date', tp.practice_date, 'time', ps.practice_time, 'location', ps.location,
      'series_name', ps.name,
      'my_status', (SELECT status FROM public.availabilities WHERE practice_id = tp.id AND member_id = v_ph.id),
      'counts', (SELECT jsonb_build_object(
          'playing',     count(*) FILTER (WHERE status = 'playing'),
          'maybe',       count(*) FILTER (WHERE status = 'maybe'),
          'not_playing', count(*) FILTER (WHERE status = 'not_playing'))
        FROM public.availabilities WHERE practice_id = tp.id)
    ) AS p
    FROM public.team_practices tp
    JOIN public.practice_series ps ON ps.id = tp.series_id
    WHERE ps.group_id = v_ph.group_id
      AND tp.practice_date >= (now() AT TIME ZONE coalesce(nullif(tp.timezone, ''), 'America/Los_Angeles'))::date::text
  ) q;

  RETURN jsonb_build_object(
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'image_url', v_group.image_url),
    'member', jsonb_build_object('id', v_ph.id, 'name', v_ph.placeholder_name),
    'matches', v_matches,
    'practices', v_practices
  );
END;
$$;
REVOKE ALL ON FUNCTION public.guest_roster_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_roster_view(text) TO anon, authenticated;

-- Guest write: set the placeholder's RSVP for one event. Validates the event
-- belongs to the placeholder's group (anti-IDOR) and upserts on member_id.
CREATE OR REPLACE FUNCTION public.guest_set_availability(
  p_token text, p_event_kind text, p_event_id uuid, p_status text, p_match_types text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ph public.group_members%ROWTYPE;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);

  IF p_event_kind = 'match' THEN
    IF NOT EXISTS (SELECT 1 FROM public.team_matches WHERE id = p_event_id AND group_id = v_ph.group_id) THEN
      RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO public.availabilities (event_kind, match_id, member_id, user_id, status, match_types)
    VALUES ('match', p_event_id, v_ph.id, NULL, coalesce(p_status, ''), coalesce(p_match_types, ''))
    ON CONFLICT (match_id, member_id) DO UPDATE
      SET status = excluded.status, match_types = excluded.match_types, updated_at = now();
  ELSIF p_event_kind = 'practice' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.team_practices tp JOIN public.practice_series ps ON ps.id = tp.series_id
      WHERE tp.id = p_event_id AND ps.group_id = v_ph.group_id
    ) THEN
      RAISE EXCEPTION 'Event not found' USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO public.availabilities (event_kind, practice_id, member_id, user_id, status)
    VALUES ('practice', p_event_id, v_ph.id, NULL, coalesce(p_status, ''))
    ON CONFLICT (practice_id, member_id) DO UPDATE
      SET status = excluded.status, updated_at = now();
  ELSE
    RAISE EXCEPTION 'Invalid event kind' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_set_availability(text, text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_set_availability(text, text, uuid, text, text) TO anon, authenticated;

-- Guest: fix their own display name (the "wrong name" case) without an account.
CREATE OR REPLACE FUNCTION public.guest_update_name(p_token text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph   public.group_members%ROWTYPE;
  v_name text := trim(coalesce(p_name, ''));
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);
  IF v_name = '' THEN RAISE EXCEPTION 'Please enter a name' USING ERRCODE = 'invalid_parameter_value'; END IF;
  UPDATE public.group_members SET placeholder_name = v_name WHERE id = v_ph.id;
  RETURN jsonb_build_object('ok', true, 'name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_update_name(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_update_name(text, text) TO anon, authenticated;

-- Authenticated: claim a placeholder into the signed-in account. Token is the
-- bearer credential (ignores any email/phone mismatch). CONVERTS the slot in
-- place if the caller isn't already a member of the group; otherwise MERGES the
-- placeholder's RSVPs into the caller's existing membership (existing answer
-- wins on a same-event collision) and removes the placeholder row.
CREATE OR REPLACE FUNCTION public.claim_roster_placeholder(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_ph       public.group_members%ROWTYPE;
  v_existing uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  v_ph := public.guest_resolve_placeholder(p_token);

  SELECT id INTO v_existing FROM public.group_members
    WHERE group_id = v_ph.group_id AND user_id = v_caller;

  IF v_existing IS NULL THEN
    -- CONVERT in place: history is preserved, the row just gains an identity.
    -- Carry the guest's chosen roster name onto the new account when the
    -- profile has no real name yet — an email signup derives name from the
    -- email local part (e.g. "jordan.lee"), which shouldn't replace the name
    -- the captain/guest already set. OAuth signups that bring a real name are
    -- left untouched.
    UPDATE public.profiles p
      SET name = v_ph.placeholder_name
      WHERE p.id = v_caller
        AND v_ph.placeholder_name IS NOT NULL AND btrim(v_ph.placeholder_name) <> ''
        AND (p.name IS NULL OR btrim(p.name) = '' OR p.name = split_part(p.email::text, '@', 1));
    UPDATE public.group_members
      SET user_id = v_caller, placeholder_name = NULL, placeholder_email = NULL,
          placeholder_phone = NULL, claim_token = NULL, claim_expires_at = NULL
      WHERE id = v_ph.id;
    UPDATE public.availabilities SET user_id = v_caller WHERE member_id = v_ph.id;
    UPDATE public.availability_poll_responses SET user_id = v_caller WHERE member_id = v_ph.id;
    RETURN jsonb_build_object('ok', true, 'group_id', v_ph.group_id, 'merged_existing', false);
  END IF;

  -- MERGE: move placeholder RSVPs onto the existing membership where the
  -- existing account has NOT already answered that event (existing wins).
  UPDATE public.availabilities a
    SET member_id = v_existing, user_id = v_caller
    WHERE a.member_id = v_ph.id
      AND NOT EXISTS (
        SELECT 1 FROM public.availabilities b
        WHERE b.member_id = v_existing
          AND b.match_id IS NOT DISTINCT FROM a.match_id
          AND b.practice_id IS NOT DISTINCT FROM a.practice_id
      );
  -- Remaining placeholder RSVPs collided with an existing answer → drop them.
  DELETE FROM public.availabilities WHERE member_id = v_ph.id;

  -- Same merge for poll responses: move where the existing account hasn't
  -- answered this poll (existing wins), then drop the collisions.
  UPDATE public.availability_poll_responses a
    SET member_id = v_existing, user_id = v_caller
    WHERE a.member_id = v_ph.id
      AND NOT EXISTS (
        SELECT 1 FROM public.availability_poll_responses b
        WHERE b.member_id = v_existing AND b.poll_id = a.poll_id
      );
  DELETE FROM public.availability_poll_responses WHERE member_id = v_ph.id;

  -- Remove the now-empty placeholder slot.
  DELETE FROM public.group_members WHERE id = v_ph.id;

  RETURN jsonb_build_object('ok', true, 'group_id', v_ph.group_id, 'merged_existing', true);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_roster_placeholder(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_roster_placeholder(text) TO authenticated;

-- Captain: fetch the per-person share links for every placeholder on the team.
-- claim_token is captain-only (it is the bearer credential), so it is exposed
-- here behind a can_run_group gate rather than in the broadly-readable
-- group_members payload. Returns [{id, name, token, expires_at}].
CREATE OR REPLACE FUNCTION public.get_roster_placeholder_links(p_group_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can view share links' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', placeholder_name, 'token', claim_token, 'expires_at', claim_expires_at
         ) ORDER BY placeholder_name), '[]'::jsonb)
    INTO v_out
    FROM public.group_members
    WHERE group_id = p_group_id AND placeholder_name IS NOT NULL AND archived_at IS NULL;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.get_roster_placeholder_links(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_roster_placeholder_links(uuid) TO authenticated;

-- =====================================================================
-- 0021_guest_poll_responses
--
-- Extend the guest-RSVP feature to availability POLLS: account-less
-- placeholder members can submit their free-form availability blocks via
-- their per-person link, same as match/practice RSVPs. Mirrors 0019/0020:
-- availability_poll_responses gains member_id as the universal roster key,
-- guest RPCs are anon + token-scoped, and claim_roster_placeholder folds
-- poll responses into the new account.
-- =====================================================================

ALTER TABLE public.availability_poll_responses
  ADD COLUMN member_id uuid REFERENCES public.group_members(id) ON DELETE CASCADE;

UPDATE public.availability_poll_responses r SET member_id = gm.id
  FROM public.availability_polls p
  JOIN public.group_members gm ON gm.group_id = p.group_id
  WHERE r.poll_id = p.id AND gm.user_id = r.user_id;

DELETE FROM public.availability_poll_responses WHERE member_id IS NULL;

ALTER TABLE public.availability_poll_responses ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE public.availability_poll_responses ALTER COLUMN user_id DROP NOT NULL;

-- Swap the per-poll uniqueness from user_id to member_id (full index so
-- ON CONFLICT (poll_id, member_id) can infer it).
ALTER TABLE public.availability_poll_responses DROP CONSTRAINT availability_poll_responses_poll_id_user_id_key;
CREATE UNIQUE INDEX availability_poll_responses_poll_member_uidx
  ON public.availability_poll_responses (poll_id, member_id);
CREATE INDEX availability_poll_responses_member_idx
  ON public.availability_poll_responses (member_id);

COMMENT ON COLUMN public.availability_poll_responses.member_id IS
  'Universal roster identity for the poll response — group_members(id) for both real and placeholder members. user_id is denormalized, NULL for placeholders.';

-- Guest read: open polls for the placeholder's team (with at least one
-- upcoming candidate date) + the guest's own blocks per poll.
CREATE OR REPLACE FUNCTION public.guest_poll_view(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph    public.group_members%ROWTYPE;
  v_polls jsonb;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'title', p.title,
           'candidate_dates', p.candidate_dates,
           'min_block_minutes', p.min_block_minutes,
           'min_players', p.min_players,
           'timezone', p.timezone,
           'status', p.status,
           'my_blocks', coalesce(
             (SELECT r.blocks FROM public.availability_poll_responses r
              WHERE r.poll_id = p.id AND r.member_id = v_ph.id), '[]'::jsonb)
         ) ORDER BY p.created_at), '[]'::jsonb)
    INTO v_polls
    FROM public.availability_polls p
    WHERE p.group_id = v_ph.group_id
      AND p.status = 'open'
      AND EXISTS (
        SELECT 1 FROM unnest(p.candidate_dates) d
        WHERE d >= (now() AT TIME ZONE coalesce(nullif(p.timezone, ''), 'America/Los_Angeles'))::date
      );

  RETURN jsonb_build_object('polls', v_polls);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_poll_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_poll_view(text) TO anon, authenticated;

-- Guest write: replace the placeholder's blocks for one open poll. Validates
-- the poll belongs to the placeholder's group and is still open (anti-IDOR).
CREATE OR REPLACE FUNCTION public.guest_set_poll_response(p_token text, p_poll_id uuid, p_blocks jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ph public.group_members%ROWTYPE;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);
  IF jsonb_typeof(p_blocks) <> 'array' THEN
    RAISE EXCEPTION 'blocks must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.availability_polls p
    WHERE p.id = p_poll_id AND p.group_id = v_ph.group_id AND p.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Poll not found or closed' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.availability_poll_responses (poll_id, member_id, user_id, blocks)
  VALUES (p_poll_id, v_ph.id, NULL, p_blocks)
  ON CONFLICT (poll_id, member_id) DO UPDATE
    SET blocks = excluded.blocks, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_set_poll_response(text, uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_set_poll_response(text, uuid, jsonb) TO anon, authenticated;

-- =====================================================================
-- 0022_placeholder_invite_scope
--
-- Scope a placeholder to the surface it was invited from: a guest added
-- from the match table should only see/RSVP matches, not practices or
-- polls. placeholder_scope ∈ {all,match,practice,poll}; NULL = all. The
-- guest_* views gate each section on it. add_roster_placeholders gains a
-- p_scope arg (per-person invites carry the inviting surface's scope);
-- the shared self-add link stays 'all' (a general "join the team" link).
-- =====================================================================

ALTER TABLE public.group_members ADD COLUMN placeholder_scope text;
COMMENT ON COLUMN public.group_members.placeholder_scope IS
  'For placeholders: which surface they were invited to RSVP — all | match | practice | poll. NULL = all.';

-- add_roster_placeholders gains p_scope (default all). Drop the 2-arg form
-- first so the new signature is unambiguous.
DROP FUNCTION IF EXISTS public.add_roster_placeholders(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.add_roster_placeholders(p_group_id uuid, p_people jsonb, p_scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_person jsonb;
  v_name   text;
  v_token  text;
  v_id     uuid;
  v_scope  text := CASE WHEN coalesce(p_scope,'all') IN ('all','match','practice','poll')
                        THEN coalesce(p_scope,'all') ELSE 'all' END;
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can add roster members' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_people) <> 'array' THEN
    RAISE EXCEPTION 'people must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    v_name := trim(coalesce(v_person->>'name', ''));
    CONTINUE WHEN v_name = '';
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.group_members
      (group_id, user_id, roles, placeholder_name, placeholder_email, placeholder_phone,
       placeholder_scope, claim_token, claim_expires_at)
    VALUES
      (p_group_id, NULL, '{}'::group_member_role[], v_name,
       NULLIF(trim(coalesce(v_person->>'email', '')), '')::citext,
       NULLIF(trim(coalesce(v_person->>'phone', '')), ''),
       v_scope, v_token, now() + interval '90 days')
    RETURNING id INTO v_id;
    v_out := v_out || jsonb_build_object('id', v_id, 'name', v_name, 'token', v_token);
  END LOOP;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.add_roster_placeholders(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_placeholders(uuid, jsonb, text) TO authenticated;

-- guest_roster_view: gate matches/practices on the placeholder's scope.
CREATE OR REPLACE FUNCTION public.guest_roster_view(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph        public.group_members%ROWTYPE;
  v_group     public.groups%ROWTYPE;
  v_scope     text;
  v_matches   jsonb;
  v_practices jsonb;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);
  v_scope := coalesce(v_ph.placeholder_scope, 'all');
  SELECT * INTO v_group FROM public.groups WHERE id = v_ph.group_id;

  SELECT coalesce(jsonb_agg(m ORDER BY (m->>'date'), (m->>'time')), '[]'::jsonb) INTO v_matches
  FROM (
    SELECT jsonb_build_object(
      'id', tm.id, 'event_kind', 'match',
      'date', tm.match_date, 'time', tm.match_time, 'location', tm.location,
      'opponent', tm.opponent, 'notes', tm.notes,
      'my_status', (SELECT status FROM public.availabilities WHERE match_id = tm.id AND member_id = v_ph.id),
      'counts', (SELECT jsonb_build_object(
          'playing',     count(*) FILTER (WHERE status = 'playing'),
          'maybe',       count(*) FILTER (WHERE status = 'maybe'),
          'not_playing', count(*) FILTER (WHERE status = 'not_playing'))
        FROM public.availabilities WHERE match_id = tm.id)
    ) AS m
    FROM public.team_matches tm
    WHERE tm.group_id = v_ph.group_id
      AND v_scope IN ('all','match')
      AND tm.match_date >= (now() AT TIME ZONE coalesce(nullif(tm.timezone, ''), 'America/Los_Angeles'))::date::text
  ) q;

  SELECT coalesce(jsonb_agg(p ORDER BY (p->>'date'), (p->>'time')), '[]'::jsonb) INTO v_practices
  FROM (
    SELECT jsonb_build_object(
      'id', tp.id, 'event_kind', 'practice',
      'date', tp.practice_date, 'time', ps.practice_time, 'location', ps.location,
      'series_name', ps.name,
      'my_status', (SELECT status FROM public.availabilities WHERE practice_id = tp.id AND member_id = v_ph.id),
      'counts', (SELECT jsonb_build_object(
          'playing',     count(*) FILTER (WHERE status = 'playing'),
          'maybe',       count(*) FILTER (WHERE status = 'maybe'),
          'not_playing', count(*) FILTER (WHERE status = 'not_playing'))
        FROM public.availabilities WHERE practice_id = tp.id)
    ) AS p
    FROM public.team_practices tp
    JOIN public.practice_series ps ON ps.id = tp.series_id
    WHERE ps.group_id = v_ph.group_id
      AND v_scope IN ('all','practice')
      AND tp.practice_date >= (now() AT TIME ZONE coalesce(nullif(tp.timezone, ''), 'America/Los_Angeles'))::date::text
  ) q;

  RETURN jsonb_build_object(
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'image_url', v_group.image_url),
    'member', jsonb_build_object('id', v_ph.id, 'name', v_ph.placeholder_name),
    'matches', v_matches,
    'practices', v_practices
  );
END;
$$;
REVOKE ALL ON FUNCTION public.guest_roster_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_roster_view(text) TO anon, authenticated;

-- guest_poll_view: only when the placeholder's scope includes polls.
CREATE OR REPLACE FUNCTION public.guest_poll_view(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph    public.group_members%ROWTYPE;
  v_polls jsonb;
BEGIN
  v_ph := public.guest_resolve_placeholder(p_token);
  IF coalesce(v_ph.placeholder_scope, 'all') NOT IN ('all','poll') THEN
    RETURN jsonb_build_object('polls', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'title', p.title,
           'candidate_dates', p.candidate_dates,
           'min_block_minutes', p.min_block_minutes,
           'min_players', p.min_players,
           'timezone', p.timezone,
           'status', p.status,
           'my_blocks', coalesce(
             (SELECT r.blocks FROM public.availability_poll_responses r
              WHERE r.poll_id = p.id AND r.member_id = v_ph.id), '[]'::jsonb)
         ) ORDER BY p.created_at), '[]'::jsonb)
    INTO v_polls
    FROM public.availability_polls p
    WHERE p.group_id = v_ph.group_id
      AND p.status = 'open'
      AND EXISTS (
        SELECT 1 FROM unnest(p.candidate_dates) d
        WHERE d >= (now() AT TIME ZONE coalesce(nullif(p.timezone, ''), 'America/Los_Angeles'))::date
      );

  RETURN jsonb_build_object('polls', v_polls);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_poll_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_poll_view(text) TO anon, authenticated;

-- =========================================================================
-- 0021_guest_rsvp_find_players
-- =========================================================================
-- Guest RSVP for "Looking for players" (find_players) posts. Non-members
-- respond via the public /p/[id] link without an account. Mirrors the
-- team-roster guest pattern: nullable user_id + a guest discriminator,
-- written through a SECURITY DEFINER RPC granted to anon. Their response
-- lands in the host's "View Requests" list and the normal approve/decline
-- flow; an approved guest counts toward players_confirmed like a member.

-- ---- play_requests: allow accountless (guest) responders -----------------
ALTER TABLE public.play_requests ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.play_requests ADD COLUMN IF NOT EXISTS guest_name    text;
ALTER TABLE public.play_requests ADD COLUMN IF NOT EXISTS guest_contact text;
ALTER TABLE public.play_requests ADD COLUMN IF NOT EXISTS guest_token   text;

-- exactly one identity: member (user_id) XOR guest (guest_name)
ALTER TABLE public.play_requests
  ADD CONSTRAINT play_requests_identity_check
  CHECK (num_nonnulls(user_id, guest_name) = 1);

-- opaque bearer token for a guest row (dedupe / future manage+claim)
CREATE UNIQUE INDEX IF NOT EXISTS play_requests_guest_token_key
  ON public.play_requests (guest_token) WHERE guest_token IS NOT NULL;

COMMENT ON COLUMN public.play_requests.guest_name IS
  'Accountless responder display name. Set (with user_id NULL) for guest RSVPs from the public /p/[id] link. XOR with user_id via play_requests_identity_check.';
COMMENT ON COLUMN public.play_requests.guest_contact IS
  'Optional host-visible phone/email a guest leaves so the organizer can reach them.';
COMMENT ON COLUMN public.play_requests.guest_token IS
  'Opaque bearer token returned to a guest at RSVP time; enables a later manage/withdraw or claim-to-account flow.';

-- ---- notifications: allow a guest (profile-less) actor -------------------
ALTER TABLE public.notifications ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_guest_name text;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_actor_identity_check
  CHECK (actor_id IS NOT NULL OR actor_guest_name IS NOT NULL);

COMMENT ON COLUMN public.notifications.actor_guest_name IS
  'Display name for an actor with no profile (e.g. a guest RSVP). Read as a fallback when actor_id is NULL.';

-- ---- notify_on_join_request: carry a guest actor ------------------------
CREATE OR REPLACE FUNCTION public.notify_on_join_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_author_id uuid;
BEGIN
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL THEN RETURN NEW; END IF;
  -- self-join guard only applies to real members
  IF NEW.user_id IS NOT NULL AND v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, post_id, actor_guest_name)
  VALUES (
    v_author_id, NEW.user_id, 'join_request', NEW.post_id,
    CASE WHEN NEW.user_id IS NULL THEN NEW.guest_name ELSE NULL END
  );
  RETURN NEW;
END;
$$;

-- ---- notify_on_join_request_reapply: same guest handling ----------------
CREATE OR REPLACE FUNCTION public.notify_on_join_request_reapply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_author_id uuid;
BEGIN
  IF NEW.status <> 'pending' OR OLD.status = 'pending'
     OR OLD.status NOT IN ('rejected','withdrawn','removed') THEN
    RETURN NEW;
  END IF;
  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.user_id IS NOT NULL AND v_author_id = NEW.user_id THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, actor_id, type, post_id, actor_guest_name)
  VALUES (
    v_author_id, NEW.user_id, 'join_request', NEW.post_id,
    CASE WHEN NEW.user_id IS NULL THEN NEW.guest_name ELSE NULL END
  );
  RETURN NEW;
END;
$$;

-- ---- notify_on_play_request_response: skip guests (no device) -----------
CREATE OR REPLACE FUNCTION public.notify_on_play_request_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_author_id uuid;
  v_notif_type notification_type;
BEGIN
  IF OLD.status <> 'pending' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;
  -- guests have no account/device to receive an approval notification
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT author_id INTO v_author_id FROM posts WHERE id = NEW.post_id;
  IF v_author_id IS NULL OR v_author_id = NEW.user_id THEN RETURN NEW; END IF;

  v_notif_type := CASE NEW.status WHEN 'approved' THEN 'request_approved'::notification_type
                                  ELSE 'request_rejected'::notification_type END;
  INSERT INTO notifications (user_id, actor_id, type, post_id)
  VALUES (NEW.user_id, v_author_id, v_notif_type, NEW.post_id);
  RETURN NEW;
END;
$$;

-- ---- create_session_chat_on_complete: don't add guests as participants,
--      but still surface their names in the chat + confirmation message ----
CREATE OR REPLACE FUNCTION public.create_session_chat_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_chat_id      uuid;
  v_play_dt      timestamptz;
  v_session_end  timestamptz;
  v_chat_name    text;
  v_players      text;
  v_guests       text;
  v_message      text;
  v_duration     integer;
  v_location     text;
  v_location_md  text;
BEGIN
  IF NEW.is_complete IS NOT TRUE OR NEW.post_type <> 'find_players' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_play_dt := ((NEW.play_date || ' ' || NEW.play_time || ':00')::timestamp
                  AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'));
  EXCEPTION WHEN OTHERS THEN
    v_play_dt := now() + interval '24 hours';
  END;
  v_duration := COALESCE(NULLIF(NEW.play_duration, 0), 90);
  v_session_end := v_play_dt + (v_duration || ' minutes')::interval;
  v_location := COALESCE(NULLIF(NEW.court_location, ''), 'TBD');
  v_location_md := CASE
    WHEN NEW.court_facility_id IS NOT NULL AND NULLIF(NEW.court_location, '') IS NOT NULL
      THEN '[' || NEW.court_location || '](/courts?selected=' || NEW.court_facility_id || ')'
    ELSE v_location
  END;

  v_chat_name := trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'Mon FMDD')) || ' · '
              || v_location || ' · '
              || trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'FMHH12:MI AM'));

  -- approved accountless guests (no profile → not chat participants, but
  -- listed alongside manual players)
  SELECT string_agg(guest_name, ', ' ORDER BY created_at)
    INTO v_guests
    FROM public.play_requests
    WHERE post_id = NEW.id AND status = 'approved' AND user_id IS NULL;

  INSERT INTO public.chats (name, creator_id, post_id, session_end_at, manual_player_names)
  VALUES (
    v_chat_name, NEW.author_id, NEW.id, v_session_end,
    concat_ws(', ', NULLIF(NEW.manual_players, ''), NULLIF(v_guests, ''))
  )
  ON CONFLICT (post_id) WHERE post_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_chat_id;
  IF v_chat_id IS NULL THEN RETURN NEW; END IF;

  -- only real (account-backed) approved players become chat participants
  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT v_chat_id, NEW.author_id
  UNION
  SELECT v_chat_id, pr.user_id
  FROM public.play_requests pr
  WHERE pr.post_id = NEW.id AND pr.status = 'approved' AND pr.user_id IS NOT NULL;

  SELECT string_agg(name, ', ' ORDER BY ord) INTO v_players FROM (
    SELECT p.name, 0 AS ord
    FROM public.profiles p WHERE p.id = NEW.author_id
    UNION ALL
    SELECT p.name, ROW_NUMBER() OVER (ORDER BY pr.created_at) AS ord
    FROM public.play_requests pr
    JOIN public.profiles p ON p.id = pr.user_id
    WHERE pr.post_id = NEW.id AND pr.status = 'approved'
  ) s;

  v_players := concat_ws(
    ', ',
    NULLIF(v_players, ''),
    NULLIF(NEW.manual_players, ''),
    NULLIF(v_guests, '')
  );

  v_message := E'🎾 Game confirmed!\n'
            || E'📅 ' || trim(to_char(v_play_dt AT TIME ZONE COALESCE(NULLIF(NEW.play_timezone, ''), 'America/Los_Angeles'), 'Mon FMDD at FMHH12:MI AM'))
            || ' (' || v_duration || E' min)\n'
            || E'📍 ' || v_location_md || E'\n'
            || 'Players: ' || COALESCE(v_players, '') || E'\n\n'
            || 'See you on court!';

  INSERT INTO public.chat_messages (chat_id, sender_id, content)
  VALUES (v_chat_id, NEW.author_id, v_message);

  RETURN NEW;
END;
$$;

-- ---- push for join_request (guest + member) -----------------------------
-- join_request previously produced a bell notification but no push. Add a
-- push on the notifications row so hosts are alerted for both guest and
-- member RSVPs. Actor name falls back to the stored guest name.
CREATE OR REPLACE FUNCTION public.push_on_join_request_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_actor_name text;
BEGIN
  IF NEW.actor_id IS NOT NULL THEN
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = NEW.actor_id;
  END IF;
  v_actor_name := COALESCE(NULLIF(trim(v_actor_name), ''), NULLIF(trim(NEW.actor_guest_name), ''), 'Someone');
  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  jsonb_build_array(NEW.user_id),
      'title',     v_actor_name,
      'body',      'wants to join your game',
      'thread_id', 'join:' || NEW.post_id::text,
      'data',      jsonb_build_object(
                     'kind',    'join_request',
                     'post_id', NEW.post_id::text
                   )
    )
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notifications_push_join_request ON public.notifications;
CREATE TRIGGER notifications_push_join_request
  AFTER INSERT ON public.notifications
  FOR EACH ROW WHEN (NEW.type = 'join_request')
  EXECUTE FUNCTION public.push_on_join_request_insert();

-- ---- RPC: guest_join_post (anon) ----------------------------------------
CREATE OR REPLACE FUNCTION public.guest_join_post(
  p_post_id uuid,
  p_name    text,
  p_contact text DEFAULT NULL,
  p_note    text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_post    public.posts%ROWTYPE;
  v_name    text := trim(COALESCE(p_name, ''));
  v_contact text := NULLIF(trim(COALESCE(p_contact, '')), '');
  v_note    text := COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), '');
  v_count   integer;
  v_token   text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Please enter your name' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The unguessable post UUID is the capability (same trust model the
  -- public page relies on). Only find_players posts are shareable/publicly
  -- viewable, so scope guest RSVPs to that type.
  SELECT * INTO v_post FROM public.posts WHERE id = p_post_id;
  IF v_post.id IS NULL OR v_post.post_type <> 'find_players' THEN
    RAISE EXCEPTION 'This game is no longer available' USING ERRCODE = 'no_data_found';
  END IF;

  -- bound abuse through the public link
  SELECT count(*) INTO v_count FROM public.play_requests
    WHERE post_id = p_post_id AND user_id IS NULL;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'This game is not accepting more guest responses' USING ERRCODE = 'check_violation';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.play_requests (post_id, user_id, guest_name, guest_contact, guest_token, status, note)
  VALUES (p_post_id, NULL, v_name, v_contact, v_token, 'pending', v_note);

  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_join_post(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_join_post(uuid, text, text, text) TO anon, authenticated;

-- =====================================================================
-- 0022_link_roster_placeholder_to_friend
--
-- Let a captain attach an account-less roster placeholder (created by a
-- USTA import or manual add) to an existing app user who is one of their
-- friends — instead of only being able to share a per-person claim link.
-- Reuses the exact convert/merge logic that claim_roster_placeholder used
-- inline, now extracted into a shared helper so both paths stay in sync.
-- The linked friend gets a bell notification + push.
-- =====================================================================

-- New notification kind + a team FK so the bell item can deep-link to the
-- team. (ADD VALUE must be committed before the RPC below references it;
-- apply this block as its own migration step ahead of the functions.)
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'team_linked';
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE;

-- Shared core: move a placeholder roster slot onto p_target.
-- CONVERTS the slot in place when the target isn't already a member (history
-- preserved, the row just gains an identity); otherwise MERGES the placeholder's
-- RSVPs/poll responses into the target's existing membership (existing answer
-- wins on collision) and deletes the empty placeholder. Returns whether it
-- merged into an existing membership. NOT client-callable — only the two
-- SECURITY DEFINER wrappers (claim_roster_placeholder / link_roster_placeholder)
-- invoke it, each enforcing its own authorization first.
CREATE OR REPLACE FUNCTION public._merge_placeholder_into_user(p_member_id uuid, p_target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ph       public.group_members%ROWTYPE;
  v_existing uuid;
BEGIN
  SELECT * INTO v_ph FROM public.group_members WHERE id = p_member_id;
  IF v_ph.id IS NULL THEN
    RAISE EXCEPTION 'Roster spot not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ph.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This roster spot already has an account' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_existing FROM public.group_members
    WHERE group_id = v_ph.group_id AND user_id = p_target;

  IF v_existing IS NULL THEN
    -- CONVERT in place. Carry the roster name onto the account only when the
    -- profile has no real name yet (email signups derive name from the email
    -- local part) — never overwrite a real name a linked friend already has.
    UPDATE public.profiles p
      SET name = v_ph.placeholder_name
      WHERE p.id = p_target
        AND v_ph.placeholder_name IS NOT NULL AND btrim(v_ph.placeholder_name) <> ''
        AND (p.name IS NULL OR btrim(p.name) = '' OR p.name = split_part(p.email::text, '@', 1));
    UPDATE public.group_members
      SET user_id = p_target, placeholder_name = NULL, placeholder_email = NULL,
          placeholder_phone = NULL, claim_token = NULL, claim_expires_at = NULL
      WHERE id = v_ph.id;
    UPDATE public.availabilities SET user_id = p_target WHERE member_id = v_ph.id;
    UPDATE public.availability_poll_responses SET user_id = p_target WHERE member_id = v_ph.id;
    RETURN false;
  END IF;

  -- MERGE: move placeholder RSVPs onto the existing membership where the
  -- existing account has NOT already answered that event (existing wins).
  UPDATE public.availabilities a
    SET member_id = v_existing, user_id = p_target
    WHERE a.member_id = v_ph.id
      AND NOT EXISTS (
        SELECT 1 FROM public.availabilities b
        WHERE b.member_id = v_existing
          AND b.match_id IS NOT DISTINCT FROM a.match_id
          AND b.practice_id IS NOT DISTINCT FROM a.practice_id
      );
  DELETE FROM public.availabilities WHERE member_id = v_ph.id;

  UPDATE public.availability_poll_responses a
    SET member_id = v_existing, user_id = p_target
    WHERE a.member_id = v_ph.id
      AND NOT EXISTS (
        SELECT 1 FROM public.availability_poll_responses b
        WHERE b.member_id = v_existing AND b.poll_id = a.poll_id
      );
  DELETE FROM public.availability_poll_responses WHERE member_id = v_ph.id;

  DELETE FROM public.group_members WHERE id = v_ph.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._merge_placeholder_into_user(uuid, uuid) FROM public, anon, authenticated;

-- Reworked to delegate the convert/merge to the shared helper (behavior
-- unchanged: token is the bearer credential, folds RSVPs into the caller).
CREATE OR REPLACE FUNCTION public.claim_roster_placeholder(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_ph     public.group_members%ROWTYPE;
  v_merged boolean;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  v_ph := public.guest_resolve_placeholder(p_token);
  v_merged := public._merge_placeholder_into_user(v_ph.id, v_caller);
  RETURN jsonb_build_object('ok', true, 'group_id', v_ph.group_id, 'merged_existing', v_merged);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_roster_placeholder(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_roster_placeholder(text) TO authenticated;

-- Captain: link a placeholder slot to an existing FRIEND's account. Captain-
-- gated (can_run_group) and friends-only (an accepted friendship between the
-- caller and the target is required — enforced here, not just in the UI). On a
-- fresh convert (target wasn't already a member) the friend gets a team_linked
-- notification + push; a merge into an existing membership stays silent.
CREATE OR REPLACE FUNCTION public.link_roster_placeholder(p_member_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_group      uuid;
  v_is_ph      boolean;
  v_merged     boolean;
  v_team_name  text;
  v_actor_name text;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;

  SELECT group_id, (user_id IS NULL) INTO v_group, v_is_ph
    FROM public.group_members WHERE id = p_member_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'Roster spot not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_run_group(v_group) THEN
    RAISE EXCEPTION 'Only team captains can link roster members' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT v_is_ph THEN
    RAISE EXCEPTION 'This roster spot already has an account' USING ERRCODE = 'check_violation';
  END IF;

  -- Friends-only gate: accepted friendship in either direction.
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'accepted'
      AND ( (f.requester_id = v_caller AND f.addressee_id = p_user_id)
         OR (f.requester_id = p_user_id AND f.addressee_id = v_caller) )
  ) THEN
    RAISE EXCEPTION 'You can only link teammates you are friends with' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_merged := public._merge_placeholder_into_user(p_member_id, p_user_id);

  IF NOT v_merged THEN
    SELECT name INTO v_team_name FROM public.groups   WHERE id = v_group;
    SELECT name INTO v_actor_name FROM public.profiles WHERE id = v_caller;
    INSERT INTO public.notifications (user_id, actor_id, type, group_id)
    VALUES (p_user_id, v_caller, 'team_linked'::notification_type, v_group);
    PERFORM public.invoke_edge_function(
      'push-fanout',
      jsonb_build_object(
        'user_ids',  jsonb_build_array(p_user_id),
        'title',     COALESCE(NULLIF(btrim(v_actor_name), ''), 'A teammate'),
        'body',      'added you to ' || COALESCE(v_team_name, 'a team'),
        'thread_id', 'team_linked:' || v_group::text,
        'data',      jsonb_build_object('kind', 'team_linked', 'group_id', v_group::text)
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'group_id', v_group, 'merged_existing', v_merged);
END;
$$;
REVOKE ALL ON FUNCTION public.link_roster_placeholder(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.link_roster_placeholder(uuid, uuid) TO authenticated;

-- =====================================================================
-- 0023_roster_placeholder_dedup
--
-- Stop stacking duplicate account-less placeholders (the Love Hurts 1 bug):
-- the shared self-add link reuses an existing same-name placeholder's link,
-- and captain add-by-name / USTA import skip names already on the roster.
-- =====================================================================

-- Shared name normalizer (mirrors client normalizeName in src/lib/rosterMatch.ts):
-- trim, collapse internal whitespace, lowercase.
CREATE OR REPLACE FUNCTION public._norm_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')))
$$;

-- Shared self-add link: reuse an existing same-name placeholder instead of
-- stacking a duplicate. Refreshes the reused link's expiry so it stays valid.
CREATE OR REPLACE FUNCTION public.guest_create_placeholder(p_group_token text, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group          uuid;
  v_name           text := trim(coalesce(p_name, ''));
  v_count          integer;
  v_token          text;
  v_existing_id    uuid;
  v_existing_token text;
BEGIN
  IF v_name = '' THEN RAISE EXCEPTION 'Please enter your name' USING ERRCODE = 'invalid_parameter_value'; END IF;
  SELECT id INTO v_group FROM public.groups
    WHERE roster_link_token = p_group_token
      AND (roster_link_expires_at IS NULL OR roster_link_expires_at > now());
  IF v_group IS NULL THEN RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'no_data_found'; END IF;

  -- Dedup: if this name is already on the roster as a placeholder, return that
  -- person's existing link rather than creating another slot.
  SELECT id, claim_token INTO v_existing_id, v_existing_token
    FROM public.group_members
    WHERE group_id = v_group AND archived_at IS NULL AND placeholder_name IS NOT NULL
      AND public._norm_name(placeholder_name) = public._norm_name(v_name)
    ORDER BY created_at LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.group_members
      SET claim_expires_at = now() + interval '90 days'
      WHERE id = v_existing_id;
    RETURN jsonb_build_object('token', v_existing_token);
  END IF;

  -- Cheap anti-abuse: cap placeholders created through the shared link.
  SELECT count(*) INTO v_count FROM public.group_members
    WHERE group_id = v_group AND placeholder_name IS NOT NULL;
  IF v_count >= 200 THEN RAISE EXCEPTION 'This roster is full' USING ERRCODE = 'check_violation'; END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.group_members (group_id, user_id, roles, placeholder_name, claim_token, claim_expires_at)
  VALUES (v_group, NULL, '{}'::group_member_role[], v_name, v_token, now() + interval '90 days');

  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_create_placeholder(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_create_placeholder(text, text) TO anon, authenticated;

-- Captain add-by-name / USTA import: skip names already on the roster (as a
-- placeholder or a real member) instead of duplicating. Returns
-- { created: [{id,name,token}...], skipped: [name...] }.
CREATE OR REPLACE FUNCTION public.add_roster_placeholders(p_group_id uuid, p_people jsonb, p_scope text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_person  jsonb;
  v_name    text;
  v_norm    text;
  v_token   text;
  v_id      uuid;
  v_scope   text := CASE WHEN coalesce(p_scope,'all') IN ('all','match','practice','poll')
                         THEN coalesce(p_scope,'all') ELSE 'all' END;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NOT public.can_run_group(p_group_id) THEN
    RAISE EXCEPTION 'Only team captains can add roster members' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_people) <> 'array' THEN
    RAISE EXCEPTION 'people must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    v_name := trim(coalesce(v_person->>'name', ''));
    CONTINUE WHEN v_name = '';
    v_norm := public._norm_name(v_name);

    -- Skip if this name already matches a placeholder or real member on the roster.
    IF EXISTS (
      SELECT 1 FROM public.group_members gm
      LEFT JOIN public.profiles p ON p.id = gm.user_id
      WHERE gm.group_id = p_group_id AND gm.archived_at IS NULL
        AND public._norm_name(coalesce(gm.placeholder_name, p.name)) = v_norm
    ) THEN
      v_skipped := v_skipped || to_jsonb(v_name);
      CONTINUE;
    END IF;

    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.group_members
      (group_id, user_id, roles, placeholder_name, placeholder_email, placeholder_phone,
       placeholder_scope, claim_token, claim_expires_at)
    VALUES
      (p_group_id, NULL, '{}'::group_member_role[], v_name,
       NULLIF(trim(coalesce(v_person->>'email', '')), '')::citext,
       NULLIF(trim(coalesce(v_person->>'phone', '')), ''),
       v_scope, v_token, now() + interval '90 days')
    RETURNING id INTO v_id;
    v_created := v_created || jsonb_build_object('id', v_id, 'name', v_name, 'token', v_token);
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.add_roster_placeholders(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_roster_placeholders(uuid, jsonb, text) TO authenticated;

-- =========================================================================
-- Community teams phase 1: USTA league identity per season
--
-- A USTA team is effectively re-registered each season: division, NTRP
-- level, flight, and even lineup format can all change year to year — so
-- league identity lives on `seasons`, not `groups`. All columns nullable:
-- casual/non-USTA teams are unaffected. `lineup_format` is stored as data,
-- not code, because USTA formats vary by division, level, section, AND
-- championship year (e.g. PNW 40&O plays 1S+3D locally vs 1S+4D at
-- national championships).
-- =========================================================================
alter table public.seasons
  add column league_division  text,
  add column rating_scheme    text,
  add column league_level     numeric,
  add column flight           text,
  add column usta_team_number text,
  add column area             text,
  add column lineup_format    jsonb;

alter table public.seasons
  add constraint seasons_rating_scheme_check
    check (rating_scheme is null or rating_scheme in ('straight', 'combined')),
  add constraint seasons_league_division_check
    check (league_division is null or league_division in
      ('adult_18', 'adult_40', 'adult_55', 'adult_65', 'mixed_18', 'mixed_40', 'combo', 'tri_level', 'other'));

comment on column public.seasons.league_level is
  'Team NTRP level. straight scheme = individual rating cap (e.g. 3.5); combined scheme = pair-sum level (e.g. 7.0 for Mixed/55&O).';
comment on column public.seasons.lineup_format is
  'Ordered lineup slots for a team match, e.g. [{"code":"S1","type":"singles"},{"code":"D1","type":"doubles"}]. Null = free-form slots (legacy behavior). Stored as data, not code: USTA formats vary by division, level, section, and championship year.';

-- =========================================================================
-- Direct roster adds were silent: a manager inserting a friend straight into
-- group_members (create-team form, Settings → Roster → Add friends) gave the
-- friend no signal at all — they only discovered the team by opening the app.
-- Mirror the link_roster_placeholder behavior: notify + push the added user.
-- Trigger-level so every direct-add surface (present and future) is covered.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.notify_on_group_member_added()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_team_name  text;
  v_actor_name text;
BEGIN
  -- Notify only real accounts added by SOMEONE ELSE in an authenticated
  -- session:
  --   - placeholder rows (user_id NULL) have nobody to notify;
  --   - self-inserts (owner auto-add trigger, invite acceptance, guest
  --     claims) are the user's own action;
  --   - service-role/admin inserts have no auth.uid() — skip rather than
  --     misattribute.
  IF NEW.user_id IS NULL OR v_actor IS NULL OR NEW.user_id = v_actor THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_team_name  FROM public.groups   WHERE id = NEW.group_id;
  SELECT name INTO v_actor_name FROM public.profiles WHERE id = v_actor;

  -- Reuses the existing team_linked type — the notifications UI already
  -- renders it ("added you to their team — tap to RSVP") and deep-links to
  -- the team.
  INSERT INTO public.notifications (user_id, actor_id, type, group_id)
  VALUES (NEW.user_id, v_actor, 'team_linked'::notification_type, NEW.group_id);

  PERFORM public.invoke_edge_function(
    'push-fanout',
    jsonb_build_object(
      'user_ids',  jsonb_build_array(NEW.user_id),
      'title',     COALESCE(NULLIF(btrim(v_actor_name), ''), 'A teammate'),
      'body',      'added you to ' || COALESCE(v_team_name, 'a team'),
      'thread_id', 'team_linked:' || NEW.group_id::text,
      'data',      jsonb_build_object('kind', 'team_linked', 'group_id', NEW.group_id::text)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_members_notify_added ON public.group_members;
CREATE TRIGGER group_members_notify_added
  AFTER INSERT ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_group_member_added();
