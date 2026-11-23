-- Keep request counts for both post types. Only Find Players completes by count.
CREATE OR REPLACE FUNCTION public.recount_post_players_confirmed(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  proposal public.posts%ROWTYPE;
  total_confirmed integer;
  game_complete boolean;
BEGIN
  SELECT * INTO proposal
  FROM public.posts
  WHERE id = p_post_id AND post_type IN ('find_players', 'propose_team')
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF proposal.post_type = 'propose_team' THEN
    -- Keep the formation count once the roster is handed off to Teams.
    IF proposal.is_complete OR NULLIF(proposal.team_group_id, '') IS NOT NULL THEN RETURN; END IF;

    SELECT count(DISTINCT user_id)
    INTO total_confirmed
    FROM public.play_requests
    WHERE post_id = p_post_id AND status = 'approved' AND user_id <> proposal.author_id;

    UPDATE public.posts SET players_confirmed = total_confirmed
    WHERE id = p_post_id AND players_confirmed IS DISTINCT FROM total_confirmed;
  ELSE
    SELECT
      (SELECT count(*) FROM public.play_requests WHERE post_id = p_post_id AND status = 'approved')
      + (SELECT count(*) FROM regexp_split_to_table(COALESCE(proposal.manual_players, ''), '\s*,\s*') AS n
         WHERE length(trim(n)) > 0)
    INTO total_confirmed;

    game_complete := proposal.players_needed <> 0 AND total_confirmed >= proposal.players_needed;
    UPDATE public.posts SET players_confirmed = total_confirmed, is_complete = game_complete
    WHERE id = p_post_id
      AND (players_confirmed IS DISTINCT FROM total_confirmed OR is_complete IS DISTINCT FROM game_complete);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recount_post_players_confirmed(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.play_requests_recount_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  proposal_id uuid := COALESCE(NEW.post_id, OLD.post_id);
  organizer_id uuid;
  formed boolean;
BEGIN
  IF TG_OP <> 'DELETE' AND (NEW.status IN ('pending', 'approved') OR
     (TG_OP = 'UPDATE' AND OLD.status = 'approved')) THEN
    -- Serialize changes to the approved roster with the formation update.
    SELECT author_id, is_complete OR NULLIF(team_group_id, '') IS NOT NULL
    INTO organizer_id, formed
    FROM public.posts
    WHERE id = proposal_id AND post_type = 'propose_team'
    FOR NO KEY UPDATE;
    IF FOUND THEN
      IF formed THEN
        RAISE EXCEPTION 'This team has already formed. Manage members from the team roster.'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.status = 'approved' AND auth.uid() IS NOT NULL AND auth.uid() <> organizer_id THEN
        RAISE EXCEPTION 'Only the organizer can approve team requests.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  PERFORM public.recount_post_players_confirmed(proposal_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS play_requests_recount_post ON public.play_requests;
CREATE TRIGGER play_requests_recount_post
  AFTER INSERT OR DELETE OR UPDATE OF status ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.play_requests_recount_trigger();

CREATE OR REPLACE FUNCTION public.posts_recount_on_manual_players()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM public.recount_post_players_confirmed(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS posts_recount_manual_players ON public.posts;
CREATE TRIGGER posts_recount_manual_players
  AFTER UPDATE OF manual_players ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_recount_on_manual_players();

CREATE OR REPLACE FUNCTION public.form_proposed_team(p_post_id uuid)
RETURNS TABLE(team_group_id text, players_confirmed integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  organizer_id uuid := auth.uid();
BEGIN
  IF organizer_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to form a team.' USING ERRCODE = '42501';
  END IF;

  -- Take the same lock as request changes, then refresh the count for posts
  -- created before this migration. Already formed posts skip both writes.
  PERFORM 1 FROM public.posts
  WHERE id = p_post_id AND author_id = organizer_id
    AND post_type = 'propose_team' AND NOT is_complete
  FOR NO KEY UPDATE;

  IF FOUND THEN
    -- The existing completion trigger creates and links the team in this transaction.
    UPDATE public.posts
    SET is_complete = true,
        players_confirmed = (
          SELECT count(DISTINCT user_id)
          FROM public.play_requests
          WHERE post_id = p_post_id AND status = 'approved' AND user_id <> organizer_id
        )
    WHERE id = p_post_id;
  END IF;

  RETURN QUERY
  SELECT p.team_group_id, p.players_confirmed
  FROM public.posts AS p
  WHERE p.id = p_post_id AND p.author_id = organizer_id
    AND p.post_type = 'propose_team' AND p.is_complete AND NULLIF(p.team_group_id, '') IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This team proposal is unavailable.' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.form_proposed_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.form_proposed_team(uuid) TO authenticated;
