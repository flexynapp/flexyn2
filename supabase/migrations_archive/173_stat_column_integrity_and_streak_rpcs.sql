-- supabase/migrations/173_stat_column_integrity_and_streak_rpcs.sql
--
-- Completes the privileged-column lockdown started in migration 142.
-- The 142 trigger blocks direct client UPDATEs of flex_coins / total_xp /
-- streak counters / league_tier etc., but it missed the leaderboard
-- ranking columns themselves:
--
--   supabase.from('user_profiles')
--     .update({ total_volume_lbs: 999999999 })
--     .eq('id', auth.uid())
--
-- passes RLS (auth.uid() = id) and instantly tops every volume
-- leaderboard (125_period_leaderboard, 135/141 get_gym_leaderboard,
-- LeaderboardsContent / RegionalLeaderboardsModal client sorts). Same
-- hole for total_distance_meters (distance boards).
--
-- This migration:
--
--   1. Re-emits user_profiles_block_privileged_updates() with the full
--      142 body PLUS guards for the columns audited as server-maintained:
--        • total_volume_lbs        — increment_user_volume (023/032),
--                                    reconcile_my_workout_volume (142)
--        • total_distance_meters   — increment_user_distance (023/032)
--        • last_workout_date       — advance_workout_streak (below),
--                                    spend_streak_rescue (087)
--        • last_login_date         — advance_login_streak (below)
--        • streak_freezes_available — coin-shop purchase RPC (031),
--                                    freeze burn in advance_login_streak
--        • level_capsules_awarded_through — CAS column for the level-up
--                                    capsule grant (070/074); client-
--                                    settable meant reset-to-0 →
--                                    re-collect every level reward
--        • overthrow_count         — increment_overthrow_count (112/159)
--      The two date columns MUST ride along with the streak counters:
--      with only the counters blocked, a client could rewind
--      last_workout_date and replay advance_workout_streak for an
--      unbounded streak.
--
--   2. Extends the trigger to BEFORE INSERT. user_profiles has an
--      INSERT policy (001: auth.uid() = id) and the client updateMe is
--      an UPSERT, so if handle_new_user ever failed, the first client
--      write would INSERT — and a BEFORE UPDATE trigger never sees it.
--      A crafted INSERT could found the row with 9-digit coins/volume.
--      On client inserts we force every privileged column to its
--      schema default instead of raising, so a legitimate first-write
--      profile creation still succeeds.
--
--   3. Adds the server-side RPCs the blocked columns need. The 142
--      blocklist already included login_streak / workout_streak /
--      longest_* — but the CLIENT was still their only writer
--      (loginStreak.js / workoutStreak.js direct UPDATE), and both
--      reset flows (db.js deleteAccount, me.js resetForDeletion)
--      zeroed blocked columns via updateMe. Those flows break the
--      moment the 142 trigger is live. New RPCs:
--        • advance_login_streak(p_today)   — recomputes the streak
--          server-side from stored state (same rules as the client:
--          same-day no-op, +1 on consecutive day, freeze burn on gap,
--          else reset to 1). p_today is the user's LOCAL date, clamped
--          to ±2 days of server UTC so streak day boundaries follow
--          the user's clock but can't time-travel. Cheat ceiling:
--          +1/day, identical to legitimately opening the app.
--        • advance_workout_streak(p_today) — same, no freezes. We
--          deliberately do NOT require a workout_logs row for today:
--          logs are client-authored anyway, and backdated logs would
--          falsely fail the check.
--        • reset_my_profile_stats() — zeroes exactly the BLOCKED
--          columns for auth.uid() (the open columns stay in the
--          client's updateMe payload). Deliberately untouched:
--          prestige_level (the pre-142 reset never cleared it),
--          referral_code / referred_by (referral identity must
--          survive reset or reset→re-referral becomes a coin farm),
--          streak_freezes_available (purchased; faithful to the old
--          payload which never cleared it).
--
-- Audited but NOT blocked (would break live client engines — each
-- needs its writer moved server-side first; tracked as follow-ups):
--   • achievements_unlocked_count — written by the client achievements
--     engine (src/api/db.js _invokeXp) and the leaderboardStats
--     reconcile. Also only as trustworthy as the client-writable
--     achievements table itself (147 FIX 7 already treats COUNT(*) of
--     achievements as the capsule-grant cap, so the blast radius is
--     leaderboard sort order, not rewards).
--   • first_workout_capsule_granted — set true by the client grant
--     flow in src/lib/data/capsules.js.
--
-- ALSO FIXES A LATENT 142 BUG: the 142 trigger guards NEW.referred_by,
-- but NO migration ever created a referred_by column (referral links
-- live in public.referrals, mig 089 — a table with no client write
-- policy). plpgsql resolves NEW.<field> at runtime, so with the 142
-- trigger live, EVERY client UPDATE on user_profiles that reaches that
-- check dies with `record "new" has no field "referred_by"` — an
-- app-wide profile-write outage (username, onboarding, settings, all
-- of it). updateMe's 42703 strip-and-retry can't save it: the
-- "has no field" message doesn't match any of its column-extraction
-- patterns. We add the column idempotently below so the guard is valid
-- on every deployment state (142 already pasted or not). The column is
-- intentionally dormant until claim_referral is wired to populate it.
--
-- Paste-safe per repo convention: bare NEW./OLD., public.<table>,
-- single-table statements with bare columns, scalar SELECT ... INTO —
-- no alias.column or record-dotted tokens.

BEGIN;

-- ── 0. Column that 142's trigger references but nothing ever created ─
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID;

COMMENT ON COLUMN public.user_profiles.referred_by IS
  'Dormant denormalization of referrals.referrer_id. Created by mig 173 because the mig 142 trigger already guarded it; not yet populated by claim_referral.';

-- ── 1+2. Privileged-column trigger: 142 body + new guards + INSERT ──
CREATE OR REPLACE FUNCTION public.user_profiles_block_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $block_privileged$
BEGIN
  -- RPC path: function owner is postgres → allow.
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  -- Service-role bypass (for admin tooling / Edge Functions): also
  -- allowed. The service role JWT sets the request role to
  -- 'service_role' and Supabase elevates current_user accordingly.
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Client INSERT path (row missing — e.g. handle_new_user failed and
  -- the first updateMe upsert resolves to INSERT). Force every
  -- privileged column to its schema default rather than raising, so
  -- legitimate first-write profile creation still works but can't
  -- found the row with privileged state.
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
    RETURN NEW;
  END IF;

  -- Direct client UPDATE path → enforce column immutability. We use
  -- `IS DISTINCT FROM` so NULL→NULL doesn't trip the check.
  -- The error code 42501 ("insufficient_privilege") routes nicely
  -- through the client's existing RLS-error toast paths.

  -- Currency
  IF NEW.flex_coins IS DISTINCT FROM OLD.flex_coins THEN
    RAISE EXCEPTION 'flex_coins is RPC-only (use increment_flex_coins)' USING ERRCODE = '42501';
  END IF;

  -- XP / leveling
  IF NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
    RAISE EXCEPTION 'total_xp is RPC-only (use increment_user_xp)' USING ERRCODE = '42501';
  END IF;
  IF NEW.current_level IS DISTINCT FROM OLD.current_level THEN
    RAISE EXCEPTION 'current_level is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.prestige_level IS DISTINCT FROM OLD.prestige_level THEN
    RAISE EXCEPTION 'prestige_level is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- League standings (assigned by weekly scheduler)
  IF NEW.league_tier IS DISTINCT FROM OLD.league_tier THEN
    RAISE EXCEPTION 'league_tier is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Capsule rewards
  IF NEW.milestone_capsules_awarded IS DISTINCT FROM OLD.milestone_capsules_awarded THEN
    RAISE EXCEPTION 'milestone_capsules_awarded is RPC-only' USING ERRCODE = '42501';
  END IF;
  -- Level-up capsule CAS marker (070/074). Client-settable meant
  -- reset-to-0 → re-collect every level reward.
  IF NEW.level_capsules_awarded_through IS DISTINCT FROM OLD.level_capsules_awarded_through THEN
    RAISE EXCEPTION 'level_capsules_awarded_through is RPC-only (use reset_my_profile_stats)' USING ERRCODE = '42501';
  END IF;

  -- Referral code — squatting prevention. get_my_referral_code RPC
  -- atomically generates a unique code once per user; allowing the
  -- client to set it would let an attacker pre-empt a code targeting
  -- inbound referrals.
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referral_code is RPC-only (use get_my_referral_code)' USING ERRCODE = '42501';
  END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'referred_by is RPC-only (use claim_referral)' USING ERRCODE = '42501';
  END IF;

  -- Streaks — recomputed server-side from workout / login activity.
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
  -- Streak anchor dates — must be locked alongside the counters, or a
  -- client could rewind the date and replay the advance RPC for an
  -- unbounded streak.
  IF NEW.last_workout_date IS DISTINCT FROM OLD.last_workout_date THEN
    RAISE EXCEPTION 'last_workout_date is RPC-only (use advance_workout_streak)' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_login_date IS DISTINCT FROM OLD.last_login_date THEN
    RAISE EXCEPTION 'last_login_date is RPC-only (use advance_login_streak)' USING ERRCODE = '42501';
  END IF;
  -- Freezes are bought with coins (031) or burned by the login-streak
  -- advance; client-settable meant free streak immortality.
  IF NEW.streak_freezes_available IS DISTINCT FROM OLD.streak_freezes_available THEN
    RAISE EXCEPTION 'streak_freezes_available is RPC-only (use the coin shop purchase RPC)' USING ERRCODE = '42501';
  END IF;

  -- Cooldowns / one-shot timestamps (claim_daily_chest, spend_streak_rescue).
  IF NEW.last_daily_chest_at IS DISTINCT FROM OLD.last_daily_chest_at THEN
    RAISE EXCEPTION 'last_daily_chest_at is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Leaderboard ranking columns — the gap this migration closes.
  IF NEW.total_volume_lbs IS DISTINCT FROM OLD.total_volume_lbs THEN
    RAISE EXCEPTION 'total_volume_lbs is RPC-only (use increment_user_volume / reconcile_my_workout_volume)' USING ERRCODE = '42501';
  END IF;
  IF NEW.total_distance_meters IS DISTINCT FROM OLD.total_distance_meters THEN
    RAISE EXCEPTION 'total_distance_meters is RPC-only (use increment_user_distance)' USING ERRCODE = '42501';
  END IF;

  -- Nemesis overthrow tally (112/159 — requires proof of overthrow).
  IF NEW.overthrow_count IS DISTINCT FROM OLD.overthrow_count THEN
    RAISE EXCEPTION 'overthrow_count is RPC-only (use increment_overthrow_count)' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$block_privileged$;

-- Recreate as BEFORE INSERT OR UPDATE (142 created it UPDATE-only).
DROP TRIGGER IF EXISTS user_profiles_block_privileged_updates_tr ON public.user_profiles;
CREATE TRIGGER user_profiles_block_privileged_updates_tr
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_block_privileged_updates();


-- ── 3a. advance_login_streak ─────────────────────────────────────────
-- Server-side replacement for the direct UPDATE in
-- src/lib/data/loginStreak.js. Same math the client used:
--   last_login_date = p_today            → no-op
--   last_login_date = p_today - 1        → streak + 1
--   gap > 1 day AND freezes > 0          → streak + 1, burn a freeze
--   otherwise                            → reset to 1
-- p_today is the user's LOCAL calendar date so day boundaries follow
-- their clock; the ±2-day clamp vs server UTC covers every timezone
-- while blocking time travel. Coins / capsules stay client-driven off
-- the returned streak value (increment_flex_coins is already atomic).
CREATE OR REPLACE FUNCTION public.advance_login_streak(p_today DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $advance_login_streak$
DECLARE
  v_uid          UUID := auth.uid();
  v_server_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_streak       INT;
  v_last         DATE;
  v_longest      INT;
  v_freezes      INT;
  v_diff         INT;
  v_new_streak   INT;
  v_new_longest  INT;
  v_new_freezes  INT;
  v_freeze_used  BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_today IS NULL OR p_today < v_server_today - 2 OR p_today > v_server_today + 2 THEN
    RAISE EXCEPTION 'p_today out of range' USING ERRCODE = '22023';
  END IF;

  SELECT login_streak, last_login_date, longest_login_streak, streak_freezes_available
    INTO v_streak, v_last, v_longest, v_freezes
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  v_streak  := COALESCE(v_streak, 0);
  v_longest := COALESCE(v_longest, 0);
  v_freezes := COALESCE(v_freezes, 0);

  -- Same-day repeat or replayed older date → no-op.
  IF v_last IS NOT NULL AND p_today <= v_last THEN
    RETURN jsonb_build_object(
      'is_new_day', FALSE,
      'streak', v_streak,
      'longest', v_longest,
      'freeze_used', FALSE,
      'freezes_remaining', v_freezes
    );
  END IF;

  IF v_last IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_diff := p_today - v_last;
    IF v_diff = 1 THEN
      v_new_streak := v_streak + 1;
    ELSIF v_diff > 1 AND v_freezes > 0 THEN
      v_new_streak  := v_streak + 1;
      v_freeze_used := TRUE;
    ELSE
      v_new_streak := 1;
    END IF;
  END IF;

  v_new_longest := GREATEST(v_longest, v_new_streak);
  v_new_freezes := CASE WHEN v_freeze_used THEN GREATEST(v_freezes - 1, 0) ELSE v_freezes END;

  UPDATE public.user_profiles
     SET login_streak             = v_new_streak,
         last_login_date          = p_today,
         longest_login_streak     = v_new_longest,
         streak_freezes_available = v_new_freezes,
         updated_at               = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'is_new_day', TRUE,
    'streak', v_new_streak,
    'longest', v_new_longest,
    'freeze_used', v_freeze_used,
    'freezes_remaining', v_new_freezes
  );
END;
$advance_login_streak$;

REVOKE ALL ON FUNCTION public.advance_login_streak(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_login_streak(DATE) TO authenticated;


-- ── 3b. advance_workout_streak ───────────────────────────────────────
-- Server-side replacement for the direct UPDATE in
-- src/lib/data/workoutStreak.js. No freezes for workout streaks.
-- Compatible with spend_streak_rescue (087): the rescue rewinds
-- last_workout_date to yesterday, so the next advance sees diff = 1.
CREATE OR REPLACE FUNCTION public.advance_workout_streak(p_today DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $advance_workout_streak$
DECLARE
  v_uid          UUID := auth.uid();
  v_server_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_streak       INT;
  v_last         DATE;
  v_longest      INT;
  v_diff         INT;
  v_new_streak   INT;
  v_new_longest  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_today IS NULL OR p_today < v_server_today - 2 OR p_today > v_server_today + 2 THEN
    RAISE EXCEPTION 'p_today out of range' USING ERRCODE = '22023';
  END IF;

  SELECT workout_streak, last_workout_date, longest_workout_streak
    INTO v_streak, v_last, v_longest
    FROM public.user_profiles
   WHERE id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '22023';
  END IF;

  v_streak  := COALESCE(v_streak, 0);
  v_longest := COALESCE(v_longest, 0);

  IF v_last IS NOT NULL AND p_today <= v_last THEN
    RETURN jsonb_build_object(
      'is_new_day', FALSE,
      'streak', v_streak,
      'longest', v_longest
    );
  END IF;

  IF v_last IS NULL THEN
    v_new_streak := 1;
  ELSE
    v_diff := p_today - v_last;
    IF v_diff = 1 THEN
      v_new_streak := v_streak + 1;
    ELSE
      v_new_streak := 1;
    END IF;
  END IF;

  v_new_longest := GREATEST(v_longest, v_new_streak);

  UPDATE public.user_profiles
     SET workout_streak         = v_new_streak,
         last_workout_date      = p_today,
         longest_workout_streak = v_new_longest,
         updated_at             = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'is_new_day', TRUE,
    'streak', v_new_streak,
    'longest', v_new_longest
  );
END;
$advance_workout_streak$;

REVOKE ALL ON FUNCTION public.advance_workout_streak(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_workout_streak(DATE) TO authenticated;


-- ── 3c. reset_my_profile_stats ───────────────────────────────────────
-- Zeroes exactly the BLOCKED columns for the caller. The reset flows
-- (db.js deleteAccount step 3, me.js resetForDeletion) keep clearing
-- the open columns (identity, onboarding, cosmetics,
-- achievements_unlocked_count, first-workout flag, account_reset_at)
-- through updateMe as before. Deliberately untouched here:
-- prestige_level (the pre-142 reset never cleared it), referral_code /
-- referred_by (referral identity survives reset so reset→re-referral
-- can't farm coins), streak_freezes_available (purchased; the old
-- payload never cleared it either).
CREATE OR REPLACE FUNCTION public.reset_my_profile_stats()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $reset_my_profile_stats$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles
     SET total_xp                       = 0,
         current_level                  = 1,
         flex_coins                     = 0,
         milestone_capsules_awarded     = 0,
         level_capsules_awarded_through = 0,
         total_volume_lbs               = 0,
         total_distance_meters          = 0,
         login_streak                   = 0,
         longest_login_streak           = 0,
         last_login_date                = NULL,
         workout_streak                 = 0,
         longest_workout_streak         = 0,
         last_workout_date              = NULL,
         league_tier                    = 'bronze',
         last_daily_chest_at            = NULL,
         overthrow_count                = 0,
         updated_at                     = now()
   WHERE id = v_uid;
END;
$reset_my_profile_stats$;

REVOKE ALL ON FUNCTION public.reset_my_profile_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_my_profile_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
