-- 263_level_reward_schedule_rebalance.sql
--
-- Fixes F5 from docs/xp-audit-2026-07-29.md.
--
-- THE PROBLEM IS THE SCHEDULE, NOT THE CURVE. Migration 261 gave the
-- database the rebalanced curve, which deliberately makes early levels
-- cheap — a first hard workout reaching level 6 is good onboarding and is
-- staying. What was never re-checked is that migration 070 pays PER LEVEL
-- CROSSED, so cheap levels mean a firehose:
--
--   one 700 XP workout  → 5 standard capsules, 1 premium, 350 coins
--   month 1 @800 XP/day → 35 standard, 7 premium, 3 elite, 2,450 coins
--
-- At shop prices (standard 100, premium 350, elite 1000) that month is
-- ~8,950 coins of capsule value plus 2,450 cash, against a shop whose most
-- aspirational item costs 1,000. The shop stops meaning anything in week one.
--
-- NEW SCHEDULE — reward milestones, not thresholds:
--
--   every level ≥ 2   → 25 coins        (was: 25 coins + 1 standard capsule)
--   every 3rd level   → +1 standard
--   every 10th level  → +1 premium, +100 coins
--   every 25th level  → +1 elite
--
-- Modelled against the live curve before choosing:
--
--   path          | before (total value) | after  | reduction
--   day 1  @800   |                1,350 |    350 | 3.9x
--   week 1 @800   |                6,650 |  1,975 | 3.4x
--   month 1 @800  |               11,400 |  4,425 | 2.6x
--   6 months @800 |               21,450 |  8,400 | 2.6x
--
-- A first workout still pays 2 standard capsules and 150 coins, so the
-- "I got something" moment survives. Elite capsules move to levels 25, 50,
-- 75 and 100 — four in a lifetime rather than ten in six months, which is
-- what "aspirational" is supposed to mean.
--
-- Deliberately NOT changed: the tier pacing in xpTier.js. Week one reaching
-- Gold looked alarming in the audit, but the curve decelerates hard after —
-- Amethyst is ~6 months and Legendary ~2.2 years. Fast early tiers are the
-- onboarding working, not a defect.
--
-- NO CLAWBACK. level_capsules_awarded_through is a high-water mark, so
-- anyone already paid under the old schedule keeps everything they were
-- given; only levels crossed from here on use the new rates.
--
-- Everything else in the function — the auth gate, the FOR UPDATE lock, the
-- current_level ceiling, the idempotency guard and the return shape — is
-- unchanged from 070. Restated in full because CREATE OR REPLACE needs the
-- whole body.
--
-- The mirror in src/lib/__tests__/capsuleLevelUp.test.js is updated in the
-- same commit; it is the only check that this schedule and the client's
-- understanding of it agree.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

CREATE OR REPLACE FUNCTION public.grant_level_up_rewards(p_new_level integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $grant_level_up_rewards$
DECLARE
  v_uid             UUID := auth.uid();
  v_email           TEXT;
  v_prev_through    INT;
  v_level_cap       INT;
  v_lvl             INT;
  v_standard_count  INT := 0;
  v_premium_count   INT := 0;
  v_elite_count     INT := 0;
  v_coins_total     INT := 0;
  v_new_balance     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_new_level IS NULL OR p_new_level < 1 THEN
    RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(level_capsules_awarded_through, 0),
         email,
         GREATEST(COALESCE(current_level, 1), 1)
    INTO v_prev_through, v_email, v_level_cap
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;

  IF p_new_level > v_level_cap THEN
    p_new_level := v_level_cap;
  END IF;

  UPDATE public.user_profiles
     SET level_capsules_awarded_through = p_new_level
   WHERE id = v_uid
     AND COALESCE(level_capsules_awarded_through, 0) = v_prev_through
     AND v_prev_through < p_new_level;

  IF NOT FOUND THEN
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'already_granted', TRUE,
      'awarded_through', v_prev_through,
      'standard',        0,
      'premium',         0,
      'elite',           0,
      'coins',           0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  FOR v_lvl IN GREATEST(v_prev_through + 1, 2) .. p_new_level LOOP
    -- Base: coins on every level. Halved from 50 — levels arrive far more
    -- often on the rebalanced curve, so the per-level rate had to come down
    -- for the per-week total to stay sane.
    v_coins_total := v_coins_total + 25;

    -- Standard capsule every third level rather than every level.
    IF v_lvl % 3 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'standard');
      v_standard_count := v_standard_count + 1;
    END IF;

    -- Premium every tenth (was every fifth).
    IF v_lvl % 10 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'premium');
      v_premium_count := v_premium_count + 1;
      v_coins_total := v_coins_total + 100;
    END IF;

    -- Elite every twenty-fifth (was every tenth) — levels 25, 50, 75, 100.
    IF v_lvl % 25 = 0 THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
        VALUES (v_uid, v_email, 'elite');
      v_elite_count := v_elite_count + 1;
    END IF;
  END LOOP;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_coins_total
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  RETURN jsonb_build_object(
    'already_granted', FALSE,
    'awarded_through', p_new_level,
    'standard',        v_standard_count,
    'premium',         v_premium_count,
    'elite',           v_elite_count,
    'coins',           v_coins_total,
    'new_balance',     COALESCE(v_new_balance, 0)
  );
END;
$grant_level_up_rewards$;

NOTIFY pgrst, 'reload schema';
