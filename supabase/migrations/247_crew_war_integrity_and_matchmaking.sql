-- 247_crew_war_integrity_and_matchmaking.sql
--
-- Crew Wars: close a live score-forgery hole, then make the feature
-- actually run end to end.
--
-- THE HOLE
--
-- Migration 180 spent real effort clamping contribute_crew_war_xp so a
-- crafted client could not hand it a billion XP. That clamp was moot.
-- Migration 058 had already added
--
--   "crew_wars_update"  FOR UPDATE  USING (caller is in either crew)
--
-- plus an UPDATE grant, and, like the league_members hole closed in 245,
-- the policy constrains WHICH ROW and says nothing about WHICH COLUMN.
-- So any member of either crew could simply send
--
--   UPDATE public.crew_wars SET crew_a_score = 999999, status = 'completed'
--
-- from the browser and skip the RPC entirely -- forging the score, the
-- winner, and the resolution push. crew_war_contributions carried the
-- same shape: "crew_war_contrib_own" FOR ALL on your own row let you set
-- your own xp_contributed to anything you liked.
--
-- Both capabilities are removed rather than narrowed. contribute_crew_war_xp
-- is SECURITY DEFINER and bypasses RLS, so nothing legitimate needs them.
-- Guard triggers pin the trust-bearing columns as defence in depth so a
-- future permissive policy cannot silently reopen either hole.
--
-- THE DEAD MACHINERY
--
-- Beyond the hole, Crew Wars never actually ran:
--
--   * joinWarMatchmaking inserted a row with crew_b_id NULL and status
--     'matchmaking' and left a comment saying a cron would pair it. No
--     such cron was ever written, so every crew that pressed "Enter
--     Battle" sat in a queue nobody serviced.
--   * Nothing resolved a finished war either. ends_at passed, status
--     stayed 'active' forever, winner_crew_id stayed NULL, and
--     notify_crew_war_resolved_for (migration 069) never fired.
--   * There was no uniqueness on the queue, so a double tap or two
--     leaders in two sessions could park a crew in the queue twice.
--
-- This migration replaces all of that with:
--
--   join_crew_war_queue   -- leader-gated, pairs on join (no cron needed
--                            to start a war: the second crew to arrive is
--                            matched against the longest-waiting crew
--                            under FOR UPDATE SKIP LOCKED)
--   leave_crew_war_queue  -- leader cancels a pending queue entry
--   resolve_due_crew_wars -- settles expired wars, pays the winning crew
--                            from the existing economy, fires the push,
--                            and sweeps abandoned queue entries
--
-- plus a partial unique index so a crew can hold at most one open queue
-- entry no matter how many taps or sessions race.
--
-- Paste-safe per repo convention: schema-qualified table names, no short
-- alias.column tokens, no record .id access, and no bare angle-bracket
-- comparison operators anywhere in a statement body (GREATEST / LEAST /
-- NOT (a = b) are used instead).

-- ── 1. Payout bookkeeping ────────────────────────────────────────────
ALTER TABLE public.crew_wars
  ADD COLUMN IF NOT EXISTS rewarded_at timestamptz;

-- ── 2. Remove the forgeable write capabilities ───────────────────────
DROP POLICY IF EXISTS "crew_wars_update" ON public.crew_wars;
DROP POLICY IF EXISTS "crew_wars_insert" ON public.crew_wars;
REVOKE INSERT, UPDATE, DELETE ON public.crew_wars FROM authenticated, anon;

DROP POLICY IF EXISTS "crew_war_contrib_own" ON public.crew_war_contributions;
REVOKE INSERT, UPDATE, DELETE ON public.crew_war_contributions
  FROM authenticated, anon;

-- The public read policies from 055/058 stay: war scoreboards are meant
-- to be visible to everyone, and only the write side was ever the problem.

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
    RETURN NEW;
  END IF;

  NEW.xp_contributed := OLD.xp_contributed;
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

-- ── 3. One open queue entry per crew ─────────────────────────────────
-- Collapse any duplicates left behind by the unguarded client inserts
-- before the unique index goes on, keeping the oldest entry per crew.
DELETE FROM public.crew_wars
 WHERE crew_b_id IS NULL
   AND NOT (id IN (
     SELECT DISTINCT ON (crew_a_id) id
       FROM public.crew_wars
      WHERE crew_b_id IS NULL
      ORDER BY crew_a_id, created_at
   ));

CREATE UNIQUE INDEX IF NOT EXISTS crew_wars_one_open_queue_per_crew
  ON public.crew_wars (crew_a_id)
  WHERE crew_b_id IS NULL;

CREATE INDEX IF NOT EXISTS crew_wars_due_idx
  ON public.crew_wars (status, ends_at);

-- ── 4. Enter matchmaking, pairing on arrival ─────────────────────────
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

  -- Pair against the crew that has been waiting longest. SKIP LOCKED so
  -- two crews arriving at the same instant cannot both claim the same
  -- opponent row.
  SELECT id INTO v_opponent
    FROM public.crew_wars
   WHERE crew_b_id IS NULL
     AND status = 'matchmaking'
     AND NOT (crew_a_id = p_crew_id)
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_opponent IS NOT NULL THEN
    UPDATE public.crew_wars
       SET crew_b_id    = p_crew_id,
           status       = 'active',
           starts_at    = now(),
           ends_at      = now() + INTERVAL '7 days',
           crew_a_score = 0,
           crew_b_score = 0
     WHERE id = v_opponent;

    PERFORM public.notify_crew_war_started_for(v_opponent);

    RETURN jsonb_build_object('ok', TRUE, 'status', 'matched',
                              'war_id', v_opponent);
  END IF;

  INSERT INTO public.crew_wars (crew_a_id, crew_b_id, status)
  VALUES (p_crew_id, NULL, 'matchmaking')
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', TRUE, 'status', 'queued',
                            'war_id', v_existing);
END;
$join_crew_war$;

REVOKE ALL ON FUNCTION public.join_crew_war_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_crew_war_queue(uuid) TO authenticated;

-- ── 5. Leave the queue ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_crew_war_queue(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $leave_crew_war$
DECLARE
  v_uid     uuid := auth.uid();
  v_leader  integer;
  v_removed integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_leader
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND user_id = v_uid
     AND is_admin = TRUE;

  IF v_leader = 0 THEN
    RAISE EXCEPTION 'only a crew leader can leave matchmaking'
      USING ERRCODE = '42501';
  END IF;

  -- Only an unpaired entry can be withdrawn. Once a rival is matched the
  -- war is real and cannot be rage-quit.
  WITH gone AS (
    DELETE FROM public.crew_wars
     WHERE crew_a_id = p_crew_id
       AND crew_b_id IS NULL
       AND status = 'matchmaking'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_removed FROM gone;

  RETURN jsonb_build_object('ok', TRUE, 'removed', v_removed);
END;
$leave_crew_war$;

REVOKE ALL ON FUNCTION public.leave_crew_war_queue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_crew_war_queue(uuid) TO authenticated;

-- ── 6. Settle finished wars ──────────────────────────────────────────
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
    ELSIF v_score_a = GREATEST(v_score_a, v_score_b) THEN
      v_winner := v_crew_a;
    ELSE
      v_winner := v_crew_b;
    END IF;

    UPDATE public.crew_wars
       SET status = 'completed', winner_crew_id = v_winner
     WHERE id = v_war AND status = 'active';

    -- One-shot payout under the row lock taken above.
    UPDATE public.crew_wars
       SET rewarded_at = now()
     WHERE id = v_war AND rewarded_at IS NULL;

    IF FOUND AND v_winner IS NOT NULL THEN
      FOR v_member IN
        SELECT user_id FROM public.crew_members WHERE crew_id = v_winner
      LOOP
        PERFORM public.increment_user_xp(v_member, 250);
        PERFORM public.grant_flex_coins(v_member, 100);
      END LOOP;
    END IF;

    PERFORM public.notify_crew_war_resolved_for(v_war);
    v_resolved := v_resolved + 1;
  END LOOP;

  -- Sweep queue entries nobody ever paired with, so a crew that gave up
  -- three days ago is not silently blocked from re-entering later.
  DELETE FROM public.crew_wars
   WHERE crew_b_id IS NULL
     AND status = 'matchmaking'
     AND created_at = LEAST(created_at, now() - INTERVAL '3 days');

  RETURN v_resolved;
END;
$resolve_crew_wars$;

-- Cron-only. No client ever calls this.
REVOKE ALL ON FUNCTION public.resolve_due_crew_wars() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_due_crew_wars() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.resolve_due_crew_wars() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'resolve-crew-wars';
SELECT cron.schedule('resolve-crew-wars', '*/15 * * * *',
  $$SELECT public.resolve_due_crew_wars();$$);

NOTIFY pgrst, 'reload schema';
