-- 198_xp_action_rate_limits_and_capsule_oneshot.sql
--
-- XP anti-farm remediation (audit part 2) + capsule one-shot fix.
--
-- FINDING: all the per-action XP caps the app intends
-- (base44/functions/updateUserXpAndAchievements/entry.ts) are DEAD CODE —
-- never deployed. The live path (db.js _invokeXp) drops action_type and
-- forwards the client-computed xp straight to increment_user_xp, whose
-- only guard is a 50,000-XP / rolling-24h ceiling. So the effort-
-- independent fixed grants (comeback +200 with zero guards, water 3,
-- meal 5, recipe 25, regimen 100, goal 100) and delete+re-add of workouts
-- can be farmed up to ~50k XP/day.
--
-- FIX: enforce per-ACTION daily caps server-side (porting the dead code's
-- intent) via grant_action_xp(), and REVOKE direct increment_user_xp from
-- clients so the caps can't be bypassed by calling the raw RPC. The caps
-- are set at legitimate ceilings — high-volume TRAINING is not throttled
-- (workout cap ≈ the fatigue model's 3-session/day limit; cardio grants 0
-- total_xp anyway) — only the farmable fixed grants are bounded.

-- ── Per-action daily XP ledger (definer-only) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.action_xp_ledger (
  user_id     uuid    NOT NULL,
  day         date    NOT NULL,
  action_type text    NOT NULL,
  amount      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, action_type)
);
ALTER TABLE public.action_xp_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_xp_ledger FROM authenticated, anon;

-- ── grant_action_xp: per-action daily cap → global-capped grant ────────
-- Client XP now flows through here. Unknown/other action types get NO
-- per-action cap (only the global 50k/24h ceiling in increment_user_xp),
-- so this never blocks a legit action we haven't classified.
CREATE OR REPLACE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    UUID    := auth.uid();
  v_day    date    := (now() AT TIME ZONE 'utc')::date;
  v_cap    integer;
  v_before integer;
  v_credit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN; END IF;

  -- Per-action per-day XP ceilings (legit maxima; farmable fixed grants).
  v_cap := CASE p_action_type
    WHEN 'workout_completed' THEN 4000  -- ~4 sessions; fatigue model allows 3
    WHEN 'comeback_bonus'    THEN 200   -- once/day
    WHEN 'water_logged'      THEN 24    -- ~8 glasses × 3
    WHEN 'meal_logged'       THEN 30    -- ~6 meals × 5
    WHEN 'recipe_created'    THEN 75    -- ~3 recipes × 25
    WHEN 'regimen_created'   THEN 200   -- ~2 regimens × 100
    WHEN 'goal_completed'    THEN 500   -- ~5 goals × 100
    ELSE NULL                           -- unclassified → global cap only
  END;

  IF v_cap IS NULL THEN
    v_credit := p_xp;
  ELSE
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
  END IF;

  -- Delegate to the global-capped, level-recomputing grant. Runs as the
  -- definer (postgres), so it works even though authenticated no longer
  -- holds EXECUTE on increment_user_xp (revoked below).
  PERFORM public.increment_user_xp(v_uid, v_credit);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

-- Force all client XP through grant_action_xp. Without this a crafted
-- client would just call increment_user_xp directly and skip the per-
-- action caps. Server-internal callers (grant_action_xp,
-- grant_xp_milestone_achievements) run as definer and are unaffected.
REVOKE EXECUTE ON FUNCTION public.increment_user_xp(uuid, integer) FROM authenticated;

-- ── Capsule finalize: one item per capsule ─────────────────────────────
-- finalize_capsule_claim only checked is_opened, never marking the capsule
-- claimed — so it could be called repeatedly on one opened capsule with
-- different item_ids to pull multiple items. Add a finalized_at stamp and
-- reject a second claim. (Rewritten with scalar SELECT INTO instead of
-- %ROWTYPE for paste-safety; behavior otherwise identical.)
ALTER TABLE public.user_capsules ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

CREATE OR REPLACE FUNCTION public.finalize_capsule_claim(
  p_capsule_id uuid, p_item_id text, p_item_name text, p_item_emoji text,
  p_item_rarity text, p_item_type text, p_variant text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid            UUID := auth.uid();
  v_email          TEXT;
  v_is_opened      BOOLEAN;
  v_rolled_rarity  TEXT;
  v_rolled_variant TEXT;
  v_finalized      TIMESTAMPTZ;
  v_inventory_id   UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_capsule_id IS NULL OR p_item_id IS NULL OR p_item_name IS NULL THEN
    RAISE EXCEPTION 'capsule_id, item_id, item_name required' USING ERRCODE = '22023';
  END IF;

  SELECT is_opened, rolled_rarity, rolled_variant, finalized_at
    INTO v_is_opened, v_rolled_rarity, v_rolled_variant, v_finalized
    FROM public.user_capsules
   WHERE id = p_capsule_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023'; END IF;
  IF v_is_opened IS NOT TRUE THEN RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023'; END IF;
  IF v_rolled_rarity IS NULL THEN RAISE EXCEPTION 'capsule roll missing — call claim_capsule_loot first' USING ERRCODE = '22023'; END IF;
  IF v_finalized IS NOT NULL THEN RAISE EXCEPTION 'capsule already claimed' USING ERRCODE = '22023'; END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, variant, acquired_via)
  VALUES
    (v_uid, v_email, p_item_id, p_item_name, p_item_emoji, v_rolled_rarity, p_item_type, v_rolled_variant, 'capsule')
  ON CONFLICT (user_id, item_id, variant) DO UPDATE SET acquired_at = now()
  RETURNING id INTO v_inventory_id;

  UPDATE public.user_capsules SET finalized_at = now() WHERE id = p_capsule_id;

  RETURN jsonb_build_object(
    'ok', true, 'inventory_id', v_inventory_id, 'item_id', p_item_id,
    'item_rarity', v_rolled_rarity, 'item_variant', v_rolled_variant);
END;
$function$;
