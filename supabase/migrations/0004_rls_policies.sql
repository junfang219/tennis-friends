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

-- Owners create / update / delete matches; players involved can update for
-- reporting via /confirm/dispute endpoints (server route uses service_role).
create policy event_matches_write_owner on public.event_matches
  for all to authenticated
  using (
    exists(select 1 from public.events e where e.id = event_id and e.owner_id = auth.uid())
  )
  with check (
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
