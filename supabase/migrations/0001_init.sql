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
create type public.play_request_status       as enum ('pending', 'approved', 'rejected');
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
  'group_invite_accepted'
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
  insert into public.profiles (id, email, phone, name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), '')
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
  -- One-to-one backing group auto-created when the event is created.
  group_id          uuid unique references public.groups (id) on delete set null,
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
  player1_id    uuid not null references public.profiles (id) on delete restrict,
  player2_id    uuid not null references public.profiles (id) on delete restrict,
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
  created_at  timestamptz not null default now()
);
create index chat_messages_chat_created_idx on public.chat_messages (chat_id, created_at desc);
create index chat_messages_sender_idx       on public.chat_messages (sender_id);

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
  constraint bookings_time_order check (end_time > start_time)
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

create table public.court_reviews (
  id          uuid primary key default gen_random_uuid(),
  court_id    uuid not null references public.courts (id) on delete cascade,
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
  court_id     uuid not null references public.courts (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  has_empty    boolean not null,
  post_id      uuid references public.posts (id) on delete set null,
  reported_at  timestamptz not null default now()
);
create index court_availability_reports_court_idx on public.court_availability_reports (court_id, reported_at desc);
create index court_availability_reports_user_idx  on public.court_availability_reports (user_id, reported_at desc);

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
