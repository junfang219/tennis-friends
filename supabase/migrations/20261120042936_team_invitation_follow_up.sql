BEGIN;

-- Apply the same lifecycle update to both Roster and older leave-team callers.
CREATE FUNCTION team_onboarding_private.retire_departing_player()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.team_onboarding_players p SET removed_at=now(),revoked_at=coalesce(p.revoked_at,now())
 WHERE p.group_id=OLD.group_id AND p.removed_at IS NULL
 AND (p.member_id=OLD.id OR p.accepted_by=OLD.user_id);
 RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.retire_departing_player() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER retire_departing_onboarding_player
BEFORE DELETE ON public.group_members
FOR EACH ROW WHEN (OLD.user_id IS NOT NULL)
EXECUTE FUNCTION team_onboarding_private.retire_departing_player();

-- Retire records left active by the old direct membership deletion.
UPDATE public.team_onboarding_players p
SET removed_at=now(),revoked_at=coalesce(p.revoked_at,now())
FROM public.groups g
WHERE g.id=p.group_id AND p.removed_at IS NULL AND p.member_id IS NULL
AND p.accepted_by IS NOT NULL AND p.accepted_by IS DISTINCT FROM g.owner_id
AND NOT EXISTS (
 SELECT 1 FROM public.group_members m WHERE m.group_id=p.group_id AND m.user_id=p.accepted_by
);

CREATE OR REPLACE FUNCTION team_onboarding_private.claim_delivery(p_group uuid,p_player uuid,p_batch uuid,p_channel text,p_reminder boolean,p_expected jsonb,p_options jsonb) RETURNS jsonb
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
 -- Replays and outstanding SMS claims do not create a delivery attempt.
 IF p_channel='sms' AND EXISTS(
  SELECT 1 FROM public.team_onboarding_deliveries d
  WHERE d.player_id=p_player AND d.channel='sms' AND d.status='sending'
 ) THEN RETURN jsonb_build_object('status','sending'); END IF;
 -- The group lock above serializes the quota check and insert across batches.
 IF (SELECT count(*) FROM public.team_onboarding_deliveries d
     JOIN public.team_onboarding_players p ON p.id=d.player_id
     WHERE p.group_id=p_group AND d.created_at>=now()-interval '1 hour')
    >= (CASE WHEN p_channel='sms' THEN 100 ELSE 500 END)
 THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
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

COMMIT;
