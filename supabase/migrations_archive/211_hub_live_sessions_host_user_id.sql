-- 211_hub_live_sessions_host_user_id.sql
--
-- hub_live_sessions identified the host only by host_email — no host id. That
-- blocks the LiveSessionCard profile-nav from moving off email. Adds
-- host_user_id and keeps it populated with the same trigger pattern as
-- migs 208/209: a SECURITY DEFINER BEFORE INSERT/UPDATE trigger resolves it
-- from host_email against user_profiles, only when NULL. Existing rows are
-- backfilled by touching each (fires the trigger) — paste-safe, bare columns.

ALTER TABLE public.hub_live_sessions ADD COLUMN IF NOT EXISTS host_user_id uuid;

CREATE OR REPLACE FUNCTION public.hub_live_sessions_populate_host_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.host_user_id IS NULL AND NEW.host_email IS NOT NULL THEN
    SELECT id INTO NEW.host_user_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.host_email) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hub_live_sessions_populate_host_id_tr ON public.hub_live_sessions;
CREATE TRIGGER hub_live_sessions_populate_host_id_tr
  BEFORE INSERT OR UPDATE ON public.hub_live_sessions
  FOR EACH ROW EXECUTE FUNCTION public.hub_live_sessions_populate_host_id();

-- Backfill existing rows (touch each → trigger fills host_user_id).
UPDATE public.hub_live_sessions
   SET host_email = host_email
 WHERE host_user_id IS NULL AND host_email IS NOT NULL;
