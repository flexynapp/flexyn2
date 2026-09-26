-- 310_league_rollover_and_activity_gate.sql
--
-- Makes the weekly league actually resolve, and makes it resolve CORRECTLY.
--
-- ── WHY THESE SHIP TOGETHER ───────────────────────────────────────────────
--
-- The build plan in docs/league-season-prompt.md had "make the rollover run"
-- as Phase 1 and "add the activity gate" as Phase 2. That ordering is wrong
-- and this migration deliberately collapses them. Scheduling the cron against
-- the existing distribute_league_rewards would, on the very first Monday,
-- promote every 0-XP member of the live bronze bracket — which is exactly the
-- bug being fixed. There is no safe window between the two phases.
--
-- ── WHAT WAS BROKEN ───────────────────────────────────────────────────────
--
-- 1. NOTHING EVER RESOLVED. Verified against production 2026-08-08: 8 leagues
--    since 2026-05-04, is_resolved = false on all of them, and
--    league_members.rank has never been non-null on a single row.
--
--    Migration 242 moved find-or-create into ensure_my_league(), which always
--    returns a bracket for the CURRENT week. The client's only trigger for
--    resolution was, in getMyLeague():
--
--        if (!league.is_resolved && weekEnd < new Date())
--
--    A current-week bracket's week_end is the coming Sunday, so that branch
--    has been unreachable since 242 landed. claim_league_resolution (027) and
--    distribute_league_rewards (067) are correct code that nothing calls, and
--    no cron calls them either — cron.job holds no weekly-league entry.
--
-- 2. NO ACTIVITY FLOOR. Bronze is promote = 10 of a 30-cap bracket and the
--    resolver ranks purely by weekly_xp. Live brackets have held 1–11 members,
--    32 of 35 memberships at 0 XP. Five weeks of that and an account that has
--    never opened the app is in Legend.
--
-- 3. WEEKLY XP WAS CLIENT-ASSERTED. increment_league_xp is clamped (2k/call,
--    150k/week, scoped to auth.uid()) but p_amount still came from the browser
--    and weekly_xp was an independent counter, not a projection. 75 calls
--    bought 150,000 weekly XP with no workout. Migration 297 already solved
--    this shape for the monthly board by deriving from xp_grant_log; the
--    weekly board never got the same treatment. It does now.
--
-- 4. BRACKETS WERE FRAGMENTED. ensure_my_league picked the NEWEST open bracket,
--    scattering a handful of users across near-empty brackets.
--
-- ── QUALIFICATION ─────────────────────────────────────────────────────────
--
-- qualified <=> active_days >= tier.min_workouts AND weekly_xp >= tier.min_xp
--
-- min_xp ships at 0 on every tier, and that is evidence-driven rather than
-- timid. The production ledger holds 10 user-weeks in total: median 23 XP,
-- p75 50 XP, and 35 of its 36 grants are 3-65 XP micro-actions (24 of them
-- water logs at 3 XP). The 5,025 mean is one 50,000 XP test grant. Any XP
-- floor in the hundreds would disqualify every user in the database including
-- the active ones, converting "stops AFK promotion" into "stops all
-- promotion". The column exists so the floor can be raised from data later.
--
-- Unqualified members keep rank NULL, sort below every qualified member, are
-- never promoted, and never consume a promotion slot.
--
-- ── DECAY ─────────────────────────────────────────────────────────────────
--
-- Grace first. A rest week is not cheating, and week one of absence is the
-- worst possible moment to punish someone in a fitness app.
--   1 quiet week  -> nothing
--   2 quiet weeks -> nothing (the client nudges)
--   3+ quiet weeks -> one tier per week, floor bronze
--
-- ── SHIELD ────────────────────────────────────────────────────────────────
--
-- Paid, 3 per account for life (kegan, 2026-08-08). There is no payment
-- infrastructure in this repo yet — no Stripe, no RevenueCat, no native
-- wrapper — so this migration ships the ENTITLEMENT and the CONSUMPTION only.
-- Granting a shield is service_role-only, which is the correct posture
-- regardless: a receipt-validating Edge Function is the future caller, and no
-- client path may ever mint one. The lifetime cap is enforced server-side so
-- it cannot be bypassed by replaying a receipt.
--
-- ── PASTE-SAFE ────────────────────────────────────────────────────────────
-- public.<table>, auth.<fn>(), bare columns in single-table statements,
-- scalar SELECT ... INTO (no %ROWTYPE, no record-field dot access), and
-- least()/greatest() in place of bare angle-bracket comparisons.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Schema
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS active_days   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qualified     BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome       TEXT,
  ADD COLUMN IF NOT EXISTS coins_awarded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS resolved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_count  INTEGER;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS league_inactive_weeks    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS league_shields_owned     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS league_shields_lifetime  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS league_shield_used_at    TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Privileged-column guard — the new columns are RPC-only
--
-- Re-emitted with the FULL installed body (read from pg_get_functiondef, not
-- from migration 173, per the CLAUDE.md rule about later migrations silently
-- reverting a function from a stale template) plus four new guards.
--
-- Without these, a client could zero league_inactive_weeks to erase its decay
-- or set league_shields_owned to an arbitrary number and never be demoted.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.user_profiles_block_privileged_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $guard$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.flex_coins                     := 0;
    NEW.total_xp                       := 0;
    NEW.current_level                  := 1;
    NEW.prestige_level                 := 0;
    NEW.league_tier                    := 'bronze';
    NEW.milestone_capsules_awarded     := 0;
    NEW.level_capsules_awarded_through := 0;
    NEW.referral_code                  := NULL;
    NEW.referred_by                    := NULL;
    NEW.workout_streak                 := 0;
    NEW.longest_workout_streak         := 0;
    NEW.login_streak                   := 0;
    NEW.longest_login_streak           := 0;
    NEW.last_workout_date              := NULL;
    NEW.last_login_date                := NULL;
    NEW.streak_freezes_available       := 1;
    NEW.last_daily_chest_at            := NULL;
    NEW.total_volume_lbs               := 0;
    NEW.total_distance_meters          := 0;
    NEW.overthrow_count                := 0;
    NEW.league_inactive_weeks          := 0;
    NEW.league_shields_owned           := 0;
    NEW.league_shields_lifetime        := 0;
    NEW.league_shield_used_at          := NULL;
    RETURN NEW;
  END IF;

  IF NEW.flex_coins IS DISTINCT FROM OLD.flex_coins THEN
    RAISE EXCEPTION 'flex_coins is RPC-only (use increment_flex_coins)' USING ERRCODE = '42501';
  END IF;
  IF NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
    RAISE EXCEPTION 'total_xp is RPC-only (use increment_user_xp)' USING ERRCODE = '42501';
  END IF;
  IF NEW.current_level IS DISTINCT FROM OLD.current_level THEN
    RAISE EXCEPTION 'current_level is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.prestige_level IS DISTINCT FROM OLD.prestige_level THEN
    RAISE EXCEPTION 'prestige_level is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.league_tier IS DISTINCT FROM OLD.league_tier THEN
    RAISE EXCEPTION 'league_tier is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.milestone_capsules_awarded IS DISTINCT FROM OLD.milestone_capsules_awarded THEN
    RAISE EXCEPTION 'milestone_capsules_awarded is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.level_capsules_awarded_through IS DISTINCT FROM OLD.level_capsules_awarded_through THEN
    RAISE EXCEPTION 'level_capsules_awarded_through is RPC-only (use reset_my_profile_stats)' USING ERRCODE = '42501';
  END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referral_code is RPC-only (use get_my_referral_code)' USING ERRCODE = '42501';
  END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'referred_by is RPC-only (use claim_referral)' USING ERRCODE = '42501';
  END IF;
  IF NEW.workout_streak IS DISTINCT FROM OLD.workout_streak THEN
    RAISE EXCEPTION 'workout_streak is RPC-only (use advance_workout_streak)' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_workout_streak IS DISTINCT FROM OLD.longest_workout_streak THEN
    RAISE EXCEPTION 'longest_workout_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.login_streak IS DISTINCT FROM OLD.login_streak THEN
    RAISE EXCEPTION 'login_streak is RPC-only (use advance_login_streak)' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_login_streak IS DISTINCT FROM OLD.longest_login_streak THEN
    RAISE EXCEPTION 'longest_login_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_workout_date IS DISTINCT FROM OLD.last_workout_date THEN
    RAISE EXCEPTION 'last_workout_date is RPC-only (use advance_workout_streak)' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_login_date IS DISTINCT FROM OLD.last_login_date THEN
    RAISE EXCEPTION 'last_login_date is RPC-only (use advance_login_streak)' USING ERRCODE = '42501';
  END IF;
  IF NEW.streak_freezes_available IS DISTINCT FROM OLD.streak_freezes_available THEN
    RAISE EXCEPTION 'streak_freezes_available is RPC-only (use the coin shop purchase RPC)' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_daily_chest_at IS DISTINCT FROM OLD.last_daily_chest_at THEN
    RAISE EXCEPTION 'last_daily_chest_at is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.total_volume_lbs IS DISTINCT FROM OLD.total_volume_lbs THEN
    RAISE EXCEPTION 'total_volume_lbs is RPC-only (use increment_user_volume / reconcile_my_workout_volume)' USING ERRCODE = '42501';
  END IF;
  IF NEW.total_distance_meters IS DISTINCT FROM OLD.total_distance_meters THEN
    RAISE EXCEPTION 'total_distance_meters is RPC-only (use increment_user_distance)' USING ERRCODE = '42501';
  END IF;
  IF NEW.overthrow_count IS DISTINCT FROM OLD.overthrow_count THEN
    RAISE EXCEPTION 'overthrow_count is RPC-only (use increment_overthrow_count)' USING ERRCODE = '42501';
  END IF;
  IF NEW.league_inactive_weeks IS DISTINCT FROM OLD.league_inactive_weeks THEN
    RAISE EXCEPTION 'league_inactive_weeks is RPC-only (set by roll_weekly_leagues)' USING ERRCODE = '42501';
  END IF;
  IF NEW.league_shields_owned IS DISTINCT FROM OLD.league_shields_owned THEN
    RAISE EXCEPTION 'league_shields_owned is RPC-only (use grant_league_shield)' USING ERRCODE = '42501';
  END IF;
  IF NEW.league_shields_lifetime IS DISTINCT FROM OLD.league_shields_lifetime THEN
    RAISE EXCEPTION 'league_shields_lifetime is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.league_shield_used_at IS DISTINCT FROM OLD.league_shield_used_at THEN
    RAISE EXCEPTION 'league_shield_used_at is RPC-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Void the stranded brackets  (one-shot; confirmed by kegan 2026-08-08)
--
-- 7 past-week brackets, oldest 2026-05-04, 32 of 35 memberships at 0 XP.
-- Resolving them under ANY ruleset would promote AFK accounts, which is the
-- outcome this whole migration exists to prevent. They are marked resolved
-- with no ranks, no tier changes, no payouts and no notifications.
--
-- This is deliberate, not a bug. outcome = 'void' records why, so a future
-- reader does not mistake these for brackets the resolver skipped.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.league_members
   SET outcome = 'void'
 WHERE outcome IS NULL
   AND rank IS NULL
   AND league_id IN (
     SELECT id FROM public.leagues
      WHERE is_resolved = FALSE
        AND week_end = LEAST(week_end, CURRENT_DATE)
        AND NOT (week_end = CURRENT_DATE)
   );

UPDATE public.leagues
   SET is_resolved = TRUE,
       resolved_at = now(),
       qualified_count = 0
 WHERE is_resolved = FALSE
   AND week_end = LEAST(week_end, CURRENT_DATE)
   AND NOT (week_end = CURRENT_DATE);

-- Same treatment for the monthly board, whose cron has been flipping
-- is_resolved without distributing anything since migration 132.
UPDATE public.monthly_leagues
   SET is_resolved = TRUE
 WHERE is_resolved = FALSE
   AND month_end = LEAST(month_end, CURRENT_DATE)
   AND NOT (month_end = CURRENT_DATE);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Server-derived weekly XP  (mirrors migration 297's monthly writer)
--
-- Takes no amount. Derives the standing from SUM(xp_grant_log.amount) inside
-- the bracket's own week, so there is no number here for a client to inflate.
-- SET rather than increment, so calling it twice on one action is harmless.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sync_my_weekly_league()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync_weekly$
DECLARE
  v_uid        UUID := auth.uid();
  v_member_id  UUID;
  v_league_id  UUID;
  v_week_start DATE;
  v_week_end   DATE;
  v_xp         INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_week_start := (date_trunc('week', CURRENT_DATE))::DATE;
  v_week_end   := v_week_start + 6;

  SELECT id INTO v_league_id
    FROM public.leagues
   WHERE week_start = v_week_start
     AND id IN (SELECT league_id FROM public.league_members WHERE user_id = v_uid)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_league_id IS NULL THEN
    RETURN;  -- not placed yet; ensure_my_league() runs first
  END IF;

  SELECT id INTO v_member_id
    FROM public.league_members
   WHERE league_id = v_league_id AND user_id = v_uid
   LIMIT 1;

  IF v_member_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_xp
    FROM public.xp_grant_log
   WHERE user_id = v_uid
     AND granted_at >= v_week_start::TIMESTAMPTZ
     AND granted_at = LEAST(granted_at, (v_week_end + 1)::TIMESTAMPTZ);

  UPDATE public.league_members
     SET weekly_xp = GREATEST(0, v_xp)
   WHERE id = v_member_id;
END;
$sync_weekly$;

REVOKE ALL ON FUNCTION public.sync_my_weekly_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_my_weekly_league() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_my_weekly_league() TO authenticated;

-- The client-supplied amount has no remaining purpose now that weekly XP is
-- a projection of the ledger. Revoked rather than dropped so a stale bundle
-- gets a clean 42501 instead of a 404 it might silently swallow.
REVOKE EXECUTE ON FUNCTION public.increment_league_xp(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_league_xp(UUID, INTEGER) FROM anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Activity — distinct days trained inside a window
--
-- Strength OR cardio, matching how workout_streak has been defined since
-- migration 016. A day counts once no matter how many sessions land on it,
-- so ten short logs in one evening is one active day.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.league_active_days(
  p_user_id UUID,
  p_from    DATE,
  p_to      DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $active_days$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_days FROM (
    SELECT date FROM public.workout_logs
     WHERE user_id = p_user_id AND date BETWEEN p_from AND p_to
    UNION
    SELECT date FROM public.cardio_logs
     WHERE user_id = p_user_id AND date BETWEEN p_from AND p_to
  ) AS trained_days;
  RETURN COALESCE(v_days, 0);
END;
$active_days$;

REVOKE ALL ON FUNCTION public.league_active_days(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_active_days(UUID, DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.league_active_days(UUID, DATE, DATE) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Cron-safe notification
--
-- notify_league_resolution_for (040, hardened by 288) demands auth.uid() AND
-- a shared resolved league between sender and recipient — correct for a
-- client caller, impossible for pg_cron, which has no session user. This is
-- the internal twin. It reuses league_resolution_text() so all 15 languages
-- keep working, and it is revoked from every client role.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_league_resolution_internal(
  p_user_id   UUID,
  p_outcome   TEXT,
  p_from_tier TEXT,
  p_to_tier   TEXT,
  p_coins     INTEGER,
  p_capsule   TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $notify_internal$
DECLARE
  v_email TEXT;
  v_lang  TEXT;
  v_text  JSONB;
  v_id    UUID;
  v_type  TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_outcome NOT IN ('promote', 'demote', 'hold') THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.league_resolution_text(
    COALESCE(v_lang, 'en'), p_outcome,
    COALESCE(p_from_tier, ''), COALESCE(p_to_tier, ''),
    COALESCE(p_coins, 0), p_capsule
  );

  v_type := CASE p_outcome
              WHEN 'promote' THEN 'league_promoted'
              WHEN 'demote'  THEN 'league_demoted'
              ELSE 'league_held'
            END;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id, v_email, v_type,
          v_text->>'title', v_text->>'body', '🏆', '/dashboard',
          jsonb_build_object('outcome', p_outcome, 'coins', COALESCE(p_coins, 0)))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$notify_internal$;

REVOKE ALL ON FUNCTION public.notify_league_resolution_internal(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_league_resolution_internal(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.notify_league_resolution_internal(UUID, TEXT, TEXT, TEXT, INTEGER, TEXT) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The resolver
--
-- Internal. No auth.uid() guard, because pg_cron has no session user — which
-- is exactly why it must be unreachable from PostgREST. Every public-schema
-- function is an endpoint the moment it exists, and an exposed resolver lets
-- anyone settle a bracket early. Revoked from PUBLIC, anon and authenticated.
--
-- Idempotency comes from the caller's atomic claim on leagues.is_resolved,
-- not from a rank probe. The old 067 guard ("any rank non-null means done")
-- cannot work here: a bracket where nobody qualifies writes zero ranks and
-- would re-run forever.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_league_bracket_internal(p_league_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resolve$
DECLARE
  c_min_bracket CONSTANT INTEGER := 5;   -- qualified members needed to move anyone
  c_decay_grace CONSTANT INTEGER := 2;   -- quiet weeks tolerated before decay

  v_tier        TEXT;
  v_week_start  DATE;
  v_week_end    DATE;
  v_promote_pct NUMERIC;
  v_demote_pct  NUMERIC;
  v_min_days    INTEGER;
  v_min_xp      INTEGER;
  v_coins       INTEGER;
  v_capsule     TEXT;

  v_qualified   INTEGER := 0;
  v_promote_n   INTEGER := 0;
  v_demote_n    INTEGER := 0;
  v_rank        INTEGER := 0;
  v_touched     INTEGER := 0;

  v_mid         UUID;
  v_uid         UUID;
  v_email       TEXT;
  v_days        INTEGER;
  v_xp          INTEGER;
  v_is_q        BOOLEAN;
  v_outcome     TEXT;
  v_new_tier    TEXT;
  v_pay         INTEGER;
  v_cap         TEXT;
  v_quiet       INTEGER;
  v_shields     INTEGER;
  v_shielded    BOOLEAN;
BEGIN
  SELECT tier, week_start, week_end
    INTO v_tier, v_week_start, v_week_end
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_tier IS NULL THEN
    RETURN 0;
  END IF;

  SELECT promote_pct, demote_pct, min_days, min_xp, reward_coins, reward_capsule
    INTO v_promote_pct, v_demote_pct, v_min_days, v_min_xp, v_coins, v_capsule
    FROM (VALUES
      ('bronze',   0.50, 0.00, 1, 0,   50, NULL::TEXT),
      ('silver',   0.40, 0.10, 1, 0,  100, NULL),
      ('gold',     0.30, 0.15, 2, 0,  200, 'standard'),
      ('platinum', 0.25, 0.20, 2, 0,  350, 'premium'),
      ('diamond',  0.20, 0.20, 3, 0,  600, 'premium'),
      ('legend',   0.00, 0.20, 3, 0, 1000, 'elite')
    ) AS cfg(tier_id, promote_pct, demote_pct, min_days, min_xp, reward_coins, reward_capsule)
   WHERE tier_id = v_tier;

  IF v_promote_pct IS NULL THEN
    RETURN 0;
  END IF;

  -- Pass 1: stamp activity and qualification on every membership row.
  FOR v_mid IN
    SELECT id FROM public.league_members WHERE league_id = p_league_id
  LOOP
    SELECT user_id, COALESCE(weekly_xp, 0) INTO v_uid, v_xp
      FROM public.league_members WHERE id = v_mid;

    v_days := public.league_active_days(v_uid, v_week_start, v_week_end);
    v_is_q := (v_days >= v_min_days) AND (v_xp >= v_min_xp);

    UPDATE public.league_members
       SET active_days = v_days, qualified = v_is_q
     WHERE id = v_mid;
  END LOOP;

  SELECT COUNT(*) INTO v_qualified
    FROM public.league_members
   WHERE league_id = p_league_id AND qualified = TRUE;

  -- Slots are computed over the QUALIFIED field only, so an idle member can
  -- never occupy one. Proportions rather than absolute counts: a fixed
  -- "top 10" is what let a 6-person bronze bracket promote everybody.
  IF v_qualified >= c_min_bracket THEN
    v_promote_n := GREATEST(1, CEIL(v_qualified * v_promote_pct))::INTEGER;
    v_demote_n  := FLOOR(v_qualified * v_demote_pct)::INTEGER;
    IF v_promote_pct = 0 THEN
      v_promote_n := 0;
    END IF;
  END IF;

  -- Pass 2: qualified members, ranked. Tie-break by joined_at so the member
  -- who has been in the bracket longer wins — same convention as 067.
  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = TRUE
     ORDER BY weekly_xp DESC NULLS LAST, joined_at ASC
  LOOP
    v_rank := v_rank + 1;

    SELECT user_id, user_email INTO v_uid, v_email
      FROM public.league_members WHERE id = v_mid;

    v_shielded := FALSE;

    IF v_promote_n > 0 AND v_rank <= v_promote_n THEN
      v_outcome  := 'promote';
      v_new_tier := CASE v_tier
                      WHEN 'bronze'   THEN 'silver'
                      WHEN 'silver'   THEN 'gold'
                      WHEN 'gold'     THEN 'platinum'
                      WHEN 'platinum' THEN 'diamond'
                      WHEN 'diamond'  THEN 'legend'
                      ELSE v_tier
                    END;
      -- First place takes a 1.5x purse. Everyone else in the zone takes the
      -- tier rate.
      v_pay := CASE WHEN v_rank = 1 THEN (v_coins * 3) / 2 ELSE v_coins END;
      v_cap := v_capsule;

    ELSIF v_demote_n > 0 AND v_rank > (v_qualified - v_demote_n) THEN
      SELECT COALESCE(league_shields_owned, 0) INTO v_shields
        FROM public.user_profiles WHERE id = v_uid;

      IF v_shields >= 1 THEN
        UPDATE public.user_profiles
           SET league_shields_owned = league_shields_owned - 1,
               league_shield_used_at = now()
         WHERE id = v_uid;
        v_shielded := TRUE;
        v_outcome  := 'hold';
        v_new_tier := v_tier;
        v_pay      := 0;
        v_cap      := NULL;
      ELSE
        v_outcome  := 'demote';
        v_new_tier := CASE v_tier
                        WHEN 'silver'   THEN 'bronze'
                        WHEN 'gold'     THEN 'silver'
                        WHEN 'platinum' THEN 'gold'
                        WHEN 'diamond'  THEN 'platinum'
                        WHEN 'legend'   THEN 'diamond'
                        ELSE v_tier
                      END;
        v_pay := 0;
        v_cap := NULL;
      END IF;

    ELSE
      -- Qualified and mid-table. This used to pay nothing at all, which is
      -- ~90% of a full bracket receiving no signal that the week happened.
      v_outcome  := 'hold';
      v_new_tier := v_tier;
      v_pay      := GREATEST(1, v_coins / 4);
      v_cap      := NULL;
    END IF;

    UPDATE public.league_members
       SET rank = v_rank, outcome = v_outcome, coins_awarded = COALESCE(v_pay, 0)
     WHERE id = v_mid;

    -- Qualifying clears the decay counter, shield or no shield.
    UPDATE public.user_profiles
       SET league_inactive_weeks = 0
     WHERE id = v_uid;

    IF v_new_tier IS DISTINCT FROM v_tier THEN
      UPDATE public.user_profiles SET league_tier = v_new_tier WHERE id = v_uid;
    END IF;

    IF v_pay > 0 THEN
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + v_pay
       WHERE id = v_uid;
    END IF;

    IF v_cap IS NOT NULL THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_uid, v_email, v_cap);
    END IF;

    -- Silent mid-table holds would be notification spam. A shielded hold is
    -- always worth telling someone about: they spent something.
    IF v_outcome IN ('promote', 'demote') OR v_shielded THEN
      PERFORM public.notify_league_resolution_internal(
        v_uid, v_outcome, v_tier, v_new_tier, COALESCE(v_pay, 0), v_cap);
    END IF;

    v_touched := v_touched + 1;
  END LOOP;

  -- Pass 3: the unqualified. No rank, no payout, and decay only after the
  -- grace window. rank stays NULL so the UI can render them as Unranked
  -- rather than as the bottom of a list they were not competing in.
  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = FALSE
  LOOP
    SELECT user_id INTO v_uid FROM public.league_members WHERE id = v_mid;

    UPDATE public.league_members
       SET outcome = 'unranked', coins_awarded = 0
     WHERE id = v_mid;

    UPDATE public.user_profiles
       SET league_inactive_weeks = COALESCE(league_inactive_weeks, 0) + 1
     WHERE id = v_uid;

    SELECT COALESCE(league_inactive_weeks, 0), COALESCE(league_shields_owned, 0)
      INTO v_quiet, v_shields
      FROM public.user_profiles WHERE id = v_uid;

    IF v_quiet > c_decay_grace AND v_tier <> 'bronze' THEN
      IF v_shields >= 1 THEN
        UPDATE public.user_profiles
           SET league_shields_owned = league_shields_owned - 1,
               league_shield_used_at = now()
         WHERE id = v_uid;
        PERFORM public.notify_league_resolution_internal(
          v_uid, 'hold', v_tier, v_tier, 0, NULL);
      ELSE
        v_new_tier := CASE v_tier
                        WHEN 'silver'   THEN 'bronze'
                        WHEN 'gold'     THEN 'silver'
                        WHEN 'platinum' THEN 'gold'
                        WHEN 'diamond'  THEN 'platinum'
                        WHEN 'legend'   THEN 'diamond'
                        ELSE v_tier
                      END;
        UPDATE public.user_profiles SET league_tier = v_new_tier WHERE id = v_uid;
        UPDATE public.league_members SET outcome = 'decayed' WHERE id = v_mid;
        PERFORM public.notify_league_resolution_internal(
          v_uid, 'demote', v_tier, v_new_tier, 0, NULL);
      END IF;
    END IF;

    v_touched := v_touched + 1;
  END LOOP;

  UPDATE public.leagues
     SET qualified_count = v_qualified,
         resolved_at = now()
   WHERE id = p_league_id;

  RETURN v_touched;
END;
$resolve$;

REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. The cron entry point
--
-- Single-winner claim per bracket, the same shape roll_crew_seasons() uses:
-- two overlapping firings can both SELECT a due bracket, but only the one
-- whose UPDATE actually moves is_resolved goes on to distribute.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.roll_weekly_leagues()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $roll$
DECLARE
  v_id      UUID;
  v_claimed INTEGER := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.leagues
     WHERE is_resolved = FALSE
       AND week_end = LEAST(week_end, CURRENT_DATE)
       AND NOT (week_end = CURRENT_DATE)
     ORDER BY week_start
  LOOP
    UPDATE public.leagues
       SET is_resolved = TRUE
     WHERE id = v_id AND is_resolved = FALSE;

    IF FOUND THEN
      PERFORM public.resolve_league_bracket_internal(v_id);
      v_claimed := v_claimed + 1;
    END IF;
  END LOOP;

  RETURN v_claimed;
END;
$roll$;

REVOKE ALL ON FUNCTION public.roll_weekly_leagues() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roll_weekly_leagues() FROM anon;
REVOKE ALL ON FUNCTION public.roll_weekly_leagues() FROM authenticated;

-- Monday 00:10 UTC, ten minutes after gym-rival-settle so the two weekly
-- settlements do not contend.
SELECT cron.unschedule('roll-weekly-leagues')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'roll-weekly-leagues');

SELECT cron.schedule('roll-weekly-leagues', '10 0 * * 1',
  'SELECT public.roll_weekly_leagues();');

-- The monthly job has been flipping is_resolved with no distribution since
-- migration 132, destroying the state a distributor would key off. Off until
-- it has a real resolver.
SELECT cron.unschedule('monthly-league-resolve')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'monthly-league-resolve');

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Bracket density
--
-- ensure_my_league picked the NEWEST open bracket, which scatters a small
-- population across several near-empty ones. Fullest-first concentrates them.
-- Everything else in this function is unchanged from migration 242.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ensure_my_league()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $ensure$
DECLARE
  v_uid        UUID := auth.uid();
  v_email      TEXT := public.current_user_email();
  v_tier       TEXT;
  v_week_start DATE;
  v_week_end   DATE;
  v_league_id  UUID;
  v_member_id  UUID;
  v_league     JSONB;
  v_member     JSONB;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(league_tier, 'bronze') INTO v_tier
    FROM public.user_profiles
   WHERE id = v_uid;

  v_tier := coalesce(v_tier, 'bronze');
  IF NOT (v_tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend')) THEN
    v_tier := 'bronze';
  END IF;

  v_week_start := (date_trunc('week', CURRENT_DATE))::DATE;
  v_week_end   := v_week_start + 6;

  SELECT id, league_id INTO v_member_id, v_league_id
    FROM public.league_members
   WHERE user_id = v_uid
     AND league_id IN (
       SELECT id FROM public.leagues WHERE week_start = v_week_start
     )
   ORDER BY joined_at DESC
   LIMIT 1;

  IF v_member_id IS NULL THEN
    -- FULLEST bracket with room, not the newest. A bracket of six is not a
    -- competition; concentrating the field is the cheapest fix available.
    SELECT id INTO v_league_id
      FROM public.leagues
     WHERE tier = v_tier
       AND week_start = v_week_start
       AND is_resolved = FALSE
       AND member_count = least(member_count, 29)
     ORDER BY member_count DESC, created_at ASC
     LIMIT 1;

    IF v_league_id IS NULL THEN
      INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
      VALUES (v_tier, v_week_start, v_week_end, 0, FALSE)
      RETURNING id INTO v_league_id;
    END IF;

    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp)
    VALUES (v_league_id, v_uid, v_email, 0)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_member_id;

    IF v_member_id IS NULL THEN
      SELECT id INTO v_member_id
        FROM public.league_members
       WHERE league_id = v_league_id
         AND user_id = v_uid
       LIMIT 1;
    END IF;
  END IF;

  SELECT to_jsonb(leagues) INTO v_league
    FROM public.leagues
   WHERE id = v_league_id;

  SELECT to_jsonb(league_members) INTO v_member
    FROM public.league_members
   WHERE id = v_member_id;

  RETURN jsonb_build_object('league', v_league, 'member', v_member);
END;
$ensure$;

REVOKE ALL ON FUNCTION public.ensure_my_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_my_league() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_league() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Shield entitlement
--
-- Paid, three per account for life. No client grant path exists and none may
-- be added: the intended caller is a receipt-validating Edge Function running
-- as service_role. The lifetime cap lives here rather than in that function
-- so replaying a receipt cannot mint a fourth.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.grant_league_shield(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $grant_shield$
DECLARE
  c_lifetime_cap CONSTANT INTEGER := 3;
  v_lifetime INTEGER;
  v_owned    INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(league_shields_lifetime, 0), COALESCE(league_shields_owned, 0)
    INTO v_lifetime, v_owned
    FROM public.user_profiles WHERE id = p_user_id;

  IF v_lifetime IS NULL THEN
    RAISE EXCEPTION 'no such profile' USING ERRCODE = '22023';
  END IF;

  IF v_lifetime >= c_lifetime_cap THEN
    RETURN jsonb_build_object('granted', FALSE, 'reason', 'lifetime_cap',
                              'owned', v_owned, 'lifetime', v_lifetime);
  END IF;

  UPDATE public.user_profiles
     SET league_shields_owned    = COALESCE(league_shields_owned, 0) + 1,
         league_shields_lifetime = COALESCE(league_shields_lifetime, 0) + 1
   WHERE id = p_user_id;

  RETURN jsonb_build_object('granted', TRUE, 'owned', v_owned + 1,
                            'lifetime', v_lifetime + 1, 'cap', c_lifetime_cap);
END;
$grant_shield$;

REVOKE ALL ON FUNCTION public.grant_league_shield(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_league_shield(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.grant_league_shield(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_league_shield(UUID) TO service_role;

-- Read-only view of your own shield state, for the store UI.
CREATE OR REPLACE FUNCTION public.my_league_shields()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $my_shields$
DECLARE
  v_uid      UUID := auth.uid();
  v_owned    INTEGER;
  v_lifetime INTEGER;
  v_quiet    INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(league_shields_owned, 0),
         COALESCE(league_shields_lifetime, 0),
         COALESCE(league_inactive_weeks, 0)
    INTO v_owned, v_lifetime, v_quiet
    FROM public.user_profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'owned', COALESCE(v_owned, 0),
    'lifetime_purchased', COALESCE(v_lifetime, 0),
    'lifetime_cap', 3,
    'inactive_weeks', COALESCE(v_quiet, 0)
  );
END;
$my_shields$;

REVOKE ALL ON FUNCTION public.my_league_shields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_league_shields() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_league_shields() TO authenticated;

NOTIFY pgrst, 'reload schema';
