-- 243_weekly_debrief_email_backfill.sql
--
-- Fixes the live 400 on Weekly Debrief generation.
--
--   POST /rest/v1/rpc/generate_my_weekly_debrief  ->  400
--   23502: null value in column "user_email" violates not-null constraint
--   Failing row contains (..., null, 30, 2026, Week 30, 2026, ...)
--
-- ROOT CAUSE
--
-- weekly_debriefs.user_email is NOT NULL (column 3), and
-- generate_my_weekly_debrief's final statement simply never mentions it:
--
--   INSERT INTO public.weekly_debriefs (user_id, week_number, year, week_label, data)
--   VALUES (v_user_id, v_week_num, v_year, v_week_label, v_data)
--   ON CONFLICT (user_id, week_number, year) DO UPDATE ...
--
-- Five columns for a table that requires six. Every call fails, so the
-- Debrief Vault (ProfileMenu -> Weekly Debriefs) has never generated a
-- debrief. The feature is reachable in the UI, so this is a live break
-- rather than dead code behind a hidden entry point.
--
-- WHY A TRIGGER RATHER THAN REWRITING THE RPC
--
-- The obvious fix is to add user_email to that INSERT. It would mean
-- re-emitting the whole 150-line function, whose body is dense with
-- jsonb arrow operators and angle-bracket comparisons that all have to
-- survive the paste pipeline intact. That is a large, risky
-- transliteration to fix one missing column, and it would leave the same
-- hole open for the other writer: migration 051's debrief cron / Edge
-- Function inserts into this table too.
--
-- A BEFORE INSERT trigger fills the column for EVERY writer, in four
-- lines, and matches how this repo already handles denormalized identity
-- columns (participant_ids in mig 216, hub_follows id/email in 208+217).
--
-- Identity is derived from NEW.user_id, which generate_my_weekly_debrief
-- already sets from auth.uid() — so it stays server-derived and is never
-- taken from a client parameter. NEW. references are paste-safe per the
-- repo convention.
--
-- Nothing reads this column: src/lib/data/debriefs.js queries
-- weekly_debriefs by RLS on user_id and never filters on user_email. It
-- is a denormalized leftover that only has to be present and correct.
-- Lower-cased to match how every other email column in this schema is
-- stored.
--
-- The COALESCE on the profile lookup means a user_profiles row that is
-- somehow missing still yields a non-null value rather than trading a
-- 23502 on insert for a 23502 from the trigger.
--
-- REQUIRES: nothing. Independent of 241 and 242.
--
-- Paste-safe: public.<table>, NEW., bare columns, no angle brackets.

CREATE OR REPLACE FUNCTION public.fill_weekly_debrief_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NEW.user_email IS NOT NULL AND NOT (NEW.user_email = '') THEN
    RETURN NEW;
  END IF;

  SELECT lower(coalesce(email, '')) INTO v_email
    FROM public.user_profiles
   WHERE id = NEW.user_id;

  NEW.user_email := coalesce(nullif(v_email, ''), 'unknown@flexyn.local');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_weekly_debrief_email ON public.weekly_debriefs;
CREATE TRIGGER trg_fill_weekly_debrief_email
  BEFORE INSERT ON public.weekly_debriefs
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_weekly_debrief_email();

NOTIFY pgrst, 'reload schema';
