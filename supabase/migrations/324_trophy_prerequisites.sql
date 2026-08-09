-- 324_trophy_prerequisites.sql
--
-- Takes the trophy catalog from 73 to 120 obtainable achievements and
-- adds a PREREQUISITE ENGINE: a trophy can require other trophies, and
-- stays genuinely unobtainable until they are all earned.
--
-- ── What's new ────────────────────────────────────────────────────
--
-- 37 new ladder rungs across 11 new ladders — nutrition (which the
-- trophy engine had NO coverage of at all, despite the retired
-- achievements catalog carrying six), recovery (sleep / journal /
-- weekly debriefs), programming (regimens), duels FOUGHT as distinct
-- from duels won, comments, followers, coins earned and marketplace
-- sales.
--
-- Plus 10 CAPSTONES. A capstone has no numeric criterion of its own; it
-- is earned purely by owning the top rung of every ladder in a
-- category, and `capstone_apex` requires the other nine. That two-level
-- chain is why the grant runs to a fixpoint (see below).
--
-- ── Why the gate is enforced HERE and not just in the UI ───────────
--
-- Hiding a locked trophy in the client is decoration. Migration 189
-- exists because the client used to be able to INSERT achievement rows
-- directly, and any signed-in user could forge a badge. The same
-- reasoning applies to a prerequisite: if the server grants a capstone
-- the moment its (nonexistent) numeric criterion is met, then the
-- "requirement" is a label on a page rather than a rule. So the
-- eligibility set is `candidate EXCEPT unmet` — a trophy with any
-- outstanding requirement is removed before the INSERT ever sees it.
--
-- ── The fixpoint loop ─────────────────────────────────────────────
--
-- A CTE reads the snapshot taken at statement start, so rows inserted
-- by the same statement are invisible to its own `owned` subquery. With
-- chains — ladder tops → capstone → apex — one pass would grant only
-- the first level and silently leave the rest for the next visit. The
-- grant therefore repeats until a round inserts nothing, capped at 6
-- iterations (the catalog's longest chain is 2, so 6 is slack, not a
-- limit anyone can reach).
--
-- ── On restating rather than patching ─────────────────────────────
--
-- Both functions are replaced wholesale here. That is the thing
-- CLAUDE.md warns about — migs 098/127 silently reverted 080 that way —
-- and it is deliberate this time: migration 323 created both bodies,
-- nothing else has redefined them (verified with pg_get_functiondef
-- before writing this), and the change is structural rather than a
-- single statement. The mig-189 counter patch in 323 section 3 is NOT
-- restated here, because it patches a function this migration does not
-- own.
--
-- Paste-safe per CLAUDE.md: no `alias.column` tokens, no record-field
-- dotted access. The prerequisite check is expressed as `candidate
-- EXCEPT unmet` precisely so it needs no correlated alias.
--
-- Idempotent; safe to re-run.


-- ── 1. Signals ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trophy_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_email      TEXT := COALESCE(auth.email(), '');
  v_workouts   NUMERIC := 0; v_volume    NUMERIC := 0; v_lifts     NUMERIC := 0;
  v_streak     NUMERIC := 0; v_months    NUMERIC := 0; v_quests    NUMERIC := 0;
  v_perfect    NUMERIC := 0; v_maxdist   NUMERIC := 0; v_totdist   NUMERIC := 0;
  v_acttypes   NUMERIC := 0; v_level     NUMERIC := 1; v_prestige  NUMERIC := 0;
  v_goals      NUMERIC := 0; v_duelwins  NUMERIC := 0; v_bounties  NUMERIC := 0;
  v_gaunt      NUMERIC := 0; v_gauntpath NUMERIC := 0; v_crew      NUMERIC := 0;
  v_crewwars   NUMERIC := 0; v_posts     NUMERIC := 0; v_checkins  NUMERIC := 0;
  v_capsules   NUMERIC := 0; v_relics    NUMERIC := 0;
  -- new in 324
  v_meals      NUMERIC := 0; v_ndays     NUMERIC := 0; v_sleep     NUMERIC := 0;
  v_journal    NUMERIC := 0; v_debriefs  NUMERIC := 0; v_regimens  NUMERIC := 0;
  v_duelplay   NUMERIC := 0; v_comments  NUMERIC := 0; v_followers NUMERIC := 0;
  v_coins      NUMERIC := 0; v_market    NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- COALESCE goes AFTER the SELECT, never inside it: a SELECT that
  -- matches no row leaves the variable NULL and the inline COALESCE
  -- never runs. That bug was caught in testing against a user with no
  -- user_gauntlet_progress row.
  SELECT workout_streak, current_level, prestige_level, total_volume_lbs
    INTO v_streak, v_level, v_prestige, v_volume
    FROM public.user_profiles WHERE id = v_uid;
  v_streak := COALESCE(v_streak,0); v_level := COALESCE(v_level,1);
  v_prestige := COALESCE(v_prestige,0); v_volume := COALESCE(v_volume,0);

  SELECT COUNT(*) INTO v_workouts FROM public.workout_logs
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(DISTINCT date_trunc('month', date)) INTO v_months
    FROM public.workout_logs
   WHERE (user_id = v_uid OR created_by = v_email) AND date IS NOT NULL;

  SELECT COUNT(DISTINCT lower(trim(elem ->> 'name'))) INTO v_lifts
    FROM public.workout_logs
    CROSS JOIN LATERAL jsonb_array_elements(exercises) AS elem
   WHERE (user_id = v_uid OR created_by = v_email)
     AND jsonb_typeof(exercises) = 'array'
     AND COALESCE(trim(elem ->> 'name'), '') <> '';

  SELECT COALESCE(MAX(distance_meters),0), COALESCE(SUM(distance_meters),0),
         COUNT(DISTINCT activity_type)
    INTO v_maxdist, v_totdist, v_acttypes
    FROM public.cardio_logs WHERE user_id = v_uid OR created_by = v_email;

  SELECT quests_claimed, perfect_days INTO v_quests, v_perfect
    FROM public.user_quest_stats WHERE user_id = v_uid;
  v_quests := COALESCE(v_quests,0); v_perfect := COALESCE(v_perfect,0);

  SELECT COUNT(*) INTO v_goals FROM public.goals
   WHERE (user_id = v_uid OR created_by = v_email) AND status = 'completed';

  SELECT COUNT(*) INTO v_duelwins FROM public.duels WHERE winner_id = v_uid;

  -- Duels FOUGHT, not won. A ladder that only rewards winning punishes
  -- the person who most needs the encouragement to keep entering.
  SELECT COUNT(*) INTO v_duelplay FROM public.duels
   WHERE challenger_id = v_uid OR opponent_id = v_uid;

  SELECT COUNT(*) INTO v_bounties FROM public.bounties WHERE claimed_by_id = v_uid;

  SELECT challenges_completed,
         CASE WHEN COALESCE(path_completed,false) THEN 1 ELSE 0 END
    INTO v_gaunt, v_gauntpath
    FROM public.user_gauntlet_progress WHERE user_id = v_uid;
  v_gaunt := COALESCE(v_gaunt,0); v_gauntpath := COALESCE(v_gauntpath,0);

  SELECT COUNT(*) INTO v_crew FROM public.crew_members WHERE user_id = v_uid;
  SELECT COUNT(DISTINCT war_id) INTO v_crewwars
    FROM public.crew_war_contributions WHERE user_id = v_uid;

  SELECT COUNT(*) INTO v_posts FROM public.hub_posts
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(*) INTO v_checkins FROM public.gym_checkins WHERE user_id = v_uid;

  SELECT COUNT(*) INTO v_capsules FROM public.user_capsules
   WHERE user_id = v_uid AND COALESCE(is_opened,false);

  -- 'legendary' is not the top of the ramp: RARITY_ORDER in
  -- src/lib/collection.js runs …epic, legendary, mythic, animated.
  SELECT COUNT(*) INTO v_relics FROM public.user_inventory
   WHERE user_id = v_uid AND item_rarity IN ('legendary','mythic','animated');

  -- ── new signals ────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_meals FROM public.nutrition_logs
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(DISTINCT date) INTO v_ndays FROM public.nutrition_logs
   WHERE (user_id = v_uid OR created_by = v_email) AND date IS NOT NULL;

  SELECT COUNT(*) INTO v_sleep   FROM public.sleep_logs      WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_journal FROM public.journal_entries WHERE user_id = v_uid;
  SELECT COUNT(*) INTO v_debriefs FROM public.weekly_debriefs WHERE user_id = v_uid;

  SELECT COUNT(*) INTO v_regimens FROM public.regimens
   WHERE user_id = v_uid OR created_by = v_email;

  SELECT COUNT(*) INTO v_comments FROM public.hub_comments
   WHERE user_id = v_uid OR created_by = v_email;

  -- followee_id, NOT followee_email — and NOT follower_id, which would
  -- count who this user follows rather than who follows them. The
  -- followed/followee mix-up on this exact table broke 100% of Block
  -- clicks once already (see the identity section in CLAUDE.md).
  SELECT COUNT(*) INTO v_followers FROM public.hub_follows
   WHERE followee_id = v_uid;

  -- Lifetime coins EARNED, so spending them never takes a badge away.
  SELECT COALESCE(SUM(delta), 0) INTO v_coins FROM public.flex_coin_ledger
   WHERE user_id = v_uid AND delta > 0;

  -- 'completed', not 'sold' — the only two statuses in this table are
  -- 'active' and 'completed'.
  SELECT COUNT(*) INTO v_market FROM public.marketplace_listings
   WHERE seller_user_id = v_uid AND status = 'completed';

  RETURN jsonb_build_object(
    'workouts',v_workouts,'volumeLbs',v_volume,'distinctLifts',v_lifts,
    'workoutStreak',v_streak,'activeMonths',v_months,'questsClaimed',v_quests,
    'perfectDays',v_perfect,'maxDistanceM',v_maxdist,'totalDistanceM',v_totdist,
    'activityTypes',v_acttypes,'level',v_level,'prestige',v_prestige,
    'goalsDone',v_goals,'duelWins',v_duelwins,'bountiesClaimed',v_bounties,
    'gauntletDone',v_gaunt,'gauntletPath',v_gauntpath,'crewCount',v_crew,
    'crewWars',v_crewwars,'posts',v_posts,'checkins',v_checkins,
    'capsulesOpened',v_capsules,'legendaries',v_relics,
    'meals',v_meals,'nutritionDays',v_ndays,'sleepLogs',v_sleep,
    'journalEntries',v_journal,'debriefs',v_debriefs,'regimens',v_regimens,
    'duelsPlayed',v_duelplay,'comments',v_comments,'followers',v_followers,
    'coinsEarned',v_coins,'marketSales',v_market
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_trophy_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trophy_progress() TO authenticated;


-- ── 2. Grant engine, with prerequisites and a fixpoint loop ────────
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
  v_round  TEXT[];
  v_cap    INTEGER := 50;   -- mirrors TAIL_CAP in trophyDefinitions.js
  v_pass   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_sig := public.get_trophy_progress();

  -- Longest chain in the catalog is 2 (ladder top -> capstone -> apex).
  -- 6 is slack so a future chain does not silently stop resolving.
  FOR v_pass IN 1..6 LOOP
    WITH owned (tid) AS (
      SELECT trophy_id FROM public.user_trophies WHERE user_id = v_uid
    ),
    named (tid, needed, have) AS (
      VALUES
        -- Iron
        ('first_rep',        1::numeric,       (v_sig ->> 'workouts')::numeric),
        ('consistent',       10,               (v_sig ->> 'workouts')::numeric),
        ('committed',        50,               (v_sig ->> 'workouts')::numeric),
        ('centurion',        100,              (v_sig ->> 'workouts')::numeric),
        ('tonnage_ton',      2000,             (v_sig ->> 'volumeLbs')::numeric),
        ('tonnage_10t',      20000,            (v_sig ->> 'volumeLbs')::numeric),
        ('tonnage_100t',     200000,           (v_sig ->> 'volumeLbs')::numeric),
        ('tonnage_million',  1000000,          (v_sig ->> 'volumeLbs')::numeric),
        ('variety_10',       10,               (v_sig ->> 'distinctLifts')::numeric),
        ('variety_25',       25,               (v_sig ->> 'distinctLifts')::numeric),
        ('variety_50',       50,               (v_sig ->> 'distinctLifts')::numeric),
        ('variety_100',      100,              (v_sig ->> 'distinctLifts')::numeric),
        ('regimen_1',        1,                (v_sig ->> 'regimens')::numeric),
        ('regimen_5',        5,                (v_sig ->> 'regimens')::numeric),
        ('regimen_10',       10,               (v_sig ->> 'regimens')::numeric),
        ('regimen_25',       25,               (v_sig ->> 'regimens')::numeric),
        -- Consistency
        ('streak_spark',     7,                (v_sig ->> 'workoutStreak')::numeric),
        ('streak_blaze',     30,               (v_sig ->> 'workoutStreak')::numeric),
        ('streak_inferno',   100,              (v_sig ->> 'workoutStreak')::numeric),
        ('streak_eternal',   365,              (v_sig ->> 'workoutStreak')::numeric),
        ('longevity_3',      3,                (v_sig ->> 'activeMonths')::numeric),
        ('longevity_6',      6,                (v_sig ->> 'activeMonths')::numeric),
        ('longevity_12',     12,               (v_sig ->> 'activeMonths')::numeric),
        ('longevity_24',     24,               (v_sig ->> 'activeMonths')::numeric),
        ('quest_10',         10,               (v_sig ->> 'questsClaimed')::numeric),
        ('quest_100',        100,              (v_sig ->> 'questsClaimed')::numeric),
        ('quest_500',        500,              (v_sig ->> 'questsClaimed')::numeric),
        ('perfect_7',        7,                (v_sig ->> 'perfectDays')::numeric),
        ('perfect_30',       30,               (v_sig ->> 'perfectDays')::numeric),
        ('perfect_100',      100,              (v_sig ->> 'perfectDays')::numeric),
        -- Endurance
        ('cardio_5k',        5000,             (v_sig ->> 'maxDistanceM')::numeric),
        ('cardio_10k',       10000,            (v_sig ->> 'maxDistanceM')::numeric),
        ('cardio_half',      21097,            (v_sig ->> 'maxDistanceM')::numeric),
        ('cardio_marathon',  42195,            (v_sig ->> 'maxDistanceM')::numeric),
        ('distance_50k',     50000,            (v_sig ->> 'totalDistanceM')::numeric),
        ('distance_250k',    250000,           (v_sig ->> 'totalDistanceM')::numeric),
        ('distance_1000k',   1000000,          (v_sig ->> 'totalDistanceM')::numeric),
        ('cross_3',          3,                (v_sig ->> 'activityTypes')::numeric),
        ('cross_5',          5,                (v_sig ->> 'activityTypes')::numeric),
        ('cross_8',          8,                (v_sig ->> 'activityTypes')::numeric),
        -- Fuel
        ('meal_1',           1,                (v_sig ->> 'meals')::numeric),
        ('meal_50',          50,               (v_sig ->> 'meals')::numeric),
        ('meal_250',         250,              (v_sig ->> 'meals')::numeric),
        ('meal_1000',        1000,             (v_sig ->> 'meals')::numeric),
        ('nday_7',           7,                (v_sig ->> 'nutritionDays')::numeric),
        ('nday_30',          30,               (v_sig ->> 'nutritionDays')::numeric),
        ('nday_100',         100,              (v_sig ->> 'nutritionDays')::numeric),
        ('nday_365',         365,              (v_sig ->> 'nutritionDays')::numeric),
        -- Recovery
        ('sleep_7',          7,                (v_sig ->> 'sleepLogs')::numeric),
        ('sleep_30',         30,               (v_sig ->> 'sleepLogs')::numeric),
        ('sleep_100',        100,              (v_sig ->> 'sleepLogs')::numeric),
        ('journal_1',        1,                (v_sig ->> 'journalEntries')::numeric),
        ('journal_10',       10,               (v_sig ->> 'journalEntries')::numeric),
        ('journal_50',       50,               (v_sig ->> 'journalEntries')::numeric),
        ('debrief_1',        1,                (v_sig ->> 'debriefs')::numeric),
        ('debrief_10',       10,               (v_sig ->> 'debriefs')::numeric),
        ('debrief_52',       52,               (v_sig ->> 'debriefs')::numeric),
        -- Progression
        ('level_tier1',      10,               (v_sig ->> 'level')::numeric),
        ('level_tier2',      25,               (v_sig ->> 'level')::numeric),
        ('level_tier3',      50,               (v_sig ->> 'level')::numeric),
        ('level_apex',       100,              (v_sig ->> 'level')::numeric),
        ('prestige_1',       1,                (v_sig ->> 'prestige')::numeric),
        ('prestige_3',       3,                (v_sig ->> 'prestige')::numeric),
        ('prestige_5',       5,                (v_sig ->> 'prestige')::numeric),
        ('goal_first',       1,                (v_sig ->> 'goalsDone')::numeric),
        ('goal_10',          10,               (v_sig ->> 'goalsDone')::numeric),
        ('goal_50',          50,               (v_sig ->> 'goalsDone')::numeric),
        -- Arena
        ('duel_challenger',  1,                (v_sig ->> 'duelWins')::numeric),
        ('duel_champion',    10,               (v_sig ->> 'duelWins')::numeric),
        ('duel_gladiator',   50,               (v_sig ->> 'duelWins')::numeric),
        ('duel_immortal',    200,              (v_sig ->> 'duelWins')::numeric),
        ('duelplay_1',       1,                (v_sig ->> 'duelsPlayed')::numeric),
        ('duelplay_25',      25,               (v_sig ->> 'duelsPlayed')::numeric),
        ('duelplay_100',     100,              (v_sig ->> 'duelsPlayed')::numeric),
        ('bounty_1',         1,                (v_sig ->> 'bountiesClaimed')::numeric),
        ('bounty_10',        10,               (v_sig ->> 'bountiesClaimed')::numeric),
        ('bounty_50',        50,               (v_sig ->> 'bountiesClaimed')::numeric),
        ('gauntlet_5',       5,                (v_sig ->> 'gauntletDone')::numeric),
        ('gauntlet_path',    1,                (v_sig ->> 'gauntletPath')::numeric),
        -- Crew
        ('crew_squad',       1,                (v_sig ->> 'crewCount')::numeric),
        ('crewwar_1',        1,                (v_sig ->> 'crewWars')::numeric),
        ('crewwar_10',       10,               (v_sig ->> 'crewWars')::numeric),
        ('crewwar_50',       50,               (v_sig ->> 'crewWars')::numeric),
        -- Community
        ('post_1',           1,                (v_sig ->> 'posts')::numeric),
        ('post_10',          10,               (v_sig ->> 'posts')::numeric),
        ('post_50',          50,               (v_sig ->> 'posts')::numeric),
        ('post_200',         200,              (v_sig ->> 'posts')::numeric),
        ('comment_1',        1,                (v_sig ->> 'comments')::numeric),
        ('comment_25',       25,               (v_sig ->> 'comments')::numeric),
        ('comment_100',      100,              (v_sig ->> 'comments')::numeric),
        ('follower_1',       1,                (v_sig ->> 'followers')::numeric),
        ('follower_10',      10,               (v_sig ->> 'followers')::numeric),
        ('follower_50',      50,               (v_sig ->> 'followers')::numeric),
        ('follower_200',     200,              (v_sig ->> 'followers')::numeric),
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
        ('relic_25',         25,               (v_sig ->> 'legendaries')::numeric),
        ('coin_1k',          1000,             (v_sig ->> 'coinsEarned')::numeric),
        ('coin_10k',         10000,            (v_sig ->> 'coinsEarned')::numeric),
        ('coin_100k',        100000,           (v_sig ->> 'coinsEarned')::numeric),
        ('market_1',         1,                (v_sig ->> 'marketSales')::numeric),
        ('market_10',        10,               (v_sig ->> 'marketSales')::numeric),
        ('market_50',        50,               (v_sig ->> 'marketSales')::numeric),
        -- Capstones: no numeric criterion (0 >= 0 always passes). They
        -- are gated ENTIRELY by the requirement edges below.
        ('capstone_iron',         0, 0),
        ('capstone_consistency',  0, 0),
        ('capstone_endurance',    0, 0),
        ('capstone_nutrition',    0, 0),
        ('capstone_recovery',     0, 0),
        ('capstone_progression',  0, 0),
        ('capstone_arena',        0, 0),
        ('capstone_community',    0, 0),
        ('capstone_collection',   0, 0),
        ('capstone_apex',         0, 0)
    ),
    -- Requirement edges, one row per (trophy, prerequisite). Mirrors
    -- `requires` in src/lib/trophyDefinitions.js.
    reqs (tid, req) AS (
      VALUES
        ('crewwar_1', 'crew_squad'),
        ('capstone_iron','centurion'), ('capstone_iron','tonnage_million'),
        ('capstone_iron','variety_100'), ('capstone_iron','regimen_25'),
        ('capstone_consistency','streak_eternal'), ('capstone_consistency','longevity_24'),
        ('capstone_consistency','quest_500'), ('capstone_consistency','perfect_100'),
        ('capstone_endurance','cardio_marathon'), ('capstone_endurance','distance_1000k'),
        ('capstone_endurance','cross_8'),
        ('capstone_nutrition','meal_1000'), ('capstone_nutrition','nday_365'),
        ('capstone_recovery','sleep_100'), ('capstone_recovery','journal_50'),
        ('capstone_recovery','debrief_52'),
        ('capstone_progression','level_apex'), ('capstone_progression','prestige_5'),
        ('capstone_progression','goal_50'),
        ('capstone_arena','duel_immortal'), ('capstone_arena','duelplay_100'),
        ('capstone_arena','bounty_50'), ('capstone_arena','gauntlet_path'),
        ('capstone_community','crewwar_50'), ('capstone_community','post_200'),
        ('capstone_community','comment_100'), ('capstone_community','follower_200'),
        ('capstone_community','checkin_365'),
        ('capstone_collection','capsule_100'), ('capstone_collection','relic_25'),
        ('capstone_collection','coin_100k'), ('capstone_collection','market_50'),
        ('capstone_apex','capstone_iron'), ('capstone_apex','capstone_consistency'),
        ('capstone_apex','capstone_endurance'), ('capstone_apex','capstone_nutrition'),
        ('capstone_apex','capstone_recovery'), ('capstone_apex','capstone_progression'),
        ('capstone_apex','capstone_arena'), ('capstone_apex','capstone_community'),
        ('capstone_apex','capstone_collection')
    ),
    ladder (lad, base, step, have) AS (
      VALUES
        ('sessions',  100::numeric,     100::numeric,     (v_sig ->> 'workouts')::numeric),
        ('tonnage',   1000000,          1000000,          (v_sig ->> 'volumeLbs')::numeric),
        ('variety',   100,              50,               (v_sig ->> 'distinctLifts')::numeric),
        ('regimen',   25,               25,               (v_sig ->> 'regimens')::numeric),
        ('streak',    365,              365,              (v_sig ->> 'workoutStreak')::numeric),
        ('longevity', 24,               12,               (v_sig ->> 'activeMonths')::numeric),
        ('quests',    500,              500,              (v_sig ->> 'questsClaimed')::numeric),
        ('perfect',   100,              100,              (v_sig ->> 'perfectDays')::numeric),
        ('distance',  1000000,          1000000,          (v_sig ->> 'totalDistanceM')::numeric),
        ('meals',     1000,             1000,             (v_sig ->> 'meals')::numeric),
        ('ndays',     365,              365,              (v_sig ->> 'nutritionDays')::numeric),
        ('sleep',     100,              100,              (v_sig ->> 'sleepLogs')::numeric),
        ('journal',   50,               50,               (v_sig ->> 'journalEntries')::numeric),
        ('debrief',   52,               52,               (v_sig ->> 'debriefs')::numeric),
        ('prestige',  5,                1,                (v_sig ->> 'prestige')::numeric),
        ('goals',     50,               50,               (v_sig ->> 'goalsDone')::numeric),
        ('duel',      200,              200,              (v_sig ->> 'duelWins')::numeric),
        ('duelplay',  100,              100,              (v_sig ->> 'duelsPlayed')::numeric),
        ('bounty',    50,               50,               (v_sig ->> 'bountiesClaimed')::numeric),
        ('crewwar',   50,               50,               (v_sig ->> 'crewWars')::numeric),
        ('social',    200,              200,              (v_sig ->> 'posts')::numeric),
        ('comments',  100,              100,              (v_sig ->> 'comments')::numeric),
        ('followers', 200,              200,              (v_sig ->> 'followers')::numeric),
        ('gym',       365,              365,              (v_sig ->> 'checkins')::numeric),
        ('capsule',   100,              100,              (v_sig ->> 'capsulesOpened')::numeric),
        ('relic',     25,               25,               (v_sig ->> 'legendaries')::numeric),
        ('coins',     100000,           100000,           (v_sig ->> 'coinsEarned')::numeric),
        ('market',    50,               50,               (v_sig ->> 'marketSales')::numeric)
    ),
    tails (tid) AS (
      SELECT lad || '_x' || k
        FROM ladder
        CROSS JOIN LATERAL generate_series(
          1,
          -- Clamp in NUMERIC and cast to integer LAST: casting first
          -- overflows int4 on an absurd signal, which is exactly the
          -- corrupt-data case the cap exists to survive.
          LEAST(v_cap::numeric, GREATEST(0::numeric, floor((have - base) / step)))::integer
        ) AS k
    ),
    candidate (tid) AS (
      SELECT tid FROM named WHERE have >= needed
      UNION
      SELECT tid FROM tails
    ),
    -- Any trophy with at least one prerequisite it does not yet own.
    -- Expressed as a set difference rather than a correlated NOT EXISTS
    -- so there is no `alias.column` token to survive the clipboard.
    unmet (tid) AS (
      SELECT tid FROM reqs WHERE req NOT IN (SELECT tid FROM owned)
    ),
    eligible (tid) AS (
      SELECT tid FROM candidate
      EXCEPT
      SELECT tid FROM unmet
    ),
    ins AS (
      INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
      SELECT v_uid, v_email, tid FROM eligible
      ON CONFLICT (user_id, trophy_id) DO NOTHING
      RETURNING trophy_id
    )
    SELECT COALESCE(array_agg(trophy_id), ARRAY[]::TEXT[]) INTO v_round FROM ins;

    v_new := v_new || v_round;
    -- array_length of an empty array is NULL, not 0.
    EXIT WHEN array_length(v_round, 1) IS NULL;
  END LOOP;

  -- Self-heal the badge counter from the source of truth. Drives the
  -- achievements leaderboard and the profile "Badges" stat.
  UPDATE public.user_profiles
     SET achievements_unlocked_count = (
           SELECT count(*) FROM public.user_trophies WHERE user_id = v_uid)
   WHERE id = v_uid;

  RETURN jsonb_build_object('newly_granted', to_jsonb(v_new));
END;
$$;

REVOKE ALL ON FUNCTION public.grant_eligible_trophies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_eligible_trophies() TO authenticated;

NOTIFY pgrst, 'reload schema';
