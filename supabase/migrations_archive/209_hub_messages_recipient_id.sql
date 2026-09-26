-- 209_hub_messages_recipient_id.sql
--
-- Foundation for migrating direct messages off email. hub_messages identifies
-- the SENDER by user_id, but the RECIPIENT only by recipient_email — there was
-- no recipient_id. That blocks re-keying the messaging UI (participant
-- matching currently joins users.list() emails against message emails).
--
-- Adds recipient_id and keeps it populated with the same trigger pattern as
-- hub_follows (mig 208): a BEFORE INSERT/UPDATE trigger resolves it from
-- recipient_email against user_profiles (SECURITY DEFINER, so it can see the
-- recipient's row past own-row RLS), only when NULL. Existing rows are
-- backfilled by touching each (fires the trigger) — paste-safe, bare columns.

ALTER TABLE public.hub_messages ADD COLUMN IF NOT EXISTS recipient_id uuid;

CREATE OR REPLACE FUNCTION public.hub_messages_populate_recipient_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.recipient_id IS NULL AND NEW.recipient_email IS NOT NULL THEN
    SELECT id INTO NEW.recipient_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.recipient_email) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hub_messages_populate_recipient_id_tr ON public.hub_messages;
CREATE TRIGGER hub_messages_populate_recipient_id_tr
  BEFORE INSERT OR UPDATE ON public.hub_messages
  FOR EACH ROW EXECUTE FUNCTION public.hub_messages_populate_recipient_id();

CREATE INDEX IF NOT EXISTS idx_hub_messages_recipient_id
  ON public.hub_messages (recipient_id);

-- Backfill existing rows (touch each → trigger fills recipient_id).
UPDATE public.hub_messages
   SET recipient_email = recipient_email
 WHERE recipient_id IS NULL AND recipient_email IS NOT NULL;
