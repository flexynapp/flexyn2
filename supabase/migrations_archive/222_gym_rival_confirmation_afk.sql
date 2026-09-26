-- 222_gym_rival_confirmation_afk.sql
--
-- Adds the weekly Gym Rival lifecycle: mutual opt-in confirmation,
-- inactivity gating on matching, and a 48h AFK void.
--
--   Single-row match model on public.gym_rival_assignments:
--     user_id  = the initiator (who rolled), rival_id = the matched rival.
--     NEW: initiator_confirmed, rival_confirmed (BOOL), accepted_at (TS).
--     status  gains 'pending' (awaiting both confirms) and 'void' (AFK).
--     Lifecycle: pending → active (both confirmed, accepted_at set) →
--     void (either side logs no workout within 48h of acceptance).
--
--   Matching runs server-side (gym_rival_roll) so it can (a) insert the
--   pending row, (b) exclude users inactive >7 days or already matched,
--   and (c) notify the rival cross-user — none of which the client can do
--   under RLS. All SQL paste-safe (scalar SELECT INTO, public.<t>, no
--   alias.column).

-- ── 1. Enum values (added first; not used elsewhere in this script) ───────
ALTER TYPE public.gym_rival_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.gym_rival_status ADD VALUE IF NOT EXISTS 'void';

-- ── 2. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.gym_rival_assignments
  ADD COLUMN IF NOT EXISTS initiator_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rival_confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS accepted_at         TIMESTAMPTZ;

-- ── 3. Let the rival READ the match row (owner policy only covers user_id) ─
DROP POLICY IF EXISTS "gym_rival_rival_read" ON public.gym_rival_assignments;
CREATE POLICY "gym_rival_rival_read"
  ON public.gym_rival_assignments
  FOR SELECT
  USING (rival_id = auth.uid());

-- ── 4. Roll a new pending match (server-side matching) ────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_roll()
RETURNS SETOF public.gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_roll$
DECLARE
  v_uid    UUID := auth.uid();
  v_my_xp  BIGINT;
  v_rival  UUID;
  v_new_id UUID;
  v_name   TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Reroll: retire any in-progress match this user is part of (either side).
  UPDATE public.gym_rival_assignments
     SET status = 'reassigned'
   WHERE status IN ('pending', 'active')
     AND (user_id = v_uid OR rival_id = v_uid);

  SELECT total_xp INTO v_my_xp FROM public.user_profiles WHERE id = v_uid;

  -- Candidate: not me, not opted out, ACTIVE in the last 7 days, has a
  -- username, and not already tied up in a pending/active match. Closest
  -- XP first, random tiebreak.
  SELECT id INTO v_rival
    FROM public.user_profiles
   WHERE id <> v_uid
     AND COALESCE(nemesis_opt_out, FALSE) = FALSE
     AND username IS NOT NULL
     AND last_active_at IS NOT NULL
     AND last_active_at >= now() - interval '7 days'
     AND id NOT IN (
       SELECT user_id  FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
       UNION
       SELECT rival_id FROM public.gym_rival_assignments WHERE status IN ('pending', 'active')
     )
   ORDER BY abs(COALESCE(total_xp, 0) - COALESCE(v_my_xp, 0)) ASC, random()
   LIMIT 1;

  IF v_rival IS NULL THEN
    RETURN;  -- no eligible rival right now
  END IF;

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, initiator_confirmed, rival_confirmed)
  VALUES (v_uid, v_rival, 'pending', FALSE, FALSE)
  RETURNING id INTO v_new_id;

  -- Cross-user nudge so the rival knows to confirm. Reuses the mapped
  -- 'nemesis_assigned' type (→ competitive) to avoid a mapper change.
  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;
  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT
    v_rival, email, 'nemesis_assigned',
    '🎯 @' || COALESCE(v_name, 'someone') || ' wants to be your Gym Rival',
    'Confirm to start this week''s challenge — first one to go AFK forfeits.',
    '🎯', '/workout',
    jsonb_build_object('assignment_id', v_new_id, 'initiator_id', v_uid)
  FROM auth.users WHERE id = v_rival;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = v_new_id;
END;
$gym_rival_roll$;

REVOKE ALL    ON FUNCTION public.gym_rival_roll() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_roll() TO authenticated;

-- ── 5. Confirm participation (caller confirms their own side) ─────────────
CREATE OR REPLACE FUNCTION public.gym_rival_confirm(p_assignment_id UUID)
RETURNS SETOF public.gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_confirm$
DECLARE
  v_uid     UUID := auth.uid();
  v_owner   UUID;
  v_rival   UUID;
  v_status  TEXT;
  v_init_ok BOOLEAN;
  v_riv_ok  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, initiator_confirmed, rival_confirmed
    INTO v_owner, v_rival, v_status, v_init_ok, v_riv_ok
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id
   FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'match_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'pending' THEN
    RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
    RETURN;
  END IF;

  IF v_uid = v_owner THEN
    UPDATE public.gym_rival_assignments SET initiator_confirmed = TRUE WHERE id = p_assignment_id;
    v_init_ok := TRUE;
  ELSIF v_uid = v_rival THEN
    UPDATE public.gym_rival_assignments SET rival_confirmed = TRUE WHERE id = p_assignment_id;
    v_riv_ok := TRUE;
  ELSE
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  -- Both in → the week is live.
  IF v_init_ok AND v_riv_ok THEN
    UPDATE public.gym_rival_assignments
       SET status = 'active', accepted_at = now()
     WHERE id = p_assignment_id;
  END IF;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$gym_rival_confirm$;

REVOKE ALL    ON FUNCTION public.gym_rival_confirm(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_confirm(UUID) TO authenticated;

-- ── 6. Void a stale (AFK) match — lazy, callable by either party ──────────
CREATE OR REPLACE FUNCTION public.gym_rival_void_stale(p_assignment_id UUID)
RETURNS SETOF public.gym_rival_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_void_stale$
DECLARE
  v_uid      UUID := auth.uid();
  v_owner    UUID;
  v_rival    UUID;
  v_status   TEXT;
  v_accepted TIMESTAMPTZ;
  v_a_logged BOOLEAN;
  v_b_logged BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT user_id, rival_id, status, accepted_at
    INTO v_owner, v_rival, v_status, v_accepted
    FROM public.gym_rival_assignments
   WHERE id = p_assignment_id;

  IF v_owner IS NULL OR (v_uid <> v_owner AND v_uid <> v_rival) THEN
    RAISE EXCEPTION 'not_part_of_match' USING ERRCODE = '42501';
  END IF;

  -- Only active, accepted matches past the 48h grace window can void.
  IF v_status <> 'active' OR v_accepted IS NULL OR now() < v_accepted + interval '48 hours' THEN
    RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.workout_logs WHERE user_id = v_owner AND created_at >= v_accepted
  ) INTO v_a_logged;
  SELECT EXISTS (
    SELECT 1 FROM public.workout_logs WHERE user_id = v_rival AND created_at >= v_accepted
  ) INTO v_b_logged;

  IF NOT v_a_logged OR NOT v_b_logged THEN
    UPDATE public.gym_rival_assignments SET status = 'void' WHERE id = p_assignment_id;
  END IF;

  RETURN QUERY SELECT * FROM public.gym_rival_assignments WHERE id = p_assignment_id;
END;
$gym_rival_void_stale$;

REVOKE ALL    ON FUNCTION public.gym_rival_void_stale(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gym_rival_void_stale(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
