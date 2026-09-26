-- 355_meal_plans_multi_meal_slot.sql
--
-- REVERSES migration 344's one-plan-per-slot rule, and replaces it with the
-- constraint 344 was actually buying.
--
-- WHY THIS IS A REVERSAL AND NOT A REGRESSION
--
-- 344 read the duplicate-row incident (8 rows across 2 slots on 2026-08-11,
-- 6 of them unreachable) as "a slot must hold one meal". That diagnosis fit
-- the data but not the domain: a real day can carry two dinners, and the
-- planner grid's own inability to draw a second one — an 89.7 pt cell at
-- min-h-[58px] showing one truncated name — is what made one-per-slot look
-- like a rule rather than a limitation of the drawing.
--
-- The rows were never two different dinners. Every one was the SAME diary
-- entry mirrored again: the Nutrition page's photo logger writes a
-- meal_plans row 120-192 ms after its nutrition_logs row, and re-logging
-- appended instead of replacing. The identity that was being violated is the
-- MIRROR's, not the slot's — one plan row per diary row. So the uniqueness
-- moves to (user_id, log_id), which:
--
--   * still makes the mirror idempotent, which is the whole defect 344 fixed;
--   * stops constraining meals a user deliberately planned, which 344 did as
--     a side effect nobody intended.
--
-- Verified on production 2026-08-13 before writing this: 4 rows, 3 carrying
-- food_snapshot->>'log_id', 3 distinct (user_id, log_id) pairs, 0 duplicate
-- pairs and 0 duplicate slots. The new index builds without a dedupe.
--
-- THE CAP IS THREE, AND IT IS ENFORCED HERE
--
-- Two is the floor that has to work: every plan template in nutritionPlans.js
-- carries snack1 and snack2, both of which map to the single `snack` slot, so
-- applying a plan needs two meals in one slot. Three gives a real day
-- headroom. Past three a day stops being a plan and becomes a record, and the
-- record already exists — syncPlannerDiaryLog mirrors planner meals into
-- nutrition_logs, which has no cap and is the right home for that.
--
-- This is display capacity rather than a security invariant, so the UI is
-- expected to prevent the fourth rather than discover it. The trigger is
-- defence in depth against a race and against a caller that forgets. It
-- raises check_violation (23514), which the client must surface rather than
-- swallow.
--
-- CLIENT WORK THIS MIGRATION DOES NOT DO, AND DEPENDS ON
--
-- Dropping the index alone changes NOTHING a user can see. mealPlans.js
-- enforces one-per-slot in the client: findSlot() resolves the slot's
-- existing row id and upsert() updates it, so a second dinner still
-- overwrites the first. Until that changes, this migration only removes a
-- safety net. The two must land together:
--
--   * upsert() must stop calling findSlot() for a NEW meal. Resolving an id
--     is correct when editing a known row and wrong as a default.
--   * WeeklyMealPlannerModal's planMap is keyed `${plan_date}-${meal_type}`
--     with last-write-wins. It has to become a slot -> array map, or the
--     second meal is written and then hidden, which is the 344 incident
--     again with the index gone.

-- ── 1 · Drop the slot exclusivity ────────────────────────────────────
DROP INDEX IF EXISTS public.meal_plans_user_date_slot_uniq;

-- ── 2 · Keep the mirror idempotent ───────────────────────────────────
-- Partial: planner-created rows carry no log_id and are not constrained by
-- this. NULLs are distinct in Postgres anyway, but the predicate keeps the
-- index small and states the intent.
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_user_log_uniq
  ON public.meal_plans (user_id, (food_snapshot->>'log_id'))
  WHERE food_snapshot->>'log_id' IS NOT NULL;

-- ── 3 · Cap a slot at three meals ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.meal_plans_slot_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing integer;
BEGIN
  SELECT count(*) INTO v_existing
    FROM public.meal_plans
   WHERE user_id   = NEW.user_id
     AND plan_date = NEW.plan_date
     AND meal_type = NEW.meal_type
     AND id       <> NEW.id;

  IF v_existing >= 3 THEN
    RAISE EXCEPTION
      'meal_plans: % already holds 3 meals on %', NEW.meal_type, NEW.plan_date
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meal_plans_slot_cap ON public.meal_plans;
CREATE TRIGGER trg_meal_plans_slot_cap
  BEFORE INSERT OR UPDATE ON public.meal_plans
  FOR EACH ROW EXECUTE FUNCTION public.meal_plans_slot_cap();

-- ── Proof it ran ─────────────────────────────────────────────────────
-- RAISE NOTICE is invisible in the Supabase SQL editor, so the bundle ends
-- in a SELECT. Expect: slot_uniq_gone = true, log_uniq_present = 1,
-- cap_trigger_present = 1.
SELECT
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'meal_plans'
      AND indexname = 'meal_plans_user_date_slot_uniq') = 0 AS slot_uniq_gone,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'meal_plans'
      AND indexname = 'meal_plans_user_log_uniq')            AS log_uniq_present,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.meal_plans'::regclass
      AND tgname  = 'trg_meal_plans_slot_cap')               AS cap_trigger_present,
  (SELECT count(*) FROM public.meal_plans)                   AS plan_rows;
