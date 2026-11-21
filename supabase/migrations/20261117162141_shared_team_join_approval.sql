-- Shared links request access; only a team manager can grant membership.
BEGIN;
CREATE SCHEMA IF NOT EXISTS team_onboarding_private;
REVOKE ALL ON SCHEMA team_onboarding_private FROM PUBLIC;
GRANT USAGE ON SCHEMA team_onboarding_private TO anon, authenticated;

CREATE TABLE public.team_join_links (
 group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE public.team_join_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 UNIQUE(group_id,user_id)
);
CREATE INDEX team_join_requests_pending_idx ON public.team_join_requests(group_id,created_at) WHERE status='pending';
CREATE INDEX team_join_requests_user_idx ON public.team_join_requests(user_id);
CREATE INDEX team_join_requests_reviewer_idx ON public.team_join_requests(reviewed_by);
ALTER TABLE public.team_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_join_links,public.team_join_requests FROM PUBLIC,anon,authenticated;
-- Deliberately no client table grants/policies. All access is through checked RPCs.

CREATE FUNCTION team_onboarding_private.manage_link(p_group uuid,p_action text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
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

CREATE FUNCTION team_onboarding_private.view_link(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE gid uuid; c jsonb; state text;
BEGIN
 SELECT group_id INTO gid FROM public.team_join_links WHERE token=p_token AND enabled;
 IF gid IS NULL THEN RETURN NULL; END IF;
 SELECT config INTO c FROM public.team_onboarding WHERE group_id=gid;
 IF auth.uid() IS NULL THEN state:='signed_out';
 ELSIF EXISTS(SELECT 1 FROM public.groups WHERE id=gid AND owner_id=auth.uid()) OR EXISTS(SELECT 1 FROM public.group_members WHERE group_id=gid AND user_id=auth.uid()) THEN state:='joined';
 ELSE
  SELECT CASE WHEN status='approved' THEN 'removed' ELSE status END INTO state FROM public.team_join_requests WHERE group_id=gid AND user_id=auth.uid();
  state:=coalesce(state,'ready');
 END IF;
 -- Public preview intentionally omits roster, request identities, and USTA details.
 RETURN jsonb_build_object('groupId',gid,'name',c->>'name','description',coalesce(c->>'description',''),'status',state);
END; $$;

CREATE FUNCTION team_onboarding_private.request_join(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE gid uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT group_id INTO gid FROM public.team_join_links WHERE token=p_token AND enabled;
 IF gid IS NULL THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 -- Match the existing invitation/save lock order and recheck after locking.
 PERFORM 1 FROM public.groups WHERE id=gid FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.team_join_links WHERE group_id=gid AND token=p_token AND enabled) THEN RAISE EXCEPTION 'Invitation unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.groups WHERE id=gid AND owner_id=auth.uid()) AND NOT EXISTS(SELECT 1 FROM public.group_members WHERE group_id=gid AND user_id=auth.uid()) THEN
  INSERT INTO public.team_join_requests(group_id,user_id) VALUES(gid,auth.uid()) ON CONFLICT(group_id,user_id) DO NOTHING;
 END IF;
 RETURN team_onboarding_private.view_link(p_token);
END; $$;

CREATE FUNCTION team_onboarding_private.review_request(p_group uuid,p_request uuid,p_decision text,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.team_join_requests%ROWTYPE; target public.team_onboarding_players%ROWTYPE; mid uuid; pid uuid; pname text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
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

REVOKE ALL ON FUNCTION team_onboarding_private.manage_link(uuid,text),team_onboarding_private.view_link(text),team_onboarding_private.request_join(text),team_onboarding_private.review_request(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.manage_link(uuid,text),team_onboarding_private.request_join(text),team_onboarding_private.review_request(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.view_link(text) TO anon,authenticated;
-- Invoker wrappers expose only the checked operations through PostgREST.
CREATE FUNCTION public.manage_team_join_link(p_group uuid,p_action text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.manage_link(p_group,p_action) $$;
CREATE FUNCTION public.view_team_join_link(p_token text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.view_link(p_token) $$;
CREATE FUNCTION public.request_team_join(p_token text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.request_join(p_token) $$;
CREATE FUNCTION public.review_team_join_request(p_group uuid,p_request uuid,p_decision text,p_player uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.review_request(p_group,p_request,p_decision,p_player) $$;
REVOKE ALL ON FUNCTION public.manage_team_join_link(uuid,text),public.view_team_join_link(text),public.request_team_join(text),public.review_team_join_request(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_team_join_link(uuid,text),public.request_team_join(text),public.review_team_join_request(uuid,uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.view_team_join_link(text) TO anon,authenticated;
COMMIT;
