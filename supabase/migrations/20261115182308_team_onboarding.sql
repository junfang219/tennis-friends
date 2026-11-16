-- Additive release SQL. Apply only after reviewing/testing against the current
-- canonical schema. No production database is changed by creating this file.
BEGIN;
CREATE TABLE public.team_onboarding (
 group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
 config jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.team_onboarding_players (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 member_id uuid REFERENCES public.group_members(id) ON DELETE SET NULL,
 name text NOT NULL, phone text, email text,
 associated_account_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
 confirmed_at timestamptz, sent_at timestamptz, accepted_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days', revoked_at timestamptz, removed_at timestamptz, token_created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(group_id, id)
);
CREATE UNIQUE INDEX team_onboarding_association_unique ON public.team_onboarding_players(group_id,associated_account_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX team_onboarding_phone_unique ON public.team_onboarding_players(group_id,phone) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX team_onboarding_email_unique ON public.team_onboarding_players(group_id,email) WHERE revoked_at IS NULL;
CREATE INDEX team_onboarding_players_associated_idx ON public.team_onboarding_players(associated_account_id) WHERE revoked_at IS NULL AND accepted_by IS NULL;
CREATE INDEX team_onboarding_players_group_idx ON public.team_onboarding_players(group_id);
CREATE TABLE public.team_onboarding_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid NOT NULL REFERENCES public.team_onboarding_players(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL, channel text NOT NULL CHECK (channel IN ('sms','email','in_app')),
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed')),
 provider_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(player_id,batch_id,channel)
);
CREATE INDEX team_onboarding_deliveries_player_time_idx ON public.team_onboarding_deliveries(player_id,created_at);
ALTER TABLE public.team_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_onboarding_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_onboarding_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_onboarding, public.team_onboarding_players, public.team_onboarding_deliveries FROM anon, authenticated;
GRANT ALL ON public.team_onboarding, public.team_onboarding_players, public.team_onboarding_deliveries TO service_role;

CREATE FUNCTION public.save_team_onboarding(p_group uuid, p_config jsonb, p_players jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE person jsonb; existing public.team_onboarding_players%ROWTYPE; associated uuid; mid uuid; pid uuid;
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
  IF existing.revoked_at IS NOT NULL THEN CONTINUE; END IF;
 IF existing.accepted_by IS NOT NULL THEN associated := existing.accepted_by; END IF;
  IF existing.id IS NULL THEN
   mid := gen_random_uuid();
   -- No legacy claim token: acceptance must use the new account-bound invitation.
   INSERT INTO public.group_members(id,group_id,user_id,roles,placeholder_name,placeholder_email,placeholder_phone,placeholder_scope)
   VALUES(mid,p_group,NULL,'{}'::public.group_member_role[],person->>'name',nullif(person->>'email','')::citext,nullif(person->>'phone',''),'all');
   INSERT INTO public.team_onboarding_players(id,group_id,member_id,name,phone,email,associated_account_id,confirmed_at)
   VALUES(pid,p_group,mid,person->>'name',nullif(person->>'phone',''),nullif(lower(person->>'email'),''),associated,(person->>'confirmedAt')::timestamptz);
  ELSE
   IF existing.sent_at IS NOT NULL AND (existing.phone IS DISTINCT FROM nullif(person->>'phone','') OR existing.email IS DISTINCT FROM nullif(lower(person->>'email'),'') OR existing.associated_account_id IS DISTINCT FROM associated) THEN
    RAISE EXCEPTION 'Revoke the sent invitation before changing its recipient';
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

CREATE FUNCTION public.read_team_onboarding(p_group uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('config',(SELECT config FROM public.team_onboarding WHERE group_id=p_group),'players',coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('associated_account_name',a.name)) FROM public.team_onboarding_players p LEFT JOIN public.profiles a ON a.id=p.associated_account_id WHERE p.group_id=p_group AND p.removed_at IS NULL),'[]'::jsonb));
END; $$;
CREATE FUNCTION public.view_team_onboarding_invitation(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.team_onboarding_players%ROWTYPE; c jsonb; aname text;
BEGIN
 SELECT * INTO p FROM public.team_onboarding_players WHERE token=p_token AND (sent_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.team_onboarding_deliveries d WHERE d.player_id=team_onboarding_players.id AND d.status='sent' AND d.created_at>=team_onboarding_players.token_created_at));
 IF p.id IS NULL THEN RETURN NULL; END IF;
 SELECT config INTO c FROM public.team_onboarding WHERE group_id=p.group_id;
 SELECT name INTO aname FROM public.profiles WHERE id=p.associated_account_id;
 RETURN jsonb_build_object('groupId',p.group_id,'name',c->>'name','description',CASE WHEN coalesce((c->>'includeDescription')::boolean,true) THEN coalesce(c->>'description','') ELSE '' END,'playerName',p.name,'associatedAccountId',p.associated_account_id,'associatedAccountName',aname,'acceptedBy',p.accepted_by,'status',CASE WHEN p.revoked_at IS NOT NULL THEN 'revoked' WHEN p.accepted_at IS NOT NULL THEN 'accepted' WHEN p.expires_at<now() THEN 'expired' ELSE 'pending' END,'includeUsta',coalesce((c->>'includeUsta')::boolean,false),'ustaTeamName',coalesce(c->>'ustaTeamName',c->>'name'),'teamNumber',coalesce(c->>'teamNumber',''),'deadline',coalesce(c->>'deadline',''),'includeRegistrationLink',coalesce((c->>'includeRegistrationLink')::boolean,true));
END; $$;
CREATE FUNCTION public.accept_team_onboarding_invitation(p_token text) RETURNS jsonb
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
 IF EXISTS(SELECT 1 FROM public.team_onboarding_players WHERE group_id=p.group_id AND id<>p.id AND (accepted_by=auth.uid() OR associated_account_id=auth.uid())) THEN RAISE EXCEPTION 'Account already associated with another player'; END IF;
 PERFORM public._merge_placeholder_into_user(p.member_id,auth.uid());
 SELECT id INTO mid FROM public.group_members WHERE group_id=p.group_id AND user_id=auth.uid();
 UPDATE public.team_onboarding_players SET member_id=mid,accepted_by=auth.uid(),associated_account_id=auth.uid(),accepted_at=now() WHERE id=p.id;
 RETURN jsonb_build_object('groupId',p.group_id);
END; $$;
CREATE FUNCTION public.revoke_team_onboarding_invitation(p_group uuid,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 UPDATE public.team_onboarding_players SET revoked_at=now() WHERE id=p_player AND group_id=p_group AND accepted_by IS NULL;

 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.save_team_onboarding(uuid,jsonb,jsonb),public.read_team_onboarding(uuid),public.view_team_onboarding_invitation(text),public.accept_team_onboarding_invitation(text),public.revoke_team_onboarding_invitation(uuid,uuid) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_team_onboarding(uuid,jsonb,jsonb),public.read_team_onboarding(uuid),public.accept_team_onboarding_invitation(text),public.revoke_team_onboarding_invitation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.view_team_onboarding_invitation(text) TO anon,authenticated;
CREATE FUNCTION public.renew_team_onboarding_invitation(p_group uuid,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 UPDATE public.team_onboarding_players SET token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),token_created_at=now(),expires_at=now()+interval '30 days',revoked_at=NULL,sent_at=NULL
 WHERE id=p_player AND group_id=p_group AND accepted_at IS NULL AND removed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation cannot be renewed'; END IF;
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.renew_team_onboarding_invitation(uuid,uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.renew_team_onboarding_invitation(uuid,uuid) TO authenticated;
CREATE FUNCTION public.list_team_onboarding_invitations() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(public.view_team_onboarding_invitation(token)||jsonb_build_object('token',token)), '[]'::jsonb)
 FROM public.team_onboarding_players WHERE auth.uid() IS NOT NULL AND associated_account_id=auth.uid() AND accepted_by IS NULL AND sent_at IS NOT NULL AND revoked_at IS NULL AND expires_at>now();
$$;
REVOKE ALL ON FUNCTION public.list_team_onboarding_invitations() FROM public,anon;
GRANT EXECUTE ON FUNCTION public.list_team_onboarding_invitations() TO authenticated;
COMMIT;
