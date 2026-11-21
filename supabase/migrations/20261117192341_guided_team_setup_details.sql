-- Returning to setup edits only team details, without replacing roster or invitations.
BEGIN;
CREATE FUNCTION team_onboarding_private.update_setup_details(p_group uuid,p_name text,p_description text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_admin_group(p_group) THEN RAISE EXCEPTION 'Team manager access required' USING ERRCODE='42501'; END IF;
 IF coalesce(length(btrim(p_name)),0) NOT BETWEEN 1 AND 100 OR p_description IS NULL OR length(p_description)>2000 THEN RAISE EXCEPTION 'Invalid team details' USING ERRCODE='22023'; END IF;
 SELECT config INTO c FROM public.team_onboarding WHERE group_id=p_group;
 c:=jsonb_build_object('includeUsta',false,'teamNumber','','deadline','')||coalesce(c,'{}'::jsonb)||jsonb_build_object('name',btrim(p_name),'description',p_description,'includeDescription',true);
 UPDATE public.groups SET name=btrim(p_name) WHERE id=p_group;
 INSERT INTO public.team_onboarding(group_id,config) VALUES(p_group,c) ON CONFLICT(group_id) DO UPDATE SET config=excluded.config;
 RETURN jsonb_build_object('groupId',p_group);
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.update_setup_details(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION team_onboarding_private.update_setup_details(uuid,text,text) TO authenticated;
CREATE FUNCTION public.update_team_setup_details(p_group uuid,p_name text,p_description text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT team_onboarding_private.update_setup_details(p_group,p_name,p_description) $$;
REVOKE ALL ON FUNCTION public.update_team_setup_details(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_setup_details(uuid,text,text) TO authenticated;
COMMIT;
