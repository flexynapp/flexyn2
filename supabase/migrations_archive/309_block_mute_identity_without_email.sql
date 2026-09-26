-- 309_block_mute_identity_without_email.sql
--
-- Settings renders the blocked and muted lists, and it had nothing to
-- render but the address: `maskEmail(b.blocked_email)`. That is somebody
-- else's email on screen, which is not allowed regardless of masking —
-- "keg•••@gmail.com" still carries the domain and enough of the local part
-- to identify a person you already know.
--
-- Naming those rows instead needs a user id, and neither write path
-- produces one:
--
--   · user_blocks and story_blocks HAVE a blocked_id column, but
--     block_user_full() inserts only the emails, so it has been NULL on
--     every row ever written.
--   · user_mutes has no id column at all.
--
-- Both are fixed here with BEFORE INSERT triggers rather than by editing
-- block_user_full: a trigger covers every insert path, including the
-- client's direct upsert into user_mutes and anything added later, and it
-- cannot be silently reverted by a future migration restating that
-- function from a stale template — which is exactly how push notifications
-- lost their Vault lookup for months (see CLAUDE.md).
--
-- No backfill: user_blocks, story_blocks and user_mutes are all empty in
-- production, verified before writing this.
--
-- The id stays NULL when the blocked address has no account — the block
-- input is free text, so you can block someone who has never signed up.
-- The client renders those as "an account" and still offers Unblock; it
-- does NOT fall back to the email.

BEGIN;

ALTER TABLE public.user_mutes
  ADD COLUMN IF NOT EXISTS muted_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Resolve blocked_email -> blocked_id on insert.
CREATE OR REPLACE FUNCTION public.fill_blocked_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  IF NEW.blocked_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_id
    FROM public.user_profiles
   WHERE lower(email) = lower(NEW.blocked_email)
   LIMIT 1;
  NEW.blocked_id := v_id;
  RETURN NEW;
END;
$fn$;

-- Same for mutes.
CREATE OR REPLACE FUNCTION public.fill_muted_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  IF NEW.muted_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO v_id
    FROM public.user_profiles
   WHERE lower(email) = lower(NEW.muted_email)
   LIMIT 1;
  NEW.muted_id := v_id;
  RETURN NEW;
END;
$fn$;

-- A trigger function is not callable through PostgREST in any useful way,
-- but every public-schema function is an endpoint until it is revoked and
-- these read user_profiles as the definer. Close them anyway.
REVOKE EXECUTE ON FUNCTION public.fill_blocked_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_muted_id()   FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_blocks_fill_id ON public.user_blocks;
CREATE TRIGGER trg_user_blocks_fill_id
  BEFORE INSERT ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.fill_blocked_id();

DROP TRIGGER IF EXISTS trg_story_blocks_fill_id ON public.story_blocks;
CREATE TRIGGER trg_story_blocks_fill_id
  BEFORE INSERT ON public.story_blocks
  FOR EACH ROW EXECUTE FUNCTION public.fill_blocked_id();

DROP TRIGGER IF EXISTS trg_user_mutes_fill_id ON public.user_mutes;
CREATE TRIGGER trg_user_mutes_fill_id
  BEFORE INSERT ON public.user_mutes
  FOR EACH ROW EXECUTE FUNCTION public.fill_muted_id();

COMMIT;
