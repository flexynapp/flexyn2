-- 367_crew_generational_challenges_and_trophies.sql
--
-- Pre-built generational challenges, and the crew trophy that completing
-- one pays out. Kegan's spec, 2026-08-16:
--
--   "Crew Challenges should be already pre-built, generational goals for
--    Crews to chase. When a Crew completes a Challenge they receive a
--    trophy with the title related to completing that challenge, which
--    they can display in a new Trophies menu next to the League menu."
--   "The leader can select between all available challenges for their
--    Crew level ... each challenge should be rewarded with a unique
--    trophy."
--
-- The leader-composed challenge from migration 098 STAYS (kegan's call).
-- Both kinds live in public.crew_challenges; template_key IS NULL means
-- the old free-form kind, and every behaviour below keys off that.
--
-- MEASURED BEFORE WRITING THIS. public.crew_challenges holds ZERO rows in
-- production and crew_challenge_contributions holds zero -- the composed
-- feature has never been used once since 098 shipped. So nothing here
-- migrates existing data, and the generational path is the first thing
-- that will ever put a row in this table.
--
--
-- WHY A TEMPLATE TABLE AND NOT A CHECK CONSTRAINT
--
-- The catalog is DATA because it grows on a product cadence ("we will add
-- more challenges for higher levels later") and because the UI has to
-- render the locked ones. A CHECK constraint would make every new
-- challenge a migration and would leave the client with no way to show a
-- crew what it is climbing toward.
--
--
-- THE HOLE THIS CLOSES ON THE WAY PAST (see the plausibility section of
-- CLAUDE.md). sync_my_crew_challenge_progress reads workout_logs for
-- total_volume / total_sessions / days_active and pays increment_user_xp,
-- grant_flex_coins and award_crew_progress on completion. It had NO
-- implausibility filter. Migrations 361 and 362 swept the competitive-or-
-- credited readers and this one was missed -- CLAUDE.md's own list names
-- fifteen of the twenty-four functions that read workout_logs, and this
-- is one of the nine it never classified. It is squarely on the FILTER
-- side of the line: a forged row here takes crew XP, crew levels and
-- treasury coins that belong to somebody else. Fixed below, with the
-- house predicate NOT COALESCE(implausible, FALSE) so a row that escaped
-- the backfill still counts.
--
--
-- FOUR DESIGN DECISIONS WORTH THE INK
--
-- 1. A GENERATIONAL CHALLENGE HAS NO DEADLINE. ends_at loses its NOT NULL
--    and NULL means "no deadline" rather than a sentinel far-future date.
--    A sentinel would render in the UI as "ends in 36,500 days", which is
--    a lie the user can see. Every reader is guarded for NULL instead.
--
-- 2. THE WINDOW FLOOR IS THE LATER OF THE CHALLENGE START AND THE
--    MEMBER'S JOIN DATE. A chase is forward-looking -- the day the leader
--    picks one is day zero, so the crew is chasing rather than cashing in
--    a history it already had. The joined_at half is what makes that hold
--    for somebody who joins mid-chase: without it, a crew stuck at 80%
--    recruits one veteran and his entire back catalogue lands on the bar.
--    Measured both ways in the pre-deploy probe -- a member who joined
--    three days ago credits three days, not the twelve he has logged.
--
-- 3. NO ONE MEMBER MAY FINISH A CREW GOAL ALONE. A generational
--    contribution is capped at 60% of the target. 60 rather than 50
--    because a crew of two must still be able to finish one, and two
--    members at 60% covers it; a solo leader cannot. The composed
--    challenges keep 246's original per-metric ceilings untouched.
--
-- 4. THE CLIENT CANNOT CREATE A TEMPLATED CHALLENGE. The INSERT policy on
--    crew_challenges is is_crew_moderator, so a rank-2 member can post a
--    row straight from the browser. If template_key were writable there,
--    a moderator would INSERT template_key='first_million' with
--    target_value=1 and mint the crew's trophy in one request. The guard
--    trigger forces template_key to NULL on every client INSERT and pins
--    it on UPDATE, so the only way to start one is the definer RPC below,
--    which is leader-only. Same reasoning as 246 and 245: a capability
--    removed cannot be misused.
--
-- Paste-safe per repo convention: schema-qualified table names, no short
-- table-alias column tokens, no record field access, and no bare angle-
-- bracket comparison operators anywhere in a statement body.


-- ── 1. The catalog ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crew_challenge_templates (
  template_key   text    PRIMARY KEY,
  title          text    NOT NULL,
  metric         text    NOT NULL
                 CHECK (metric IN ('total_volume', 'total_sessions', 'total_xp', 'days_active')),
  target_value   integer NOT NULL CHECK (target_value > 0),
  min_crew_level integer NOT NULL DEFAULT 1 CHECK (min_crew_level > 0),
  trophy_id      text    NOT NULL UNIQUE,
  trophy_title   text    NOT NULL,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT TRUE
);

ALTER TABLE public.crew_challenge_templates ENABLE ROW LEVEL SECURITY;

-- The catalog is public reference data: the UI renders the locked rungs
-- as well as the available ones, so a crew can see what it is climbing
-- toward. Nobody writes it from a client.
DROP POLICY IF EXISTS "crew challenge templates: read all" ON public.crew_challenge_templates;
CREATE POLICY "crew challenge templates: read all"
  ON public.crew_challenge_templates FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.crew_challenge_templates TO authenticated;

-- Level 1 only, deliberately. Kegan: "we will add more challenges for
-- higher levels later." The level gate is built and tested now so that
-- adding a row later is data entry rather than a code change. One
-- challenge per metric, so the four choices are genuinely different
-- things to chase rather than four sizes of the same thing.
INSERT INTO public.crew_challenge_templates
  (template_key, title, metric, target_value, min_crew_level, trophy_id, trophy_title, sort_order)
VALUES
  ('first_million',    'The First Million',    'total_volume',   1000000, 1, 'crew_first_million',    'Millionaires', 10),
  ('century_sessions', 'The Century',          'total_sessions',     100, 1, 'crew_century_sessions', 'Centurions',   20),
  ('thirty_days',      'Thirty Days Standing', 'days_active',         30, 1, 'crew_thirty_days',      'Unbroken',     30),
  ('fifty_k_xp',       'Fifty Thousand',       'total_xp',         50000, 1, 'crew_fifty_k_xp',       'Ascendant',    40)
ON CONFLICT (template_key) DO NOTHING;


-- ── 2. Crew trophies ─────────────────────────────────────────────────
--
-- Crew-owned, unlike public.user_trophies which is per user. title is
-- copied in at award time rather than joined: a trophy is a record of
-- what the crew was told they had won, and retuning the catalog later
-- must not silently rewrite a trophy somebody already holds.

CREATE TABLE IF NOT EXISTS public.crew_trophies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id    uuid        NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  trophy_id  text        NOT NULL,
  title      text        NOT NULL,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crew_id, trophy_id)
);

CREATE INDEX IF NOT EXISTS crew_trophies_crew_earned_idx
  ON public.crew_trophies (crew_id, earned_at DESC);

ALTER TABLE public.crew_trophies ENABLE ROW LEVEL SECURITY;

-- Readable by any authenticated user: a crew's trophy shelf is part of
-- its public identity, the same call already made for user_trophies and
-- for the crews table itself (migration 311). No client writes it.
DROP POLICY IF EXISTS "crew trophies: read all" ON public.crew_trophies;
CREATE POLICY "crew trophies: read all"
  ON public.crew_trophies FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.crew_trophies TO authenticated;


-- ── 3. crew_challenges gains a template, and loses its NOT NULL end ──

ALTER TABLE public.crew_challenges
  ADD COLUMN IF NOT EXISTS template_key text
    REFERENCES public.crew_challenge_templates(template_key);

ALTER TABLE public.crew_challenges
  ALTER COLUMN ends_at DROP NOT NULL;

-- One generational chase at a time, and a template may only be chased
-- once per crew -- the trophy is unique, so a second attempt could only
-- ever be a no-op or a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS crew_challenges_one_active_generational_idx
  ON public.crew_challenges (crew_id)
  WHERE template_key IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS crew_challenges_template_once_per_crew_idx
  ON public.crew_challenges (crew_id, template_key)
  WHERE template_key IS NOT NULL;


-- ── 4. Guard trigger: template_key is not a client-writable column ────

CREATE OR REPLACE FUNCTION public.crew_challenges_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.current_value := 0;
    NEW.status        := 'active';
    NEW.completed_at  := NULL;
    NEW.rewarded_at   := NULL;
    -- A client INSERT is always a free-form challenge. Starting a
    -- generational one goes through start_crew_generational_challenge,
    -- which is SECURITY DEFINER and therefore runs as postgres and
    -- returns above before reaching this line.
    NEW.template_key  := NULL;
    RETURN NEW;
  END IF;

  NEW.current_value := OLD.current_value;
  NEW.status        := OLD.status;
  NEW.target_value  := OLD.target_value;
  NEW.metric        := OLD.metric;
  NEW.crew_id       := OLD.crew_id;
  NEW.created_by    := OLD.created_by;
  NEW.starts_at     := OLD.starts_at;
  NEW.ends_at       := OLD.ends_at;
  NEW.completed_at  := OLD.completed_at;
  NEW.rewarded_at   := OLD.rewarded_at;
  NEW.template_key  := OLD.template_key;
  RETURN NEW;
END;
$guard$;


-- ── 5. What this crew may chase ──────────────────────────────────────
--
-- Returns the whole catalog with a state per row, because the locked
-- rungs are the point of a ladder: a crew that can see the next one has
-- a reason to level up. States:
--   available -- level met, not yet chased
--   active    -- currently being chased
--   earned    -- completed, trophy held
--   locked    -- crew level too low

CREATE OR REPLACE FUNCTION public.get_crew_challenge_catalog(p_crew_id uuid)
RETURNS TABLE (
  template_key   text,
  title          text,
  metric         text,
  target_value   integer,
  min_crew_level integer,
  trophy_id      text,
  trophy_title   text,
  state          text,
  current_value  integer,
  challenge_id   uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $catalog$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_level integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  -- Members only. The catalog itself is public, but which rungs a
  -- given crew has cleared is crew business.
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = p_crew_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a member of that crew' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(crew_level, 1) INTO v_level
    FROM public.crews WHERE id = p_crew_id;

  RETURN QUERY
  WITH chased AS (
    SELECT
      public.crew_challenges.template_key  AS chased_key,
      public.crew_challenges.status        AS chased_status,
      public.crew_challenges.current_value AS chased_value,
      public.crew_challenges.id            AS chased_id
    FROM public.crew_challenges
    WHERE public.crew_challenges.crew_id = p_crew_id
      AND public.crew_challenges.template_key IS NOT NULL
  )
  SELECT
    public.crew_challenge_templates.template_key,
    public.crew_challenge_templates.title,
    public.crew_challenge_templates.metric,
    public.crew_challenge_templates.target_value,
    public.crew_challenge_templates.min_crew_level,
    public.crew_challenge_templates.trophy_id,
    public.crew_challenge_templates.trophy_title,
    CASE
      WHEN chased.chased_status = 'active'    THEN 'active'
      WHEN chased.chased_status = 'completed' THEN 'earned'
      WHEN v_level = LEAST(v_level, public.crew_challenge_templates.min_crew_level)
           AND NOT (v_level = public.crew_challenge_templates.min_crew_level)
        THEN 'locked'
      ELSE 'available'
    END AS state,
    COALESCE(chased.chased_value, 0) AS current_value,
    chased.chased_id                 AS challenge_id
  FROM public.crew_challenge_templates
  LEFT JOIN chased ON chased.chased_key = public.crew_challenge_templates.template_key
  WHERE public.crew_challenge_templates.is_active
  ORDER BY public.crew_challenge_templates.sort_order,
           public.crew_challenge_templates.template_key;
END;
$catalog$;

REVOKE ALL ON FUNCTION public.get_crew_challenge_catalog(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_crew_challenge_catalog(uuid) TO authenticated;


-- ── 6. Starting one. Leader only, per 358's precedent. ───────────────

CREATE OR REPLACE FUNCTION public.start_crew_generational_challenge(
  p_crew_id      uuid,
  p_template_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $start$
DECLARE
  v_uid       uuid := auth.uid();
  v_rank      integer;
  v_level     integer;
  v_title     text;
  v_metric    text;
  v_target    integer;
  v_min_level integer;
  v_trophy    text;
  v_existing  uuid;
  v_new       uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_crew_id IS NULL OR p_template_key IS NULL THEN
    RAISE EXCEPTION 'crew_id and template_key required' USING ERRCODE = '22023';
  END IF;

  -- Committing every member of the crew to a months-long chase is a
  -- structural act, not an operational one -- the same reading that put
  -- war entry at leader-only in 358.
  v_rank := public.crew_rank(p_crew_id, v_uid);
  IF NOT (v_rank = 3) THEN
    RAISE EXCEPTION 'only a crew leader can start a crew challenge'
      USING ERRCODE = '42501';
  END IF;

  SELECT title, metric, target_value, min_crew_level, trophy_id
    INTO v_title, v_metric, v_target, v_min_level, v_trophy
    FROM public.crew_challenge_templates
   WHERE template_key = p_template_key AND is_active;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'no such challenge' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(crew_level, 1) INTO v_level
    FROM public.crews WHERE id = p_crew_id;

  IF v_level = LEAST(v_level, v_min_level) AND NOT (v_level = v_min_level) THEN
    RAISE EXCEPTION 'crew level % is below the level % this challenge needs',
      v_level, v_min_level USING ERRCODE = '42501';
  END IF;

  -- Already chased, in either sense.
  SELECT id INTO v_existing
    FROM public.crew_challenges
   WHERE crew_id = p_crew_id AND template_key = p_template_key;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'that challenge has already been started by this crew'
      USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_existing
    FROM public.crew_challenges
   WHERE crew_id = p_crew_id
     AND template_key IS NOT NULL
     AND status = 'active';

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'this crew is already chasing a challenge'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.crew_challenges
    (crew_id, created_by, title, metric, target_value, current_value,
     starts_at, ends_at, status, template_key)
  VALUES
    (p_crew_id, v_uid, v_title, v_metric, v_target, 0,
     now(), NULL, 'active', p_template_key)
  RETURNING id INTO v_new;

  PERFORM public.notify_crew_challenge_created_for(v_new);

  RETURN v_new;
END;
$start$;

REVOKE ALL ON FUNCTION public.start_crew_generational_challenge(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_crew_generational_challenge(uuid, text) TO authenticated;


-- ── 7. Progress ──────────────────────────────────────────────────────
--
-- Rewritten from 246. Four changes, marked inline:
--   (a) implausible workout_logs are excluded  -- the missed sweep
--   (b) NULL ends_at means no deadline         -- generational
--   (c) generational windows start at joined_at, not starts_at
--   (d) completing a generational one awards the crew trophy
--
-- Everything else is 246's, including the composed-challenge ceilings
-- and the one-shot rewarded_at row lock.

CREATE OR REPLACE FUNCTION public.sync_my_crew_challenge_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $sync$
DECLARE
  v_uid       uuid    := auth.uid();
  v_email     text;
  v_chal      uuid;
  v_crew      uuid;
  v_metric    text;
  v_target    integer;
  v_start     timestamptz;
  v_end       timestamptz;
  v_template  text;
  v_joined    timestamptz;
  v_floor     timestamptz;
  v_mine      numeric;
  v_cap       integer;
  v_credit    integer;
  v_sum       bigint;
  v_total     integer;
  v_member    uuid;
  v_trophy    text;
  v_trophyttl text;
  v_touched   integer := 0;
  v_completed jsonb   := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_email := public.current_user_email();

  FOR v_chal, v_crew, v_metric, v_target, v_start, v_end, v_template IN
    SELECT id, crew_id, metric, target_value, starts_at, ends_at, template_key
      FROM public.crew_challenges
     WHERE status = 'active'
       AND crew_id IN (
             SELECT crew_id FROM public.crew_members WHERE user_id = v_uid
           )
     ORDER BY starts_at
     LIMIT 40
  LOOP
    -- (b) A NULL ends_at never expires. Only a dated challenge can.
    IF v_end IS NOT NULL
       AND now() = GREATEST(now(), v_end) AND NOT (now() = v_end) THEN
      UPDATE public.crew_challenges
         SET status = 'expired'
       WHERE id = v_chal AND status = 'active';
      CONTINUE;
    END IF;

    -- (c) A generational challenge counts only what this member trained
    -- while actually in the crew. A dated one keeps 246's behaviour.
    v_floor := v_start;
    IF v_template IS NOT NULL THEN
      SELECT MIN(joined_at) INTO v_joined
        FROM public.crew_members
       WHERE crew_id = v_crew AND user_id = v_uid;
      v_floor := GREATEST(v_start, COALESCE(v_joined, v_start));
    END IF;

    IF v_end IS NULL THEN
      v_end := now();
    END IF;

    -- (a) NOT COALESCE(implausible, FALSE), never implausible = FALSE:
    -- a row that predates the backfill is NULL and must read as fine.
    IF v_metric = 'total_volume' THEN
      SELECT COALESCE(SUM(public._duel_calc_volume(exercises)), 0)
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_floor AND v_end
         AND NOT COALESCE(implausible, FALSE);

    ELSIF v_metric = 'total_sessions' THEN
      SELECT COUNT(*)
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_floor AND v_end
         AND NOT COALESCE(implausible, FALSE);

    ELSIF v_metric = 'days_active' THEN
      SELECT COUNT(DISTINCT "date")
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_floor AND v_end
         AND NOT COALESCE(implausible, FALSE);

    ELSIF v_metric = 'total_xp' THEN
      SELECT COALESCE(SUM(amount), 0)
        INTO v_mine
        FROM public.action_xp_ledger
       WHERE user_id = v_uid
         AND day BETWEEN (v_floor AT TIME ZONE 'utc')::date
                     AND (v_end   AT TIME ZONE 'utc')::date;

    ELSE
      CONTINUE;
    END IF;

    v_cap := CASE v_metric
      WHEN 'total_volume'   THEN 2000000
      WHEN 'total_sessions' THEN 500
      WHEN 'days_active'    THEN 400
      WHEN 'total_xp'       THEN 200000
      ELSE 0
    END;
    v_cap := LEAST(v_cap, v_target);

    -- No one member finishes a crew goal alone. 60% so a crew of two
    -- still can. See decision 3 in the header.
    IF v_template IS NOT NULL THEN
      v_cap := LEAST(v_cap, CEIL(v_target * 0.6)::integer);
    END IF;

    v_credit := LEAST(v_cap::numeric, GREATEST(0, FLOOR(COALESCE(v_mine, 0))))::integer;

    INSERT INTO public.crew_challenge_contributions
      (challenge_id, user_id, value, updated_at)
    VALUES
      (v_chal, v_uid, v_credit, now())
    ON CONFLICT (challenge_id, user_id)
    DO UPDATE SET value = v_credit, updated_at = now();

    PERFORM 1 FROM public.crew_challenges WHERE id = v_chal FOR UPDATE;

    SELECT COALESCE(SUM(value), 0)
      INTO v_sum
      FROM public.crew_challenge_contributions
     WHERE challenge_id = v_chal;

    v_total := LEAST(v_sum, v_target::bigint)::integer;

    UPDATE public.crew_challenges
       SET current_value = v_total
     WHERE id = v_chal;

    v_touched := v_touched + 1;

    IF v_total = v_target THEN
      UPDATE public.crew_challenges
         SET status = 'completed', completed_at = COALESCE(completed_at, now())
       WHERE id = v_chal AND status = 'active';

      UPDATE public.crew_challenges
         SET rewarded_at = now()
       WHERE id = v_chal AND rewarded_at IS NULL;

      IF FOUND THEN
        FOR v_member IN
          SELECT user_id
            FROM public.crew_challenge_contributions
           WHERE challenge_id = v_chal AND NOT (value = 0)
        LOOP
          PERFORM public.increment_user_xp(v_member, 150);
          PERFORM public.grant_flex_coins(v_member, 50);
        END LOOP;

        PERFORM public.award_crew_progress(v_crew, 300, 10, 1, 'challenge');

        -- (d) The unique trophy. Only generational challenges carry one;
        -- a leader-composed challenge has no template and pays only the
        -- economy rewards above, exactly as it did before.
        IF v_template IS NOT NULL THEN
          SELECT trophy_id, trophy_title INTO v_trophy, v_trophyttl
            FROM public.crew_challenge_templates
           WHERE template_key = v_template;

          IF v_trophy IS NOT NULL THEN
            INSERT INTO public.crew_trophies (crew_id, trophy_id, title)
            VALUES (v_crew, v_trophy, v_trophyttl)
            ON CONFLICT (crew_id, trophy_id) DO NOTHING;
          END IF;
        END IF;

        PERFORM public.notify_crew_challenge_completed_for(v_chal);
        v_completed := v_completed || to_jsonb(v_chal);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_touched, 'completed', v_completed);
END;
$sync$;

REVOKE ALL ON FUNCTION public.sync_my_crew_challenge_progress() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_my_crew_challenge_progress() TO authenticated;


-- ── 8. The crew's trophy shelf ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_crew_trophies(p_crew_id uuid)
RETURNS TABLE (
  trophy_id text,
  title     text,
  earned_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $shelf$
  SELECT
    public.crew_trophies.trophy_id,
    public.crew_trophies.title,
    public.crew_trophies.earned_at
  FROM public.crew_trophies
  WHERE public.crew_trophies.crew_id = p_crew_id
  ORDER BY public.crew_trophies.earned_at DESC;
$shelf$;

REVOKE ALL ON FUNCTION public.get_crew_trophies(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_crew_trophies(uuid) TO authenticated;


-- ── 9. Proof it ran ──────────────────────────────────────────────────

SELECT
  (SELECT count(*) FROM public.crew_challenge_templates)                       AS templates_seeded,
  (SELECT count(*) FROM public.crew_challenge_templates WHERE min_crew_level = 1) AS level_1_options,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'crew_challenges'
       AND column_name = 'template_key')                                       AS template_key_column,
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'crew_challenges'
       AND column_name = 'ends_at')                                            AS ends_at_nullable,
  (SELECT count(*) FROM pg_class WHERE relname = 'crew_trophies')              AS crew_trophies_table,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_crew_challenge_catalog',
                         'start_crew_generational_challenge',
                         'get_crew_trophies'))                                 AS new_functions;
