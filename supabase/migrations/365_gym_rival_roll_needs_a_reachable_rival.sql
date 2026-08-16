-- 365_gym_rival_roll_needs_a_reachable_rival.sql
--
-- gym_rival_roll throws 23502 and rolls back the whole match whenever the
-- candidate it picks is an anonymous guest.
--
-- HOW IT FAILS
--
-- The roll ends by notifying the rival:
--
--   INSERT INTO public.notifications (user_id, user_email, ...)
--   SELECT v_rival, email, ... FROM auth.users WHERE id = v_rival;
--
-- `notifications.user_email` is NOT NULL, and `auth.users.email` is NULL for
-- every account created by signInAnonymously(). So the INSERT raises
--
--   23502: null value in column "user_email" of relation "notifications"
--
-- inside the function, which aborts the whole call — the assignment row and
-- the reassignment of the caller's previous match go with it. The client
-- catches it as a generic failure and shows "Could not find a Gym Rival. Try
-- again", so it reads as an empty matchmaking pool rather than a crash, and
-- retrying picks from the same pool and fails again.
--
-- Measured on production 2026-08-16: of 14 candidates eligible under the
-- roll's own filters, **9 are anonymous guests with no email**. So roughly
-- two rolls in three failed outright. This is not new in 364 — the
-- notification block is unchanged since the feature shipped — but 364's
-- verification is what surfaced it.
--
-- THE FIX, IN TWO PARTS
--
-- 1. A rival who cannot be told and cannot accept is not a rival. The
--    candidate pool now requires an email. This is the right product rule
--    independently of the constraint: a Gym Rival match is PENDING until both
--    sides confirm, an anonymous guest never receives the notification that
--    asks them to, and sweep_stale_guest_accounts deletes them after 7 days —
--    so every such match was dead on arrival even when the INSERT happened to
--    succeed.
--
-- 2. The notification INSERT is guarded anyway. Delivery failing must never
--    destroy the match: with `AND email IS NOT NULL` the SELECT yields zero
--    rows and inserts nothing, instead of raising. Part 1 means that branch
--    should be unreachable; it exists so a future change to the pool cannot
--    quietly restore a hard failure.
--
-- Everything else about 364's matchmaking is unchanged.

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

  UPDATE public.gym_rival_assignments SET status = 'reassigned'
   WHERE status IN ('pending', 'active') AND (user_id = v_uid OR rival_id = v_uid);

  SELECT weekly_output, cadence, strength, lifter_age, lifter_level
    INTO v_out_a, v_cad_a, v_str_a, v_age_a, v_lvl_a
    FROM public.gym_rival_user_stats(v_uid, v_type);

  -- Pass 1 honours the 21-day rematch cooldown; pass 2 drops it rather than
  -- reporting "no rivals available" on a small active pool.
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_rival IS NOT NULL;

    FOR v_cand IN
      SELECT id FROM public.user_profiles
       WHERE id <> v_uid
         AND COALESCE(nemesis_opt_out, FALSE) = FALSE
         AND username IS NOT NULL
         AND last_active_at IS NOT NULL
         AND last_active_at >= now() - interval '7 days'
         -- A rival who cannot be notified cannot accept, and a Gym Rival
         -- match stays PENDING until they do. Anonymous accounts carry no
         -- email; they are also swept after 7 days.
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

      -- Strictly better wins; a near-tie takes a coin flip so that Reroll
      -- can actually produce someone else.
      IF v_best_gap IS NULL
         OR v_gap < v_best_gap - 0.02
         OR (ABS(v_gap - v_best_gap) <= 0.02 AND random() < 0.5) THEN
        v_best_gap := v_gap;
        v_rival    := v_cand;
      END IF;
    END LOOP;
  END LOOP;

  IF v_rival IS NULL THEN RETURN; END IF;

  INSERT INTO public.gym_rival_assignments
    (user_id, rival_id, status, rival_type, initiator_confirmed, rival_confirmed, match_gap)
  VALUES (v_uid, v_rival, 'pending', v_type, FALSE, FALSE, v_best_gap)
  RETURNING id INTO v_new_id;

  SELECT username INTO v_name FROM public.user_profiles WHERE id = v_uid;

  -- `AND email IS NOT NULL` is the guard: a rival we cannot address must
  -- yield no notification, never an exception that destroys the match.
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
