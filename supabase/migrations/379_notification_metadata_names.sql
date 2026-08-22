-- 379_notification_metadata_names.sql
--
-- Puts the NAME a notification's title mentions into its metadata, so the
-- client can re-render that row in the reader's language.
--
-- ── The problem ──────────────────────────────────────────────────────────
--
-- `notifications.title` is written once and never re-rendered, so a row is
-- frozen in whatever language produced it. src/lib/notificationText.js fixes
-- that by rebuilding the sentence from `type` + `metadata` — but only when
-- metadata carries everything the sentence names. Three live types name
-- somebody and store only an id:
--
--   crew_war_started    "⚔️ Crew war vs Spermguzzlegains"   → opponent_crew_id
--   crew_war_resolved   "🏆 You crushed Admin Grind!"       → opponent_crew_id
--   nemesis_assigned    "🎯 @sefseg wants to be your Rival" → initiator_id
--                       "@sefseg declined the challenge"    → assignment_id only
--
-- So those three fall back to stored text and stay frozen. This closes it.
--
-- ── Why a trigger and not four CREATE OR REPLACEs ────────────────────────
--
-- The name is already in scope in every writer — `v_crew_b.name`,
-- `v_opponent`, `v_name` — so the "obvious" fix is one extra pair in each
-- jsonb_build_object. There are FOUR of them (notify_crew_war_started_for,
-- notify_crew_war_resolved_for, gym_rival_roll, gym_rival_decline) and
-- restating them means re-emitting ~250 lines of working SECURITY DEFINER
-- code, all of it dense with `v_war.crew_a_id`, `cm.user_id` and `up.email`
-- — exactly the alias.column and record.field tokens the paste pipeline
-- mangles into `42601 syntax error at "<"`. Rewriting four correct functions
-- to change four lines is the wrong trade.
--
-- Migration 264 made this call already, in its own words: a trigger "rather
-- than by restating 22 SECURITY DEFINER functions". Same reasoning here, and
-- it buys something the per-function edit does not — any FUTURE writer of
-- these types is enriched too, without anybody remembering to.
--
-- ── What it costs ────────────────────────────────────────────────────────
--
-- One indexed primary-key lookup per inserted row, on three types only.
-- Crew-war fanout inserts one row per member in a loop, so a 16-person crew
-- pays 16 extra `crews` lookups per war — against a war that happens weekly.
-- Every other notification type returns before touching a table.
--
-- The trigger is idempotent: a row that already carries the name is returned
-- untouched, so re-running the backfill or adding the field to a writer
-- later costs nothing and conflicts with nothing.

CREATE OR REPLACE FUNCTION public.notifications_add_metadata_names()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name  TEXT;
  v_other UUID;
BEGIN
  -- Only three types need this. Everything else leaves immediately.
  IF NEW.type NOT IN ('crew_war_started', 'crew_war_resolved', 'nemesis_assigned') THEN
    RETURN NEW;
  END IF;

  IF NEW.metadata IS NULL THEN
    NEW.metadata := '{}'::jsonb;
  END IF;

  IF NEW.type IN ('crew_war_started', 'crew_war_resolved') THEN
    IF NEW.metadata ? 'opponent_crew_name' THEN
      RETURN NEW;
    END IF;
    SELECT name INTO v_name
      FROM public.crews
     WHERE id = (NEW.metadata ->> 'opponent_crew_id')::UUID;
    IF v_name IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('opponent_crew_name', v_name);
    END IF;
    RETURN NEW;
  END IF;

  -- nemesis_assigned has THREE writers and three shapes. gym_rival_roll
  -- stores initiator_id; gym_rival_decline stores neither party, only the
  -- assignment; notify_gym_rival_assigned_for already stores rival_name and
  -- is left alone.
  IF NEW.metadata ? 'rival_display_name' THEN
    RETURN NEW;
  END IF;

  IF NEW.metadata ? 'initiator_id' THEN
    SELECT username INTO v_name
      FROM public.user_profiles
     WHERE id = (NEW.metadata ->> 'initiator_id')::UUID;

  ELSIF NEW.metadata ? 'rival_id' THEN
    SELECT username INTO v_name
      FROM public.user_profiles
     WHERE id = (NEW.metadata ->> 'rival_id')::UUID;

  ELSIF NEW.metadata ? 'assignment_id' THEN
    -- The decline case. gym_rival_decline sends the row to the OTHER party,
    -- so whoever acted is the side of the assignment that is not the
    -- recipient. Derived rather than stored, because the writer has it in a
    -- variable and does not persist it.
    SELECT CASE WHEN user_id = NEW.user_id THEN rival_id ELSE user_id END
      INTO v_other
      FROM public.gym_rival_assignments
     WHERE id = (NEW.metadata ->> 'assignment_id')::UUID;

    IF v_other IS NOT NULL THEN
      SELECT username INTO v_name
        FROM public.user_profiles
       WHERE id = v_other;
    END IF;
  END IF;

  IF v_name IS NOT NULL THEN
    NEW.metadata := NEW.metadata || jsonb_build_object('rival_display_name', v_name);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_add_metadata_names() FROM PUBLIC;

-- Postgres has no CREATE TRIGGER IF NOT EXISTS, so a retry of a partially
-- applied migration needs the DROP.
DROP TRIGGER IF EXISTS trg_notifications_add_metadata_names ON public.notifications;

CREATE TRIGGER trg_notifications_add_metadata_names
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_add_metadata_names();

-- ── Backfill ─────────────────────────────────────────────────────────────
-- Existing rows keep their frozen title until this runs.
--
-- Written as a DO loop with scalar variables rather than UPDATE ... FROM,
-- because the join form needs `n.metadata` / `c.name` / `a.user_id` and the
-- clipboard pipeline mangles short alias.column tokens into
-- `42601 syntax error at "<"`. Every statement below is single-table with
-- bare columns. Slower, and it runs once over a few dozen rows.
--
-- Idempotent: the WHERE skips rows that already carry the name, so this can
-- be re-run after a partial apply.

DO $$
DECLARE
  v_id    UUID;
  v_meta  JSONB;
  v_user  UUID;
  v_name  TEXT;
  v_other UUID;
BEGIN
  -- Crew wars: the opponent crew's name, from the id already on the row.
  FOR v_id, v_meta IN
    SELECT id, metadata
      FROM public.notifications
     WHERE type IN ('crew_war_started', 'crew_war_resolved')
       AND NOT (metadata ? 'opponent_crew_name')
  LOOP
    v_name := NULL;
    SELECT name INTO v_name
      FROM public.crews
     WHERE id = (v_meta ->> 'opponent_crew_id')::UUID;
    IF v_name IS NOT NULL THEN
      UPDATE public.notifications
         SET metadata = v_meta || jsonb_build_object('opponent_crew_name', v_name)
       WHERE id = v_id;
    END IF;
  END LOOP;

  -- Gym Rival: the invite shape carries initiator_id; the decline shape
  -- carries only the assignment, so the actor is whichever side of it is
  -- not the recipient.
  FOR v_id, v_meta, v_user IN
    SELECT id, metadata, user_id
      FROM public.notifications
     WHERE type = 'nemesis_assigned'
       AND NOT (metadata ? 'rival_display_name')
  LOOP
    v_name  := NULL;
    v_other := NULL;

    IF v_meta ? 'initiator_id' THEN
      v_other := (v_meta ->> 'initiator_id')::UUID;
    ELSIF v_meta ? 'rival_id' THEN
      v_other := (v_meta ->> 'rival_id')::UUID;
    ELSIF v_meta ? 'assignment_id' THEN
      SELECT CASE WHEN user_id = v_user THEN rival_id ELSE user_id END
        INTO v_other
        FROM public.gym_rival_assignments
       WHERE id = (v_meta ->> 'assignment_id')::UUID;
    END IF;

    IF v_other IS NOT NULL THEN
      SELECT username INTO v_name
        FROM public.user_profiles
       WHERE id = v_other;
    END IF;

    IF v_name IS NOT NULL THEN
      UPDATE public.notifications
         SET metadata = v_meta || jsonb_build_object('rival_display_name', v_name)
       WHERE id = v_id;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Proves it ran, in the Supabase editor where RAISE NOTICE is invisible.
SELECT
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'trg_notifications_add_metadata_names') AS trigger_installed,
  (SELECT count(*) FROM public.notifications
    WHERE type IN ('crew_war_started','crew_war_resolved')
      AND metadata ? 'opponent_crew_name')                 AS crew_rows_named,
  (SELECT count(*) FROM public.notifications
    WHERE type = 'nemesis_assigned'
      AND metadata ? 'rival_display_name')                 AS rival_rows_named;
