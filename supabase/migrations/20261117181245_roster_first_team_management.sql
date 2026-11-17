-- Scoped edits lock the team before reading its roster, so saving invitation
-- settings or USTA details cannot remove players approved in another tab.
BEGIN;
CREATE FUNCTION team_onboarding_private.patch_team(p_group uuid,p_change jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; people jsonb; person jsonb; existing public.team_onboarding_players%ROWTYPE; member public.group_members%ROWTYPE; team_name text; op text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT name INTO team_name FROM public.groups WHERE id=p_group FOR UPDATE;
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
REVOKE ALL ON FUNCTION team_onboarding_private.patch_team(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.patch_team(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.patch_team_onboarding(p_group uuid,p_change jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.patch_team(p_group,p_change) $$;
REVOKE ALL ON FUNCTION public.patch_team_onboarding(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patch_team_onboarding(uuid,jsonb) TO authenticated;
COMMIT;
