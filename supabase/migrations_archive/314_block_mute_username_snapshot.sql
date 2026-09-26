-- 314_block_mute_username_snapshot.sql
--
-- Migration 309 gave the blocked and muted lists a user id so Settings
-- could render a handle instead of an address. Driving it on a device
-- showed the id alone is not enough: the client resolves it through
-- useAuthorsById(), which reads public_profiles, which returned one row
-- per caller (see 313). Every row rendered "an account".
--
-- 313 fixes that read. This makes the lists not depend on it.
--
-- A blocked account is the one case where a live lookup is the wrong
-- mechanism regardless: the list has to name someone the viewer has
-- deliberately cut off, it is rendered from a settings screen that loads no
-- feed, and paging a 1000-row author list to label three rows is work for
-- nothing. The name at block time is also the more honest label — it is who
-- they were when you blocked them.
--
-- Snapshot, not a join. Same reasoning as hub_posts.author_name.

BEGIN;

ALTER TABLE public.user_blocks  ADD COLUMN IF NOT EXISTS blocked_username TEXT;
ALTER TABLE public.story_blocks ADD COLUMN IF NOT EXISTS blocked_username TEXT;
ALTER TABLE public.user_mutes   ADD COLUMN IF NOT EXISTS muted_username   TEXT;

-- Same trigger functions as 309, now capturing the username in the lookup
-- they were already doing. One SELECT, two columns — no extra work per row.
CREATE OR REPLACE FUNCTION public.fill_blocked_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  IF NEW.blocked_id IS NOT NULL AND NEW.blocked_username IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, username INTO v_id, v_name
    FROM public.user_profiles
   WHERE lower(email) = lower(NEW.blocked_email)
   LIMIT 1;
  NEW.blocked_id       := coalesce(NEW.blocked_id, v_id);
  NEW.blocked_username := coalesce(NEW.blocked_username, v_name);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fill_muted_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id   UUID;
  v_name TEXT;
BEGIN
  IF NEW.muted_id IS NOT NULL AND NEW.muted_username IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id, username INTO v_id, v_name
    FROM public.user_profiles
   WHERE lower(email) = lower(NEW.muted_email)
   LIMIT 1;
  NEW.muted_id       := coalesce(NEW.muted_id, v_id);
  NEW.muted_username := coalesce(NEW.muted_username, v_name);
  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fill_blocked_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fill_muted_id()   FROM PUBLIC, anon, authenticated;

-- The triggers from 309 already point at these functions and do not need
-- recreating. No backfill: all three tables are still empty.

COMMIT;
