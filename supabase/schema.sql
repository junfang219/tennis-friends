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
create type public.post_type                 as enum ('regular', 'find_players', 'propose_team', 'event');
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
  'event_challenge_declined'
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
  updated_at           timestamptz not null default now()
);

create index profiles_location_idx     on public.profiles using gist (location) where location is not null;
create index profiles_handle_idx       on public.profiles (handle) where handle is not null;
create index profiles_ntrp_idx         on public.profiles (ntrp_rating) where ntrp_rating is not null;
create index profiles_created_at_idx   on public.profiles (created_at desc);

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
  constraint event_participants_unique unique (event_id, user_id)
);
create index event_participants_event_status_idx on public.event_participants (event_id, status);
create index event_participants_user_idx         on public.event_participants (user_id);

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
  -- Legacy single-media fields (kept until clients migrate to photos[])
  media_url           text not null default '',
  media_type          text not null default '',
  post_type           post_type not null default 'regular',
  play_date           text not null default '',
  play_time           text not null default '',
  play_duration       integer not null default 90,
  court_location      text not null default '',
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
  created_at          timestamptz not null default now()
);
create index posts_author_created_idx     on public.posts (author_id, created_at desc);
create index posts_event_idx              on public.posts (event_id) where event_id is not null;
create index posts_broadcast_created_idx  on public.posts (created_at desc) where is_broadcast = true;
create index posts_broadcast_location_idx on public.posts using gist (broadcast_location) where is_broadcast = true and broadcast_location is not null;

create table public.photos (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  url         text not null,
  "order"     integer not null default 0,
  created_at  timestamptz not null default now()
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
  friend_group_id     uuid unique references public.friend_groups (id) on delete set null,
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

create trigger profiles_updated_at                before update on public.profiles                for each row execute function public.set_updated_at();
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

-- INSERT: self for matches/practices in their group; captains+ on matches can
-- also insert rows on behalf of any group member (so they can assign a lineup
-- slot before the member has RSVP'd themselves — mirrors the UPDATE policy).
CREATE POLICY availabilities_insert_self_or_captain ON availabilities
  FOR INSERT TO authenticated WITH CHECK (
    (
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
    )
    OR (
      match_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_matches tm
        WHERE tm.id = availabilities.match_id
          AND has_group_role(tm.group_id, 'captain'::group_role)
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
SET search_path TO 'public'
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

DROP POLICY availabilities_upsert_self ON availabilities;
CREATE POLICY availabilities_upsert_self ON availabilities FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (
    (match_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_matches tm WHERE tm.id = availabilities.match_id AND is_group_member(tm.group_id)
    ))
    OR (practice_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM team_practices tp JOIN practice_series ps ON ps.id = tp.series_id
      WHERE tp.id = availabilities.practice_id AND is_group_member(ps.group_id)
    ))
  ));

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

GRANT EXECUTE ON FUNCTION public.cleanup_user_for_test(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cleanup_user_for_test(uuid) FROM PUBLIC, anon, authenticated;

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
            || E'📍 ' || v_location || E'\n'
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
-- LADDER CHALLENGE RPC (propose_ladder_challenge)
-- ============================================================
--
-- Replaces /api/events/[id]/challenges. Reads live standings off the
-- event_participants aggregate columns (kept in sync by
-- recompute_event_standings) and enforces the rank-gap rule.
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
