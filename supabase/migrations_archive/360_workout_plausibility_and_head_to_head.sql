-- 360_workout_plausibility_and_head_to_head.sql
--
-- Two things: the plausibility model finally runs on the server, and a
-- war shows both rosters instead of one.
--
-- ══ 1. THE PLAUSIBILITY GATE FLAGS, IT DOES NOT REJECT ═══════════════
--
-- `detectImplausibleWorkout` (src/lib/workoutFatigue.js) has always been
-- client-side, and `public.workout_logs` has had no triggers at all. 359
-- stopped an implausible log WINNING a war; this stops it being invisible.
--
-- IT DOES NOT BLOCK THE SAVE, and that is a deliberate choice against the
-- obvious one. Three reasons, in order of how much they matter:
--
--   1. A reject destroys the session. `weight_lbs` is set on 27 of 60
--      profiles, so the model falls back to a 160 lb default for most
--      people — and a genuinely strong lifter with a blank profile can
--      exceed a 160 lb lifter's ceiling honestly. Rejecting means they
--      retype the session or give up. Flagging costs them nothing.
--   2. The real client ALREADY blocks (Workout.jsx returns early and
--      shows `implausibleWarning`). So a server reject adds nothing for
--      an honest user — it can only fire where the two models disagree,
--      which is exactly the false-positive case.
--   3. A reject TEACHES THE THRESHOLD. Refuse at 28,800 and the next
--      attempt is 28,700 forever. A silent flag accumulates the pattern
--      instead, which is what a ban decision actually needs.
--
-- So: never raises, never edits the user's `exercises`, and the flag is
-- assigned by the trigger on every write, so a crafted request cannot
-- set `implausible = false` on its own row.
--
-- Same-day accumulation IS covered — the check sums the user's other logs
-- on that date, because otherwise the answer is "split it into ten rows".
--
-- ══ 2. WHAT THE FLAG COSTS YOU ══════════════════════════════════════
--
-- A flagged session stops counting toward a crew war — volume, sessions
-- AND days. 359 capped volume, which on its own left the session and day
-- components (50 and 100 points each) fully payable on a fabricated
-- session, so seven absurd logs still bought 1,050 points. Both layers
-- stay: the cap catches a plausible-looking week that is too big in
-- aggregate, the flag catches the individual session that is not real.
--
-- It does NOT touch XP, gym leaderboards or weekly reviews. Those read
-- the same table and each one is its own decision about what to do with a
-- flagged row; making that call for all of them inside a Crew Wars
-- migration would be exactly the kind of silent blast radius this repo
-- keeps getting bitten by.
--
-- ══ 3. THE WAR SHOWS BOTH ROSTERS ═══════════════════════════════════
--
-- get_crew_war_breakdown returned `members` for the caller's own crew
-- only. That was my call and Kegan has overridden it: a war should show
-- who you are fighting.
--
-- The split it keeps: every member of BOTH crews now comes back with a
-- name and a score, because that is the contest. Per-day detail —
-- volume_lbs, sessions, days_active — is still own-crew only. Which of
-- your rivals trained on which days is a training calendar, not a
-- scoreboard, and nothing on the head-to-head board needs it.
--
-- Paste-safe per repo convention.

-- ── The daily model, factored out ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_daily_volume_ceiling(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $user_daily_volume_ceiling$
DECLARE
  v_weight numeric;
  v_age    numeric;
  v_gender text;
  v_budget numeric;
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

  RETURN GREATEST(0, FLOOR(v_budget));
END;
$user_daily_volume_ceiling$;

REVOKE ALL ON FUNCTION public.user_daily_volume_ceiling(uuid)
  FROM PUBLIC, anon, authenticated;

-- 359's weekly ceiling is now one multiplication on top of the daily one,
-- so the two can never drift apart.
CREATE OR REPLACE FUNCTION public.crew_member_volume_ceiling(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $crew_member_volume_ceiling$
  SELECT LEAST(200000, GREATEST(0, public.user_daily_volume_ceiling(p_user_id) * 7))::bigint;
$crew_member_volume_ceiling$;

REVOKE ALL ON FUNCTION public.crew_member_volume_ceiling(uuid)
  FROM PUBLIC, anon, authenticated;

-- ── The flag ─────────────────────────────────────────────────────────

ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS implausible       boolean,
  ADD COLUMN IF NOT EXISTS implausible_ratio numeric;

COMMENT ON COLUMN public.workout_logs.implausible IS
  'Server-assigned. TRUE when this row plus the same day''s other logs '
  'exceed the lifter''s modelled daily ceiling. Never blocks the write; '
  'excluded from crew-war scoring. Set by trigger on every write, so a '
  'client-supplied value is always overwritten.';

COMMENT ON COLUMN public.workout_logs.implausible_ratio IS
  'day total / modelled ceiling. 1.2 is a borderline day; 40 is a typo or '
  'a forgery. Ranks severity for a moderation decision.';

CREATE OR REPLACE FUNCTION public.workout_logs_flag_implausible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $workout_logs_flag_implausible$
DECLARE
  v_user     uuid;
  v_email    text;
  v_ceiling  numeric;
  v_this     numeric;
  v_same_day numeric;
  v_total    numeric;
BEGIN
  -- Identity is keyed two ways on this table (see CLAUDE.md). A row with
  -- only created_by still has to be attributed to somebody, or the whole
  -- check silently no-ops on the legacy path.
  v_user := NEW.user_id;
  IF v_user IS NULL AND NEW.created_by IS NOT NULL THEN
    SELECT id INTO v_user
      FROM public.user_profiles
     WHERE lower(email) = lower(NEW.created_by)
     LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    -- Nobody to model. Unknown is not a claim of guilt.
    NEW.implausible       := FALSE;
    NEW.implausible_ratio := NULL;
    RETURN NEW;
  END IF;

  v_ceiling := public.user_daily_volume_ceiling(v_user);
  v_this    := COALESCE(public._duel_calc_volume(NEW.exercises), 0);

  SELECT lower(email) INTO v_email
    FROM public.user_profiles WHERE id = v_user;

  -- Everything else this person logged on the same calendar day.
  -- Without this the answer to a ceiling is "post it in ten pieces".
  SELECT COALESCE(SUM(public._duel_calc_volume(exercises)), 0)
    INTO v_same_day
    FROM public.workout_logs
   WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
     AND "date" = NEW."date"
     AND NOT (id = NEW.id);

  v_total := v_this + COALESCE(v_same_day, 0);

  IF v_ceiling = LEAST(v_ceiling, 0) THEN
    NEW.implausible       := FALSE;
    NEW.implausible_ratio := NULL;
  ELSE
    NEW.implausible_ratio := ROUND(v_total / v_ceiling, 3);
    NEW.implausible       := NOT (v_total = LEAST(v_total, v_ceiling));
  END IF;

  RETURN NEW;
END;
$workout_logs_flag_implausible$;

DROP TRIGGER IF EXISTS workout_logs_flag_implausible_tr ON public.workout_logs;
CREATE TRIGGER workout_logs_flag_implausible_tr
  BEFORE INSERT OR UPDATE ON public.workout_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.workout_logs_flag_implausible();

-- Backfill. A no-op UPDATE fires the BEFORE trigger, which fills both
-- columns from the same model — so history is classified by exactly the
-- rule new rows will be.
UPDATE public.workout_logs SET updated_at = updated_at WHERE implausible IS NULL;

-- ── A flagged session does not count toward a war ────────────────────

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

      -- `NOT COALESCE(implausible, FALSE)` and not `implausible = FALSE`:
      -- a row written before this migration and somehow never backfilled
      -- would be NULL, and NULL must read as "fine", not as "excluded".
      SELECT
        COALESCE(SUM(public._duel_calc_volume(exercises)), 0),
        COUNT(*),
        COUNT(DISTINCT "date")
      INTO v_vol, v_sess, v_days
      FROM public.workout_logs
      WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
        AND created_at BETWEEN v_start AND v_end
        AND NOT COALESCE(implausible, FALSE);

      v_cap    := public.crew_member_volume_ceiling(v_user);
      v_vol_c  := LEAST(v_cap, GREATEST(0, FLOOR(COALESCE(v_vol, 0))))::bigint;
      v_sess_c := LEAST(28, GREATEST(0, COALESCE(v_sess, 0)));
      v_days_c := LEAST(7,  GREATEST(0, COALESCE(v_days, 0)));

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

-- ── Both rosters on the board ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_crew_war_breakdown(p_war_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $get_crew_war_breakdown$
DECLARE
  v_uid    uuid := auth.uid();
  v_crew_a uuid;
  v_crew_b uuid;
  v_mine   uuid;
  v_seen   integer;
  v_rows   jsonb;
  v_totals jsonb;
BEGIN
  IF v_uid IS NULL OR p_war_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT crew_a_id, crew_b_id INTO v_crew_a, v_crew_b
    FROM public.crew_wars WHERE id = p_war_id;

  IF v_crew_a IS NULL THEN
    RETURN NULL;
  END IF;

  -- Still gated on belonging to one of the two crews. Opening the member
  -- list to both sides does not open it to spectators.
  SELECT crew_id INTO v_mine
    FROM public.crew_members
   WHERE user_id = v_uid AND crew_id IN (v_crew_a, v_crew_b)
   LIMIT 1;

  IF v_mine IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_seen
    FROM public.crew_war_contributions WHERE war_id = p_war_id;

  IF v_seen = 0 THEN
    RETURN jsonb_build_object('war_id', p_war_id, 'my_crew_id', v_mine,
                              'crew_a_id', v_crew_a, 'crew_b_id', v_crew_b,
                              'totals', '[]'::jsonb, 'members', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'crew_id',     t_crew,
             'volume_lbs',  t_vol,
             'sessions',    t_sess,
             'days_active', t_days,
             'score',       t_score
           ) ORDER BY t_score DESC
         ), '[]'::jsonb)
    INTO v_totals
    FROM (
      SELECT crew_id AS t_crew,
             SUM(volume_lbs)     AS t_vol,
             SUM(sessions)       AS t_sess,
             SUM(days_active)    AS t_days,
             SUM(xp_contributed) AS t_score
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id
       GROUP BY crew_id
    ) AS sides;

  -- BOTH crews. The per-day columns stay own-crew only: a rival's score
  -- is the contest, a rival's training calendar is not.
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     m_user,
             'crew_id',     m_crew,
             'score',       m_score,
             'volume_lbs',  CASE WHEN m_crew = v_mine THEN m_vol  ELSE NULL END,
             'sessions',    CASE WHEN m_crew = v_mine THEN m_sess ELSE NULL END,
             'days_active', CASE WHEN m_crew = v_mine THEN m_days ELSE NULL END,
             'username',    (SELECT username   FROM public.user_profiles WHERE id = m_user),
             'full_name',   (SELECT full_name  FROM public.user_profiles WHERE id = m_user),
             'avatar_url',  (SELECT avatar_url FROM public.user_profiles WHERE id = m_user),
             'is_mine',     m_crew = v_mine
           ) ORDER BY m_score DESC
         ), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT user_id AS m_user, crew_id AS m_crew, xp_contributed AS m_score,
             volume_lbs AS m_vol, sessions AS m_sess, days_active AS m_days
        FROM public.crew_war_contributions
       WHERE war_id = p_war_id
    ) AS all_sides;

  RETURN jsonb_build_object(
    'war_id',     p_war_id,
    'my_crew_id', v_mine,
    'crew_a_id',  v_crew_a,
    'crew_b_id',  v_crew_b,
    'totals',     COALESCE(v_totals, '[]'::jsonb),
    'members',    COALESCE(v_rows, '[]'::jsonb)
  );
END;
$get_crew_war_breakdown$;
