-- 369_postdeploy_fixes.sql
--
-- Four defects found by an adversarial post-deploy verification of 363–368,
-- each reproduced against production inside a rolled-back transaction. Two
-- are regressions introduced by 363 and 364; two are holes in 366 and 368.
--
-- ============================================================================
-- 1. gym_rival_week_state counted every session AFTER the match week (363)
-- ============================================================================
--
-- The window was computed correctly and then only half applied: every
-- aggregate was bounded on the LEFT (`created_at >= v_since`) and nothing
-- bounded it on the right, while `week_ends` was returned to the client and
-- rendered under the label "Total volume this week".
--
-- Measured on live assignment 24675d94, called as the owner:
--   week_since 2026-06-08, week_ends 2026-06-15, you_distance 3941.54
--   true in-week total: 0. All 3941.54 comes from rows dated 2026-08-07 and
--   2026-08-09 — eight weeks past the end of the week being displayed.
--
-- This did not surface earlier because `gym_rival_settle_week` normally
-- completes a match the moment `week_ends` passes, which keeps the window
-- current. It cannot here: the settler requires `accepted_at IS NOT NULL` and
-- all three live rows have NULL, so they sit on a frozen June window whose
-- totals keep growing forever. The left-only bound is fine while a window is
-- current and wrong the instant one is not — so bound it explicitly rather
-- than relying on a different function to keep it fresh.
--
-- `you_logged` / `them_logged` stay anchored to `accepted_at` on purpose:
-- that pair answers "has this person trained since we accepted", which is the
-- 48h AFK rule, not the scoring window.
--
-- ============================================================================
-- 2. gym_rival_roll destroyed the caller's match before finding a new one (364)
-- ============================================================================
--
-- The `SET status='reassigned'` UPDATE was the FIRST statement; the
-- `IF v_rival IS NULL THEN RETURN` bail came after both search passes. So an
-- empty candidate pool cost the caller the match they already had, returned
-- no row, and the client rendered "No available rivals right now — check back
-- soon" over a match it had just destroyed.
--
-- Reproduced with no synthetic state beyond the passage of time: ageing the
-- three unmatched candidates past the function's own 7-day activity window —
-- which production reaches on its own by 2026-08-20 — took the pool 3 → 0 and
-- flipped the caller's live row `active → reassigned` with 0 rows returned.
--
-- The WHERE also matches `rival_id = v_uid`, so it silently cancelled a
-- pending challenge SOMEBODY ELSE had sent, with no notification to them.
--
-- Fix: search first, mutate second. The reassign now runs only once a
-- replacement is known, so a failed roll is a no-op.
--
-- ============================================================================
-- 3. notifications_fill_user_email could still raise 23502 (366)
-- ============================================================================
--
-- 366 fills `user_email` from `user_profiles` when an insert omits it. But
-- `user_profiles.email` is nullable, `authenticated` holds column-level UPDATE
-- on it, the own-row policy permits it, and
-- `user_profiles_block_privileged_updates()` guards ~23 economy columns and
-- NOT `email`.
--
-- Executed as a real authenticated user with only the anon key:
--   UPDATE user_profiles SET email = NULL WHERE id = <self>   -- succeeded
--   then any notification INSERT targeting that user  -> 23502
--
-- which aborts the entire calling RPC. That is precisely the failure class
-- 366 exists to close, reachable by the recipient rather than by a guest.
-- The fill now falls through user_profiles → auth.users → a synthesised
-- placeholder, so it cannot return NULL and the column's NOT NULL can never
-- again take down an unrelated transaction.
--
-- The placeholder is deliberately `@flexyn.invalid` (RFC 2606 reserved) so it
-- can never be mistaken for a deliverable address by anything downstream.
--
-- NOT fixed here, and worth a separate decision: that a user can null their
-- own `user_profiles.email` at all. Revoking the column UPDATE is a broader
-- change than a hotfix should make blind.
--
-- ============================================================================
-- 4. A crew with no rank>=2 member is a permanent dead letter (368)
-- ============================================================================
--
-- 368 gates all three application functions on `crew_rank() >= 2`. Crew
-- "Butt Crackers" is private with exactly one member at rank 1 — even though
-- `crews.created_by` is that same user — so:
--   join_crew_atomic       -> 'requested', row filed
--   notifications          -> 0   (nobody is rank >= 2)
--   list_crew_join_requests-> []
--   decide_crew_join_request -> 42501
-- and the sole member cannot rescue himself: a direct role UPDATE matches 0
-- rows under RLS and `transfer_crew_leadership` raises 42501.
--
-- Two-part fix. `crew_can_review()` treats a member as a reviewer when the
-- crew has NO rank>=2 member at all — self-healing, and it collapses back to
-- the strict rank gate the moment anyone is promoted. Plus a one-shot
-- backfill promoting the oldest member of any reviewer-less crew to leader,
-- which is what the roster should have said all along.

-- == 1. Bound the match week on both sides =================================

CREATE OR REPLACE FUNCTION public.gym_rival_week_state(p_assignment_id UUID)
RETURNS TABLE (
  week_since    TIMESTAMPTZ,
  week_ends     TIMESTAMPTZ,
  you_volume    NUMERIC,
  them_volume   NUMERIC,
  you_distance  NUMERIC,
  them_distance NUMERIC,
  you_logged    BOOLEAN,
  them_logged   BOOLEAN,
  afk_deadline  TIMESTAMPTZ,
  is_stalled    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_owner    UUID;
  v_rival    UUID;
  v_status   TEXT;
  v_type     TEXT;
  v_accepted TIMESTAMPTZ;
  v_assigned TIMESTAMPTZ;
  v_you      UUID;
  v_them     UUID;
  v_since    TIMESTAMPTZ;
  v_ends     TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_yv       NUMERIC := 0;
  v_tv       NUMERIC := 0;
  v_yd       NUMERIC := 0;
  v_td       NUMERIC := 0;
  v_yl       BOOLEAN := FALSE;
  v_tl       BOOLEAN := FALSE;
  v_stalled  BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, rival_type, accepted_at, assigned_at
    INTO v_owner, v_rival, v_status, v_type, v_accepted, v_assigned
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  IF v_uid = v_owner THEN
    v_you := v_owner; v_them := v_rival;
  ELSE
    v_you := v_rival; v_them := v_owner;
  END IF;

  v_stalled := (v_status = 'active' AND v_accepted IS NULL);

  v_since    := date_trunc('week', COALESCE(v_accepted, v_assigned, now()));
  v_ends     := v_since + interval '7 days';
  v_deadline := v_accepted + interval '48 hours';

  -- Both edges. Without the right edge a frozen window keeps accumulating
  -- sessions logged months later and reports them as "this week".
  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
    INTO v_yv
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = v_you
     AND created_at >= v_since
     AND created_at <  v_ends
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (s->>'reps')   ~ '^[0-9]+$';

  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
    INTO v_tv
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = v_them
     AND created_at >= v_since
     AND created_at <  v_ends
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (s->>'reps')   ~ '^[0-9]+$';

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_yd
    FROM public.cardio_logs
   WHERE user_id = v_you
     AND date >= v_since::date
     AND date <  v_ends::date;

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_td
    FROM public.cardio_logs
   WHERE user_id = v_them
     AND date >= v_since::date
     AND date <  v_ends::date;

  -- Deliberately NOT windowed: this pair answers the 48h AFK rule, which is
  -- anchored on acceptance, not on the scoring week.
  IF v_accepted IS NOT NULL THEN
    IF v_type = 'cardio' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs
         WHERE user_id = v_you AND date >= v_accepted::date
      ) INTO v_yl;
      SELECT EXISTS (
        SELECT 1 FROM public.cardio_logs
         WHERE user_id = v_them AND date >= v_accepted::date
      ) INTO v_tl;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs
         WHERE user_id = v_you AND created_at >= v_accepted
      ) INTO v_yl;
      SELECT EXISTS (
        SELECT 1 FROM public.workout_logs
         WHERE user_id = v_them AND created_at >= v_accepted
      ) INTO v_tl;
    END IF;
  END IF;

  RETURN QUERY SELECT v_since, v_ends, v_yv, v_tv, v_yd, v_td,
                      v_yl, v_tl, v_deadline, v_stalled;
END;
$$;

-- == 2. Search before destroying the existing match =========================

CREATE OR REPLACE FUNCTION public.gym_rival_roll(p_type TEXT DEFAULT 'gym')
RETURNS SETOF gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_type  TEXT := CASE WHEN p_type = 'cardio' THEN 'cardio' ELSE 'gym' END;
  v_label TEXT := CASE WHEN p_type = 'cardio' THEN 'Cardio Rival' ELSE 'Gym Rival' END;
  v_out_a NUMERIC; v_cad_a NUMERIC; v_str_a NUMERIC; v_age_a NUMERIC; v_lvl_a INTEGER;
  v_out_b NUMERIC; v_cad_b NUMERIC; v_str_b NUMERIC; v_age_b NUMERIC; v_lvl_b INTEGER;
  v_pass     INTEGER;
  v_cand     UUID;
  v_gap      NUMERIC;
  v_best_gap NUMERIC;
  v_rival    UUID;
  v_new_id   UUID;
  v_name     TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;

  SELECT weekly_output, cadence, strength, lifter_age, lifter_level
    INTO v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a
    FROM public.gym_rival_user_stats(v_uid, v_type);

  -- The candidate search runs BEFORE anything is mutated. It excludes people
  -- already in a pending/active match, which necessarily includes the
  -- caller's own current rival — correct, because a reroll must return
  -- somebody NEW, and if nobody is available the caller keeps what they had.
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;

    FOR v_cand IN
      SELECT id FROM public.user_profiles
       WHERE id <> v_uid
         AND COALESCE(nemesis_opt_out, FALSE) = FALSE
         AND username IS NOT NULL
         AND last_active_at IS NOT NULL
         AND last_active_at >= now() - interval '7 days'
         AND id NOT IN (SELECT id FROM auth.users WHERE email IS NULL)
         AND id NOT IN (
           SELECT user_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
           UNION
           SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active'))
         AND (v_pass = 2 OR id NOT IN (
           SELECT rival_id FROM public.gym_rival_assignments
            WHERE user_id = v_uid AND assigned_at >= now() - interval '21 days'
           UNION
           SELECT user_id FROM public.gym_rival_assignments
            WHERE rival_id = v_uid AND assigned_at >= now() - interval '21 days'))
       LIMIT 200
    LOOP
      SELECT weekly_output, cadence, strength, lifter_age, lifter_level
        INTO v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b
        FROM public.gym_rival_user_stats(v_cand, v_type);

      v_gap := public.gym_rival_match_gap(
        v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a,
        v_out_b, v_cad_b, v_str_b, v_age_b, v_lvl_b);

      IF v_best_gap IS NULL
         OR v_gap < v_best_gap - 0.02
         OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5) THEN
        v_best_gap := v_gap;
        v_rival    := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  -- Nothing has been mutated yet, so a failed roll is a true no-op and the
  -- caller keeps the match they already had.
  IF v_rival IS NULL THEN RETURN; END IF;

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending', 'active') AND (user_id = v_uid OR rival_id = v_uid);

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE, v_best_gap)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your ' || v_label,
    'Confirm to start this week''s challenge — first one to go AFK forfeits.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid, 'rival_type', v_type)
  FROM auth.users WHERE id = v_rival AND email IS NOT NULL;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$$;

-- == 3. The fill can never return NULL ======================================

CREATE OR REPLACE FUNCTION public.notifications_fill_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.user_email IS NULL THEN
    SELECT email INTO NEW.user_email
      FROM public.user_profiles
     WHERE id = NEW.user_id;
  END IF;

  -- user_profiles.email is nullable AND client-writable, so the profile is
  -- not a guaranteed source. Fall through rather than let a NOT NULL column
  -- abort an unrelated transaction.
  IF NEW.user_email IS NULL THEN
    SELECT email INTO NEW.user_email
      FROM auth.users
     WHERE id = NEW.user_id;
  END IF;

  -- .invalid is RFC 2606 reserved, so nothing downstream can mistake this
  -- for a deliverable address.
  IF NEW.user_email IS NULL THEN
    NEW.user_email := 'user_' || COALESCE(NEW.user_id::text, 'unknown') || '@flexyn.invalid';
  END IF;

  RETURN NEW;
END;
$$;

-- == 4. A crew always has someone who can review ============================

CREATE OR REPLACE FUNCTION public.crew_can_review(p_crew_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rank      INTEGER;
  v_reviewers INTEGER;
  v_member    INTEGER;
BEGIN
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  v_rank := public.crew_rank(p_crew_id, p_user_id);
  IF v_rank IS NOT NULL AND v_rank >= 2 THEN
    RETURN TRUE;
  END IF;

  -- Fallback: a crew with NO rank>=2 member at all would otherwise queue
  -- applications nobody can ever see or decide. Any member may review there,
  -- and this collapses back to the strict gate the moment someone is promoted.
  SELECT COUNT(*) INTO v_reviewers
    FROM public.crew_members
   WHERE crew_id = p_crew_id
     AND public.crew_rank(crew_id, user_id) >= 2;

  IF NOT (v_reviewers = 0) THEN
    RETURN FALSE;
  END IF;

  SELECT COUNT(*) INTO v_member
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  RETURN NOT (v_member = 0);
END;
$$;

REVOKE ALL ON FUNCTION public.crew_can_review(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crew_can_review(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.crew_can_review(UUID, UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.notify_crew_join_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_name FROM public.crews WHERE id = NEW.crew_id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT user_id,
         (SELECT email FROM public.user_profiles WHERE id = user_id),
         'crew_join_request',
         'Someone wants to join ' || COALESCE(v_name, 'your crew'),
         'Review the request from the crew roster.',
         '📋', '/hub',
         jsonb_build_object('crew_id', NEW.crew_id, 'applicant_id', NEW.user_id)
    FROM public.crew_members
   WHERE crew_id = NEW.crew_id
     AND public.crew_can_review(crew_id, user_id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_crew_join_requests(p_crew_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_out      JSONB;
  v_id       UUID;
  v_msg      TEXT;
  v_at       TIMESTAMPTZ;
  v_username TEXT;
  v_full     TEXT;
  v_avatar   TEXT;
  v_level    INTEGER;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT public.crew_can_review(p_crew_id, v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;

  v_out := '[]'::jsonb;

  FOR v_id, v_msg, v_at IN
    SELECT user_id, message, created_at
      FROM public.crew_join_requests
     WHERE crew_id = p_crew_id AND status = 'pending'
     ORDER BY created_at ASC
  LOOP
    SELECT username, full_name, avatar_url, current_level
      INTO v_username, v_full, v_avatar, v_level
      FROM public.user_profiles
     WHERE id = v_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id',       v_id,
      'username',      v_username,
      'full_name',     v_full,
      'avatar_url',    v_avatar,
      'current_level', v_level,
      'message',       v_msg,
      'created_at',    v_at));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.list_crew_join_requests(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_crew_join_requests(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_crew_join_request(p_crew_id UUID, p_user_id UUID, p_approve BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_cap       INTEGER;
  v_count     INTEGER;
  v_elsewhere INTEGER;
  v_state     TEXT;
  v_name      TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'crew_id and user_id required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.crew_can_review(p_crew_id, v_uid) THEN
    RAISE EXCEPTION 'only a crew moderator or leader can decide join requests'
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_state
    FROM public.crew_join_requests
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_state = 'pending') THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', v_state, 'changed', FALSE);
  END IF;

  SELECT name INTO v_name FROM public.crews WHERE id = p_crew_id;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.crew_join_requests
       SET status = 'rejected', decided_by = v_uid, decided_at = now()
     WHERE crew_id = p_crew_id AND user_id = p_user_id;

    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (p_user_id,
            (SELECT email FROM public.user_profiles WHERE id = p_user_id),
            'crew_join_request',
            'Your request to join ' || COALESCE(v_name, 'a crew') || ' was declined',
            'You can apply again, or find another crew.', '📋', '/hub',
            jsonb_build_object('crew_id', p_crew_id, 'decision', 'rejected'));

    RETURN jsonb_build_object('ok', TRUE, 'status', 'rejected', 'changed', TRUE);
  END IF;

  SELECT COUNT(*) INTO v_elsewhere
    FROM public.crew_members
   WHERE user_id = p_user_id AND NOT (crew_id = p_crew_id);

  IF NOT (v_elsewhere = 0) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_in_crew');
  END IF;

  SELECT COALESCE(max_capacity, 16) INTO v_cap
    FROM public.crews WHERE id = p_crew_id FOR UPDATE;

  SELECT COUNT(*) INTO v_count
    FROM public.crew_members WHERE crew_id = p_crew_id;

  IF v_count = GREATEST(v_count, v_cap) THEN
    RAISE EXCEPTION 'crew_full' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES (p_crew_id, p_user_id, FALSE, 'member')
  ON CONFLICT DO NOTHING;

  UPDATE public.crew_join_requests
     SET status = 'approved', decided_by = v_uid, decided_at = now()
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id,
          (SELECT email FROM public.user_profiles WHERE id = p_user_id),
          'crew_join_request',
          'You''re in — welcome to ' || COALESCE(v_name, 'the crew'),
          'Your request was accepted. Open the crew to meet the roster.',
          '🎉', '/hub',
          jsonb_build_object('crew_id', p_crew_id, 'decision', 'approved'));

  RETURN jsonb_build_object('ok', TRUE, 'status', 'approved', 'changed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_crew_join_request(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_crew_join_request(UUID, UUID, BOOLEAN) TO authenticated;

-- One-shot: a crew whose roster has no rank>=2 member gets its oldest member
-- promoted to leader. This is what the roster should already have said — the
-- affected crew's sole member is also its `created_by`.
UPDATE public.crew_members
   SET role = 'leader', is_admin = TRUE
 WHERE ctid IN (
   SELECT MIN(ctid)
     FROM public.crew_members
    WHERE crew_id IN (
      SELECT crew_id FROM public.crew_members
       GROUP BY crew_id
      HAVING COUNT(*) FILTER (WHERE public.crew_rank(crew_id, user_id) >= 2) = 0)
    GROUP BY crew_id);
