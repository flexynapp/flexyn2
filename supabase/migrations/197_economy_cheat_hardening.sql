-- 197_economy_cheat_hardening.sql
--
-- XP / economy anti-cheat audit remediation. The user_profiles
-- block-privileged-updates trigger (mig 100+) correctly locks total_xp /
-- flex_coins / current_level / total_volume_lbs / total_distance_meters /
-- streaks / league_tier to RPC-only. This migration closes the holes the
-- audit found in OTHER tables + two missed columns — all direct-write
-- bypasses that made the SECURITY DEFINER RPCs irrelevant.
--
-- IMPORTANT: these are TABLE-level REVOKEs, not column-level. A
-- column-level `REVOKE UPDATE (col)` is a no-op while a table-level UPDATE
-- grant exists (the table grant already covers every column), so the lock
-- must remove the table-level privilege. Verified via the client call-site
-- audit that the app does not write these tables/columns directly (it uses
-- the RPCs); the only direct writers were exploit paths + two legacy
-- fallbacks, both removed on the client in the same change.

-- ─────────────────────────────────────────────────────────────────────
-- 1. league_members — CRITICAL. weekly_xp was directly UPDATE-able by the
--    caller → set it to anything → win the weekly league (coins + capsule
--    + promotion via distribute_league_rewards). Also the INSERT policy
--    put no ceiling on the value a caller could seed on join.
--    Fix: remove table-level UPDATE (weekly_xp/rank are RPC-managed), and
--    force weekly_xp/rank to safe values on client INSERT.
-- ─────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.league_members FROM authenticated;

CREATE OR REPLACE FUNCTION public.league_members_guard_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  NEW.weekly_xp := 0;    -- earned only via increment_league_xp
  NEW.rank      := NULL;  -- assigned only by distribute_league_rewards
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS league_members_guard_insert_tr ON public.league_members;
CREATE TRIGGER league_members_guard_insert_tr
  BEFORE INSERT ON public.league_members
  FOR EACH ROW EXECUTE FUNCTION public.league_members_guard_insert();

-- Cap the sole remaining weekly_xp writer. Per-call ceiling (one action
-- grants <=1000 workout / <=600 cardio XP; 2000 is headroom) + a hard
-- weekly ceiling so no volume of scripted calls yields a runaway number.
CREATE OR REPLACE FUNCTION public.increment_league_xp(p_league_member_id uuid, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_call_cap CONSTANT integer := 2000;
  v_week_cap CONSTANT integer := 150000;
  v_amt      integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
  v_amt := LEAST(p_amount, v_call_cap);
  UPDATE public.league_members
     SET weekly_xp = LEAST(v_week_cap, COALESCE(weekly_xp, 0) + v_amt)
   WHERE id = p_league_member_id AND user_id = v_uid;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. crew_wars — CRITICAL. The crew_wars_update policy lets any war
--    participant UPDATE the row, and the table-level UPDATE grant let them
--    set crew_a_score / crew_b_score / winner_crew_id / status directly →
--    rig the outcome. No client code updates crew_wars (RPCs do). Remove
--    the table-level UPDATE grant entirely.
-- ─────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.crew_wars FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. crew_war_contributions — HIGH. xp_contributed was directly writable.
--    contribute_crew_war_xp (SECURITY DEFINER) is the only legit writer;
--    the client never touches this table directly.
-- ─────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.crew_war_contributions FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. user_inventory — CRITICAL economy bypass. insert-own RLS + grants let
--    a client insert ANY cosmetic at ANY rarity with no capsule. Items are
--    granted only by SECURITY DEFINER RPCs (finalize_capsule_claim,
--    purchase_listing, reward paths). Keep SELECT + DELETE (view / discard
--    own items).
-- ─────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE ON public.user_inventory FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. record_monthly_xp — MEDIUM. No client caller (server/cron only), yet
--    authenticated held EXECUTE → a crafted client could inflate monthly-
--    league standing via repeated 5k calls. Remove the grant.
-- ─────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.record_monthly_xp(uuid, text, text, integer) FROM authenticated, anon;

-- Housekeeping: increment_user_xp requires auth.uid(), never needs anon.
REVOKE EXECUTE ON FUNCTION public.increment_user_xp(uuid, integer) FROM anon;

-- ─────────────────────────────────────────────────────────────────────
-- 6. increment_user_volume / increment_user_distance — MEDIUM. Columns are
--    trigger-protected (RPC-only) but the RPCs had NO cap → arbitrary
--    delta topped the volume/distance leaderboards. Add per-call + per-day
--    ceilings. Decrements (edit corrections / deletes legitimately pass
--    negative deltas) apply as-is — they can only reduce.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_stat_grant_ledger (
  user_id uuid    NOT NULL,
  day     date    NOT NULL,
  stat    text    NOT NULL,
  granted numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, stat)
);
ALTER TABLE public.user_stat_grant_ledger ENABLE ROW LEVEL SECURITY;
-- No policies + no grants → only SECURITY DEFINER functions (owner) touch it.
REVOKE ALL ON public.user_stat_grant_ledger FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.increment_user_volume(p_delta numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_call_cap CONSTANT numeric := 100000;   -- one session's volume ceiling
  v_day_cap  CONSTANT numeric := 300000;   -- per-day accumulation ceiling
  v_before   numeric;
  v_credit   numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;

  IF p_delta < 0 THEN
    UPDATE public.user_profiles
       SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) + p_delta)
     WHERE id = v_uid;
    RETURN;
  END IF;

  SELECT COALESCE(granted, 0) INTO v_before
    FROM public.user_stat_grant_ledger
   WHERE user_id = v_uid AND day = (now() AT TIME ZONE 'utc')::date AND stat = 'volume';
  v_before := COALESCE(v_before, 0);

  v_credit := LEAST(p_delta, v_call_cap, GREATEST(0, v_day_cap - v_before));
  IF v_credit <= 0 THEN RETURN; END IF;

  INSERT INTO public.user_stat_grant_ledger (user_id, day, stat, granted)
  VALUES (v_uid, (now() AT TIME ZONE 'utc')::date, 'volume', v_credit)
  ON CONFLICT (user_id, day, stat)
  DO UPDATE SET granted = public.user_stat_grant_ledger.granted + v_credit;

  UPDATE public.user_profiles
     SET total_volume_lbs = GREATEST(0, COALESCE(total_volume_lbs, 0) + v_credit)
   WHERE id = v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_user_distance(p_delta numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_call_cap CONSTANT numeric := 200000;   -- 200km single-session ceiling (ultras)
  v_day_cap  CONSTANT numeric := 500000;   -- 500km per-day ceiling
  v_before   numeric;
  v_credit   numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_delta IS NULL OR p_delta = 0 THEN RETURN; END IF;

  IF p_delta < 0 THEN
    UPDATE public.user_profiles
       SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) + p_delta)
     WHERE id = v_uid;
    RETURN;
  END IF;

  SELECT COALESCE(granted, 0) INTO v_before
    FROM public.user_stat_grant_ledger
   WHERE user_id = v_uid AND day = (now() AT TIME ZONE 'utc')::date AND stat = 'distance';
  v_before := COALESCE(v_before, 0);

  v_credit := LEAST(p_delta, v_call_cap, GREATEST(0, v_day_cap - v_before));
  IF v_credit <= 0 THEN RETURN; END IF;

  INSERT INTO public.user_stat_grant_ledger (user_id, day, stat, granted)
  VALUES (v_uid, (now() AT TIME ZONE 'utc')::date, 'distance', v_credit)
  ON CONFLICT (user_id, day, stat)
  DO UPDATE SET granted = public.user_stat_grant_ledger.granted + v_credit;

  UPDATE public.user_profiles
     SET total_distance_meters = GREATEST(0, COALESCE(total_distance_meters, 0) + v_credit)
   WHERE id = v_uid;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. lifetime_xp — MEDIUM. Powers the prestige all-time leaderboard but
--    was NOT in the block-privileged-updates list → directly writable.
--    Written only by perform_prestige (SECURITY DEFINER, runs as owner →
--    bypasses this guard). Separate trigger keeps the existing large guard
--    function untouched.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_profiles_guard_lifetime_xp()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.lifetime_xp := COALESCE(NEW.lifetime_xp, 0);
    RETURN NEW;
  END IF;
  IF NEW.lifetime_xp IS DISTINCT FROM OLD.lifetime_xp THEN
    RAISE EXCEPTION 'lifetime_xp is RPC-only (use perform_prestige)' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_profiles_guard_lifetime_xp_tr ON public.user_profiles;
CREATE TRIGGER user_profiles_guard_lifetime_xp_tr
  BEFORE INSERT OR UPDATE OF lifetime_xp ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_guard_lifetime_xp();
