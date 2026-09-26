-- 323_trophy_ladders.sql
--
-- Extends the earned-trophy engine (mig 167) from 18 flat badges to a
-- LADDER system with infinite tails, and folds in the achievements
-- catalog that was never earnable.
--
-- ── Why this exists ───────────────────────────────────────────────
--
-- Flexyn had two badge systems and only one of them worked:
--
--   • public.achievements — 26 definitions in the client catalog
--     (src/lib/achievementDefinitions.js) with NO grant path at all.
--     Mig 189 correctly removed the client INSERT policy to stop badge
--     forgery, but nothing server-side was ever written to replace it,
--     so from that day forward not one of the 26 could be earned.
--     Production carries exactly ONE achievements row across all users
--     — an `xp_250` from 2026-05-20, which is not even in the catalog,
--     so the page rendered "1 / 26" with nothing under Completed.
--   • public.user_trophies — this one. SQL criteria, idempotent
--     grants, 9 live rows. It works.
--
-- Seven milestones were duplicated across both (first_rep/first_workout,
-- consistent/ten_workouts, centurion/hundred_workouts, cardio_5k/first_5k
-- and so on). This migration makes user_trophies the single system.
--
-- ── Ladders and tails ─────────────────────────────────────────────
--
-- Every trophy is a rung on a named ladder. Past the last named rung,
-- ids are GENERATED rather than enumerated: `sessions_x1` is 200
-- workouts, `sessions_x2` is 300. That is the same trick migration 312
-- uses for league season trophies, and it exists for the same reason —
-- a hand-written catalog runs out, and the day a user collects the last
-- badge the feature is over for them.
--
-- The client mirror is src/lib/trophyDefinitions.js. The ids, the
-- thresholds AND the tail base/step numbers must match this file. The
-- `signal` keys in LADDERS there are the keys get_trophy_progress()
-- returns here.
--
-- ── Grant shape ───────────────────────────────────────────────────
--
-- Mig 167 wrote one 5-line IF/INSERT/FOUND block per trophy. At 73
-- named rungs plus generated tails that would be ~500 lines of copy
-- paste, so this is table-driven instead: gather every signal once,
-- build a (trophy_id, needed, have) VALUES list, and insert the whole
-- eligible set in a single statement whose RETURNING clause IS the
-- newly-granted list. Adding a rung is now one line.
--
-- Return contract is unchanged from 167: { "newly_granted": [ids] }.
--
-- Paste-safe per CLAUDE.md — no `alias.column` tokens, no record-field
-- dotted access, single-table statements use bare columns.
--
-- Idempotent; safe to re-run.


-- ── 1. Signals — one read each, shared by both RPCs ────────────────
--
-- SECURITY DEFINER and keyed to auth.uid() only. It takes no parameters
-- BY DESIGN: an id parameter would let any caller read another user's
-- training volume, streak and gym attendance, which is exactly the
-- class of leak migration 108 was.
CREATE OR REPLACE FUNCTION public.get_trophy_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_email         TEXT := COALESCE(auth.email(), '');
  v_workouts      NUMERIC := 0;
  v_volume        NUMERIC := 0;
  v_lifts         NUMERIC := 0;
  v_streak        NUMERIC := 0;
  v_months        NUMERIC := 0;
  v_quests        NUMERIC := 0;
  v_perfect       NUMERIC := 0;
  v_maxdist       NUMERIC := 0;
  v_totdist       NUMERIC := 0;
  v_acttypes      NUMERIC := 0;
  v_level         NUMERIC := 1;
  v_prestige      NUMERIC := 0;
  v_goals         NUMERIC := 0;
  v_duelwins      NUMERIC := 0;
  v_bounties      NUMERIC := 0;
  v_gaunt         NUMERIC := 0;
  v_gauntpath     NUMERIC := 0;
  v_crew          NUMERIC := 0;
  v_crewwars      NUMERIC := 0;
  v_posts         NUMERIC := 0;
  v_checkins      NUMERIC := 0;
  v_capsules      NUMERIC := 0;
  v_relics        NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Profile-derived signals, one row.
  --
  -- The COALESCE has to come AFTER the SELECT, not inside it. A
  -- `SELECT COALESCE(col,0) INTO v` that matches NO ROW leaves the
  -- variable NULL — the COALESCE never runs, because there is nothing
  -- to run it on — and it silently overwrites the DECLARE default.
  -- Caught by calling this for a user with no user_gauntlet_progress
  -- row: the payload came back with gauntletDone: null, which then
  -- makes `have >= needed` evaluate to NULL for that whole ladder.
  SELECT workout_streak, current_level, prestige_level, total_volume_lbs
    INTO v_streak, v_level, v_prestige, v_volume
    FROM public.user_profiles
   WHERE id = v_uid;
  v_streak   := COALESCE(v_streak, 0);
  v_level    := COALESCE(v_level, 1);
  v_prestige := COALESCE(v_prestige, 0);
  v_volume   := COALESCE(v_volume, 0);

  -- Workouts. Both identity keys, per the CLAUDE.md identity section:
  -- older rows carry created_by (email) and newer ones user_id.
  SELECT COUNT(*)
    INTO v_workouts
    FROM public.workout_logs
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(DISTINCT date_trunc('month', date))
    INTO v_months
    FROM public.workout_logs
   WHERE (user_id = v_uid OR created_by = v_email)
     AND date IS NOT NULL;

  -- Distinct exercises ever logged. `exercises` is a JSONB array of
  -- objects carrying `name`; lower/trim so "Bench Press" and "bench
  -- press " are one lift rather than two. The jsonb_typeof guard is
  -- load-bearing — production holds rows where it is '[]' and the
  -- column is nullable, and jsonb_array_elements raises on a non-array.
  SELECT COUNT(DISTINCT lower(trim(elem ->> 'name')))
    INTO v_lifts
    FROM public.workout_logs
    CROSS JOIN LATERAL jsonb_array_elements(exercises) AS elem
   WHERE (user_id = v_uid OR created_by = v_email)
     AND jsonb_typeof(exercises) = 'array'
     AND COALESCE(trim(elem ->> 'name'), '') <> '';

  -- Cardio: single-session best, lifetime total, distinct activities.
  SELECT COALESCE(MAX(distance_meters), 0),
         COALESCE(SUM(distance_meters), 0),
         COUNT(DISTINCT activity_type)
    INTO v_maxdist, v_totdist, v_acttypes
    FROM public.cardio_logs
   WHERE user_id = v_uid OR created_by = v_email;

  -- Most users have no user_quest_stats row at all — same no-row trap
  -- as the profile read above.
  SELECT quests_claimed, perfect_days
    INTO v_quests, v_perfect
    FROM public.user_quest_stats
   WHERE user_id = v_uid;
  v_quests  := COALESCE(v_quests, 0);
  v_perfect := COALESCE(v_perfect, 0);

  SELECT COUNT(*)
    INTO v_goals
    FROM public.goals
   WHERE (user_id = v_uid OR created_by = v_email)
     AND status = 'completed';

  SELECT COUNT(*) INTO v_duelwins
    FROM public.duels WHERE winner_id = v_uid;

  SELECT COUNT(*) INTO v_bounties
    FROM public.bounties WHERE claimed_by_id = v_uid;

  -- This is the one that exposed the no-row trap in testing: nobody in
  -- production has a user_gauntlet_progress row yet.
  SELECT challenges_completed,
         CASE WHEN COALESCE(path_completed, false) THEN 1 ELSE 0 END
    INTO v_gaunt, v_gauntpath
    FROM public.user_gauntlet_progress
   WHERE user_id = v_uid;
  v_gaunt     := COALESCE(v_gaunt, 0);
  v_gauntpath := COALESCE(v_gauntpath, 0);

  SELECT COUNT(*) INTO v_crew
    FROM public.crew_members WHERE user_id = v_uid;

  -- Wars contributed to, not contribution rows: the table is keyed
  -- (war_id, user_id) but a re-count per war would still inflate the
  -- ladder if that ever changes.
  SELECT COUNT(DISTINCT war_id) INTO v_crewwars
    FROM public.crew_war_contributions WHERE user_id = v_uid;

  SELECT COUNT(*) INTO v_posts
    FROM public.hub_posts
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(*) INTO v_checkins
    FROM public.gym_checkins WHERE user_id = v_uid;

  SELECT COUNT(*) INTO v_capsules
    FROM public.user_capsules
   WHERE user_id = v_uid AND COALESCE(is_opened, false);

  -- 'legendary' is not the top of the ramp — RARITY_ORDER in
  -- src/lib/collection.js runs …epic, legendary, mythic, animated. A
  -- badge that ignored the two rarest tiers would tell someone holding
  -- an animated sticker they own no legendaries.
  SELECT COUNT(*) INTO v_relics
    FROM public.user_inventory
   WHERE user_id = v_uid
     AND item_rarity IN ('legendary', 'mythic', 'animated');

  RETURN jsonb_build_object(
    'workouts',        v_workouts,
    'volumeLbs',       v_volume,
    'distinctLifts',   v_lifts,
    'workoutStreak',   v_streak,
    'activeMonths',    v_months,
    'questsClaimed',   v_quests,
    'perfectDays',     v_perfect,
    'maxDistanceM',    v_maxdist,
    'totalDistanceM',  v_totdist,
    'activityTypes',   v_acttypes,
    'level',           v_level,
    'prestige',        v_prestige,
    'goalsDone',       v_goals,
    'duelWins',        v_duelwins,
    'bountiesClaimed', v_bounties,
    'gauntletDone',    v_gaunt,
    'gauntletPath',    v_gauntpath,
    'crewCount',       v_crew,
    'crewWars',        v_crewwars,
    'posts',           v_posts,
    'checkins',        v_checkins,
    'capsulesOpened',  v_capsules,
    'legendaries',     v_relics
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_trophy_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trophy_progress() TO authenticated;


-- ── 2. The grant engine ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_eligible_trophies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT := COALESCE(auth.email(), '');
  v_sig    JSONB;
  v_new    TEXT[] := ARRAY[]::TEXT[];
  -- Mirrors TAIL_CAP in src/lib/trophyDefinitions.js. Nobody is
  -- legitimately 50 tail-rungs deep, so a value past this means corrupt
  -- data rather than a very dedicated user — and without the cap one
  -- bad total_volume_lbs would mint thousands of rows in one call.
  v_cap    INTEGER := 50;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_sig := public.get_trophy_progress();

  -- Named rungs, then generated tails, inserted in one statement. The
  -- RETURNING clause is the newly-granted set: ON CONFLICT DO NOTHING
  -- means an already-owned trophy returns no row, so this is exactly
  -- "what changed" with no read-back and no race.
  WITH named (tid, needed, have) AS (
    VALUES
      -- Iron · sessions
      ('first_rep',        1::numeric,       (v_sig ->> 'workouts')::numeric),
      ('consistent',       10,               (v_sig ->> 'workouts')::numeric),
      ('committed',        50,               (v_sig ->> 'workouts')::numeric),
      ('centurion',        100,              (v_sig ->> 'workouts')::numeric),
      -- Iron · tonnage (pounds of lifetime volume)
      ('tonnage_ton',      2000,             (v_sig ->> 'volumeLbs')::numeric),
      ('tonnage_10t',      20000,            (v_sig ->> 'volumeLbs')::numeric),
      ('tonnage_100t',     200000,           (v_sig ->> 'volumeLbs')::numeric),
      ('tonnage_million',  1000000,          (v_sig ->> 'volumeLbs')::numeric),
      -- Iron · variety
      ('variety_10',       10,               (v_sig ->> 'distinctLifts')::numeric),
      ('variety_25',       25,               (v_sig ->> 'distinctLifts')::numeric),
      ('variety_50',       50,               (v_sig ->> 'distinctLifts')::numeric),
      ('variety_100',      100,              (v_sig ->> 'distinctLifts')::numeric),
      -- Consistency · streak
      ('streak_spark',     7,                (v_sig ->> 'workoutStreak')::numeric),
      ('streak_blaze',     30,               (v_sig ->> 'workoutStreak')::numeric),
      ('streak_inferno',   100,              (v_sig ->> 'workoutStreak')::numeric),
      ('streak_eternal',   365,              (v_sig ->> 'workoutStreak')::numeric),
      -- Consistency · longevity (distinct months with a workout)
      ('longevity_3',      3,                (v_sig ->> 'activeMonths')::numeric),
      ('longevity_6',      6,                (v_sig ->> 'activeMonths')::numeric),
      ('longevity_12',     12,               (v_sig ->> 'activeMonths')::numeric),
      ('longevity_24',     24,               (v_sig ->> 'activeMonths')::numeric),
      -- Consistency · quests
      ('quest_10',         10,               (v_sig ->> 'questsClaimed')::numeric),
      ('quest_100',        100,              (v_sig ->> 'questsClaimed')::numeric),
      ('quest_500',        500,              (v_sig ->> 'questsClaimed')::numeric),
      ('perfect_7',        7,                (v_sig ->> 'perfectDays')::numeric),
      ('perfect_30',       30,               (v_sig ->> 'perfectDays')::numeric),
      ('perfect_100',      100,              (v_sig ->> 'perfectDays')::numeric),
      -- Endurance · single-session distance (metres)
      ('cardio_5k',        5000,             (v_sig ->> 'maxDistanceM')::numeric),
      ('cardio_10k',       10000,            (v_sig ->> 'maxDistanceM')::numeric),
      ('cardio_half',      21097,            (v_sig ->> 'maxDistanceM')::numeric),
      ('cardio_marathon',  42195,            (v_sig ->> 'maxDistanceM')::numeric),
      -- Endurance · lifetime distance (metres)
      ('distance_50k',     50000,            (v_sig ->> 'totalDistanceM')::numeric),
      ('distance_250k',    250000,           (v_sig ->> 'totalDistanceM')::numeric),
      ('distance_1000k',   1000000,          (v_sig ->> 'totalDistanceM')::numeric),
      -- Endurance · cross-training
      ('cross_3',          3,                (v_sig ->> 'activityTypes')::numeric),
      ('cross_5',          5,                (v_sig ->> 'activityTypes')::numeric),
      ('cross_8',          8,                (v_sig ->> 'activityTypes')::numeric),
      -- Progression · level
      ('level_tier1',      10,               (v_sig ->> 'level')::numeric),
      ('level_tier2',      25,               (v_sig ->> 'level')::numeric),
      ('level_tier3',      50,               (v_sig ->> 'level')::numeric),
      ('level_apex',       100,              (v_sig ->> 'level')::numeric),
      -- Progression · prestige
      ('prestige_1',       1,                (v_sig ->> 'prestige')::numeric),
      ('prestige_3',       3,                (v_sig ->> 'prestige')::numeric),
      ('prestige_5',       5,                (v_sig ->> 'prestige')::numeric),
      -- Progression · goals
      ('goal_first',       1,                (v_sig ->> 'goalsDone')::numeric),
      ('goal_10',          10,               (v_sig ->> 'goalsDone')::numeric),
      ('goal_50',          50,               (v_sig ->> 'goalsDone')::numeric),
      -- Arena · duels
      ('duel_challenger',  1,                (v_sig ->> 'duelWins')::numeric),
      ('duel_champion',    10,               (v_sig ->> 'duelWins')::numeric),
      ('duel_gladiator',   50,               (v_sig ->> 'duelWins')::numeric),
      ('duel_immortal',    200,              (v_sig ->> 'duelWins')::numeric),
      -- Arena · bounties
      ('bounty_1',         1,                (v_sig ->> 'bountiesClaimed')::numeric),
      ('bounty_10',        10,               (v_sig ->> 'bountiesClaimed')::numeric),
      ('bounty_50',        50,               (v_sig ->> 'bountiesClaimed')::numeric),
      -- Arena · gauntlet
      ('gauntlet_5',       5,                (v_sig ->> 'gauntletDone')::numeric),
      ('gauntlet_path',    1,                (v_sig ->> 'gauntletPath')::numeric),
      -- Crew
      ('crew_squad',       1,                (v_sig ->> 'crewCount')::numeric),
      ('crewwar_1',        1,                (v_sig ->> 'crewWars')::numeric),
      ('crewwar_10',       10,               (v_sig ->> 'crewWars')::numeric),
      ('crewwar_50',       50,               (v_sig ->> 'crewWars')::numeric),
      -- Community · hub
      ('post_1',           1,                (v_sig ->> 'posts')::numeric),
      ('post_10',          10,               (v_sig ->> 'posts')::numeric),
      ('post_50',          50,               (v_sig ->> 'posts')::numeric),
      ('post_200',         200,              (v_sig ->> 'posts')::numeric),
      -- Community · gym check-ins
      ('checkin_1',        1,                (v_sig ->> 'checkins')::numeric),
      ('checkin_25',       25,               (v_sig ->> 'checkins')::numeric),
      ('checkin_100',      100,              (v_sig ->> 'checkins')::numeric),
      ('checkin_365',      365,              (v_sig ->> 'checkins')::numeric),
      -- Collection
      ('capsule_1',        1,                (v_sig ->> 'capsulesOpened')::numeric),
      ('capsule_25',       25,               (v_sig ->> 'capsulesOpened')::numeric),
      ('capsule_100',      100,              (v_sig ->> 'capsulesOpened')::numeric),
      ('relic_1',          1,                (v_sig ->> 'legendaries')::numeric),
      ('relic_5',          5,                (v_sig ->> 'legendaries')::numeric),
      ('relic_25',         25,               (v_sig ->> 'legendaries')::numeric)
  ),
  -- Ladders that continue past their last named rung. Tail rung k
  -- requires base + k*step; the id is `<ladder>_x<k>`. These numbers
  -- are mirrored in LADDERS in src/lib/trophyDefinitions.js.
  ladder (lad, base, step, have) AS (
    VALUES
      ('sessions',  100::numeric,     100::numeric,     (v_sig ->> 'workouts')::numeric),
      ('tonnage',   1000000,          1000000,          (v_sig ->> 'volumeLbs')::numeric),
      ('variety',   100,              50,               (v_sig ->> 'distinctLifts')::numeric),
      ('streak',    365,              365,              (v_sig ->> 'workoutStreak')::numeric),
      ('longevity', 24,               12,               (v_sig ->> 'activeMonths')::numeric),
      ('quests',    500,              500,              (v_sig ->> 'questsClaimed')::numeric),
      ('perfect',   100,              100,              (v_sig ->> 'perfectDays')::numeric),
      ('distance',  1000000,          1000000,          (v_sig ->> 'totalDistanceM')::numeric),
      ('prestige',  5,                1,                (v_sig ->> 'prestige')::numeric),
      ('goals',     50,               50,               (v_sig ->> 'goalsDone')::numeric),
      ('duel',      200,              200,              (v_sig ->> 'duelWins')::numeric),
      ('bounty',    50,               50,               (v_sig ->> 'bountiesClaimed')::numeric),
      ('crewwar',   50,               50,               (v_sig ->> 'crewWars')::numeric),
      ('social',    200,              200,              (v_sig ->> 'posts')::numeric),
      ('gym',       365,              365,              (v_sig ->> 'checkins')::numeric),
      ('capsule',   100,              100,              (v_sig ->> 'capsulesOpened')::numeric),
      ('relic',     25,               25,               (v_sig ->> 'legendaries')::numeric)
  ),
  tails (tid) AS (
    SELECT lad || '_x' || k
      FROM ladder
      CROSS JOIN LATERAL generate_series(
        1,
        -- Clamp in NUMERIC and cast to integer last. Casting first would
        -- overflow int4 on an absurd signal value — which is exactly the
        -- corrupt-data case the cap exists to survive.
        LEAST(v_cap::numeric, GREATEST(0::numeric, floor((have - base) / step)))::integer
      ) AS k
  ),
  eligible (tid) AS (
    SELECT tid FROM named WHERE have >= needed
    UNION
    SELECT tid FROM tails
  ),
  ins AS (
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    SELECT v_uid, v_email, tid FROM eligible
    ON CONFLICT (user_id, trophy_id) DO NOTHING
    RETURNING trophy_id
  )
  SELECT COALESCE(array_agg(trophy_id), ARRAY[]::TEXT[]) INTO v_new FROM ins;

  -- Self-heal the badge counter from the source of truth. This column
  -- drives the achievements leaderboard and the "Badges" stat on the
  -- public profile, and under the merge its source of truth is
  -- user_trophies, not the retired achievements table. Section 3 stops
  -- the mig-189 RPC from writing the other number.
  UPDATE public.user_profiles
     SET achievements_unlocked_count = (
           SELECT count(*) FROM public.user_trophies WHERE user_id = v_uid)
   WHERE id = v_uid;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_new));
END;
$$;

REVOKE ALL ON FUNCTION public.grant_eligible_trophies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_eligible_trophies() TO authenticated;


-- ── 3. Stop the mig-189 RPC fighting over the badge counter ────────
--
-- grant_xp_milestone_achievements() ends by self-healing
-- achievements_unlocked_count from public.achievements. That was right
-- when achievements were the badge system; now it writes ~0 over the
-- trophy count every time a user crosses an XP milestone, so the
-- leaderboard and the profile "Badges" stat would drop to zero and then
-- silently recover on the next Dashboard load.
--
-- This PATCHES THE INSTALLED FUNCTION BODY rather than restating it.
-- CLAUDE.md documents why that distinction matters: migrations 098 and
-- 127 each redefined the push fanout from a stale template and silently
-- reverted migration 080, and push had never sent a single request for
-- months as a result. Retyping a 3.6 KB function to change one line is
-- that same bug waiting to happen. Reading pg_get_functiondef() and
-- swapping one statement cannot revert anything, because whatever is
-- installed is what gets rewritten.
--
-- Idempotent: on a re-run the old statement is no longer present, the
-- replace is a no-op, and the function is left exactly as it is.
DO $patch$
DECLARE
  v_def TEXT;
  v_new TEXT;
  v_old TEXT := 'SELECT count(*) INTO v_count FROM public.achievements WHERE user_id = v_uid;';
  v_rep TEXT := 'SELECT count(*) INTO v_count FROM public.user_trophies WHERE user_id = v_uid;';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'grant_xp_milestone_achievements'
     AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE NOTICE 'grant_xp_milestone_achievements not installed; nothing to patch';
    RETURN;
  END IF;

  v_new := replace(v_def, v_old, v_rep);

  IF v_new = v_def THEN
    -- Either already patched, or the body drifted. Either way, do NOT
    -- guess — leaving it alone is safe, and the notice says to look.
    RAISE NOTICE 'grant_xp_milestone_achievements: counter statement not found; left unchanged';
  ELSE
    EXECUTE v_new;
  END IF;
END
$patch$;

NOTIFY pgrst, 'reload schema';
