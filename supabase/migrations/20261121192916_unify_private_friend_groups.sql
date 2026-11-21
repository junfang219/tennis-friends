BEGIN;

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'friend_group_added';

-- The owner explicitly opts in to direct addition by members.
ALTER TABLE public.friend_groups ADD COLUMN members_can_add boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.friend_groups.members_can_add IS
  'Whether existing members may add their own accepted friends to this private group.';

-- Backfill missing owner seats, including groups at the member cap.
ALTER TABLE public.friend_group_members DISABLE TRIGGER trg_enforce_club_member_cap;
INSERT INTO public.friend_group_members (friend_group_id, user_id)
SELECT fg.id, fg.owner_id FROM public.friend_groups AS fg
ON CONFLICT (friend_group_id, user_id) DO NOTHING;
ALTER TABLE public.friend_group_members ENABLE TRIGGER trg_enforce_club_member_cap;

UPDATE public.friend_groups SET kind = 'club' WHERE kind = 'circle';
ALTER TABLE public.friend_groups
  ALTER COLUMN kind SET DEFAULT 'club',
  ADD CONSTRAINT friend_groups_invite_only CHECK (kind = 'club');

INSERT INTO public.chats (name, creator_id, friend_group_id)
SELECT fg.name, fg.owner_id, fg.id
FROM public.friend_groups AS fg
ON CONFLICT (friend_group_id) DO NOTHING;

-- Older clients could create a linked chat under a different creator ID.
-- Preserve the room and its messages, and give ownership to the group owner.
UPDATE public.chats AS chat
SET creator_id = fg.owner_id
FROM public.friend_groups AS fg
WHERE chat.friend_group_id = fg.id AND chat.creator_id <> fg.owner_id;

-- The roster is authoritative for access. Keep existing participant settings
-- for members and add chat seats for members who never opened the legacy chat.
DELETE FROM public.chat_participants AS participant
USING public.chats AS chat
WHERE chat.id = participant.chat_id
  AND chat.friend_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.friend_group_members AS member
    WHERE member.friend_group_id = chat.friend_group_id AND member.user_id = participant.user_id
  );

INSERT INTO public.chat_participants (chat_id, user_id)
SELECT chat.id, member.user_id
FROM public.chats AS chat
JOIN public.friend_group_members AS member ON member.friend_group_id = chat.friend_group_id
ON CONFLICT (chat_id, user_id) DO NOTHING;

-- Creation and acceptance already have transactional RPCs. Remove direct
-- membership writes and keep ordinary, ad-hoc chats independently editable.
DROP POLICY friend_groups_insert_owner ON public.friend_groups;
DROP POLICY friend_group_members_insert_owner ON public.friend_group_members;
DROP POLICY friend_group_members_update_owner ON public.friend_group_members;

ALTER POLICY friend_group_members_delete_self_or_owner ON public.friend_group_members
  USING (EXISTS (
    SELECT 1 FROM public.friend_groups AS fg
    WHERE fg.id = friend_group_members.friend_group_id
      AND fg.owner_id <> friend_group_members.user_id
      AND ((SELECT auth.uid()) = friend_group_members.user_id OR (SELECT auth.uid()) = fg.owner_id)
  ));

ALTER POLICY chats_select_participant ON public.chats
  USING (public.is_chat_participant(id)
    OR (friend_group_id IS NULL AND creator_id = (SELECT auth.uid())));
ALTER POLICY chats_insert_self ON public.chats
  WITH CHECK (creator_id = (SELECT auth.uid()) AND friend_group_id IS NULL);
ALTER POLICY chats_update_creator ON public.chats
  USING (creator_id = (SELECT auth.uid()) AND friend_group_id IS NULL)
  WITH CHECK (creator_id = (SELECT auth.uid()) AND friend_group_id IS NULL);
ALTER POLICY chats_delete_creator ON public.chats
  USING (creator_id = (SELECT auth.uid()) AND friend_group_id IS NULL);

ALTER POLICY chat_participants_insert_member_or_creator ON public.chat_participants
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chats AS chat
    WHERE chat.id = chat_participants.chat_id AND chat.friend_group_id IS NULL
      AND (chat.creator_id = (SELECT auth.uid()) OR public.is_chat_participant(chat.id))
  ));

ALTER POLICY chat_participants_delete_self_or_creator ON public.chat_participants
  USING (EXISTS (
    SELECT 1 FROM public.chats AS chat
    WHERE chat.id = chat_participants.chat_id AND chat.friend_group_id IS NULL
      AND ((SELECT auth.uid()) = chat_participants.user_id OR (SELECT auth.uid()) = chat.creator_id)
  ));

REVOKE UPDATE ON public.chat_participants FROM PUBLIC, anon, authenticated;
GRANT UPDATE (last_read_at, muted, pinned_at, hidden_at, cleared_at)
  ON public.chat_participants TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE FUNCTION private.sync_friend_group_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chats SET name = NEW.name WHERE friend_group_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.sync_friend_group_settings() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_friend_group_settings
  AFTER UPDATE OF name ON public.friend_groups
  FOR EACH ROW EXECUTE FUNCTION private.sync_friend_group_settings();

CREATE FUNCTION private.remove_friend_group_chat_participant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.chat_participants AS participant
  USING public.chats AS chat
  WHERE participant.chat_id = chat.id
    AND chat.friend_group_id = OLD.friend_group_id
    AND participant.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.remove_friend_group_chat_participant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER remove_friend_group_chat_participant
  AFTER DELETE ON public.friend_group_members
  FOR EACH ROW EXECUTE FUNCTION private.remove_friend_group_chat_participant();

-- Keep personal invitations already sent for their original recipients.
-- Retire new invitation issuance, reusable links, and the obsolete group-kind lookup.
DROP POLICY friend_group_invites_insert_member ON public.friend_group_invites;
DROP POLICY friend_group_invites_update_inviter ON public.friend_group_invites;
DROP POLICY friend_group_invite_links_select_member ON public.friend_group_invite_links;
DROP FUNCTION public.is_club(uuid);
DROP FUNCTION public.create_club(text, uuid[]);
DROP FUNCTION public.get_or_create_club_invite_link(uuid);
DROP FUNCTION public.rotate_club_invite_link(uuid);
DROP FUNCTION public.get_club_invite_link(text);
DROP FUNCTION public.accept_club_invite_link(text);

ALTER POLICY friend_group_invites_update_invitee ON public.friend_group_invites
  USING (invitee_id = (SELECT auth.uid()) AND status = 'pending')
  WITH CHECK (invitee_id = (SELECT auth.uid()) AND status = 'declined');

REVOKE UPDATE ON public.friend_group_invites FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status) ON public.friend_group_invites TO authenticated;

COMMENT ON TABLE public.friend_group_invites IS
  'Historical personal invitations. Pending invitations remain redeemable by the named invitee.';

CREATE FUNCTION private.add_friend_group_members(p_friend_group_id uuid, p_member_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_members_can_add boolean;
  v_chat uuid;
  v_added_ids uuid[];
BEGIN
  -- Lock first so a queued add sees the latest permission and concurrent batches
  -- cannot exceed the member cap together.
  SELECT owner_id, members_can_add INTO v_owner, v_members_can_add
  FROM public.friend_groups WHERE id = p_friend_group_id FOR NO KEY UPDATE;

  IF v_actor IS NULL OR v_owner IS NULL OR (
    v_actor <> v_owner
    AND NOT (v_members_can_add AND public.is_friend_group_member(p_friend_group_id))
  ) THEN
    RAISE EXCEPTION 'You do not have permission to add friends to this group'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_member_ids) AS requested(user_id)
    WHERE requested.user_id IS NULL OR requested.user_id = v_actor
      OR NOT public.is_friend(requested.user_id)
      OR public.is_blocked(v_actor, requested.user_id)
  ) THEN
    RAISE EXCEPTION 'You can only add your own friends' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id INTO STRICT v_chat FROM public.chats WHERE friend_group_id = p_friend_group_id;

  WITH inserted AS (
    INSERT INTO public.friend_group_members (friend_group_id, user_id)
    SELECT DISTINCT p_friend_group_id, requested.user_id
    FROM unnest(p_member_ids) AS requested(user_id)
    ON CONFLICT (friend_group_id, user_id) DO NOTHING
    RETURNING user_id
  )
  SELECT array_agg(user_id) INTO v_added_ids FROM inserted;

  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT v_chat, added.user_id FROM unnest(v_added_ids) AS added(user_id)
  ON CONFLICT (chat_id, user_id) DO NOTHING;

  UPDATE public.friend_group_invites SET status = 'accepted'
  WHERE friend_group_id = p_friend_group_id
    AND invitee_id = ANY(v_added_ids) AND status = 'pending';

  INSERT INTO public.notifications (user_id, actor_id, type, friend_group_id)
  SELECT added.user_id, v_actor, 'friend_group_added', p_friend_group_id
  FROM unnest(v_added_ids) AS added(user_id);
END;
$$;

CREATE FUNCTION private.create_friend_group(p_name text, p_member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_group uuid;
  v_chat uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Group name is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.friend_groups (name, owner_id)
  VALUES (btrim(p_name), v_actor) RETURNING id INTO v_group;
  INSERT INTO public.chats (name, creator_id, friend_group_id)
  VALUES (btrim(p_name), v_actor, v_group) RETURNING id INTO v_chat;
  INSERT INTO public.friend_group_members (friend_group_id, user_id) VALUES (v_group, v_actor);
  INSERT INTO public.chat_participants (chat_id, user_id) VALUES (v_chat, v_actor);
  PERFORM private.add_friend_group_members(v_group, p_member_ids);

  RETURN v_group;
END;
$$;

CREATE FUNCTION public.add_friend_group_members(p_friend_group_id uuid, p_member_ids uuid[])
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.add_friend_group_members(p_friend_group_id, p_member_ids);
$$;

CREATE FUNCTION public.create_friend_group(p_name text, p_member_ids uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.create_friend_group(p_name, p_member_ids);
$$;

REVOKE EXECUTE ON FUNCTION private.add_friend_group_members(uuid, uuid[]),
  private.create_friend_group(text, uuid[]), public.add_friend_group_members(uuid, uuid[]),
  public.create_friend_group(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.add_friend_group_members(uuid, uuid[]),
  private.create_friend_group(text, uuid[]), public.add_friend_group_members(uuid, uuid[]),
  public.create_friend_group(text, uuid[]) TO authenticated;

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
  v_group  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A direct add can resolve the same personal invitation. Take the group
  -- lock before the invitation lock in both paths.
  SELECT friend_group_id INTO v_group FROM friend_group_invites
  WHERE id = p_invite_id AND invitee_id = v_caller;
  PERFORM 1 FROM friend_groups WHERE id = v_group FOR NO KEY UPDATE;
  SELECT * INTO v_inv FROM friend_group_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_inv.id IS NULL OR v_inv.invitee_id <> v_caller THEN
    RAISE EXCEPTION 'Invite not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_inv.status = 'accepted' AND EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE friend_group_id = v_inv.friend_group_id AND user_id = v_caller
  ) THEN
    SELECT id INTO v_chat FROM chats WHERE friend_group_id = v_inv.friend_group_id;
    RETURN jsonb_build_object('ok', true, 'already_accepted', true,
                              'friend_group_id', v_inv.friend_group_id, 'chat_id', v_chat);
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'This invitation is no longer pending' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO friend_group_members (friend_group_id, user_id)
  VALUES (v_inv.friend_group_id, v_caller)
  ON CONFLICT (friend_group_id, user_id) DO NOTHING;

  SELECT id INTO STRICT v_chat FROM chats WHERE friend_group_id = v_inv.friend_group_id;
  INSERT INTO chat_participants (chat_id, user_id)
  VALUES (v_chat, v_caller) ON CONFLICT DO NOTHING;

  UPDATE friend_group_invites SET status = 'accepted' WHERE id = v_inv.id;

  INSERT INTO notifications (user_id, actor_id, type, friend_group_id)
  VALUES (v_inv.inviter_id, v_caller, 'club_invite_accepted', v_inv.friend_group_id);

  RETURN jsonb_build_object('ok', true,
                            'friend_group_id', v_inv.friend_group_id,
                            'chat_id', v_chat);
END;
$$;

-- A rejected batch leaves the roster untouched. Count the rows that actually
-- landed, so retries with ON CONFLICT DO NOTHING do not use another seat.
DROP TRIGGER trg_enforce_club_member_cap ON public.friend_group_members;
DROP FUNCTION public.enforce_club_member_cap();

CREATE FUNCTION private.enforce_friend_group_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_group_id uuid;
BEGIN
  FOR v_group_id IN SELECT DISTINCT friend_group_id FROM added_members ORDER BY friend_group_id LOOP
    -- This is the same parent lock used by direct adds and legacy acceptances.
    PERFORM 1 FROM public.friend_groups WHERE id = v_group_id FOR NO KEY UPDATE;
    IF (SELECT count(*) FROM public.friend_group_members WHERE friend_group_id = v_group_id) > 200 THEN
      RAISE EXCEPTION 'A group chat can have up to 200 people' USING ERRCODE = 'P2001';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.enforce_friend_group_capacity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_friend_group_capacity
  AFTER INSERT ON public.friend_group_members
  REFERENCING NEW TABLE AS added_members
  FOR EACH STATEMENT EXECUTE FUNCTION private.enforce_friend_group_capacity();

CREATE FUNCTION private.enforce_standalone_chat_capacity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_chat_id uuid;
BEGIN
  FOR v_chat_id IN SELECT DISTINCT chat_id FROM added_participants ORDER BY chat_id LOOP
    -- Friend Group chats use their group roster as the source of membership.
    PERFORM 1 FROM public.chats
    WHERE id = v_chat_id AND friend_group_id IS NULL FOR NO KEY UPDATE;
    IF FOUND AND (SELECT count(*) FROM public.chat_participants WHERE chat_id = v_chat_id) > 200 THEN
      RAISE EXCEPTION 'A group chat can have up to 200 people' USING ERRCODE = 'P2001';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.enforce_standalone_chat_capacity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_standalone_chat_capacity
  AFTER INSERT ON public.chat_participants
  REFERENCING NEW TABLE AS added_participants
  FOR EACH STATEMENT EXECUTE FUNCTION private.enforce_standalone_chat_capacity();

-- Create the chat and all seats in one transaction, using the chat RLS rules.
CREATE FUNCTION public.create_standalone_chat(p_name text, p_member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_chat_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.chats (creator_id, name)
  VALUES (v_caller, coalesce(btrim(p_name), ''))
  RETURNING id INTO v_chat_id;

  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT v_chat_id, v_caller
  UNION
  SELECT v_chat_id, user_id FROM unnest(p_member_ids) AS selected(user_id);

  RETURN v_chat_id;
END;
$$;

-- Apply the whole edit atomically. A creator can replace a member at capacity.
-- Members can add people under the existing chat policy.
CREATE FUNCTION public.update_standalone_chat(
  p_chat_id uuid, p_name text, p_add_ids uuid[], p_remove_ids uuid[]
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_creator_id uuid;
BEGIN
  SELECT creator_id INTO v_creator_id FROM public.chats
  WHERE id = p_chat_id AND friend_group_id IS NULL;
  IF v_caller IS NULL OR v_creator_id IS NULL OR (
    v_creator_id <> v_caller AND NOT public.is_chat_participant(p_chat_id)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to edit this chat' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_creator_id <> v_caller AND cardinality(p_remove_ids) > 0 THEN
    RAISE EXCEPTION 'Only the chat creator can remove members' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_creator_id = v_caller THEN
    UPDATE public.chats SET name = coalesce(p_name, '') WHERE id = p_chat_id;
    DELETE FROM public.chat_participants
    WHERE chat_id = p_chat_id AND user_id <> v_caller AND user_id = ANY(p_remove_ids);
  END IF;

  INSERT INTO public.chat_participants (chat_id, user_id)
  SELECT p_chat_id, user_id FROM unnest(p_add_ids) AS selected(user_id)
  ON CONFLICT (chat_id, user_id) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_standalone_chat(text, uuid[]),
  public.update_standalone_chat(uuid, text, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_standalone_chat(text, uuid[]),
  public.update_standalone_chat(uuid, text, uuid[], uuid[]) TO authenticated;

COMMIT;
