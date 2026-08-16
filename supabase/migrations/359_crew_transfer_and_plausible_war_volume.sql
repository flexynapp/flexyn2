-- 359_crew_transfer_and_plausible_war_volume.sql
--
-- Two things: handing a crew over, and stopping an implausible log from
-- winning a war.
--
-- ── 1. TRANSFER LEADERSHIP ───────────────────────────────────────────
--
-- 357 deliberately kept LEADER out of the rank picker: promoting someone
-- to leader is not a role change, it is giving away the crew, and it does
-- not belong behind the same tap as "make moderator". This is that action,
-- and it is atomic — the old leader steps down and the new one steps up in
-- one statement pair inside one transaction, so there is no instant with
-- two leaders or none. The guard trigger from 357 refuses a demotion that
-- would leave zero leaders, so doing it in the other order would fail.
--
-- ── 2. WAR VOLUME IS CAPPED AT WHAT THE LIFTER COULD PLAUSIBLY DO ────
--
-- `detectImplausibleWorkout` in src/lib/workoutFatigue.js models what a
-- person can actually lift in a day from bodyweight, age and sex, and it
-- is the app's second anti-cheat layer. It is called in exactly two places
-- — Workout.jsx on save and EditWorkoutModal — and BOTH ARE THE CLIENT.
-- `public.workout_logs` has no triggers at all: measured, zero. So a
-- crafted request writes whatever it likes, and crew-war scoring read it
-- with a flat `LEAST(200000, …)` ceiling that is the same number for a
-- 120 lb fifty-five-year-old as for a 250 lb twenty-five-year-old.
--
-- That flat cap is roughly ONE average male's honest week. For everyone
-- smaller, older, or female it sat around twice their real ceiling, so the
-- cap only ever bound the people least likely to need it.
--
-- `crew_member_volume_ceiling` ports the same model to SQL and scores each
-- member against THEIR OWN ceiling. Two properties make this safe to ship:
--
--   * It only ever tightens. The flat 200,000 is still an absolute
--     ceiling; a 300 lb lifter's larger budget does not raise it.
--   * It is a no-op for a member we know nothing about. With no weight,
--     age or sex the model lands on 201,600 for the week, which LEAST()
--     immediately clamps back to 200,000 — the behaviour before this
--     migration. Nobody is penalised for an empty profile.
--
-- Measured coverage before writing this: weight_lbs is set on 27 of 60
-- profiles, age on 26, gender on 13. So this bites for under half the
-- users today and does nothing to the rest, which is the honest outcome —
-- it cannot be made stricter without punishing people for not having
-- filled in a form.
--
-- This does NOT stop the log being written; it stops it deciding a war.
-- A server-side gate on workout_logs itself is a bigger change that
-- touches every feature reading that table, and is deliberately not in
-- this migration.
--
-- ── 3. STRENGTH IS NOW BODYWEIGHT-RELATIVE ───────────────────────────
--
-- crew_match_strength averaged each member's best estimated 1RM in
-- absolute pounds, which ranks a crew of heavyweights above a crew of
-- lighter lifters who are, pound for pound, stronger — and then matches
-- them against each other. Relative strength (e1RM / bodyweight) is the
-- standard comparator and is what "a somewhat fair fight" means here.
--
-- Members whose bodyweight is unknown are skipped rather than mixed in:
-- averaging a ratio with a raw poundage produces a number that means
-- nothing. If no member of a crew has a bodyweight the function returns
-- NULL and crew_match_gap drops the dimension, exactly as it does for age.
--
-- The UNITS OF match_strength CHANGE with this migration — roughly 225
-- becomes roughly 1.4. `crew_wars` holds 0 rows (verified), so there is
-- nothing stored to migrate; a queue entry is transient by construction.
--
-- Paste-safe per repo convention.

-- ── Transfer ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_crew_leadership(
  p_crew_id uuid,
  p_to_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $transfer_crew_leadership$
DECLARE
  v_uid       uuid := auth.uid();
  v_my_rank   integer;
  v_they_are  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_to_user IS NULL THEN
    RAISE EXCEPTION 'crew_id and target required' USING ERRCODE = '22023';
  END IF;
  -- Authority first, then the argument. Checking "is the target me?"
  -- ahead of "am I the leader?" answers a non-leader with "you already
  -- lead this crew", which is both wrong and tells them less than the
  -- refusal they should have got. The probe caught this.
  v_my_rank := public.crew_rank(p_crew_id, v_uid);

  IF NOT (v_my_rank = 3) THEN
    RAISE EXCEPTION 'only a crew leader can hand over the crew'
      USING ERRCODE = '42501';
  END IF;

  IF p_to_user = v_uid THEN
    RAISE EXCEPTION 'you already lead this crew' USING ERRCODE = '22023';
  END IF;

  v_they_are := public.crew_rank(p_crew_id, p_to_user);

  IF v_they_are = 0 THEN
    RAISE EXCEPTION 'that person is not in this crew' USING ERRCODE = '22023';
  END IF;

  -- Promote FIRST. 357's guard refuses a demotion that would leave the
  -- crew with no leader, so stepping down before handing over would be
  -- rejected — and doing it in this order means a crash between the two
  -- statements leaves two leaders rather than none. Both are recoverable;
  -- only one of them is recoverable by the users themselves.
  UPDATE public.crew_members
     SET role = 'leader', is_admin = TRUE
   WHERE crew_id = p_crew_id
     AND user_id = p_to_user;

  UPDATE public.crew_members
     SET role = 'member', is_admin = FALSE
   WHERE crew_id = p_crew_id
     AND user_id = v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'new_leader', p_to_user);
END;
$transfer_crew_leadership$;

REVOKE ALL ON FUNCTION public.transfer_crew_leadership(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_crew_leadership(uuid, uuid) TO authenticated;

-- ── The plausibility ceiling ─────────────────────────────────────────
--
-- Mirrors getDailyVolumeBudget in src/lib/workoutFatigue.js, times the
-- seven days a war runs. The same-day cardio penalty in the JS is
-- deliberately not ported: it exists to stop one session's budget being
-- spent twice on one day, and over a seven-day window it would punish
-- people for doing cardio at all.

CREATE OR REPLACE FUNCTION public.crew_member_volume_ceiling(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_member_volume_ceiling$
DECLARE
  v_weight  numeric;
  v_age     numeric;
  v_gender  text;
  v_budget  numeric;
BEGIN
  SELECT COALESCE(weight_lbs, 160),
         COALESCE(age, EXTRACT(YEAR FROM age(birthday)), 36),
         COALESCE(lower(gender), 'male')
    INTO v_weight, v_age, v_gender
    FROM public.user_profiles
   WHERE id = p_user_id;

  IF v_weight IS NULL THEN
    v_weight := 160;
    v_age    := 36;
    v_gender := 'male';
  END IF;

  v_budget := v_weight * 200;

  IF v_age = LEAST(v_age, 17) THEN
    v_budget := v_budget * 0.85;
  ELSIF v_age = LEAST(v_age, 35) THEN
    v_budget := v_budget;
  ELSIF v_age = LEAST(v_age, 50) THEN
    v_budget := v_budget * 0.90;
  ELSIF v_age = LEAST(v_age, 65) THEN
    v_budget := v_budget * 0.75;
  ELSE
    v_budget := v_budget * 0.55;
  END IF;

  IF v_gender = 'female' THEN
    v_budget := v_budget * 0.85;
  END IF;

  -- Seven days of war, and never above the absolute ceiling.
  RETURN LEAST(200000, GREATEST(0, FLOOR(v_budget * 7)))::bigint;
END;
$crew_member_volume_ceiling$;

REVOKE ALL ON FUNCTION public.crew_member_volume_ceiling(uuid)
  FROM PUBLIC, anon, authenticated;

-- ── Strength, pound for pound ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crew_match_strength(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_match_strength$
DECLARE
  v_user   uuid;
  v_email  text;
  v_weight numeric;
  v_best   numeric;
  v_sum    numeric := 0;
  v_n      integer := 0;
BEGIN
  FOR v_user IN
    SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40
  LOOP
    SELECT lower(email), weight_lbs INTO v_email, v_weight
      FROM public.user_profiles WHERE id = v_user;

    -- No bodyweight means no ratio. Skipping the member is the only
    -- honest option: averaging 1.6 with 315 produces a number that
    -- describes nothing.
    IF v_weight IS NOT NULL AND v_weight > 0 THEN
      SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric)
        INTO v_best
        FROM public.workout_logs
       WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
         AND created_at > now() - INTERVAL '90 days';

      IF v_best IS NOT NULL THEN
        v_sum := v_sum + (v_best / v_weight);
        v_n   := v_n + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_n = 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_sum / v_n;
END;
$crew_match_strength$;

-- ── Scoring against each lifter's own ceiling ────────────────────────
--
-- Only the v_vol_c line changes from 358's body. Everything else — the
-- per-member rows, the top-N roll-up, the fielded count — is as it was.

CREATE OR REPLACE FUNCTION public.recompute_crew_war(p_war_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $recompute_crew_war$
DECLARE
  v_crew_a  uuid;
  v_crew_b  uuid;
  v_start   timestamptz;
  v_end     timestamptz;
  v_status  text;
  v_crew    uuid;
  v_user    uuid;
  v_email   text;
  v_vol     numeric;
  v_sess    integer;
  v_days    integer;
  v_cap     bigint;
  v_vol_c   bigint;
  v_sess_c  integer;
  v_days_c  integer;
  v_score   integer;
  v_n_a     integer;
  v_n_b     integer;
  v_field   integer;
  v_score_a integer;
  v_score_b integer;
  v_touched integer := 0;
BEGIN
  IF p_war_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT crew_a_id, crew_b_id, starts_at, ends_at, status
    INTO v_crew_a, v_crew_b, v_start, v_end, v_status
    FROM public.crew_wars
   WHERE id = p_war_id;

  IF v_crew_b IS NULL OR v_start IS NULL OR v_end IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_crew IN SELECT unnest(ARRAY[v_crew_a, v_crew_b])
  LOOP
    FOR v_user IN
      SELECT user_id FROM public.crew_members WHERE crew_id = v_crew LIMIT 40
    LOOP
      SELECT lower(email) INTO v_email
        FROM public.user_profiles WHERE id = v_user;

      SELECT
        COALESCE(SUM(public._duel_calc_volume(exercises)), 0),
        COUNT(*),
        COUNT(DISTINCT "date")
      INTO v_vol, v_sess, v_days
      FROM public.workout_logs
      WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
        AND created_at BETWEEN v_start AND v_end;

      -- The lifter's own plausible week, never above the flat ceiling.
      v_cap    := public.crew_member_volume_ceiling(v_user);
      v_vol_c  := LEAST(v_cap, GREATEST(0, FLOOR(COALESCE(v_vol, 0))))::bigint;
      v_sess_c := LEAST(28, GREATEST(0, COALESCE(v_sess, 0)));
      v_days_c := LEAST(7,  GREATEST(0, COALESCE(v_days, 0)));

      -- Score the CAPPED figures. This is NOT fixing a previous bug:
      -- _crew_war_score clamps internally with its own LEAST(200000, …),
      -- so passing the raw v_vol was equivalent while the flat ceiling was
      -- the only one. It stops being equivalent the moment a per-member
      -- ceiling exists below 200,000 — that function knows nothing about
      -- the lifter, so the cap has to be applied before the call or it
      -- does nothing at all.
      v_score := public._crew_war_score(v_vol_c, v_sess_c, v_days_c);

      INSERT INTO public.crew_war_contributions
        (war_id, user_id, crew_id, xp_contributed, volume_lbs, sessions, days_active, updated_at)
      VALUES
        (p_war_id, v_user, v_crew, v_score, v_vol_c, v_sess_c, v_days_c, now())
      ON CONFLICT (war_id, user_id) DO UPDATE
        SET xp_contributed = v_score,
            volume_lbs     = v_vol_c,
            sessions       = v_sess_c,
            days_active    = v_days_c,
            crew_id        = v_crew,
            updated_at     = now();

      v_touched := v_touched + 1;
    END LOOP;
  END LOOP;

  SELECT COUNT(*) INTO v_n_a
    FROM public.crew_war_contributions
   WHERE war_id = p_war_id AND crew_id = v_crew_a;

  SELECT COUNT(*) INTO v_n_b
    FROM public.crew_war_contributions
   WHERE war_id = p_war_id AND crew_id = v_crew_b;

  v_field := GREATEST(1, LEAST(v_n_a, v_n_b));

  SELECT COALESCE(SUM(xp_contributed), 0) INTO v_score_a
    FROM (
      SELECT xp_contributed
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id AND crew_id = v_crew_a
       ORDER BY xp_contributed DESC
       LIMIT v_field
    ) AS fielded_a;

  SELECT COALESCE(SUM(xp_contributed), 0) INTO v_score_b
    FROM (
      SELECT xp_contributed
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id AND crew_id = v_crew_b
       ORDER BY xp_contributed DESC
       LIMIT v_field
    ) AS fielded_b;

  UPDATE public.crew_wars
     SET crew_a_score = v_score_a,
         crew_b_score = v_score_b,
         scored_at    = now()
   WHERE id = p_war_id;

  RETURN v_touched;
END;
$recompute_crew_war$;
