-- 208_hub_follows_populate_ids.sql
--
-- hub_follows has follower_id / followee_id uuid columns (since the initial
-- schema) but NOTHING ever populated them — follows are written email-only
-- (follower_email / followee_email). That makes them dead columns and blocks
-- migrating the follow-graph off email as the cross-user key.
--
-- Fix: a BEFORE INSERT/UPDATE trigger resolves each id from its email against
-- user_profiles, so every write (regardless of client) keeps the ids in sync
-- with no app change required. SECURITY DEFINER because it must resolve the
-- FOLLOWEE's id — a different user's row — which own-row RLS on user_profiles
-- would otherwise hide. It only fills an id when NULL, so it never fights an
-- explicit value a future client might pass.
--
-- Existing rows are backfilled by touching each under-populated row (which
-- fires the same trigger) — keeps the SQL paste-safe (bare columns only, no
-- correlated alias.column tokens).

CREATE OR REPLACE FUNCTION public.hub_follows_populate_ids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.follower_id IS NULL AND NEW.follower_email IS NOT NULL THEN
    SELECT id INTO NEW.follower_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.follower_email) LIMIT 1;
  END IF;
  IF NEW.followee_id IS NULL AND NEW.followee_email IS NOT NULL THEN
    SELECT id INTO NEW.followee_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.followee_email) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hub_follows_populate_ids_tr ON public.hub_follows;
CREATE TRIGGER hub_follows_populate_ids_tr
  BEFORE INSERT OR UPDATE ON public.hub_follows
  FOR EACH ROW EXECUTE FUNCTION public.hub_follows_populate_ids();

-- Backfill existing rows (touch each under-populated row → trigger fills ids).
UPDATE public.hub_follows
   SET follower_email = follower_email
 WHERE follower_id IS NULL OR followee_id IS NULL;
