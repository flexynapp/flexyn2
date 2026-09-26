-- 262_cardio_and_other_xp_caps.sql
--
-- Fixes F4 from docs/xp-audit-2026-07-29.md.
--
-- grant_action_xp (migration 198) classifies seven action types and gives
-- everything else `ELSE NULL`, which means "no per-action cap — only the
-- 50,000/24h global ceiling in increment_user_xp".
--
-- The client sends EIGHT. `cardio_completed` was never in the CASE, so
-- cardio was capped at 50,000/day while workouts were capped at 4,000 — a
-- 12x asymmetry with no design reason behind it, just an omission.
--
-- Two caps added:
--
--   cardio_completed → 2400. MAX_CARDIO_XP is 600 per session, so this is
--     four maximum-effort sessions in a day. Mirrors the reasoning already
--     used for workout_completed (4000 ≈ four sessions at MAX_WORKOUT_XP
--     1000, against a fatigue model that allows three).
--
--   other → 1000. This is the fallback db.js uses when a caller doesn't
--     classify its grant (`action_type || 'other'`). Leaving it uncapped
--     meant any future caller that forgot to pass an action_type silently
--     got the 50,000 ceiling instead of a sane one. 1000/day is above any
--     legitimate miscellaneous grant and far below the global limit.
--     Anything that genuinely needs more must classify itself and get its
--     own row in this CASE — which is the point.
--
-- Server-side grants that bypass grant_action_xp entirely (achievement
-- milestone bonuses via grant_xp_milestone_achievements, league and crew
-- payouts) call increment_user_xp directly as SECURITY DEFINER and are
-- unaffected by both caps.
--
-- Everything else in the function is unchanged from 198. Restated in full
-- because CREATE OR REPLACE needs the whole body.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

CREATE OR REPLACE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $grant_action_xp$
DECLARE
  v_uid    uuid    := auth.uid();
  v_day    date    := (now() AT TIME ZONE 'utc')::date;
  v_before integer;
  v_cap    integer;
  v_credit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN; END IF;

  -- Per-action per-day XP ceilings (legit maxima; farmable fixed grants).
  v_cap := CASE p_action_type
    WHEN 'workout_completed' THEN 4000  -- ~4 sessions; fatigue model allows 3
    WHEN 'cardio_completed'  THEN 2400  -- ~4 sessions × MAX_CARDIO_XP 600
    WHEN 'comeback_bonus'    THEN 200   -- once/day
    WHEN 'water_logged'      THEN 24    -- ~8 glasses × 3
    WHEN 'meal_logged'       THEN 30    -- ~6 meals × 5
    WHEN 'recipe_created'    THEN 75    -- ~3 recipes × 25
    WHEN 'regimen_created'   THEN 200   -- ~2 regimens × 100
    WHEN 'goal_completed'    THEN 500   -- ~5 goals × 100
    ELSE 1000                           -- unclassified fallback; classify to raise
  END;

  SELECT COALESCE(amount, 0) INTO v_before
    FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = p_action_type;
  v_before := COALESCE(v_before, 0);
  v_credit := LEAST(p_xp, GREATEST(0, v_cap - v_before));
  IF v_credit <= 0 THEN RETURN; END IF;

  INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
  VALUES (v_uid, v_day, p_action_type, v_credit)
  ON CONFLICT (user_id, day, action_type)
  DO UPDATE SET amount = public.action_xp_ledger.amount + v_credit;

  -- Delegate to the global-capped, level-recomputing grant. Runs as the
  -- definer (postgres), so it works even though authenticated no longer
  -- holds EXECUTE on increment_user_xp.
  PERFORM public.increment_user_xp(v_uid, v_credit);
END;
$grant_action_xp$;

REVOKE ALL ON FUNCTION public.grant_action_xp(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_action_xp(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
