-- supabase/migrations/142_user_profiles_privileged_columns.sql
--
-- Closes a CRITICAL exploit found in the Onboarding security audit:
-- the user_profiles UPDATE policy from mig 001 has `USING (auth.uid() = id)`
-- but NO `WITH CHECK` clause. Combined with the table-level UPDATE grant
-- to `authenticated`, this lets any signed-in user UPDATE their OWN
-- row's privileged server-state columns directly from devtools:
--
--   supabase.from('user_profiles').update({
--     flex_coins: 999999999,
--     total_xp:   99999999,
--     current_level: 99,
--     prestige_level: 10,
--     league_tier: 'diamond',
--     milestone_capsules_awarded: 0,
--     referral_code: 'AAAAAA'
--   }).eq('id', auth.uid())
--
-- RLS sees `auth.uid() = id` → passes. Every atomic-RPC concurrency fix
-- (mig 023 increment_user_xp, mig 030 increment_flex_coins, mig 068
-- claim_daily_chest, mig 070, 087, 124, etc.) is bypassed because the
-- raw table UPDATE never has to go through the RPC's gate. Same exploit
-- class as the RPC trust bugs patched in mig 141.
--
-- FIX (two prongs):
--   1. Add WITH CHECK (auth.uid() = id) on the UPDATE policy — also
--      prevents row-id rewrite (defense in depth).
--   2. BEFORE UPDATE trigger that compares OLD vs NEW on every
--      privileged column. If a non-postgres caller (i.e. direct client
--      UPDATE via PostgREST) is changing one, raise 42501. SECURITY
--      DEFINER RPCs run as their function owner (postgres) and bypass
--      the check, so legitimate XP / coins / level / streak writes
--      keep working.
--
-- Why a trigger instead of column-level GRANT?
--   PG semantics: column-level REVOKE does NOT subtract from a
--   table-level GRANT. To enforce column immutability via grants we'd
--   have to REVOKE UPDATE on the entire table and re-GRANT every safe
--   column — that's a fragile enumeration that needs updating every
--   time a new client-writable column is added. The trigger names the
--   PRIVILEGED columns explicitly (a short, stable list) and ignores
--   everything else, so adding new client-writable columns later
--   needs no migration update.

BEGIN;

-- Step 1: tighten the UPDATE policy with WITH CHECK.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
CREATE POLICY "Users can update their own profile"
  ON public.user_profiles FOR UPDATE
  USING      (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- Step 2: BEFORE UPDATE trigger blocking direct writes to privileged
-- columns. SECURITY DEFINER RPCs run as `postgres`; direct client
-- UPDATEs run as `authenticated`. We allow the former and reject the
-- latter on any privileged-column change.
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

  -- Direct client path → enforce column immutability. We use
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
    RAISE EXCEPTION 'workout_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_workout_streak IS DISTINCT FROM OLD.longest_workout_streak THEN
    RAISE EXCEPTION 'longest_workout_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.login_streak IS DISTINCT FROM OLD.login_streak THEN
    RAISE EXCEPTION 'login_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_login_streak IS DISTINCT FROM OLD.longest_login_streak THEN
    RAISE EXCEPTION 'longest_login_streak is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Cooldowns / one-shot timestamps (claim_daily_chest, spend_streak_rescue).
  IF NEW.last_daily_chest_at IS DISTINCT FROM OLD.last_daily_chest_at THEN
    RAISE EXCEPTION 'last_daily_chest_at is RPC-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$block_privileged$;

DROP TRIGGER IF EXISTS user_profiles_block_privileged_updates_tr ON public.user_profiles;
CREATE TRIGGER user_profiles_block_privileged_updates_tr
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_block_privileged_updates();

NOTIFY pgrst, 'reload schema';

COMMIT;
