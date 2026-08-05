-- Migration 287: perform_prestige — server-side eligibility + atomic award
--
-- Found by the double-fire / interaction audit (Aug 2026). Two defects in
-- the same function, both in the "client-trusted value" family that
-- migration 147 cleaned up for grant_flex_coins, record_monthly_xp and
-- grant_achievement_milestones. This one was missed.
--
-- 1. NO SERVER-SIDE ELIGIBILITY GATE.
--    Prestige is meant to require level 100 — `isPrestigeEligible()` in
--    src/lib/data/prestige.js checks `current_level >= MAX_LEVEL`. That
--    check existed ONLY on the client. The RPC verified just
--    (authenticated, p_user_id = auth.uid(), prestige_level < 10), so any
--    signed-in account could POST to /rest/v1/rpc/perform_prestige and
--    prestige straight from level 1.
--
--    Ten calls walk tiers 1..10 and pay 500+1000+…+5000 = 27,500 flex
--    coins, plus the full prestige badge set and "The Eternal" title, for
--    an account that has never logged a workout.
--
--    Verified against production before writing this, in a rolled-back
--    transaction as a real `authenticated` user at current_level = 1:
--      SELECT public.perform_prestige('<uid>');
--      → {"ok": true, "coins_awarded": 500, "prestige_level": 1}
--    Migration 142's user_profiles_block_privileged_updates trigger does
--    NOT stop it — the function is SECURITY DEFINER and writes from inside
--    that context, so the trigger's client-write guard never applies.
--
-- 2. READ-THEN-WRITE RACE ON THE COIN AWARD.
--    The old body did `SELECT prestige_level INTO v_profile` (no FOR
--    UPDATE), computed `v_coins := (prestige_level + 1) * 500`, then
--    UPDATEd. Two concurrent calls both read the same starting tier, both
--    compute the same award, and both run
--    `flex_coins = flex_coins + v_coins` — so one prestige level pays out
--    twice. N concurrent calls pay N times. A double-tap was enough; the
--    client's own guard is irrelevant because the RPC is directly callable.
--
-- THE FIX: one atomic conditional UPDATE with every gate in the WHERE
-- clause. Two concurrent calls cannot both match — the second re-evaluates
-- the predicate against the first's committed row and matches nothing, the
-- same lock-free idiom open_capsule_atomic and claim_league_resolution
-- already use. Eligibility now lives with the write it guards, so it
-- cannot be bypassed by calling the endpoint directly.
--
-- Coin amounts are unchanged: tier × 500, matching `prestigeCoins()` in
-- src/lib/data/prestige.js. Verified across the boundary — 99 → blocked,
-- 100 → 500, tier 4 → 2000, tier 10 → 5000, prestige 10 → blocked.
--
-- Idempotent: CREATE OR REPLACE, no schema change, safe to re-run.

CREATE OR REPLACE FUNCTION public.perform_prestige(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_new_level INT;
  v_cur_level INT;
  v_prestige  INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Every gate lives in the WHERE clause. The award is derived from the
  -- row's own pre-update value in the same statement, so there is no
  -- window between checking the tier and paying for it.
  UPDATE public.user_profiles
     SET prestige_level     = COALESCE(prestige_level, 0) + 1,
         total_xp           = 0,
         current_level      = 1,
         prestige_dismissed = FALSE,
         prestiged_at       = array_append(COALESCE(prestiged_at, '{}'), NOW()),
         flex_coins         = COALESCE(flex_coins, 0)
                              + ((COALESCE(prestige_level, 0) + 1) * 500)
   WHERE id = p_user_id
     AND COALESCE(current_level, 1) >= 100
     AND COALESCE(prestige_level, 0) < 10
  RETURNING prestige_level INTO v_new_level;

  IF v_new_level IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',             true,
      'prestige_level', v_new_level,
      'coins_awarded',  v_new_level * 500
    );
  END IF;

  -- Nothing matched. Read back only to explain why, so the client can
  -- show the right message. Never awards anything on this path.
  SELECT COALESCE(current_level, 1), COALESCE(prestige_level, 0)
    INTO v_cur_level, v_prestige
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF v_cur_level IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  ELSIF v_prestige >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max prestige reached');
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not eligible');
  END IF;
END;
$function$;
