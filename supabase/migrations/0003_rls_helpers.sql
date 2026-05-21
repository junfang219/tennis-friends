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
