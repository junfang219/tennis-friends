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
