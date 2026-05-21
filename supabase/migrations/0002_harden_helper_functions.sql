-- Tighten the two SECURITY DEFINER / search_path advisor warnings flagged
-- against the initial schema. RLS-related advisor noise stays as-is; that
-- gets resolved by the Phase 2 policies migration.

-- 1. Pin search_path for set_updated_at so untrusted schemas can't override
--    function resolution mid-trigger.
alter function public.set_updated_at()
  set search_path = public, pg_temp;

-- 2. handle_new_user is invoked only via the auth.users INSERT trigger.
--    Nothing should call it through the REST RPC endpoint, so revoke
--    EXECUTE from the public-facing roles. The supabase_auth_admin role
--    that the trigger fires under retains access via its default grants.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
