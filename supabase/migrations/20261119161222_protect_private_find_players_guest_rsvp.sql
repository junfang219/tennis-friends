CREATE OR REPLACE FUNCTION public.guest_join_post(
  p_post_id uuid,
  p_name    text,
  p_contact text DEFAULT NULL,
  p_note    text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_post    public.posts%ROWTYPE;
  v_name    text := trim(COALESCE(p_name, ''));
  v_contact text := NULLIF(trim(COALESCE(p_contact, '')), '');
  v_note    text := COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), '');
  v_count   integer;
  v_token   text;
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Please enter your name' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Match the public share page. Keep the visibility check valid until
  -- the guest request is recorded, including during concurrent edits.
  SELECT * INTO v_post
  FROM public.posts
  WHERE id = p_post_id AND post_type = 'find_players' AND visibility = 'friends'
  FOR SHARE;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'This game is no longer available' USING ERRCODE = 'no_data_found';
  END IF;

  -- bound abuse through the public link
  SELECT count(*) INTO v_count FROM public.play_requests
    WHERE post_id = p_post_id AND user_id IS NULL;
  IF v_count >= 50 THEN
    RAISE EXCEPTION 'This game is not accepting more guest responses' USING ERRCODE = 'check_violation';
  END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.play_requests (post_id, user_id, guest_name, guest_contact, guest_token, status, note)
  VALUES (p_post_id, NULL, v_name, v_contact, v_token, 'pending', v_note);

  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_join_post(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.guest_join_post(uuid, text, text, text) TO anon, authenticated;
