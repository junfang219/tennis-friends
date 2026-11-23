-- Keep the approval on the same post and applicant for the life of a request.
CREATE OR REPLACE FUNCTION public.keep_play_request_identity()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.post_id IS DISTINCT FROM OLD.post_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'A play request cannot be reassigned.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.keep_play_request_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER play_requests_keep_identity
  BEFORE UPDATE OF post_id, user_id ON public.play_requests
  FOR EACH ROW EXECUTE FUNCTION public.keep_play_request_identity();

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

  PERFORM 1 FROM public.posts
  WHERE id = p_post_id AND author_id = organizer_id
    AND post_type = 'propose_team' AND NOT is_complete
  FOR NO KEY UPDATE;

  IF FOUND THEN
    -- Request changes take the request row lock first, then the post lock.
    -- Fail fast on a busy request so formation never deadlocks or skips it.
    PERFORM 1 FROM public.play_requests
    WHERE post_id = p_post_id AND status = 'pending'
    FOR NO KEY UPDATE NOWAIT;

    -- The completion trigger creates the roster from approved requests.
    UPDATE public.posts
    SET is_complete = true,
        players_confirmed = (
          SELECT count(DISTINCT user_id)
          FROM public.play_requests
          WHERE post_id = p_post_id AND status = 'approved' AND user_id <> organizer_id
        )
    WHERE id = p_post_id;

    UPDATE public.play_requests
    SET status = 'rejected', note = 'Recruitment closed before your request was approved.'
    WHERE post_id = p_post_id AND status = 'pending';
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

-- Close requests left pending on teams formed before this migration.
UPDATE public.play_requests AS request
SET status = 'rejected', note = 'Recruitment closed before your request was approved.'
FROM public.posts AS post
WHERE post.id = request.post_id AND post.post_type = 'propose_team'
  AND post.is_complete AND NULLIF(post.team_group_id, '') IS NOT NULL
  AND request.status = 'pending';
