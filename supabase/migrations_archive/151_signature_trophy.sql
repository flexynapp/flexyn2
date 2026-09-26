-- 151_signature_trophy.sql
--
-- Profile "Signature Trophy": one emoji the user pins from their existing
-- trophy_case to flex right next to their name on the Hub feed + profile.
-- Single nullable TEXT column on user_profiles; client-writable (it's a
-- vanity badge, not economy state). Idempotent.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signature_trophy TEXT DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
