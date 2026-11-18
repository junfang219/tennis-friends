-- Acceptance binds an already delivered link to its real joined account;
-- that canonical transition does not redirect the invitation's contact address.
BEGIN;
CREATE OR REPLACE FUNCTION team_onboarding_private.guard_delivery_recipient() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(NEW.phone,NEW.email,NEW.associated_account_id) IS DISTINCT FROM ROW(OLD.phone,OLD.email,OLD.associated_account_id) THEN
  IF ROW(NEW.phone,NEW.email) IS NOT DISTINCT FROM ROW(OLD.phone,OLD.email)
   AND NEW.accepted_by IS NOT NULL AND NEW.associated_account_id=NEW.accepted_by
   AND (OLD.accepted_by IS NULL OR OLD.accepted_by=NEW.accepted_by)
   AND EXISTS(SELECT 1 FROM public.group_members m WHERE m.id=NEW.member_id AND m.group_id=NEW.group_id AND m.user_id=NEW.accepted_by)
  THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM public.team_onboarding_deliveries d WHERE d.player_id=OLD.id AND (d.status='sending' OR (d.status='sent' AND OLD.revoked_at IS NULL AND ((d.snapshot IS NOT NULL AND d.snapshot#>>'{expected,token}'=OLD.token) OR (d.snapshot IS NULL AND d.created_at>=OLD.token_created_at))))) THEN
   RAISE EXCEPTION 'Review pending delivery or revoke the issued invitation before changing its recipient' USING ERRCODE='55000';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION team_onboarding_private.guard_delivery_recipient() FROM PUBLIC,anon,authenticated;
COMMIT;
