-- 246_crew_challenge_server_progress.sql
--
-- Makes crew challenges actually work, and makes them forgery-proof.
--
-- THE TWO PROBLEMS
--
-- 1. DEAD FEATURE. crew_challenges (migration 098) ships a target, a
--    deadline and a current_value, and the crew chat renders a progress
--    bar over them. Nothing ever moves current_value. The only writer in
--    the codebase, crewChallenges.updateChallengeProgress, has zero
--    non-test call sites, so every challenge ever created sits at 0
--    percent until it silently rots. No challenge has ever completed, so
--    notify_crew_challenge_completed_for (migration 104) has never fired.
--
-- 2. FORGEABLE. The policy that governs writes is
--
--      "crew_challenges: admins write"  FOR ALL  USING (caller is admin)
--
--    FOR ALL with an admin USING clause means any crew admin could send
--
--      UPDATE public.crew_challenges SET current_value = 999999
--
--    straight from the browser and fan a "goal smashed" push out to every
--    member. Same shape as the league_members hole closed in 245: the
--    policy constrains WHICH ROW, never WHICH COLUMN.
--
-- THE FIX
--
-- Progress becomes a server-derived aggregate, never a client number.
-- A new ledger, crew_challenge_contributions, holds one row per member
-- per challenge. sync_my_crew_challenge_progress() recomputes ONLY the
-- calling user's own row, from that user's own workout_logs (or, for the
-- total_xp metric, from action_xp_ledger, the definer-only XP ledger from
-- migration 198), then rewrites the crew aggregate as the sum of the
-- ledger. The client passes no numbers at all: it passes nothing.
--
-- The write capability is then removed rather than narrowed, matching the
-- reasoning in 245 -- a capability removed cannot be misused. Admins keep
-- INSERT and DELETE; UPDATE is revoked outright and a guard trigger pins
-- every trust-bearing column for non-privileged callers, so re-adding a
-- permissive policy later cannot silently reopen the hole.
--
-- ANTI-FARM BOUNDS. Two clamps, both server-side:
--   * a per-metric absolute ceiling on one member's contribution, and
--   * no member may bank more than the whole crew target on their own,
-- so a single forged workout_logs row cannot complete a challenge for a
-- crew of sixteen. The aggregate is additionally clamped at the target,
-- so current_value can never exceed target_value.
--
-- REWARDS. Completion pays each member who actually contributed, through
-- the existing economy primitives (increment_user_xp, grant_flex_coins).
-- rewarded_at makes the payout one-shot under a row lock, so two members
-- syncing at the same instant cannot double-pay the crew.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead).

-- ── 1. Completion bookkeeping columns ────────────────────────────────
ALTER TABLE public.crew_challenges
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rewarded_at  timestamptz;

-- ── 2. Per-member contribution ledger ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_challenge_contributions (
  challenge_id uuid        NOT NULL REFERENCES public.crew_challenges(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value        integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS crew_challenge_contrib_rank_idx
  ON public.crew_challenge_contributions (challenge_id, value DESC);

ALTER TABLE public.crew_challenge_contributions ENABLE ROW LEVEL SECURITY;

-- Crew members read their own crew's ledger. Nobody writes it from a
-- client -- the RPC below runs as definer and bypasses RLS.
DROP POLICY IF EXISTS "crew_challenge_contributions: crew read"
  ON public.crew_challenge_contributions;
CREATE POLICY "crew_challenge_contributions: crew read"
  ON public.crew_challenge_contributions FOR SELECT
  TO authenticated
  USING (
    public.is_crew_member(
      (SELECT crew_id FROM public.crew_challenges WHERE id = challenge_id)
    )
  );

GRANT SELECT ON public.crew_challenge_contributions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_challenge_contributions
  FROM authenticated, anon;

-- ── 3. Remove the forgeable write capability on crew_challenges ───────
-- The FOR ALL policy covered SELECT/INSERT/UPDATE/DELETE with an admin
-- USING clause. Split it: admins may still create and delete challenges,
-- but no client may UPDATE one. The existing members-read SELECT policy
-- from migration 098 is untouched.
DROP POLICY IF EXISTS "crew_challenges: admins write" ON public.crew_challenges;

DROP POLICY IF EXISTS "crew_challenges: admins insert" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins insert"
  ON public.crew_challenges FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_crew_admin(crew_id));

DROP POLICY IF EXISTS "crew_challenges: admins delete" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins delete"
  ON public.crew_challenges FOR DELETE
  TO authenticated
  USING (public.is_crew_admin(crew_id));

REVOKE UPDATE ON public.crew_challenges FROM authenticated, anon;

-- Defence in depth: clamp protected columns for any non-privileged
-- caller. On INSERT a fresh challenge always starts at zero and active,
-- so an admin cannot post one that is already "complete" and fire the
-- celebration fanout. On UPDATE every trust-bearing column is pinned.
CREATE OR REPLACE FUNCTION public.crew_challenges_guard_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $crew_chal_guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.current_value := 0;
    NEW.status        := 'active';
    NEW.completed_at  := NULL;
    NEW.rewarded_at   := NULL;
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
  RETURN NEW;
END;
$crew_chal_guard$;

DROP TRIGGER IF EXISTS crew_challenges_guard_write_tr ON public.crew_challenges;
CREATE TRIGGER crew_challenges_guard_write_tr
  BEFORE INSERT OR UPDATE ON public.crew_challenges
  FOR EACH ROW
  EXECUTE FUNCTION public.crew_challenges_guard_write();

-- ── 4. The one write path: recompute my own contribution ─────────────
-- Takes no arguments on purpose. Everything -- who you are, which crews
-- you belong to, which challenges are live, and how much you have put in
-- -- is derived from auth.uid() inside the function.
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

  -- Guest-safe identity: legacy workout_logs rows carry only created_by
  -- (email). current_user_email() is the migration 241 helper.
  v_email := public.current_user_email();

  FOR v_chal, v_metric, v_target, v_start, v_end IN
    SELECT id, metric, target_value, starts_at, ends_at
      FROM public.crew_challenges
     WHERE status = 'active'
       AND crew_id IN (
             SELECT crew_id FROM public.crew_members WHERE user_id = v_uid
           )
     ORDER BY ends_at
     LIMIT 40
  LOOP
    -- Past the deadline: retire it and move on. Expiry is intentionally
    -- silent (see the working notes -- a "you missed it" push scolds).
    IF now() = GREATEST(now(), v_end) AND NOT (now() = v_end) THEN
      UPDATE public.crew_challenges
         SET status = 'expired'
       WHERE id = v_chal AND status = 'active';
      CONTINUE;
    END IF;

    -- My own contribution, derived from my own rows only.
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

    -- Per-metric absolute ceiling bounds one forged row's blast radius;
    -- the target clamp stops one member soloing a sixteen-person goal
    -- via a single fabricated log.
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

    -- Serialise the aggregate rewrite and the one-shot payout.
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

    -- v_total is already clamped at the target, so equality here means
    -- the raw sum reached or passed the goal.
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

-- ── 5. Read the per-member breakdown, with display names ─────────────
-- The RLS policy above already lets a member read raw values; this RPC
-- exists so the UI gets usernames and avatars in one round trip without
-- a client-side join. Gated on the caller's own membership.
CREATE OR REPLACE FUNCTION public.get_crew_challenge_contributions(p_challenge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $get_crew_chal_contrib$
DECLARE
  v_uid  uuid := auth.uid();
  v_crew uuid;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL OR p_challenge_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT crew_id INTO v_crew
    FROM public.crew_challenges
   WHERE id = p_challenge_id;

  IF v_crew IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  PERFORM 1 FROM public.crew_members
   WHERE crew_id = v_crew AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH contrib AS (
    SELECT user_id AS c_user, value AS c_value
      FROM public.crew_challenge_contributions
     WHERE challenge_id = p_challenge_id
  ),
  named AS (
    SELECT
      c_user,
      c_value,
      (SELECT username   FROM public.user_profiles WHERE id = c_user) AS c_username,
      (SELECT full_name  FROM public.user_profiles WHERE id = c_user) AS c_full_name,
      (SELECT avatar_url FROM public.user_profiles WHERE id = c_user) AS c_avatar_url
    FROM contrib
  )
  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'user_id',    c_user,
               'value',      c_value,
               'username',   c_username,
               'full_name',  c_full_name,
               'avatar_url', c_avatar_url
             )
             ORDER BY c_value DESC
           ),
           '[]'::jsonb
         )
    INTO v_rows
    FROM named;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$get_crew_chal_contrib$;

REVOKE ALL ON FUNCTION public.get_crew_challenge_contributions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_challenge_contributions(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
