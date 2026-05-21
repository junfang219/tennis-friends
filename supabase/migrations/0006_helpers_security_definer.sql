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
