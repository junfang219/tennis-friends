-- Policies on `messages` (and any future cross-user write check) reference
-- public.is_blocked directly. Authenticated users need EXECUTE so RLS can
-- evaluate. Anon stays REVOKEd. The function returns only a boolean; no PII
-- exposure beyond what the caller already has access to.

grant execute on function public.is_blocked(uuid, uuid) to authenticated;
