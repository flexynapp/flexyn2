-- 316_daily_quests_xp_crew_and_streaks.sql
--
-- Daily quests paid coins and nothing else. Production says the feature is
-- inert: 343 quest rows, 9 ever completed, 5 ever claimed. The hard tier is
-- 123 rows, 2 completed and ZERO claims in its whole life.
--
-- This migration is the server half of finishing it. Four changes:
--
--   1. xp_reward — quests now grant XP as well as coins, server-priced by
--      difficulty exactly the way coin_reward already was (mig 199/265).
--      A claimed quest was invisible to level, league and crew; it moved a
--      shop balance and nothing else.
--
--   2. A 'crew' difficulty tier. Claiming any quest banks a share of its XP
--      on the claimant's crew; a crew-tier quest banks the full amount. That
--      is the one reward in the app that leaves the individual, and it is
--      why the tier exists.
--
--   3. user_quest_stats — a per-user quest streak and lifetime counters,
--      advanced by the perfect-day claim below. Written ONLY by SECURITY
--      DEFINER functions; the client has SELECT and nothing else.
--
--   4. claim_perfect_day_bonus — once per local day, when every quest the day
--      handed you is claimed. This is the return-tomorrow mechanic the feature
--      never had.
--
-- ── Why the XP numbers are small ─────────────────────────────────────────
--
--   easy 20 · medium 50 · hard 120 · crew 60 · perfect day 100
--
-- A maximal day is 250 from quests plus 100 for the perfect-day bonus. For
-- scale, `workout_completed` alone caps at 4,000 XP/day in grant_action_xp.
-- Quests are a pointer at the training, not a substitute for it, and the two
-- caps added below (daily_quest 400, quest_perfect_day 150) hold that line
-- even if src/lib/questCatalog.js drifts. Both grants route through
-- grant_action_xp rather than increment_user_xp directly — the mistake
-- migration 298 had to come back and fix for crew fuel.
--
-- ── Crew XP is server-computed, always ───────────────────────────────────
--
-- award_crew_progress is service_role-only and stays that way; the quest RPCs
-- reach it as SECURITY DEFINER owners. It is called with p_points => 0 and
-- p_result => 'quest' deliberately: a daily quest must move crew_xp and
-- crew_level WITHOUT touching season standings points or the war record.
-- Feeding a solo daily into the crew ladder would let one grinder carry a
-- division.
--
-- ── NOT a clawback ───────────────────────────────────────────────────────
--
-- Existing rows keep the coin_reward they were stamped with and get
-- xp_reward = 0 by backfill, because the trigger only prices a row on INSERT
-- and those rows were sold to the user at the old rate. Tomorrow's quests
-- carry XP.
--
-- Paste-safety: scalar SELECT ... INTO only, no dotted alias.column tokens
-- and no record-field access (CLAUDE.md §7).

-- ── 1. xp_reward on the quest row, and room for a fourth tier ────────────
ALTER TABLE public.user_daily_quests
  ADD COLUMN IF NOT EXISTS xp_reward integer NOT NULL DEFAULT 0;

-- The table carries CHECK (difficulty IN ('easy','medium','hard')) from the
-- original gamification migration. Without widening it, every crew-quest
-- INSERT fails with 23514 — the guard trigger prices the row correctly and
-- then the constraint rejects it, so the feature would have looked wired up
-- and simply never produced a crew quest for anyone.
--
-- Caught by running this migration against a copy of production and actually
-- inserting the four rows, which is the whole point of that exercise: the
-- DDL above executes perfectly cleanly on its own (CLAUDE.md — "verifying
-- that a migration runs is not verifying that its functions work").
--
-- DROP-then-ADD rather than ALTER: Postgres has no ALTER CONSTRAINT for a
-- CHECK expression. IF EXISTS so a re-run of a partially-applied migration
-- doesn't fail on the drop.
ALTER TABLE public.user_daily_quests
  DROP CONSTRAINT IF EXISTS user_daily_quests_difficulty_check;
ALTER TABLE public.user_daily_quests
  ADD CONSTRAINT user_daily_quests_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard', 'crew'));

-- ── 2. The guard, restated in full ───────────────────────────────────────
-- CREATE OR REPLACE needs the whole body. Everything from migration 265 is
-- unchanged apart from the new 'crew' arm and the xp_reward pricing.
CREATE OR REPLACE FUNCTION public.user_daily_quests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $user_daily_quests_guard$
DECLARE
  v_server_today DATE := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.quest_date IS NULL
       OR NEW.quest_date < v_server_today - 1
       OR NEW.quest_date > v_server_today + 1 THEN
      RAISE EXCEPTION 'quest_date out of range' USING ERRCODE = '22023';
    END IF;
    -- coin_reward and xp_reward are server-defined by difficulty; never
    -- trust the client. Keep QUEST_DIFFICULTY in src/lib/questCatalog.js in
    -- lockstep with BOTH of these CASE blocks.
    NEW.coin_reward := CASE NEW.difficulty
      WHEN 'easy' THEN 8 WHEN 'medium' THEN 20 WHEN 'hard' THEN 50
      WHEN 'crew' THEN 25 ELSE 0 END;
    NEW.xp_reward := CASE NEW.difficulty
      WHEN 'easy' THEN 20 WHEN 'medium' THEN 50 WHEN 'hard' THEN 120
      WHEN 'crew' THEN 60 ELSE 0 END;
    NEW.progress := 0;
    NEW.completed_at := NULL;
    NEW.claimed_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.coin_reward IS DISTINCT FROM OLD.coin_reward
     OR NEW.xp_reward  IS DISTINCT FROM OLD.xp_reward
     OR NEW.quest_date IS DISTINCT FROM OLD.quest_date
     OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
     OR NEW.quest_id   IS DISTINCT FROM OLD.quest_id THEN
    RAISE EXCEPTION 'quest reward/identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
    RAISE EXCEPTION 'claimed_at is RPC-only (use claim_quest_atomic)' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$user_daily_quests_guard$;

-- The trigger itself is unchanged from migration 199, but restate it so a
-- fresh database built from these files in order still attaches it.
DROP TRIGGER IF EXISTS user_daily_quests_guard_tr ON public.user_daily_quests;
CREATE TRIGGER user_daily_quests_guard_tr
  BEFORE INSERT OR UPDATE ON public.user_daily_quests
  FOR EACH ROW EXECUTE FUNCTION public.user_daily_quests_guard();

-- ── 3. grant_action_xp: cap the two new action types ─────────────────────
-- Restated in full (migration 298's body) with two rows added to the CASE.
-- Same DROP-then-CREATE dance 298 needed, for the same reason: the return
-- type is part of the signature CREATE OR REPLACE cannot change. Here it is
-- unchanged, so a plain CREATE OR REPLACE is enough.
CREATE OR REPLACE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid    := auth.uid();
  v_day    date;
  v_before integer;
  v_cap    integer;
  v_credit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN 0; END IF;

  v_day := (public.user_local_now(v_uid))::date;
  IF v_day IS NULL THEN
    v_day := (now() AT TIME ZONE 'utc')::date;
  END IF;

  v_cap := CASE p_action_type
    WHEN 'workout_completed' THEN 4000
    WHEN 'cardio_completed'  THEN 2400
    WHEN 'comeback_bonus'    THEN 200
    WHEN 'water_logged'      THEN 24
    WHEN 'meal_logged'       THEN 30
    WHEN 'recipe_created'    THEN 75
    WHEN 'regimen_created'   THEN 200
    WHEN 'goal_completed'    THEN 500
    WHEN 'crew_xp_fuel'      THEN 100
    -- NEW. A maximal quest day is easy 20 + medium 50 + hard 120 + crew 60
    -- = 250. The cap sits at 400 so a future fifth slot or a re-tier does
    -- not silently start eating claims, and well under a single workout's
    -- 4000 so quests can never out-earn training.
    WHEN 'daily_quest'       THEN 400
    -- One 100 XP bonus per day by construction (claim_perfect_day_bonus is
    -- idempotent per local date). 150 leaves headroom without leaving room
    -- for a second.
    WHEN 'quest_perfect_day' THEN 150
    ELSE 1000
  END;

  SELECT COALESCE(amount, 0) INTO v_before
    FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = p_action_type;
  v_before := COALESCE(v_before, 0);
  v_credit := LEAST(p_xp, GREATEST(0, v_cap - v_before));
  IF v_credit <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
  VALUES (v_uid, v_day, p_action_type, v_credit)
  -- Left exactly as migration 298 shipped it, dotted token and all: that
  -- text is what is installed today and it survived the paste pipeline
  -- once. Restating a working function is not the place to try a new
  -- spelling.
  ON CONFLICT (user_id, day, action_type)
  DO UPDATE SET amount = public.action_xp_ledger.amount + v_credit;

  PERFORM public.increment_user_xp(v_uid, v_credit);
  RETURN v_credit;
END;
$function$;

REVOKE ALL    ON FUNCTION public.grant_action_xp(text, integer) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.grant_action_xp(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

-- ── 4. Quest streak + lifetime counters ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_quest_stats (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak     integer NOT NULL DEFAULT 0,
  longest_streak     integer NOT NULL DEFAULT 0,
  last_perfect_date  date,
  perfect_days       integer NOT NULL DEFAULT 0,
  quests_claimed     integer NOT NULL DEFAULT 0,
  coins_earned       integer NOT NULL DEFAULT 0,
  xp_earned          integer NOT NULL DEFAULT 0,
  crew_xp_earned     integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_quest_stats ENABLE ROW LEVEL SECURITY;

-- Read your own row. There is no INSERT/UPDATE/DELETE policy anywhere on
-- this table on purpose: every column is a reward counter, and the two
-- SECURITY DEFINER functions below are the only writers. A client UPDATE
-- policy would let anyone set current_streak = 400.
DROP POLICY IF EXISTS user_quest_stats_select_own ON public.user_quest_stats;
CREATE POLICY user_quest_stats_select_own ON public.user_quest_stats
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.user_quest_stats FROM authenticated, anon;
GRANT SELECT ON public.user_quest_stats TO authenticated;
GRANT ALL    ON public.user_quest_stats TO service_role;

-- ── 5. The claimant's crew, or NULL ──────────────────────────────────────
-- A user can belong to several crews. Quest XP goes to the OLDEST membership
-- — the crew they have actually stuck with — rather than to all of them,
-- which would multiply one workout across every crew a grinder joined.
CREATE OR REPLACE FUNCTION public.primary_crew_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $primary_crew$
  SELECT crew_id
    FROM public.crew_members
   WHERE user_id = p_user_id
   ORDER BY joined_at ASC NULLS LAST
   LIMIT 1;
$primary_crew$;

-- Internal. It takes the user as a parameter, so exposing it would let
-- anyone map any user to their crew — the same shape as is_blocked (migs
-- 302/304). SECURITY DEFINER callers only.
REVOKE ALL ON FUNCTION public.primary_crew_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.primary_crew_id(uuid) TO service_role;

-- ── 6. claim_quest_atomic, now paying three currencies ───────────────────
-- Migration 068's body, extended. The coin half is byte-identical in
-- behaviour; XP and crew XP are added after the claim wins.
--
-- Order matters. The claimed_at flip stays FIRST and stays the thing that
-- decides who won, so a double-tap still loses at exactly the same point it
-- did before. Everything after it is credit, and credit that fails leaves
-- the claim standing — which is the right way round: a user who lost 20 XP
-- to a blip can be made whole, a user who claimed twice cannot be un-paid.
CREATE OR REPLACE FUNCTION public.claim_quest_atomic(p_quest_row_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $claim_quest$
DECLARE
  v_uid          uuid := auth.uid();
  v_reward       integer;
  v_xp           integer;
  v_difficulty   text;
  v_new_balance  integer;
  v_xp_credited  integer := 0;
  v_crew_id      uuid;
  v_crew_xp      integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_quest_row_id IS NULL THEN
    RAISE EXCEPTION 'quest_row_id required' USING ERRCODE = '22023';
  END IF;

  -- Atomic claim: only one caller wins the claimed_at flip.
  UPDATE public.user_daily_quests
     SET claimed_at = now()
   WHERE id           = p_quest_row_id
     AND user_id      = v_uid
     AND completed_at IS NOT NULL
     AND claimed_at   IS NULL
  RETURNING coin_reward, xp_reward, difficulty
       INTO v_reward, v_xp, v_difficulty;

  IF v_reward IS NULL THEN
    SELECT flex_coins INTO v_new_balance
      FROM public.user_profiles
     WHERE id = v_uid;
    RETURN jsonb_build_object(
      'success',         FALSE,
      'already_claimed', TRUE,
      'coins_awarded',   0,
      'xp_awarded',      0,
      'crew_xp_awarded', 0,
      'new_balance',     COALESCE(v_new_balance, 0)
    );
  END IF;

  -- Coins: delta arithmetic — race-safe against concurrent grants.
  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_reward
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  -- XP: through grant_action_xp so it lands in action_xp_ledger under its
  -- own action type and obeys the daily cap. Returns what was ACTUALLY
  -- credited, which is what we report — a capped claim must not toast
  -- "+120 XP" while granting nothing.
  IF COALESCE(v_xp, 0) > 0 THEN
    v_xp_credited := public.grant_action_xp('daily_quest', v_xp);
  END IF;

  -- Crew: a quarter of the quest's XP, or all of it for a crew-tier quest.
  -- Priced off the CREDITED amount, not the nominal reward, so a claim that
  -- the daily cap zeroed does not still feed the crew. Rounded up to match
  -- getQuestDefinition's Math.ceil in src/lib/questCatalog.js.
  IF v_xp_credited > 0 THEN
    v_crew_id := public.primary_crew_id(v_uid);
    IF v_crew_id IS NOT NULL THEN
      v_crew_xp := CASE
        WHEN v_difficulty = 'crew' THEN v_xp_credited
        ELSE CEIL(v_xp_credited * 0.25)::integer
      END;
      -- p_points => 0 and p_result => 'quest': crew_xp and crew_level move,
      -- season standings and the war record do not.
      PERFORM public.award_crew_progress(v_crew_id, v_crew_xp, 0, 0, 'quest');
    END IF;
  END IF;

  INSERT INTO public.user_quest_stats
    (user_id, quests_claimed, coins_earned, xp_earned, crew_xp_earned, updated_at)
  VALUES (v_uid, 1, v_reward, v_xp_credited, v_crew_xp, now())
  ON CONFLICT (user_id) DO UPDATE SET
    quests_claimed = public.user_quest_stats.quests_claimed + 1,
    coins_earned   = public.user_quest_stats.coins_earned   + v_reward,
    xp_earned      = public.user_quest_stats.xp_earned      + v_xp_credited,
    crew_xp_earned = public.user_quest_stats.crew_xp_earned + v_crew_xp,
    updated_at     = now();
  -- These counters are a display convenience, not a ledger. The tamper-proof
  -- record of what was granted is action_xp_ledger (mig 188) and
  -- flex_coin_grant_ledger (mig 264); nothing reads user_quest_stats to
  -- decide a reward.

  RETURN jsonb_build_object(
    'success',         TRUE,
    'already_claimed', FALSE,
    'coins_awarded',   v_reward,
    'xp_awarded',      v_xp_credited,
    'crew_xp_awarded', v_crew_xp,
    'new_balance',     v_new_balance
  );
END;
$claim_quest$;

REVOKE ALL    ON FUNCTION public.claim_quest_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_quest_atomic(uuid) TO authenticated;

-- ── 7. The perfect-day bonus ─────────────────────────────────────────────
-- Every quest the day handed you, claimed. Pays once per LOCAL day and
-- advances the quest streak.
--
-- The day is the caller's own calendar day (user_local_now), matching how
-- the client picks quest_date and how grant_action_xp buckets the ledger.
-- Using UTC here would pay the bonus at 7pm for a user in UTC+5 and reset
-- their streak mid-evening.
--
-- Idempotence is `last_perfect_date = v_day` on a row nobody but this
-- function can write, checked and set inside one statement's worth of work.
-- A double-tap loses on the second call's WHERE, the same way the quest
-- claim does.
CREATE OR REPLACE FUNCTION public.claim_perfect_day_bonus()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $perfect_day$
DECLARE
  c_bonus_coins CONSTANT integer := 30;
  c_bonus_xp    CONSTANT integer := 100;
  c_bonus_crew  CONSTANT integer := 50;

  v_uid         uuid := auth.uid();
  v_day         date;
  v_total       integer;
  v_claimed     integer;
  v_last        date;
  v_streak      integer;
  v_new_streak  integer;
  v_xp_credited integer := 0;
  v_new_balance integer;
  v_crew_id     uuid;
  v_crew_xp     integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_day := (public.user_local_now(v_uid))::date;
  IF v_day IS NULL THEN
    v_day := (now() AT TIME ZONE 'utc')::date;
  END IF;

  SELECT count(*), count(claimed_at)
    INTO v_total, v_claimed
    FROM public.user_daily_quests
   WHERE user_id = v_uid AND quest_date = v_day;

  IF COALESCE(v_total, 0) = 0 OR v_claimed < v_total THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'not_complete',
                              'claimed', COALESCE(v_claimed, 0),
                              'total',   COALESCE(v_total, 0));
  END IF;

  -- Seed the row on first ever bonus so the UPDATE below has something to
  -- lock. DO NOTHING rather than DO UPDATE — a returning user already has a
  -- row and must not have their counters reset by the seed.
  INSERT INTO public.user_quest_stats (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT last_perfect_date, current_streak
    INTO v_last, v_streak
    FROM public.user_quest_stats
   WHERE user_id = v_uid
     FOR UPDATE;

  IF v_last = v_day THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'already_claimed',
                              'streak', COALESCE(v_streak, 0));
  END IF;

  -- Yesterday continues the run; anything older starts a new one. A gap does
  -- NOT zero the lifetime counters — losing a streak already costs enough.
  v_new_streak := CASE WHEN v_last = v_day - 1 THEN COALESCE(v_streak, 0) + 1 ELSE 1 END;

  UPDATE public.user_quest_stats
     SET last_perfect_date = v_day,
         current_streak    = v_new_streak,
         longest_streak    = GREATEST(longest_streak, v_new_streak),
         perfect_days      = perfect_days + 1,
         coins_earned      = coins_earned + c_bonus_coins,
         updated_at        = now()
   WHERE user_id = v_uid
     AND (last_perfect_date IS DISTINCT FROM v_day);

  IF NOT FOUND THEN
    -- Lost the race to a concurrent call. It paid; we don't.
    RETURN jsonb_build_object('success', FALSE, 'reason', 'already_claimed',
                              'streak', v_new_streak);
  END IF;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + c_bonus_coins
   WHERE id = v_uid
  RETURNING flex_coins INTO v_new_balance;

  v_xp_credited := public.grant_action_xp('quest_perfect_day', c_bonus_xp);

  IF v_xp_credited > 0 THEN
    v_crew_id := public.primary_crew_id(v_uid);
    IF v_crew_id IS NOT NULL THEN
      v_crew_xp := c_bonus_crew;
      PERFORM public.award_crew_progress(v_crew_id, v_crew_xp, 0, 0, 'quest');
    END IF;
  END IF;

  UPDATE public.user_quest_stats
     SET xp_earned      = xp_earned      + v_xp_credited,
         crew_xp_earned = crew_xp_earned + v_crew_xp
   WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'success',         TRUE,
    'coins_awarded',   c_bonus_coins,
    'xp_awarded',      v_xp_credited,
    'crew_xp_awarded', v_crew_xp,
    'streak',          v_new_streak,
    'new_balance',     COALESCE(v_new_balance, 0)
  );
END;
$perfect_day$;

REVOKE ALL    ON FUNCTION public.claim_perfect_day_bonus() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_perfect_day_bonus() TO authenticated;

-- ── 8. Reading your own streak ───────────────────────────────────────────
-- The table is SELECT-able directly, but a user with no row yet reads zero
-- rows rather than zeroes, and every caller would need the same COALESCE
-- dance. One function, one shape.
--
-- `is_current` is the part a client cannot compute: a streak whose last
-- perfect day is older than yesterday is over, and the row still holds the
-- number until the next perfect day rewrites it. Rendering current_streak
-- raw tells someone they are on a 12-day run four days after they broke it.
CREATE OR REPLACE FUNCTION public.get_my_quest_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $quest_stats$
DECLARE
  v_uid     uuid := auth.uid();
  v_day     date;
  v_streak  integer;
  v_longest integer;
  v_last    date;
  v_perfect integer;
  v_claimed integer;
  v_coins   integer;
  v_xp      integer;
  v_crewxp  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_day := (public.user_local_now(v_uid))::date;
  IF v_day IS NULL THEN
    v_day := (now() AT TIME ZONE 'utc')::date;
  END IF;

  SELECT current_streak, longest_streak, last_perfect_date, perfect_days,
         quests_claimed, coins_earned, xp_earned, crew_xp_earned
    INTO v_streak, v_longest, v_last, v_perfect,
         v_claimed, v_coins, v_xp, v_crewxp
    FROM public.user_quest_stats
   WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'current_streak',    COALESCE(v_streak, 0),
    'longest_streak',    COALESCE(v_longest, 0),
    'last_perfect_date', v_last,
    'perfect_days',      COALESCE(v_perfect, 0),
    'quests_claimed',    COALESCE(v_claimed, 0),
    'coins_earned',      COALESCE(v_coins, 0),
    'xp_earned',         COALESCE(v_xp, 0),
    'crew_xp_earned',    COALESCE(v_crewxp, 0),
    -- COALESCE both: v_last is NULL for a user who has never had a perfect
    -- day, and `NULL = v_day` is NULL, which jsonb_build_object renders as
    -- JSON null. `if (stats.is_current)` is falsy on null so the streak case
    -- happens to survive, but `bonus_claimed_today` would arrive null and
    -- read as "not claimed" only by luck. Say false and mean it.
    'bonus_claimed_today', COALESCE(v_last = v_day, FALSE),
    'is_current',          COALESCE(v_last >= v_day - 1, FALSE)
  );
END;
$quest_stats$;

REVOKE ALL    ON FUNCTION public.get_my_quest_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_quest_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
