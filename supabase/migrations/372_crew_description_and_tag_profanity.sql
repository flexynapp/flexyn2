-- 372_crew_description_and_tag_profanity.sql
--
-- Extends the crew slur gate from `name` to `description` and `tag`.
--
-- WHY NOW. Until this deploy nothing in the product could write either
-- column. Measured against production 2026-08-16: 4 crews, 0 with a
-- description, 0 with a tag. `updateCrewProfile` has accepted them since
-- migration 248 and the only caller in the whole app was CrewChat's avatar
-- upload, so they were reachable in theory and unwritten in fact. The crew
-- settings sheet shipping alongside this migration is the first writer, which
-- makes them the first user-authored free text on the crews row.
--
-- WHY IT MATTERS. Migration 370 dropped the `is_public` filter from
-- `get_public_crews`, so the directory now lists EVERY crew to every signed-in
-- user, description and tag included. The client-side check in
-- CrewSettingsSheet produces a readable refusal; it is not a control, because
-- PostgREST takes the UPDATE directly.
--
-- THE TRAP THIS MIGRATION WALKED INTO, recorded because replacing the function
-- is the obvious fix and it does nothing. The trigger is
--
--     BEFORE INSERT OR UPDATE **OF name** ON public.crews
--
-- so it only fires when `name` is in the UPDATE's SET list. A first draft here
-- did CREATE OR REPLACE FUNCTION alone; the new body was verifiably live on
-- the trigger (`pg_get_functiondef(tgfoid)` contained the new clause) and an
-- `UPDATE crews SET description = 'retard'` still went straight through. The
-- column list is the gate, not the function body. That is why this migration
-- recreates the TRIGGER, and why the verification at the bottom attempts the
-- writes rather than checking that the function exists.
--
-- WHAT is_text_clean ACTUALLY CHECKS, because the name oversells it. It is a
-- SLUR and harassment filter, not a swear filter: the strict list is 14 terms
-- (racial and homophobic slurs, 'retard', 'whore', 'rape', 'pedo', 'rapist'),
-- matched on word boundaries with a leetspeak fold. It returns TRUE — clean —
-- for ordinary vulgarity, which is why production holds a crew called
-- 'Butt Crackers' with the name guard working correctly the whole time. That
-- is a deliberate line and this migration does not move it; it applies the
-- SAME line to two columns that had no check at all. The broader wordlist in
-- src/lib/profanityFilter.js is the client's, and it is a separate, looser
-- layer that PostgREST bypasses.
--
-- NAMING. The trigger and function keep their `..._name_profanity` names even
-- though they now cover three columns. Renaming would strand any later
-- migration that guards itself with DROP TRIGGER IF EXISTS on the old name,
-- which is a worse failure than a stale word in an identifier.
--
-- Paste-safe: NEW./OLD. only, no alias.column, no record field access.

CREATE OR REPLACE FUNCTION public.enforce_crew_name_profanity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Each column skips when it did not change, so an UPDATE touching only
  -- is_public never re-validates stored text and cannot start failing later
  -- because the wordlist grew.
  IF NOT (TG_OP = 'UPDATE' AND OLD.name IS NOT DISTINCT FROM NEW.name) THEN
    IF NEW.name IS NOT NULL AND NEW.name <> '' THEN
      IF NOT public.is_text_clean(NEW.name, TRUE) THEN
        RAISE EXCEPTION 'crew_name_profanity'
          USING ERRCODE = '23514',
                HINT    = 'Crew name contains prohibited content. Pick another name.';
      END IF;
    END IF;
  END IF;

  IF NOT (TG_OP = 'UPDATE' AND OLD.description IS NOT DISTINCT FROM NEW.description) THEN
    IF NEW.description IS NOT NULL AND NEW.description <> '' THEN
      IF NOT public.is_text_clean(NEW.description, TRUE) THEN
        RAISE EXCEPTION 'crew_description_profanity'
          USING ERRCODE = '23514',
                HINT    = 'Crew description contains prohibited content. Reword it.';
      END IF;
    END IF;
  END IF;

  IF NOT (TG_OP = 'UPDATE' AND OLD.tag IS NOT DISTINCT FROM NEW.tag) THEN
    IF NEW.tag IS NOT NULL AND NEW.tag <> '' THEN
      IF NOT public.is_text_clean(NEW.tag, TRUE) THEN
        RAISE EXCEPTION 'crew_tag_profanity'
          USING ERRCODE = '23514',
                HINT    = 'Crew tag contains prohibited content. Pick another.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- The actual fix. DROP + CREATE because a trigger's column list cannot be
-- altered in place; both statements are in one transaction, so the table is
-- never unguarded at any point another session could observe.
DROP TRIGGER IF EXISTS trg_crew_name_profanity ON public.crews;

CREATE TRIGGER trg_crew_name_profanity
  BEFORE INSERT OR UPDATE OF name, description, tag ON public.crews
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crew_name_profanity();

-- ── Self-verification ───────────────────────────────────────────────────────
-- The Supabase SQL editor hides RAISE NOTICE, so this bundle ends in a SELECT
-- that PROVES it ran rather than merely not erroring. Every boolean must be
-- TRUE.
--
-- These ATTEMPT the writes inside savepoints that are rolled back, because the
-- first draft of this migration passed every check that only inspected the
-- catalog while blocking nothing at all. `name_still_guarded` is the
-- regression check: the point is to add two columns without losing the one it
-- already had. `clean_text_still_allowed` is the other direction — a guard
-- that rejects everything would pass all three blocking checks.
DO $$
DECLARE
  v_crew  uuid;
  v_desc  boolean := FALSE;
  v_tag   boolean := FALSE;
  v_name  boolean := FALSE;
  v_ok    boolean := FALSE;
BEGIN
  SELECT id INTO v_crew FROM public.crews LIMIT 1;
  IF v_crew IS NULL THEN
    CREATE TEMP TABLE crew_profanity_check ON COMMIT DROP AS
      SELECT NULL::boolean AS guard_description, NULL::boolean AS guard_tag,
             NULL::boolean AS name_still_guarded, NULL::boolean AS clean_text_still_allowed,
             'NO CREWS EXIST — nothing was verified' AS note;
    RETURN;
  END IF;

  BEGIN
    UPDATE public.crews SET description = 'retard' WHERE id = v_crew;
    RAISE EXCEPTION 'not_blocked';
  EXCEPTION
    WHEN check_violation THEN v_desc := TRUE;
    WHEN others          THEN v_desc := FALSE;
  END;

  BEGIN
    UPDATE public.crews SET tag = 'retard' WHERE id = v_crew;
    RAISE EXCEPTION 'not_blocked';
  EXCEPTION
    WHEN check_violation THEN v_tag := TRUE;
    WHEN others          THEN v_tag := FALSE;
  END;

  BEGIN
    UPDATE public.crews SET name = 'retard' WHERE id = v_crew;
    RAISE EXCEPTION 'not_blocked';
  EXCEPTION
    WHEN check_violation THEN v_name := TRUE;
    WHEN others          THEN v_name := FALSE;
  END;

  -- Ordinary text must still write. Rolled back the same way.
  BEGIN
    UPDATE public.crews SET description = 'Early risers, heavy compounds.' WHERE id = v_crew;
    RAISE EXCEPTION 'rollback_ok';
  EXCEPTION
    WHEN check_violation THEN v_ok := FALSE;
    WHEN others          THEN v_ok := TRUE;
  END;

  CREATE TEMP TABLE crew_profanity_check ON COMMIT DROP AS
    SELECT v_desc AS guard_description, v_tag AS guard_tag,
           v_name AS name_still_guarded, v_ok AS clean_text_still_allowed,
           'attempted against a real row, all rolled back' AS note;
END;
$$;

SELECT * FROM crew_profanity_check;
