-- Follow-up: immutable delivery snapshots and safe edits to unissued drafts.
BEGIN;
ALTER TABLE public.team_onboarding_deliveries ADD COLUMN snapshot jsonb;
CREATE INDEX team_onboarding_delivery_batch_snapshot_idx ON public.team_onboarding_deliveries(batch_id,created_at,id) WHERE snapshot IS NOT NULL;
CREATE OR REPLACE FUNCTION team_onboarding_private.patch_sms(p_group uuid,p_change jsonb) RETURNS jsonb
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
    IF existing.group_id<>p_group OR existing.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Recipient entry already exists'; END IF;
    IF existing.phone IS DISTINCT FROM new_phone OR existing.name IS DISTINCT FROM btrim(person->>'name') THEN
     PERFORM team_onboarding_private.patch_sms(p_group,jsonb_build_object('action','recipient','playerId',existing.id,'name',btrim(person->>'name'),'phone',new_phone,'email',coalesce(existing.email,''),'associatedAccountId',existing.associated_account_id));
    END IF;
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
-- Covers every edit path, including legacy full saves and privileged updates.
CREATE FUNCTION team_onboarding_private.guard_delivery_recipient() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(NEW.phone,NEW.email,NEW.associated_account_id) IS DISTINCT FROM ROW(OLD.phone,OLD.email,OLD.associated_account_id) AND EXISTS(
  SELECT 1 FROM public.team_onboarding_deliveries d WHERE d.player_id=OLD.id AND (d.status='sending' OR (d.status='sent' AND OLD.revoked_at IS NULL AND ((d.snapshot IS NOT NULL AND d.snapshot#>>'{expected,token}'=OLD.token) OR (d.snapshot IS NULL AND d.created_at>=OLD.token_created_at))))
 ) THEN RAISE EXCEPTION 'Review pending delivery or revoke the issued invitation before changing its recipient' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.guard_delivery_recipient() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_onboarding_delivery_recipient BEFORE UPDATE OF phone,email,associated_account_id ON public.team_onboarding_players FOR EACH ROW EXECUTE FUNCTION team_onboarding_private.guard_delivery_recipient();

CREATE FUNCTION team_onboarding_private.claim_delivery(p_group uuid,p_player uuid,p_batch uuid,p_channel text,p_reminder boolean,p_expected jsonb,p_options jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE person public.team_onboarding_players%ROWTYPE; prior public.team_onboarding_deliveries%ROWTYPE; first_snapshot jsonb; actual jsonb; c jsonb; team_name text; address text; did uuid; options jsonb:=coalesce(p_options,'null'::jsonb); snap jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 SELECT name INTO team_name FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF p_channel NOT IN ('sms','email') OR p_channel IS NULL OR p_batch IS NULL OR p_reminder IS NULL OR (p_channel='sms' AND p_reminder) THEN RAISE EXCEPTION 'Invalid delivery' USING ERRCODE='22023'; END IF;
 SELECT * INTO person FROM public.team_onboarding_players WHERE id=p_player AND group_id=p_group FOR UPDATE;
 IF person.id IS NULL OR person.removed_at IS NOT NULL OR person.revoked_at IS NOT NULL OR (person.expires_at<now() AND NOT(p_reminder AND person.accepted_by IS NOT NULL)) OR (p_reminder AND person.confirmed_at IS NOT NULL) OR (p_channel='sms' AND person.accepted_by IS NOT NULL) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
 address:=CASE WHEN p_channel='sms' THEN person.phone ELSE coalesce(nullif(person.email,''),(SELECT email FROM public.profiles WHERE id=person.associated_account_id)) END;
 IF nullif(address,'') IS NULL THEN RETURN jsonb_build_object('status','skipped'); END IF;
 actual:=jsonb_build_object('token',person.token,'phone',person.phone,'email',person.email,'associatedAccountId',person.associated_account_id,'address',address);
 IF actual IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','changed'); END IF;
 -- One batch cannot silently change its actor, team, mode or chosen content.
 SELECT d.snapshot INTO first_snapshot FROM public.team_onboarding_deliveries d WHERE d.batch_id=p_batch AND d.snapshot IS NOT NULL ORDER BY d.created_at,d.id LIMIT 1;
 IF first_snapshot IS NOT NULL AND (first_snapshot->>'groupId' IS DISTINCT FROM p_group::text OR first_snapshot->>'actorId' IS DISTINCT FROM auth.uid()::text OR first_snapshot->>'channel' IS DISTINCT FROM p_channel OR first_snapshot->'reminder' IS DISTINCT FROM to_jsonb(p_reminder) OR first_snapshot->'options' IS DISTINCT FROM options) THEN RAISE EXCEPTION 'Batch content changed; start a new batch after reviewing delivery status' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM public.team_onboarding_deliveries WHERE player_id=p_player AND batch_id=p_batch AND channel=p_channel;
 IF prior.id IS NOT NULL THEN
  IF (prior.snapshot IS NOT NULL AND prior.snapshot->'expected' IS DISTINCT FROM actual) OR prior.created_at<person.token_created_at THEN RETURN jsonb_build_object('status','changed'); END IF;
  RETURN jsonb_build_object('status',prior.status);
 END IF;
 IF first_snapshot IS NULL THEN
  SELECT config INTO c FROM public.team_onboarding WHERE group_id=p_group;
  IF c IS NULL THEN RAISE EXCEPTION 'Save team setup first'; END IF;
  c:=c||jsonb_build_object('name',team_name,'includeDescription',true);
  IF options<>'null'::jsonb THEN
   IF p_reminder OR jsonb_typeof(options) IS DISTINCT FROM 'object' OR coalesce(length(btrim(options->>'message')),0) NOT BETWEEN 1 AND 4000 OR jsonb_typeof(options->'includeUsta') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid invitation options' USING ERRCODE='22023'; END IF;
   c:=c||jsonb_build_object('invitationMessage',btrim(options->>'message'),'includeUsta',(options->>'includeUsta')::boolean);
   IF (options->>'includeUsta')::boolean THEN
    IF jsonb_typeof(options->'registration') IS DISTINCT FROM 'object' OR coalesce(options#>>'{registration,teamNumber}','')!~'^[0-9]{10}$' OR coalesce(options#>>'{registration,deadline}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR coalesce(length(options#>>'{registration,ustaTeamName}'),0)>100 OR jsonb_typeof(options#>'{registration,includeRegistrationLink}') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid USTA instructions' USING ERRCODE='22023'; END IF;
    PERFORM (options#>>'{registration,deadline}')::date;
    c:=c||jsonb_build_object('ustaTeamName',options#>>'{registration,ustaTeamName}','teamNumber',options#>>'{registration,teamNumber}','deadline',options#>>'{registration,deadline}','includeRegistrationLink',(options#>>'{registration,includeRegistrationLink}')::boolean);
   END IF;
  ELSIF NOT p_reminder AND c->>'includeUstaInInvitations'='false' THEN c:=c||jsonb_build_object('includeUsta',false); END IF;
 ELSE c:=first_snapshot->'settings'; END IF;
 snap:=jsonb_build_object('groupId',p_group,'actorId',auth.uid(),'channel',p_channel,'reminder',p_reminder,'options',options,'settings',c,'expected',actual,'recipient',jsonb_build_object('id',person.id,'name',person.name,'address',address,'token',person.token));
 INSERT INTO public.team_onboarding_deliveries(player_id,batch_id,channel,status,snapshot) VALUES(p_player,p_batch,p_channel,'sending',snap) ON CONFLICT DO NOTHING RETURNING id INTO did;
 IF did IS NULL THEN RETURN jsonb_build_object('status','sending'); END IF;
 IF first_snapshot IS NULL AND options<>'null'::jsonb THEN UPDATE public.team_onboarding SET config=config||jsonb_build_object('invitationMessage',options->>'message','includeUstaInInvitations',(options->>'includeUsta')::boolean) WHERE group_id=p_group; END IF;
 RETURN jsonb_build_object('status','claimed','deliveryId',did,'settings',c,'recipient',snap->'recipient');
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.claim_delivery(uuid,uuid,uuid,text,boolean,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.claim_delivery(uuid,uuid,uuid,text,boolean,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.claim_team_onboarding_delivery(p_group uuid,p_player uuid,p_batch uuid,p_channel text,p_reminder boolean,p_expected jsonb,p_options jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.claim_delivery(p_group,p_player,p_batch,p_channel,p_reminder,p_expected,p_options) $$;
REVOKE ALL ON FUNCTION public.claim_team_onboarding_delivery(uuid,uuid,uuid,text,boolean,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_team_onboarding_delivery(uuid,uuid,uuid,text,boolean,jsonb,jsonb) TO authenticated;
COMMIT;
