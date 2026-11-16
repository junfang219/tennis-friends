-- Follow-up to the already-applied team onboarding migration.
-- Preserve manager checks, group locking, and RPC-only table access.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_team_onboarding(p_group uuid, p_config jsonb, p_players jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE person jsonb; existing public.team_onboarding_players%ROWTYPE; associated uuid; mid uuid; pid uuid; recipient_changed boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group) THEN
  INSERT INTO public.groups(id,name,owner_id) VALUES(p_group, left(p_config->>'name',100),auth.uid());
 END IF;
 IF NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 IF coalesce(btrim(p_config->>'name'),'')='' OR jsonb_typeof(p_players)<>'array' OR jsonb_array_length(p_players)>100 THEN RAISE EXCEPTION 'Invalid team details'; END IF;
 UPDATE public.groups SET name=p_config->>'name' WHERE id=p_group;
 INSERT INTO public.team_onboarding(group_id,config) VALUES(p_group,p_config-'players') ON CONFLICT(group_id) DO UPDATE SET config=excluded.config;
 FOR person IN SELECT * FROM jsonb_array_elements(p_players) LOOP
  pid := (person->>'id')::uuid; associated := nullif(person->>'associatedAccountId','')::uuid;
  IF associated IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.friendships WHERE status='accepted' AND ((requester_id=auth.uid() AND addressee_id=associated) OR (addressee_id=auth.uid() AND requester_id=associated))) AND NOT EXISTS(SELECT 1 FROM public.team_onboarding_players WHERE id=pid AND group_id=p_group AND associated_account_id=associated) THEN
   RAISE EXCEPTION 'Only existing friends can be associated' USING ERRCODE='42501';
  END IF;
  SELECT * INTO existing FROM public.team_onboarding_players WHERE id=pid FOR UPDATE;
  IF existing.id IS NOT NULL AND existing.group_id<>p_group THEN RAISE EXCEPTION 'Invalid player' USING ERRCODE='42501'; END IF;
  IF existing.removed_at IS NOT NULL THEN RAISE EXCEPTION 'This intended player was removed; add a new entry'; END IF;
 IF existing.accepted_by IS NOT NULL THEN associated := existing.accepted_by; END IF;
  IF existing.id IS NULL THEN
   mid := gen_random_uuid();
   -- No legacy claim token: acceptance must use the new account-bound invitation.
   INSERT INTO public.group_members(id,group_id,user_id,roles,placeholder_name,placeholder_email,placeholder_phone,placeholder_scope)
   VALUES(mid,p_group,NULL,'{}'::public.group_member_role[],person->>'name',nullif(person->>'email','')::citext,nullif(person->>'phone',''),'all');
   INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,phone,email,associated_account_id,confirmed_at)
   VALUES(pid,p_group,mid,person->>'name',nullif(person->>'phone',''),nullif(lower(person->>'email'),''),associated,(person->>'confirmedAt')::timestamptz);
  ELSE
   recipient_changed := existing.phone IS DISTINCT FROM nullif(person->>'phone','') OR existing.email IS DISTINCT FROM nullif(lower(person->>'email'),'') OR existing.associated_account_id IS DISTINCT FROM associated;
   IF existing.sent_at IS NOT NULL AND existing.revoked_at IS NULL AND recipient_changed THEN
    RAISE EXCEPTION 'Revoke the sent invitation before changing its recipient';
   END IF;
   -- Recipient corrections never revive a revoked link. Rotate the credential
   -- and require explicit renewal/issuance before it can be shared again.
   IF existing.revoked_at IS NOT NULL AND recipient_changed THEN
    UPDATE public.team_onboarding_players SET token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),token_created_at=now(),sent_at=NULL WHERE id=pid;
   END IF;
   UPDATE public.team_onboarding_players SET name=person->>'name',phone=nullif(person->>'phone',''),email=nullif(lower(person->>'email'),''),associated_account_id=associated,confirmed_at=(person->>'confirmedAt')::timestamptz WHERE id=pid;
   UPDATE public.group_members SET placeholder_name=person->>'name',placeholder_phone=nullif(person->>'phone',''),placeholder_email=nullif(person->>'email','')::citext WHERE id=existing.member_id AND user_id IS NULL;
  END IF;
 END LOOP;
 -- Removing a draft player revokes their invitation; do not erase joined membership/history.
 FOR existing IN SELECT * FROM public.team_onboarding_players WHERE group_id=p_group AND removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_players) x WHERE x->>'id'=team_onboarding_players.id::text) LOOP
  UPDATE public.team_onboarding_players SET revoked_at=now(),removed_at=now() WHERE id=existing.id;
  DELETE FROM public.group_members WHERE id=existing.member_id AND user_id IS NULL;
 END LOOP;
 RETURN jsonb_build_object('groupId',p_group);
END; $$;

CREATE OR REPLACE FUNCTION public.accept_team_onboarding_invitation(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.team_onboarding_players%ROWTYPE; mid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to accept' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.team_onboarding_players WHERE token=p_token;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p.group_id FOR UPDATE;
 SELECT * INTO p FROM public.team_onboarding_players WHERE token=p_token FOR UPDATE;
 IF p.id IS NULL OR (p.sent_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.team_onboarding_deliveries d WHERE d.player_id=p.id AND d.status='sent' AND d.created_at>=p.token_created_at)) OR p.revoked_at IS NOT NULL OR p.expires_at<now() THEN RAISE EXCEPTION 'Invitation unavailable or expired'; END IF;
 IF p.accepted_by=auth.uid() THEN RETURN jsonb_build_object('groupId',p.group_id); END IF;
 IF p.accepted_at IS NOT NULL OR (p.associated_account_id IS NOT NULL AND p.associated_account_id<>auth.uid()) THEN RAISE EXCEPTION 'Switch to the invited account or contact your captain' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_onboarding_players WHERE group_id=p.group_id AND id<>p.id AND revoked_at IS NULL AND removed_at IS NULL AND (accepted_by=auth.uid() OR associated_account_id=auth.uid())) THEN RAISE EXCEPTION 'Account already associated with another player'; END IF;
 PERFORM public._merge_placeholder_into_user(p.member_id,auth.uid());
 SELECT id INTO mid FROM public.group_members WHERE group_id=p.group_id AND user_id=auth.uid();
 UPDATE public.team_onboarding_players SET member_id=mid,accepted_by=auth.uid(),associated_account_id=auth.uid(),accepted_at=now() WHERE id=p.id;
 RETURN jsonb_build_object('groupId',p.group_id);
END; $$;
REVOKE ALL ON FUNCTION public.save_team_onboarding(uuid,jsonb,jsonb),public.accept_team_onboarding_invitation(text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.save_team_onboarding(uuid,jsonb,jsonb),public.accept_team_onboarding_invitation(text) TO authenticated;
COMMIT;
