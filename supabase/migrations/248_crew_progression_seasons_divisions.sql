-- 248_crew_progression_seasons_divisions.sql
--
-- Gives a Crew a body, a season and a division.
--
-- THE PROBLEM
--
-- A crew is currently a name, a tag, an avatar and a sixteen-seat cap.
-- Nothing about it changes when it wins. Migration 247 made Crew Wars
-- actually run end to end, but the result is still thrown away the moment
-- it resolves: winner_crew_id is written, two dozen members get 250 XP
-- each, and the crew itself is exactly what it was the week before.
--
-- There is also no global standing. A crew cannot tell whether it is the
-- best crew, a middling crew, or the only crew, so there is nothing to
-- climb and nothing to defend.
--
-- WHAT THIS ADDS
--
--   1. Crew-level state on public.crews -- crew_xp, crew_level, trophies
--      and a lifetime war record. Derived entirely server-side.
--   2. crew_seasons + crew_season_stats -- a crew-owned leaderboard. This
--      is the "leaderboard owner is a group id, not a user id" idea: crew
--      ranking uses the same shape as player ranking rather than becoming
--      a second system.
--   3. Division-banded matchmaking, replacing 247's first-in-first-out
--      pairing. A sixteen-person crew drawing a two-person crew is not a
--      war, it is a formality.
--   4. A season rollover cron that settles standings and applies
--      promotion and relegation.
--
-- THE FORGERY SURFACE, WHICH IS REAL HERE
--
-- Unlike crew_wars and crew_challenges, `authenticated` legitimately holds
-- UPDATE on public.crews -- crew leaders rename their crew and change its
-- avatar through updateCrewProfile, and two UPDATE policies allow it. So
-- every progression column added below is forgeable from the browser the
-- moment it exists:
--
--   UPDATE public.crews SET trophies = 999999 WHERE id = '<my crew>'
--
-- The capability cannot simply be revoked the way 246 and 247 revoked
-- theirs, because the legitimate rename path needs it. Instead a guard
-- trigger pins every trust-bearing column for non-privileged callers and
-- lets the five editable profile columns through. Same reasoning as 246
-- and 247: the policy constrains WHICH ROW, never WHICH COLUMN.
--
-- NOTE ON THE TRIGGER BYPASS. The guard bypasses for `postgres` and
-- `service_role` only. Every function below that writes these columns is
-- SECURITY DEFINER and therefore runs as its owner -- postgres, when this
-- file is applied in the SQL editor. If a future definer function is
-- created under a different owner, its writes get silently pinned to the
-- old values with no error raised. That failure is invisible, so check
-- pg_proc.proowner before adding one.
--
-- A PRODUCT DECISION WORTH NAMING. Losing a war costs zero trophies.
-- Ladder games normally deduct on a loss, but this is a fitness app: a
-- crew that trained all week and lost by 400 XP should not watch its
-- number go backwards. Decline is expressed through relegation, which is
-- relative and recoverable, rather than through punishing the act of
-- exercising.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead).

-- ── 1. Crew-level progression state ──────────────────────────────────
ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS crew_xp    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crew_level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trophies   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wars_won   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wars_lost  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wars_drawn integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS crews_trophies_idx ON public.crews (trophies DESC);

-- ── 2. Guard the new columns without breaking the rename path ────────
-- updateCrewProfile writes name, description, is_public, tag, avatar_url.
-- Those stay editable. Everything else is pinned for anyone who is not
-- postgres or service_role.
CREATE OR REPLACE FUNCTION public.crews_guard_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $crews_guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.crew_xp    := 0;
    NEW.crew_level := 1;
    NEW.trophies   := 0;
    NEW.wars_won   := 0;
    NEW.wars_lost  := 0;
    NEW.wars_drawn := 0;
    RETURN NEW;
  END IF;

  NEW.crew_xp      := OLD.crew_xp;
  NEW.crew_level   := OLD.crew_level;
  NEW.trophies     := OLD.trophies;
  NEW.wars_won     := OLD.wars_won;
  NEW.wars_lost    := OLD.wars_lost;
  NEW.wars_drawn   := OLD.wars_drawn;
  NEW.created_by   := OLD.created_by;
  NEW.created_at   := OLD.created_at;
  NEW.max_capacity := OLD.max_capacity;
  RETURN NEW;
END;
$crews_guard$;

DROP TRIGGER IF EXISTS crews_guard_write_tr ON public.crews;
CREATE TRIGGER crews_guard_write_tr
  BEFORE INSERT OR UPDATE ON public.crews
  FOR EACH ROW
  EXECUTE FUNCTION public.crews_guard_write();

-- ── 3. The level curve ───────────────────────────────────────────────
-- XP required to REACH level L is 100 * L * (L - 1), so level 2 costs
-- 200, level 10 costs 9,000 and level 20 costs 38,000. A war win pays
-- 400, which puts a committed crew somewhere around level 10 after a
-- season and a half. Looped rather than solved in closed form to avoid
-- float rounding landing a crew one XP short of its own level.
CREATE OR REPLACE FUNCTION public.crew_level_for_xp(p_xp integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $crew_level_curve$
DECLARE
  v_level integer := 1;
  v_xp    integer := GREATEST(0, COALESCE(p_xp, 0));
BEGIN
  WHILE v_level = LEAST(v_level, 199) AND
        v_xp = GREATEST(v_xp, 100 * (v_level + 1) * v_level)
  LOOP
    v_level := v_level + 1;
  END LOOP;
  RETURN v_level;
END;
$crew_level_curve$;

REVOKE ALL ON FUNCTION public.crew_level_for_xp(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crew_level_for_xp(integer) TO authenticated, service_role;

-- ── 4. Seasons and the crew-owned leaderboard ────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_seasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number integer     NOT NULL UNIQUE,
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  status        text        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'completed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crew_seasons_one_active
  ON public.crew_seasons (status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.crew_season_stats (
  season_id    uuid    NOT NULL REFERENCES public.crew_seasons(id) ON DELETE CASCADE,
  crew_id      uuid    NOT NULL REFERENCES public.crews(id)        ON DELETE CASCADE,
  division     integer NOT NULL DEFAULT 1,
  points       integer NOT NULL DEFAULT 0,
  wars_played  integer NOT NULL DEFAULT 0,
  wars_won     integer NOT NULL DEFAULT 0,
  challenges   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, crew_id)
);

CREATE INDEX IF NOT EXISTS crew_season_stats_rank_idx
  ON public.crew_season_stats (season_id, division, points DESC);

ALTER TABLE public.crew_seasons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_season_stats ENABLE ROW LEVEL SECURITY;

-- Standings are readable by any signed-in user. Crew names are already
-- public through crews_select_merged, and being able to scout the crew
-- above you is the point of a ladder. Nobody writes either table from a
-- client -- every writer below is SECURITY DEFINER and bypasses RLS.
DROP POLICY IF EXISTS "crew_seasons: read" ON public.crew_seasons;
CREATE POLICY "crew_seasons: read"
  ON public.crew_seasons FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "crew_season_stats: read" ON public.crew_season_stats;
CREATE POLICY "crew_season_stats: read"
  ON public.crew_season_stats FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.crew_seasons      TO authenticated;
GRANT SELECT ON public.crew_season_stats TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_seasons      FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.crew_season_stats FROM authenticated, anon;

-- ── 5. Open a season, and seat a crew in it ──────────────────────────
CREATE OR REPLACE FUNCTION public.current_crew_season()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $cur_season$
DECLARE
  v_id   uuid;
  v_next integer;
BEGIN
  SELECT id INTO v_id
    FROM public.crew_seasons
   WHERE status = 'active'
   ORDER BY season_number DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT COALESCE(MAX(season_number), 0) + 1 INTO v_next FROM public.crew_seasons;

  INSERT INTO public.crew_seasons (season_number, starts_at, ends_at, status)
  VALUES (v_next, now(), now() + INTERVAL '28 days', 'active')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.crew_seasons
     WHERE status = 'active'
     ORDER BY season_number DESC
     LIMIT 1;
  END IF;

  RETURN v_id;
END;
$cur_season$;

REVOKE ALL ON FUNCTION public.current_crew_season() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_crew_season() TO authenticated, service_role;

-- A crew joining mid-season enters at the bottom tier, not the top.
CREATE OR REPLACE FUNCTION public.ensure_crew_season_entry(p_crew_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $seat_crew$
DECLARE
  v_season uuid;
  v_div    integer;
BEGIN
  IF p_crew_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_season := public.current_crew_season();
  IF v_season IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(MAX(division), 1) INTO v_div
    FROM public.crew_season_stats
   WHERE season_id = v_season;

  INSERT INTO public.crew_season_stats (season_id, crew_id, division)
  VALUES (v_season, p_crew_id, COALESCE(v_div, 1))
  ON CONFLICT (season_id, crew_id) DO NOTHING;

  RETURN v_season;
END;
$seat_crew$;

REVOKE ALL ON FUNCTION public.ensure_crew_season_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_crew_season_entry(uuid) TO authenticated, service_role;

-- ── 6. The single crediting path ─────────────────────────────────────
-- Every progression write in the codebase goes through here. p_result is
-- 'win', 'loss', 'draw' or 'challenge'.
CREATE OR REPLACE FUNCTION public.award_crew_progress(
  p_crew_id  uuid,
  p_xp       integer,
  p_trophies integer,
  p_points   integer,
  p_result   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $award_crew$
DECLARE
  v_season uuid;
  v_xp     integer;
BEGIN
  IF p_crew_id IS NULL THEN
    RETURN;
  END IF;

  -- Bound the inputs. Every caller is server-side today, but a clamp here
  -- means a future bug upstream cannot mint an unbounded crew level.
  v_xp := LEAST(50000, GREATEST(0, COALESCE(p_xp, 0)));

  UPDATE public.crews
     SET crew_xp    = crew_xp + v_xp,
         crew_level = public.crew_level_for_xp(crew_xp + v_xp),
         trophies   = GREATEST(0, trophies + COALESCE(p_trophies, 0)),
         wars_won   = wars_won   + CASE WHEN p_result = 'win'   THEN 1 ELSE 0 END,
         wars_lost  = wars_lost  + CASE WHEN p_result = 'loss'  THEN 1 ELSE 0 END,
         wars_drawn = wars_drawn + CASE WHEN p_result = 'draw'  THEN 1 ELSE 0 END
   WHERE id = p_crew_id;

  v_season := public.ensure_crew_season_entry(p_crew_id);
  IF v_season IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.crew_season_stats
     SET points      = points + GREATEST(0, COALESCE(p_points, 0)),
         wars_played = wars_played + CASE WHEN p_result IN ('win','loss','draw') THEN 1 ELSE 0 END,
         wars_won    = wars_won    + CASE WHEN p_result = 'win' THEN 1 ELSE 0 END,
         challenges  = challenges  + CASE WHEN p_result = 'challenge' THEN 1 ELSE 0 END,
         updated_at  = now()
   WHERE season_id = v_season AND crew_id = p_crew_id;
END;
$award_crew$;

-- Server-side only. No client ever calls this.
REVOKE ALL ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) TO service_role;

-- ── 6b. Pair crews that are already waiting ──────────────────────────
-- Pairing on arrival (247, and section 8 below) only fires when somebody
-- presses the button. Two crews sitting in the queue in different
-- divisions would therefore wait for each other forever: neither arrival
-- event ever happens again, and join_crew_war_queue short-circuits on
-- 'already_queued' before it ever looks for an opponent. This is the
-- same shape as the two orphaned May queue entries found in production.
--
-- So the cron sweeps the queue as well. Patience is taken from the older
-- of the two entries, which is what lets a widening band actually close.
CREATE OR REPLACE FUNCTION public.pair_waiting_crew_wars()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $pair_waiting$
DECLARE
  v_a       uuid;
  v_a_crew  uuid;
  v_a_since timestamptz;
  v_a_div   integer;
  v_b       uuid;
  v_b_crew  uuid;
  v_season  uuid;
  v_claimed integer;
  v_paired  integer := 0;
BEGIN
  v_season := public.current_crew_season();

  FOR v_a, v_a_crew, v_a_since IN
    SELECT id, crew_a_id, created_at
      FROM public.crew_wars
     WHERE crew_b_id IS NULL AND status = 'matchmaking'
     ORDER BY created_at
     LIMIT 100
  LOOP
    -- It may have been paired by an arrival since this snapshot was taken.
    PERFORM 1 FROM public.crew_wars
      WHERE id = v_a AND crew_b_id IS NULL AND status = 'matchmaking';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(MIN(division), 1) INTO v_a_div
      FROM public.crew_season_stats
     WHERE crew_id = v_a_crew AND season_id = v_season;

    SELECT w_id, w_crew INTO v_b, v_b_crew
      FROM (
        SELECT
          id AS w_id,
          crew_a_id AS w_crew,
          ABS(COALESCE((
            SELECT MIN(division) FROM public.crew_season_stats
             WHERE crew_id = crew_a_id AND season_id = v_season
          ), v_a_div) - v_a_div) AS w_gap,
          created_at AS w_since
        FROM public.crew_wars
       WHERE crew_b_id IS NULL
         AND status = 'matchmaking'
         AND NOT (id = v_a)
         AND NOT (crew_a_id = v_a_crew)
      ) AS candidates
     WHERE w_gap = LEAST(
             w_gap,
             FLOOR(EXTRACT(EPOCH FROM (now() - v_a_since)) / 43200)
           )
     ORDER BY w_gap, w_since
     LIMIT 1;

    IF v_b IS NULL THEN
      CONTINUE;
    END IF;

    -- Fold the younger entry into the older one, then delete it.
    UPDATE public.crew_wars
       SET crew_b_id    = v_b_crew,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_a
       AND crew_b_id IS NULL
       AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      DELETE FROM public.crew_wars
       WHERE id = v_b AND crew_b_id IS NULL AND status = 'matchmaking';
      PERFORM public.notify_crew_war_started_for(v_a);
      v_paired := v_paired + 1;
    END IF;
  END LOOP;

  RETURN v_paired;
END;
$pair_waiting$;

REVOKE ALL ON FUNCTION public.pair_waiting_crew_wars() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pair_waiting_crew_wars() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.pair_waiting_crew_wars() TO service_role;

-- ── 7. War resolution now feeds the crew, not just its members ───────
-- Same structure as 247: the payout stays one-shot under rewarded_at and
-- the row lock. The addition is the award_crew_progress pair at the end.
-- Win pays 3 league points, a draw 1, a loss 0; crew XP is paid to both
-- sides because both sides trained.
CREATE OR REPLACE FUNCTION public.resolve_due_crew_wars()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $resolve_crew_wars$
DECLARE
  v_war      uuid;
  v_crew_a   uuid;
  v_crew_b   uuid;
  v_score_a  integer;
  v_score_b  integer;
  v_winner   uuid;
  v_loser    uuid;
  v_member   uuid;
  v_resolved integer := 0;
BEGIN
  FOR v_war, v_crew_a, v_crew_b, v_score_a, v_score_b IN
    SELECT id, crew_a_id, crew_b_id, crew_a_score, crew_b_score
      FROM public.crew_wars
     WHERE status = 'active'
       AND crew_b_id IS NOT NULL
       AND now() = GREATEST(now(), ends_at)
       AND NOT (now() = ends_at)
     ORDER BY ends_at
     LIMIT 200
  LOOP
    PERFORM 1 FROM public.crew_wars WHERE id = v_war FOR UPDATE;

    IF v_score_a = v_score_b THEN
      v_winner := NULL;
      v_loser  := NULL;
    ELSIF v_score_a = GREATEST(v_score_a, v_score_b) THEN
      v_winner := v_crew_a;
      v_loser  := v_crew_b;
    ELSE
      v_winner := v_crew_b;
      v_loser  := v_crew_a;
    END IF;

    UPDATE public.crew_wars
       SET status = 'completed', winner_crew_id = v_winner
     WHERE id = v_war AND status = 'active';

    -- One-shot payout under the row lock taken above.
    UPDATE public.crew_wars
       SET rewarded_at = now()
     WHERE id = v_war AND rewarded_at IS NULL;

    IF FOUND THEN
      IF v_winner IS NOT NULL THEN
        FOR v_member IN
          SELECT user_id FROM public.crew_members WHERE crew_id = v_winner
        LOOP
          PERFORM public.increment_user_xp(v_member, 250);
          PERFORM public.grant_flex_coins(v_member, 100);
        END LOOP;

        PERFORM public.award_crew_progress(v_winner, 400, 30, 3, 'win');
        PERFORM public.award_crew_progress(v_loser,  150,  0, 0, 'loss');
      ELSE
        PERFORM public.award_crew_progress(v_crew_a, 250, 12, 1, 'draw');
        PERFORM public.award_crew_progress(v_crew_b, 250, 12, 1, 'draw');
      END IF;
    END IF;

    PERFORM public.notify_crew_war_resolved_for(v_war);
    v_resolved := v_resolved + 1;
  END LOOP;

  -- Pair anyone left waiting before sweeping, so a crew that has sat in
  -- the queue long enough for its band to widen actually gets a war
  -- rather than getting deleted three days later.
  PERFORM public.pair_waiting_crew_wars();

  -- Sweep queue entries nobody ever paired with, so a crew that gave up
  -- three days ago is not silently blocked from re-entering later.
  DELETE FROM public.crew_wars
   WHERE crew_b_id IS NULL
     AND status = 'matchmaking'
     AND created_at = LEAST(created_at, now() - INTERVAL '3 days');

  RETURN v_resolved;
END;
$resolve_crew_wars$;

REVOKE ALL ON FUNCTION public.resolve_due_crew_wars() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_due_crew_wars() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_due_crew_wars() TO service_role;

-- ── 8. Division-banded matchmaking, replacing 247's FIFO pairing ─────
-- 247 took the head of the queue. This scores the queue instead: prefer
-- an opponent in the same division, then the nearest division, and widen
-- the acceptable distance the longer a crew has been waiting so a small
-- league never starves. After 48 hours anything is fair game.
CREATE OR REPLACE FUNCTION public.join_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $join_crew_war$
DECLARE
  v_uid      uuid := auth.uid();
  v_leader   integer;
  v_members  integer;
  v_existing uuid;
  v_opponent uuid;
  v_my_div   integer;
  v_claimed  integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  -- Leader-gated, on the caller's own membership row. Never on a
  -- client-supplied user id.
  SELECT COUNT(*) INTO v_leader
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND user_id = v_uid
     AND is_admin = TRUE;

  IF v_leader = 0 THEN
    RAISE EXCEPTION 'only a crew leader can enter matchmaking'
      USING ERRCODE = '42501';
  END IF;

  -- A one-person crew is a solo XP farm with a war banner on it.
  SELECT COUNT(*) INTO v_members
    FROM public.crew_members
   WHERE crew_id = p_crew_id;

  IF v_members = LEAST(v_members, 1) THEN
    RAISE EXCEPTION 'crew needs at least two members to battle'
      USING ERRCODE = '22023';
  END IF;

  -- Already queued or already fighting: idempotent, no second entry.
  SELECT id INTO v_existing
    FROM public.crew_wars
   WHERE status IN ('matchmaking', 'active')
     AND (crew_a_id = p_crew_id OR crew_b_id = p_crew_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', 'already_queued',
                              'war_id', v_existing);
  END IF;

  PERFORM public.ensure_crew_season_entry(p_crew_id);

  SELECT COALESCE(MIN(division), 1) INTO v_my_div
    FROM public.crew_season_stats
   WHERE crew_id = p_crew_id
     AND season_id = public.current_crew_season();

  -- Score the queue. Division distance dominates; waiting time relaxes
  -- it by one division per twelve hours, so a small league never starves.
  --
  -- The claim is a conditional UPDATE rather than SELECT ... FOR UPDATE:
  -- row locks cannot be applied to a WITH query, and the re-checked
  -- WHERE gives the same guarantee. Under READ COMMITTED the qual is
  -- re-evaluated after the row lock is acquired, so if another crew
  -- claimed this opponent a millisecond earlier our UPDATE touches zero
  -- rows and we simply try the next candidate.
  FOR v_opponent IN
    WITH waiting AS (
      SELECT id AS w_id, crew_a_id AS w_crew, created_at AS w_since
        FROM public.crew_wars
       WHERE crew_b_id IS NULL
         AND status = 'matchmaking'
         AND NOT (crew_a_id = p_crew_id)
    ),
    scored AS (
      SELECT
        w_id,
        ABS(COALESCE((
          SELECT MIN(division) FROM public.crew_season_stats
           WHERE crew_id = w_crew AND season_id = public.current_crew_season()
        ), v_my_div) - v_my_div) AS w_gap,
        FLOOR(EXTRACT(EPOCH FROM (now() - w_since)) / 43200) AS w_patience,
        w_since
      FROM waiting
    )
    SELECT w_id
      FROM scored
     WHERE w_gap = LEAST(w_gap, w_patience)
     ORDER BY w_gap, w_since
     LIMIT 5
  LOOP
    UPDATE public.crew_wars
       SET crew_b_id    = p_crew_id,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_opponent
       AND crew_b_id IS NULL
       AND status = 'matchmaking';

    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 1 THEN
      PERFORM public.notify_crew_war_started_for(v_opponent);
      RETURN jsonb_build_object('ok', TRUE, 'status', 'matched',
                                'war_id', v_opponent);
    END IF;
  END LOOP;

  INSERT INTO public.crew_wars (crew_a_id, crew_b_id, status)
  VALUES (p_crew_id, NULL, 'matchmaking')
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'queued',
                            'war_id', v_existing);
END;
$join_crew_war$;

REVOKE ALL ON FUNCTION public.join_crew_war_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_crew_war_queue(uuid) TO authenticated;

-- ── 9. Challenge completion feeds the crew too ───────────────────────
-- Identical to 246 apart from the single award_crew_progress call inside
-- the one-shot rewarded_at branch.
CREATE OR REPLACE FUNCTION public.sync_my_crew_challenge_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $sync_crew_chal$
DECLARE
  v_uid       uuid    := auth.uid();
  v_email     text;
  v_chal      uuid;
  v_crew      uuid;
  v_metric    text;
  v_target    integer;
  v_start     timestamptz;
  v_end       timestamptz;
  v_mine      numeric;
  v_cap       integer;
  v_credit    integer;
  v_sum       bigint;
  v_total     integer;
  v_member    uuid;
  v_touched   integer := 0;
  v_completed jsonb   := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_email := public.current_user_email();

  FOR v_chal, v_crew, v_metric, v_target, v_start, v_end IN
    SELECT id, crew_id, metric, target_value, starts_at, ends_at
      FROM public.crew_challenges
     WHERE status = 'active'
       AND crew_id IN (
             SELECT crew_id FROM public.crew_members WHERE user_id = v_uid
           )
     ORDER BY ends_at
     LIMIT 40
  LOOP
    IF now() = GREATEST(now(), v_end) AND NOT (now() = v_end) THEN
      UPDATE public.crew_challenges
         SET status = 'expired'
       WHERE id = v_chal AND status = 'active';
      CONTINUE;
    END IF;

    IF v_metric = 'total_volume' THEN
      SELECT COALESCE(SUM(public._duel_calc_volume(exercises)), 0)
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_start AND v_end;

    ELSIF v_metric = 'total_sessions' THEN
      SELECT COUNT(*)
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_start AND v_end;

    ELSIF v_metric = 'days_active' THEN
      SELECT COUNT(DISTINCT "date")
        INTO v_mine
        FROM public.workout_logs
       WHERE (user_id = v_uid OR lower(created_by) = v_email)
         AND created_at BETWEEN v_start AND v_end;

    ELSIF v_metric = 'total_xp' THEN
      SELECT COALESCE(SUM(amount), 0)
        INTO v_mine
        FROM public.action_xp_ledger
       WHERE user_id = v_uid
         AND day BETWEEN (v_start AT TIME ZONE 'utc')::date
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
        PERFORM public.notify_crew_challenge_completed_for(v_chal);
        v_completed := v_completed || to_jsonb(v_chal);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('updated', v_touched, 'completed', v_completed);
END;
$sync_crew_chal$;

REVOKE ALL ON FUNCTION public.sync_my_crew_challenge_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_my_crew_challenge_progress() TO authenticated;

-- ── 10. Standings, read by the Crew League screen ────────────────────
CREATE OR REPLACE FUNCTION public.get_crew_division_standings(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $standings$
DECLARE
  v_uid    uuid := auth.uid();
  v_season uuid;
  v_num    integer;
  v_ends   timestamptz;
  v_div    integer;
  v_rows   jsonb;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, season_number, ends_at INTO v_season, v_num, v_ends
    FROM public.crew_seasons
   WHERE status = 'active'
   ORDER BY season_number DESC
   LIMIT 1;

  IF v_season IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT MIN(division) INTO v_div
    FROM public.crew_season_stats
   WHERE season_id = v_season AND crew_id = p_crew_id;

  IF v_div IS NULL THEN
    RETURN jsonb_build_object(
      'season_number', v_num,
      'ends_at',       v_ends,
      'division',      NULL,
      'rows',          '[]'::jsonb
    );
  END IF;

  WITH standing AS (
    SELECT crew_id AS s_crew, points AS s_points, wars_played AS s_played,
           wars_won AS s_won, challenges AS s_chal
      FROM public.crew_season_stats
     WHERE season_id = v_season AND division = v_div
  ),
  named AS (
    SELECT
      s_crew, s_points, s_played, s_won, s_chal,
      (SELECT name       FROM public.crews WHERE id = s_crew) AS s_name,
      (SELECT tag        FROM public.crews WHERE id = s_crew) AS s_tag,
      (SELECT avatar_url FROM public.crews WHERE id = s_crew) AS s_avatar,
      (SELECT trophies   FROM public.crews WHERE id = s_crew) AS s_trophies,
      (SELECT crew_level FROM public.crews WHERE id = s_crew) AS s_level
    FROM standing
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'crew_id',    s_crew,
               'name',       s_name,
               'tag',        s_tag,
               'avatar_url', s_avatar,
               'points',     s_points,
               'played',     s_played,
               'won',        s_won,
               'challenges', s_chal,
               'trophies',   s_trophies,
               'level',      s_level,
               'is_mine',    s_crew = p_crew_id
             )
             ORDER BY s_points DESC, s_trophies DESC, s_name
           ),
           '[]'::jsonb
         )
    INTO v_rows
    FROM named;

  RETURN jsonb_build_object(
    'season_number', v_num,
    'ends_at',       v_ends,
    'division',      v_div,
    'rows',          COALESCE(v_rows, '[]'::jsonb)
  );
END;
$standings$;

REVOKE ALL ON FUNCTION public.get_crew_division_standings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_division_standings(uuid) TO authenticated;

-- ── 11. Season rollover ──────────────────────────────────────────────
-- Promotion and relegation only fire in divisions with at least eight
-- crews. Below that the league is too small for the movement to mean
-- anything, and shuffling three crews between tiers every four weeks
-- reads as noise rather than progress.
CREATE OR REPLACE FUNCTION public.roll_crew_seasons()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $roll_seasons$
DECLARE
  v_season  uuid;
  v_num     integer;
  v_new     uuid;
  v_crew    uuid;
  v_div     integer;
  v_rolled  integer := 0;
BEGIN
  SELECT id, season_number INTO v_season, v_num
    FROM public.crew_seasons
   WHERE status = 'active'
     AND now() = GREATEST(now(), ends_at)
     AND NOT (now() = ends_at)
   ORDER BY season_number
   LIMIT 1;

  IF v_season IS NULL THEN
    -- Nothing due. Make sure a season exists at all, then stop.
    PERFORM public.current_crew_season();
    RETURN 0;
  END IF;

  -- Single-winner close. Two overlapping cron firings can both select the
  -- due season; only the one whose UPDATE actually moves the row goes on
  -- to open the next one, so a season is never rolled twice.
  UPDATE public.crew_seasons
     SET status = 'completed'
   WHERE id = v_season AND status = 'active';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.crew_seasons (season_number, starts_at, ends_at, status)
  VALUES (v_num + 1, now(), now() + INTERVAL '28 days', 'active')
  RETURNING id INTO v_new;

  -- Carry every crew forward, adjusting the division of the top and
  -- bottom three in each sufficiently large division.
  FOR v_crew, v_div IN
    SELECT crew_id, division
      FROM public.crew_season_stats
     WHERE season_id = v_season
  LOOP
    DECLARE
      v_size   integer;
      v_rank   integer;
      v_points integer;
      v_next   integer := v_div;
    BEGIN
      SELECT COUNT(*) INTO v_size
        FROM public.crew_season_stats
       WHERE season_id = v_season AND division = v_div;

      IF v_size = GREATEST(v_size, 8) THEN
        SELECT points INTO v_points
          FROM public.crew_season_stats
         WHERE season_id = v_season AND crew_id = v_crew;

        -- Rank = how many crews finished strictly above me, plus one.
        SELECT COUNT(*) + 1 INTO v_rank
          FROM public.crew_season_stats
         WHERE season_id = v_season
           AND division  = v_div
           AND points    = GREATEST(points, COALESCE(v_points, 0) + 1);

        IF v_rank = LEAST(v_rank, 3) AND NOT (v_div = 1) THEN
          v_next := v_div - 1;
        ELSIF v_rank = GREATEST(v_rank, v_size - 2) THEN
          v_next := v_div + 1;
        END IF;
      END IF;

      INSERT INTO public.crew_season_stats (season_id, crew_id, division)
      VALUES (v_new, v_crew, GREATEST(1, v_next))
      ON CONFLICT (season_id, crew_id) DO NOTHING;
    END;

    v_rolled := v_rolled + 1;
  END LOOP;

  RETURN v_rolled;
END;
$roll_seasons$;

REVOKE ALL ON FUNCTION public.roll_crew_seasons() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roll_crew_seasons() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.roll_crew_seasons() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'roll-crew-seasons';
SELECT cron.schedule('roll-crew-seasons', '20 3 * * *',
  $$SELECT public.roll_crew_seasons();$$);

-- ── 12. Open season 1 and seat the crews that already exist ──────────
SELECT public.current_crew_season();

INSERT INTO public.crew_season_stats (season_id, crew_id, division)
SELECT public.current_crew_season(), id, 1
  FROM public.crews
ON CONFLICT (season_id, crew_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
