-- Recheck authority after waiting for the team lock. Installation changes no team records.

BEGIN;

CREATE OR REPLACE FUNCTION team_onboarding_private.manage_link(p_group uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.team_onboarding WHERE group_id=p_group) THEN RAISE EXCEPTION 'Save team setup first'; END IF;
 IF p_action='enable' THEN
  INSERT INTO public.team_join_links(group_id) VALUES(p_group) ON CONFLICT(group_id) DO UPDATE SET enabled=true;
 ELSIF p_action='replace' THEN
  INSERT INTO public.team_join_links(group_id) VALUES(p_group) ON CONFLICT(group_id) DO UPDATE SET token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),enabled=true;
 ELSIF p_action='disable' THEN
  UPDATE public.team_join_links SET enabled=false WHERE group_id=p_group;
 ELSIF p_action IS DISTINCT FROM 'read' THEN RAISE EXCEPTION 'Invalid link action';
 END IF;
 SELECT jsonb_build_object('token',l.token,'enabled',l.enabled) INTO result FROM public.team_join_links l WHERE group_id=p_group;
 RETURN coalesce(result,jsonb_build_object('token',NULL,'enabled',false))||jsonb_build_object('requests',coalesce((
  SELECT jsonb_agg(jsonb_build_object('id',r.id,'userId',r.user_id,'name',coalesce(p.name,'Player'),'email',p.email,'createdAt',r.created_at) ORDER BY r.created_at)
  FROM public.team_join_requests r JOIN public.profiles p ON p.id=r.user_id WHERE r.group_id=p_group AND r.status='pending'
 ),'[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION team_onboarding_private.review_request(p_group uuid,p_request uuid,p_decision text,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.team_join_requests%ROWTYPE; target public.team_onboarding_players%ROWTYPE; mid uuid; pid uuid; pname text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.team_join_requests WHERE id=p_request AND group_id=p_group FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
 IF r.status<>'pending' THEN
  IF r.status=(CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END) THEN RETURN jsonb_build_object('status',r.status); END IF;
  RAISE EXCEPTION 'Request already reviewed';
 END IF;
 IF p_decision='approve' THEN
  IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=p_group AND owner_id=r.user_id) AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=p_group AND user_id=r.user_id) THEN
   pid:=p_player;
   IF pid IS NULL THEN SELECT id INTO pid FROM public.team_onboarding_players WHERE group_id=p_group AND removed_at IS NULL AND associated_account_id=r.user_id AND accepted_by IS NULL ORDER BY revoked_at NULLS FIRST LIMIT 1; END IF;
   IF pid IS NOT NULL THEN
    SELECT * INTO target FROM public.team_onboarding_players WHERE id=pid AND group_id=p_group AND removed_at IS NULL FOR UPDATE;
    IF target.id IS NULL OR target.accepted_by IS NOT NULL OR target.member_id IS NULL THEN RAISE EXCEPTION 'Choose an unjoined roster entry'; END IF;
    PERFORM public._merge_placeholder_into_user(target.member_id,r.user_id);
    SELECT id INTO mid FROM public.group_members WHERE group_id=p_group AND user_id=r.user_id;
    -- Retire the old personal credential without losing confirmations/RSVPs.
    UPDATE public.team_onboarding_players SET member_id=mid,accepted_by=r.user_id,associated_account_id=r.user_id,accepted_at=now(),sent_at=NULL,revoked_at=NULL,token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),token_created_at=now(),expires_at=now()+interval '30 days' WHERE id=pid;
   ELSE
    SELECT coalesce(nullif(btrim(name),''),'Player') INTO pname FROM public.profiles WHERE id=r.user_id;
    INSERT INTO public.group_members(group_id,user_id,roles) VALUES(p_group,r.user_id,'{}'::public.group_member_role[]) RETURNING id INTO mid;
    INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,associated_account_id,accepted_by,accepted_at) VALUES(gen_random_uuid(),p_group,mid,pname,r.user_id,r.user_id,now());
   END IF;
  END IF;
 END IF;
 UPDATE public.team_join_requests SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,reviewed_at=now(),reviewed_by=auth.uid() WHERE id=r.id;
 RETURN jsonb_build_object('status',CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END);
END; $$;

CREATE OR REPLACE FUNCTION team_onboarding_private.patch_team(p_group uuid,p_change jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; people jsonb; person jsonb; existing public.team_onboarding_players%ROWTYPE; member public.group_members%ROWTYPE; team_name text; op text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT name INTO team_name FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 op:=p_change->>'action';
 IF op='remove-member' THEN
  SELECT * INTO member FROM public.group_members WHERE id=(p_change->>'memberId')::uuid AND group_id=p_group FOR UPDATE;
  IF member.id IS NULL OR member.user_id=auth.uid() OR member.user_id=(SELECT owner_id FROM public.groups WHERE id=p_group) THEN RAISE EXCEPTION 'This roster entry cannot be removed here' USING ERRCODE='42501'; END IF;
  UPDATE public.team_onboarding_players SET removed_at=now(),revoked_at=now() WHERE group_id=p_group AND (member_id=member.id OR accepted_by=member.user_id);
  DELETE FROM public.group_members WHERE id=member.id AND group_id=p_group;
  RETURN jsonb_build_object('ok',true);
 END IF;
 SELECT config INTO c FROM public.team_onboarding WHERE group_id=p_group;
 c:=coalesce(c,jsonb_build_object('name',team_name,'description','','includeUsta',false,'teamNumber','','deadline',''))||jsonb_build_object('name',team_name,'includeDescription',true);
 IF op IN ('init','registration','confirmation') AND (coalesce((c->>'includeUsta')::boolean,false) OR (op='registration' AND coalesce((p_change->>'includeUsta')::boolean,false)) OR op='confirmation') THEN
  FOR member IN SELECT * FROM public.group_members m WHERE m.group_id=p_group AND m.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_onboarding_players p WHERE p.group_id=p_group AND p.removed_at IS NULL AND (p.member_id=m.id OR p.accepted_by=m.user_id)) LOOP
   SELECT * INTO existing FROM public.team_onboarding_players WHERE group_id=p_group AND removed_at IS NULL AND associated_account_id=member.user_id AND accepted_by IS NULL ORDER BY revoked_at NULLS FIRST LIMIT 1;
   IF existing.id IS NOT NULL THEN
    IF existing.member_id IS NOT NULL AND existing.member_id<>member.id THEN PERFORM public._merge_placeholder_into_user(existing.member_id,member.user_id); END IF;
    UPDATE public.team_onboarding_players SET member_id=member.id,accepted_by=member.user_id,accepted_at=now(),sent_at=NULL,revoked_at=NULL,token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),token_created_at=now() WHERE id=existing.id;
   ELSE
    INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,associated_account_id,accepted_by,accepted_at)
    SELECT gen_random_uuid(),p_group,member.id,coalesce(nullif(p.name,''),'Player'),member.user_id,member.user_id,now() FROM public.profiles p WHERE p.id=member.user_id;
   END IF;
  END LOOP;
 END IF;
 IF op='init' THEN
  INSERT INTO public.team_onboarding(group_id,config) VALUES(p_group,c) ON CONFLICT(group_id) DO UPDATE SET config=excluded.config;
  RETURN jsonb_build_object('ok',true);
 ELSIF op='registration' THEN
  c:=c||jsonb_build_object('includeUsta',(p_change->>'includeUsta')::boolean,'ustaTeamName',p_change->>'ustaTeamName','teamNumber',p_change->>'teamNumber','deadline',p_change->>'deadline','includeRegistrationLink',(p_change->>'includeRegistrationLink')::boolean);
  IF (c->>'includeUsta')::boolean AND (coalesce(c->>'teamNumber','')!~'^[0-9]{10}$' OR coalesce(c->>'deadline','')='') THEN RAISE EXCEPTION 'Team number and deadline required'; END IF;
 ELSIF op='message' THEN
  c:=c||jsonb_build_object('invitationMessage',p_change->>'message','includeUstaInInvitations',(p_change->>'includeUstaInInvitations')::boolean);
 ELSIF op='confirmation' THEN
  SELECT * INTO existing FROM public.team_onboarding_players WHERE (id=(p_change->>'playerId')::uuid OR member_id=(p_change->>'playerId')::uuid) AND group_id=p_group AND removed_at IS NULL;
  IF existing.id IS NULL THEN
   SELECT * INTO member FROM public.group_members WHERE id=(p_change->>'playerId')::uuid AND group_id=p_group AND user_id IS NOT NULL;
   IF member.id IS NULL THEN RAISE EXCEPTION 'Player not found'; END IF;
   -- Existing friends/legacy members may not have an onboarding record yet.
   SELECT * INTO existing FROM public.team_onboarding_players WHERE group_id=p_group AND accepted_by=member.user_id AND removed_at IS NULL LIMIT 1;
   IF existing.id IS NULL THEN
    INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,associated_account_id,accepted_by,accepted_at)
    SELECT member.id,p_group,member.id,coalesce(nullif(p.name,''),'Player'),member.user_id,member.user_id,now() FROM public.profiles p WHERE p.id=member.user_id RETURNING * INTO existing;
   END IF;
  END IF;
  UPDATE public.team_onboarding_players SET confirmed_at=CASE WHEN (p_change->>'confirmed')::boolean THEN coalesce(confirmed_at,now()) ELSE NULL END WHERE id=existing.id;
 ELSIF op NOT IN ('recipients','recipient') OR op IS NULL THEN RAISE EXCEPTION 'Invalid edit';
 END IF;
 IF op IN ('recipients','recipient') THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'phone',coalesce(p.phone,''),'email',coalesce(p.email,''),'associatedAccountId',p.associated_account_id,'confirmedAt',p.confirmed_at)),'[]'::jsonb) INTO people FROM public.team_onboarding_players p WHERE p.group_id=p_group AND p.removed_at IS NULL;
  IF op='recipients' THEN
   IF jsonb_typeof(p_change->'recipients') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid recipients'; END IF;
   FOR person IN SELECT * FROM jsonb_array_elements(p_change->'recipients') LOOP
    IF coalesce(btrim(person->>'name'),'')='' OR coalesce(person->>'email','')='' THEN RAISE EXCEPTION 'Name and email required'; END IF;
    SELECT * INTO existing FROM public.team_onboarding_players WHERE id=(person->>'id')::uuid;
    IF existing.id IS NOT NULL THEN
     IF existing.group_id<>p_group OR existing.removed_at IS NOT NULL OR existing.email IS DISTINCT FROM lower(person->>'email') THEN RAISE EXCEPTION 'Recipient entry already exists'; END IF;
    ELSE people:=people||jsonb_build_array(jsonb_build_object('id',person->>'id','name',person->>'name','phone','','email',lower(person->>'email'),'confirmedAt',NULL)); END IF;
   END LOOP;
  ELSE
   SELECT * INTO existing FROM public.team_onboarding_players WHERE id=(p_change->>'playerId')::uuid AND group_id=p_group AND removed_at IS NULL;
   IF existing.id IS NULL OR existing.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'Choose an unjoined player'; END IF;
   SELECT jsonb_agg(CASE WHEN value->>'id'=existing.id::text THEN value||jsonb_build_object('name',p_change->>'name','email',lower(p_change->>'email'),'associatedAccountId',p_change->'associatedAccountId') ELSE value END) INTO people FROM jsonb_array_elements(people);
  END IF;
  PERFORM public.save_team_onboarding(p_group,c,people);
 ELSE
  INSERT INTO public.team_onboarding(group_id,config) VALUES(p_group,c) ON CONFLICT(group_id) DO UPDATE SET config=excluded.config;
 END IF;
 RETURN jsonb_build_object('ok',true);
END; $$;

-- Expired unsent drafts can be renewed in place, without bypassing an unresolved send.
CREATE OR REPLACE FUNCTION team_onboarding_private.renew_invitation(p_group uuid,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person public.team_onboarding_players%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO person FROM public.team_onboarding_players WHERE id=p_player AND group_id=p_group FOR UPDATE;
 IF person.id IS NULL OR person.accepted_at IS NOT NULL OR person.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation cannot be renewed'; END IF;
 IF EXISTS(SELECT 1 FROM public.team_onboarding_deliveries WHERE player_id=person.id AND status='sending') THEN
  RAISE EXCEPTION 'Review the pending delivery before renewing this invitation' USING ERRCODE='55000';
 END IF;
 UPDATE public.team_onboarding_players SET token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),token_created_at=now(),expires_at=now()+interval '30 days',revoked_at=NULL,sent_at=NULL WHERE id=person.id;
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.renew_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.renew_invitation(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.renew_team_onboarding_invitation(p_group uuid,p_player uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.renew_invitation(p_group,p_player) $$;
REVOKE ALL ON FUNCTION public.renew_team_onboarding_invitation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renew_team_onboarding_invitation(uuid,uuid) TO authenticated;
COMMIT;
