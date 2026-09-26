-- 217_hub_follows_bidirectional_id_email.sql
--
-- mig 208 added a BEFORE INSERT/UPDATE trigger that fills follower_id /
-- followee_id FROM the emails. Now that the client is migrating to write
-- follows by user_id (so the search/compose surfaces never read another
-- user's email off the public_profiles view), we need the reverse too:
-- fill follower_email / followee_email FROM the ids when a row is written
-- id-only. That keeps the email columns populated for the remaining
-- email-keyed readers (listFollowing, isFollowing, getMutualFollowSince)
-- regardless of which identifier the client supplied.
--
-- This REPLACES the mig 208 function in place with a bidirectional body.
-- The existing trigger (hub_follows_populate_ids_tr) already points at
-- this function, so no trigger recreation is required; it is re-asserted
-- below for idempotency. Each fill is guarded on "column IS NULL", so the
-- two directions never fight and an explicit value is never overwritten.
-- SECURITY DEFINER so it can resolve another user's profile row past
-- own-row RLS. Paste-safe: NEW. refs + bare columns only.
--
-- No backfill needed — existing rows already carry both id and email
-- (mig 208 backfill + this session's verification: 33/33 follows have
-- both ids present).

CREATE OR REPLACE FUNCTION public.hub_follows_populate_ids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- email → id (original direction, mig 208)
  IF NEW.follower_id IS NULL AND NEW.follower_email IS NOT NULL THEN
    SELECT id INTO NEW.follower_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.follower_email) LIMIT 1;
  END IF;
  IF NEW.followee_id IS NULL AND NEW.followee_email IS NOT NULL THEN
    SELECT id INTO NEW.followee_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.followee_email) LIMIT 1;
  END IF;

  -- id → email (reverse: lets id-only writes satisfy email-keyed reads)
  IF NEW.follower_email IS NULL AND NEW.follower_id IS NOT NULL THEN
    SELECT email INTO NEW.follower_email FROM public.user_profiles
     WHERE id = NEW.follower_id LIMIT 1;
  END IF;
  IF NEW.followee_email IS NULL AND NEW.followee_id IS NOT NULL THEN
    SELECT email INTO NEW.followee_email FROM public.user_profiles
     WHERE id = NEW.followee_id LIMIT 1;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hub_follows_populate_ids_tr ON public.hub_follows;
CREATE TRIGGER hub_follows_populate_ids_tr
  BEFORE INSERT OR UPDATE ON public.hub_follows
  FOR EACH ROW EXECUTE FUNCTION public.hub_follows_populate_ids();
