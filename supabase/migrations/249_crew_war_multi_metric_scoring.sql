-- 249_crew_war_multi_metric_scoring.sql
--
-- Makes a Crew War worth watching: scored on training rather than on XP,
-- derived on the server rather than sent by the client, and settled on a
-- heartbeat rather than a drip.
--
-- THREE PROBLEMS WITH WAR SCORING TODAY
--
-- 1. THE CLIENT STILL SUPPLIES THE NUMBER. contribute_crew_war_xp takes
--    p_xp from the browser. Migration 180 clamped it to 5,000 per call and
--    50,000 per war, and 247 removed the table-write path around it, so
--    this is bounded rather than open -- but it is still the last place in
--    the crew system where a number a client chose lands in a score. 246
--    already established the alternative: the server recomputes from the
--    user's own workout_logs and the client sends nothing.
--
-- 2. XP IS THE WRONG METRIC. XP rewards whoever grinds most, not the
--    fittest or most consistent crew, and the app already collects far
--    better signals -- volume, sessions, days trained -- that go entirely
--    unused competitively. A crew of six people training four times a week
--    should beat one person farming XP, and today it does not.
--
-- 3. NOTHING RECOMPUTES. Scores only move when somebody finishes a workout
--    with the app open, so a member who trains on another device, or logs
--    and closes, silently contributes nothing until their next save.
--
-- WHAT THIS DOES
--
-- Scoring becomes a blend, computed by _crew_war_score and used everywhere:
--
--     floor(volume_lb / 100) + sessions * 50 + days_active * 100
--
-- Weighted so consistency outranks any single heroic session: seven days
-- trained is worth 700 before a pound is lifted, while 20,000 lb is 200.
-- Per-member ceilings per war (200,000 lb, 28 sessions, 7 days) bound one
-- forged or mis-parsed log the way 246 bounds challenge contributions.
--
-- recompute_crew_war rebuilds an entire war from workout_logs and is the
-- only writer of the score columns. It is idempotent, so the heartbeat
-- cron, the post-workout sync and the resolver can all call it freely.
--
-- MVP is awarded on resolution to the top contributor on the winning crew,
-- which is the moment the per-member breakdown stops being a leaderboard
-- and starts being a reason to be the one carrying.
--
-- BACKWARD COMPATIBILITY. contribute_crew_war_xp keeps its signature but
-- now ignores p_xp and triggers a recompute instead. A browser still
-- running the previous bundle therefore produces a correct score rather
-- than a stale or double-counted one during the deploy window.
--
-- GUARD TRIGGERS. 247's crew_wars_guard_write and
-- crew_war_contrib_guard_write pin trust-bearing columns for anyone who is
-- not postgres or service_role. Both are re-emitted here to pin the new
-- columns too -- a guard that does not know about a column it should be
-- protecting is worse than no guard, because it reads as covered.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead).

-- ── 1. Per-metric columns and the MVP ────────────────────────────────
ALTER TABLE public.crew_war_contributions
  ADD COLUMN IF NOT EXISTS volume_lbs  bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sessions    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_active integer NOT NULL DEFAULT 0;

ALTER TABLE public.crew_wars
  ADD COLUMN IF NOT EXISTS mvp_user_id uuid,
  ADD COLUMN IF NOT EXISTS scored_at   timestamptz;

-- ── 2. Re-pin the guards, now including the new columns ──────────────
CREATE OR REPLACE FUNCTION public.crew_wars_guard_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $crew_wars_guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.crew_a_score   := 0;
    NEW.crew_b_score   := 0;
    NEW.winner_crew_id := NULL;
    NEW.rewarded_at    := NULL;
    NEW.mvp_user_id    := NULL;
    NEW.scored_at      := NULL;
    RETURN NEW;
  END IF;

  NEW.crew_a_id      := OLD.crew_a_id;
  NEW.crew_b_id      := OLD.crew_b_id;
  NEW.crew_a_score   := OLD.crew_a_score;
  NEW.crew_b_score   := OLD.crew_b_score;
  NEW.status         := OLD.status;
  NEW.starts_at      := OLD.starts_at;
  NEW.ends_at        := OLD.ends_at;
  NEW.winner_crew_id := OLD.winner_crew_id;
  NEW.rewarded_at    := OLD.rewarded_at;
  NEW.mvp_user_id    := OLD.mvp_user_id;
  NEW.scored_at      := OLD.scored_at;
  RETURN NEW;
END;
$crew_wars_guard$;

DROP TRIGGER IF EXISTS crew_wars_guard_write_tr ON public.crew_wars;
CREATE TRIGGER crew_wars_guard_write_tr
  BEFORE INSERT OR UPDATE ON public.crew_wars
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_wars_guard_write();

CREATE OR REPLACE FUNCTION public.crew_war_contrib_guard_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $crew_contrib_guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.xp_contributed := 0;
    NEW.volume_lbs     := 0;
    NEW.sessions       := 0;
    NEW.days_active    := 0;
    RETURN NEW;
  END IF;

  NEW.xp_contributed := OLD.xp_contributed;
  NEW.volume_lbs     := OLD.volume_lbs;
  NEW.sessions       := OLD.sessions;
  NEW.days_active    := OLD.days_active;
  NEW.war_id         := OLD.war_id;
  NEW.crew_id        := OLD.crew_id;
  NEW.user_id        := OLD.user_id;
  RETURN NEW;
END;
$crew_contrib_guard$;

DROP TRIGGER IF EXISTS crew_war_contrib_guard_write_tr ON public.crew_war_contributions;
CREATE TRIGGER crew_war_contrib_guard_write_tr
  BEFORE INSERT OR UPDATE ON public.crew_war_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_war_contrib_guard_write();

-- ── 3. The blend, in one place ───────────────────────────────────────
-- Mirrored in src/lib/data/crewWars.js as CREW_WAR_WEIGHTS. If the
-- weights change here they must change there, or the breakdown the UI
-- draws stops adding up to the score the server wrote.
CREATE OR REPLACE FUNCTION public._crew_war_score(
  p_volume   numeric,
  p_sessions integer,
  p_days     integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $war_score$
  SELECT (
      FLOOR(LEAST(200000, GREATEST(0, COALESCE(p_volume, 0))) / 100)
    + LEAST(28, GREATEST(0, COALESCE(p_sessions, 0))) * 50
    + LEAST(7,  GREATEST(0, COALESCE(p_days, 0)))     * 100
  )::integer;
$war_score$;

REVOKE ALL ON FUNCTION public._crew_war_score(numeric, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._crew_war_score(numeric, integer, integer)
  TO authenticated, service_role;

-- ── 4. Rebuild one war from the training logs ────────────────────────
-- The only writer of crew_a_score, crew_b_score and every contribution
-- column. Idempotent by construction: it derives absolute values and
-- overwrites, so calling it twice in a row is a no-op rather than a
-- double credit. That is what lets the cron, the post-workout sync and
-- the resolver all call it without coordinating.
CREATE OR REPLACE FUNCTION public.recompute_crew_war(p_war_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $recompute_war$
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
  v_vol_c   bigint;
  v_sess_c  integer;
  v_days_c  integer;
  v_score   integer;
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
      -- Legacy workout_logs rows carry only created_by (email), so the
      -- identity check is the same both-ways form used in 246.
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

      -- Clamp into variables before the upsert. The DO UPDATE then refers
      -- to those variables rather than EXCLUDED.<col>: the owner's paste
      -- pipeline mangles short qualified-name tokens into 42601, which is
      -- exactly why 246 was re-cut the same way.
      v_score := public._crew_war_score(v_vol, v_sess, v_days);
      v_vol_c := LEAST(200000, GREATEST(0, FLOOR(COALESCE(v_vol, 0))))::bigint;
      v_sess_c := LEAST(28, GREATEST(0, COALESCE(v_sess, 0)));
      v_days_c := LEAST(7,  GREATEST(0, COALESCE(v_days, 0)));

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

  UPDATE public.crew_wars
     SET crew_a_score = COALESCE((
           SELECT SUM(xp_contributed) FROM public.crew_war_contributions
            WHERE war_id = p_war_id AND crew_id = v_crew_a), 0),
         crew_b_score = COALESCE((
           SELECT SUM(xp_contributed) FROM public.crew_war_contributions
            WHERE war_id = p_war_id AND crew_id = v_crew_b), 0),
         scored_at    = now()
   WHERE id = p_war_id;

  RETURN v_touched;
END;
$recompute_war$;

REVOKE ALL ON FUNCTION public.recompute_crew_war(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_crew_war(uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.recompute_crew_war(uuid) TO service_role;

-- ── 5. The client's one call, taking no arguments ────────────────────
-- Same shape as 246's challenge sync, and for the same reason: there is
-- no number for a client to forge because the client sends none. Also
-- collapses what used to be getMyCrews + getActiveWarForCrew per crew +
-- contributeWarXp into a single round trip.
CREATE OR REPLACE FUNCTION public.sync_my_crew_war_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $sync_my_war$
DECLARE
  v_uid   uuid := auth.uid();
  v_war   uuid;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_war IN
    SELECT id
      FROM public.crew_wars
     WHERE status = 'active'
       AND crew_b_id IS NOT NULL
       AND (crew_a_id IN (SELECT crew_id FROM public.crew_members WHERE user_id = v_uid)
         OR crew_b_id IN (SELECT crew_id FROM public.crew_members WHERE user_id = v_uid))
     ORDER BY ends_at
     LIMIT 5
  LOOP
    PERFORM public.recompute_crew_war(v_war);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('wars', v_count);
END;
$sync_my_war$;

REVOKE ALL ON FUNCTION public.sync_my_crew_war_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_my_crew_war_progress() TO authenticated;

-- ── 6. Backward compatibility for the previous bundle ────────────────
-- Signature preserved, p_xp deliberately ignored. A browser still running
-- the old code recomputes correctly instead of adding a client number on
-- top of a server-derived score.
CREATE OR REPLACE FUNCTION public.contribute_crew_war_xp(
  p_war_id  uuid,
  p_crew_id uuid,
  p_xp      integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $contribute_compat$
DECLARE
  v_uid    uuid := auth.uid();
  v_member integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL OR p_crew_id IS NULL THEN
    RAISE EXCEPTION 'war_id and crew_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_member
    FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;
  IF v_member = 0 THEN
    RAISE EXCEPTION 'not a member of this crew' USING ERRCODE = '42501';
  END IF;

  PERFORM public.recompute_crew_war(p_war_id);

  RETURN jsonb_build_object('success', TRUE, 'war_id', p_war_id,
                            'derived', TRUE);
END;
$contribute_compat$;

REVOKE ALL ON FUNCTION public.contribute_crew_war_xp(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contribute_crew_war_xp(uuid, uuid, integer) TO authenticated;

-- ── 7. The heartbeat ─────────────────────────────────────────────────
-- Borrowed from Habitica's daily cron: settle on a schedule so the
-- scoreboard has a pulse everyone can see, rather than moving only for
-- whoever happened to have the app open. Also fixes the member who trains
-- on another device and never contributes.
CREATE OR REPLACE FUNCTION public.recompute_active_crew_wars()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $recompute_all$
DECLARE
  v_war  uuid;
  v_done integer := 0;
BEGIN
  FOR v_war IN
    SELECT id FROM public.crew_wars
     WHERE status = 'active' AND crew_b_id IS NOT NULL
     ORDER BY ends_at
     LIMIT 200
  LOOP
    PERFORM public.recompute_crew_war(v_war);
    v_done := v_done + 1;
  END LOOP;

  RETURN v_done;
END;
$recompute_all$;

REVOKE ALL ON FUNCTION public.recompute_active_crew_wars() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_active_crew_wars() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.recompute_active_crew_wars() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'recompute-crew-wars';
SELECT cron.schedule('recompute-crew-wars', '10 * * * *',
  $$SELECT public.recompute_active_crew_wars();$$);

-- ── 8. Resolution: score one last time, then crown an MVP ────────────
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
  v_mvp      uuid;
  v_member   uuid;
  v_resolved integer := 0;
BEGIN
  FOR v_war IN
    SELECT id
      FROM public.crew_wars
     WHERE status = 'active'
       AND crew_b_id IS NOT NULL
       AND now() = GREATEST(now(), ends_at)
       AND NOT (now() = ends_at)
     ORDER BY ends_at
     LIMIT 200
  LOOP
    -- Final scoring pass before anything is settled, so a workout logged
    -- in the last hour of the war still counts.
    PERFORM public.recompute_crew_war(v_war);

    PERFORM 1 FROM public.crew_wars WHERE id = v_war FOR UPDATE;

    SELECT crew_a_id, crew_b_id, crew_a_score, crew_b_score
      INTO v_crew_a, v_crew_b, v_score_a, v_score_b
      FROM public.crew_wars WHERE id = v_war;

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

    -- Top contributor on the winning side. NULL on a draw, and NULL if
    -- nobody on the winning crew actually logged anything.
    v_mvp := NULL;
    IF v_winner IS NOT NULL THEN
      SELECT user_id INTO v_mvp
        FROM public.crew_war_contributions
       WHERE war_id = v_war
         AND crew_id = v_winner
         AND NOT (xp_contributed = 0)
       ORDER BY xp_contributed DESC, updated_at
       LIMIT 1;
    END IF;

    UPDATE public.crew_wars
       SET status = 'completed', winner_crew_id = v_winner, mvp_user_id = v_mvp
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

        IF v_mvp IS NOT NULL THEN
          PERFORM public.increment_user_xp(v_mvp, 150);
          PERFORM public.grant_flex_coins(v_mvp, 50);
        END IF;

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

-- ── 9. The breakdown the war screen draws ────────────────────────────
-- Per-side metric totals plus a ranked member list, in one round trip.
-- Gated on the caller being in one of the two crews: a war scoreboard is
-- public, but who on your rival trained on which day is not.
CREATE OR REPLACE FUNCTION public.get_crew_war_breakdown(p_war_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $war_breakdown$
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
                              'totals', '[]'::jsonb, 'members', '[]'::jsonb);
  END IF;

  -- Per-side metric totals. Both sides are shown: seeing that the rival
  -- out-trained you on days rather than volume is the interesting part.
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

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'user_id',     m_user,
             'crew_id',     m_crew,
             'score',       m_score,
             'volume_lbs',  m_vol,
             'sessions',    m_sess,
             'days_active', m_days,
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
       WHERE war_id = p_war_id AND crew_id = v_mine
    ) AS mine;

  RETURN jsonb_build_object(
    'war_id',     p_war_id,
    'my_crew_id', v_mine,
    'totals',     COALESCE(v_totals, '[]'::jsonb),
    'members',    COALESCE(v_rows, '[]'::jsonb)
  );
END;
$war_breakdown$;

REVOKE ALL ON FUNCTION public.get_crew_war_breakdown(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_war_breakdown(uuid) TO authenticated;

-- ── 10. Rescore any war already running under the old rules ──────────
SELECT public.recompute_active_crew_wars();

NOTIFY pgrst, 'reload schema';
