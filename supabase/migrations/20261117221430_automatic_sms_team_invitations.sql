-- Phone-only recipients use scoped edits; uncertain SMS attempts block new batches.
BEGIN;
CREATE UNIQUE INDEX team_onboarding_sms_pending_unique ON public.team_onboarding_deliveries(player_id) WHERE channel='sms' AND status='sending';
CREATE FUNCTION team_onboarding_private.patch_sms(p_group uuid,p_change jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person jsonb; existing public.team_onboarding_players%ROWTYPE; mid uuid; pid uuid; new_phone text; new_email text; associated uuid; changed boolean; team_name text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT name INTO team_name FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF p_change->>'action'='sms-recipients' THEN
  IF jsonb_typeof(p_change->'recipients') IS DISTINCT FROM 'array' OR jsonb_array_length(p_change->'recipients') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid recipients'; END IF;
  FOR person IN SELECT * FROM jsonb_array_elements(p_change->'recipients') LOOP
   pid:=(person->>'id')::uuid; new_phone:=person->>'phone';
   IF pid IS NULL OR coalesce(length(btrim(person->>'name')),0) NOT BETWEEN 1 AND 100 OR coalesce(new_phone,'') !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'Name and valid phone required'; END IF;
   SELECT * INTO existing FROM public.team_onboarding_players WHERE id=pid;
   IF existing.id IS NOT NULL THEN
    IF existing.group_id<>p_group OR existing.removed_at IS NOT NULL OR existing.phone IS DISTINCT FROM new_phone THEN RAISE EXCEPTION 'Recipient entry already exists'; END IF;
   ELSE
    IF (SELECT count(*) FROM public.team_onboarding_players WHERE group_id=p_group AND removed_at IS NULL)>=100 THEN RAISE EXCEPTION 'At most 100 invitation recipients'; END IF;
    mid:=gen_random_uuid();
    INSERT INTO public.group_members(id,group_id,user_id,roles,placeholder_name,placeholder_phone,placeholder_scope) VALUES(mid,p_group,NULL,'{}'::public.group_member_role[],btrim(person->>'name'),new_phone,'all');
    INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,phone) VALUES(pid,p_group,mid,btrim(person->>'name'),new_phone);
   END IF;
  END LOOP;
 ELSIF p_change->>'action'='recipient' THEN
  SELECT * INTO existing FROM public.team_onboarding_players WHERE id=(p_change->>'playerId')::uuid AND group_id=p_group AND removed_at IS NULL FOR UPDATE;
  IF existing.id IS NULL OR existing.accepted_by IS NOT NULL THEN RAISE EXCEPTION 'Choose an unjoined player'; END IF;
  new_phone:=p_change->>'phone'; new_email:=nullif(lower(p_change->>'email'),''); associated:=nullif(p_change->>'associatedAccountId','')::uuid;
  IF coalesce(length(btrim(p_change->>'name')),0) NOT BETWEEN 1 AND 100 OR coalesce(new_phone,'') !~ '^\+[1-9][0-9]{7,14}$' OR coalesce(length(new_email),0)>320 THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  IF associated IS NOT NULL AND associated IS DISTINCT FROM existing.associated_account_id AND NOT EXISTS(SELECT 1 FROM public.friendships WHERE status='accepted' AND ((requester_id=auth.uid() AND addressee_id=associated) OR (addressee_id=auth.uid() AND requester_id=associated))) THEN RAISE EXCEPTION 'Only existing friends can be associated' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.team_onboarding_deliveries WHERE player_id=existing.id AND channel='sms' AND status='sending') THEN RAISE EXCEPTION 'Review the pending SMS before changing its recipient'; END IF;
  changed:=existing.phone IS DISTINCT FROM new_phone OR existing.email IS DISTINCT FROM new_email OR existing.associated_account_id IS DISTINCT FROM associated;
  IF changed AND existing.sent_at IS NOT NULL AND existing.revoked_at IS NULL THEN RAISE EXCEPTION 'Revoke the sent invitation before changing its recipient'; END IF;
  UPDATE public.team_onboarding_players SET name=btrim(p_change->>'name'),phone=new_phone,email=new_email,associated_account_id=associated,
   token=CASE WHEN changed AND revoked_at IS NOT NULL THEN replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') ELSE token END,
   token_created_at=CASE WHEN changed AND revoked_at IS NOT NULL THEN now() ELSE token_created_at END,
   sent_at=CASE WHEN changed AND revoked_at IS NOT NULL THEN NULL ELSE sent_at END WHERE id=existing.id;
  UPDATE public.group_members SET placeholder_name=btrim(p_change->>'name'),placeholder_phone=new_phone,placeholder_email=new_email::public.citext WHERE id=existing.member_id AND user_id IS NULL;
 ELSE RAISE EXCEPTION 'Invalid SMS edit'; END IF;
 INSERT INTO public.team_onboarding(group_id,config) VALUES(p_group,jsonb_build_object('name',team_name,'description','','includeDescription',true,'includeUsta',false,'teamNumber','','deadline','')) ON CONFLICT(group_id) DO UPDATE SET config=public.team_onboarding.config||jsonb_build_object('name',team_name,'includeDescription',true);
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.patch_sms(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.patch_sms(uuid,jsonb) TO authenticated;
CREATE FUNCTION public.patch_team_sms_invitations(p_group uuid,p_change jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.patch_sms(p_group,p_change) $$;
REVOKE ALL ON FUNCTION public.patch_team_sms_invitations(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patch_team_sms_invitations(uuid,jsonb) TO authenticated;
COMMIT;
