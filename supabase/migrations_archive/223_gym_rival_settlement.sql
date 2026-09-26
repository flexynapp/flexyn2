-- 223_gym_rival_settlement.sql
--
-- Phase 3b — authoritative weekly settlement + reward granting for Gym
-- Rival, plus a batch AFK-void safety net.
--
--   • gym_rival_net_rating(uid, since) — server-side score (volume/100 +
--     workouts*100 + km*20), mirrors the client formula.
--   • gym_rival_void_stale_all() — voids every active match past its 48h
--     grace window where either side logged no workout (cron backstop for
--     the lazy per-open check).
--   • gym_rival_settle_week() — for each active match whose ISO week has
--     ended: compute both net ratings, pick the winner, grant the scaled
--     prize (base 5000 XP / 500 coins / 5 capsules, +15% per level the
--     LOSER is above the winner), notify both, mark 'completed'.
--   • pg_cron: settle Monday 00:05, AFK-void every 6h.
--
-- Paste-safe: scalar SELECT ... INTO, id-only FOR loops (no record-field
-- dot access), public.<table>, jsonb via -> / ->> (not alias.column).

-- ── Status + result columns ───────────────────────────────────────────────
ALTER TYPE public.gym_rival_status ADD VALUE IF NOT EXISTS 'completed';

ALTER TABLE public.gym_rival_assignments
  ADD COLUMN IF NOT EXISTS winner_id  UUID,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- ── Net rating ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_net_rating(p_uid UUID, p_since TIMESTAMPTZ)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_net_rating$
DECLARE
  v_volume   NUMERIC := 0;
  v_sessions INT     := 0;
  v_distance NUMERIC := 0;
BEGIN
  SELECT COUNT(*) INTO v_sessions
    FROM public.workout_logs
   WHERE user_id = p_uid AND created_at >= p_since;

  SELECT COALESCE(SUM((s->>'weight')::numeric * (s->>'reps')::numeric), 0)
    INTO v_volume
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = p_uid
     AND created_at >= p_since
     AND (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$'
     AND (s->>'reps')   ~ '^[0-9]+$';

  SELECT COALESCE(SUM(distance_meters), 0) INTO v_distance
    FROM public.cardio_logs
   WHERE user_id = p_uid AND date >= p_since::date;

  RETURN round(v_volume / 100 + v_sessions * 100 + (v_distance / 1000) * 20);
END;
$gym_rival_net_rating$;

REVOKE ALL ON FUNCTION public.gym_rival_net_rating(UUID, TIMESTAMPTZ) FROM PUBLIC;

-- ── Batch AFK void (cron backstop) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_void_stale_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_void_stale_all$
DECLARE
  v_id       UUID;
  v_owner    UUID;
  v_rival    UUID;
  v_accepted TIMESTAMPTZ;
  v_a        BOOLEAN;
  v_b        BOOLEAN;
  v_count    INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active'
       AND accepted_at IS NOT NULL
       AND now() >= accepted_at + interval '48 hours'
  LOOP
    SELECT user_id, rival_id, accepted_at
      INTO v_owner, v_rival, v_accepted
      FROM public.gym_rival_assignments WHERE id = v_id;

    SELECT EXISTS (SELECT 1 FROM public.workout_logs WHERE user_id = v_owner AND created_at >= v_accepted) INTO v_a;
    SELECT EXISTS (SELECT 1 FROM public.workout_logs WHERE user_id = v_rival AND created_at >= v_accepted) INTO v_b;

    IF NOT v_a OR NOT v_b THEN
      UPDATE public.gym_rival_assignments SET status = 'void' WHERE id = v_id;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$gym_rival_void_stale_all$;

REVOKE ALL ON FUNCTION public.gym_rival_void_stale_all() FROM PUBLIC;

-- ── Weekly settlement + reward grant ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gym_rival_settle_week()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gym_rival_settle_week$
DECLARE
  v_id        UUID;
  v_owner     UUID;
  v_rival     UUID;
  v_accepted  TIMESTAMPTZ;
  v_since     TIMESTAMPTZ;
  v_net_a     INT;
  v_net_b     INT;
  v_winner    UUID;
  v_loser     UUID;
  v_xp        INT;
  v_coins     INT;
  v_caps      INT;
  v_wemail    TEXT;
  v_wname     TEXT;
  v_lname     TEXT;
  v_settled   INT := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM public.gym_rival_assignments
     WHERE status = 'active'
       AND accepted_at IS NOT NULL
       AND date_trunc('week', accepted_at) + interval '7 days' <= now()
  LOOP
    SELECT user_id, rival_id, accepted_at
      INTO v_owner, v_rival, v_accepted
      FROM public.gym_rival_assignments WHERE id = v_id;

    -- Score over the match's ISO week (Mon-start), matching the client.
    v_since := date_trunc('week', v_accepted);
    v_net_a := public.gym_rival_net_rating(v_owner, v_since);
    v_net_b := public.gym_rival_net_rating(v_rival, v_since);

    IF v_net_a > v_net_b THEN
      v_winner := v_owner; v_loser := v_rival;
    ELSIF v_net_b > v_net_a THEN
      v_winner := v_rival; v_loser := v_owner;
    ELSE
      v_winner := NULL; v_loser := NULL;  -- draw
    END IF;

    IF v_winner IS NOT NULL THEN
      -- Flat prize — no level scaling.
      v_xp    := 5000;
      v_coins := 500;
      v_caps  := 5;

      PERFORM public.increment_user_xp(v_winner, v_xp);
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + v_coins
       WHERE id = v_winner;

      SELECT email INTO v_wemail FROM auth.users WHERE id = v_winner;
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      SELECT v_winner, v_wemail, 'standard' FROM generate_series(1, v_caps);

      -- Notify (English; i18n TODO). Reuses the mapped competitive type.
      SELECT username INTO v_lname FROM public.user_profiles WHERE id = v_loser;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_winner, email, 'nemesis_overthrown',
        '🏆 You won your Gym Rival week!',
        'You out-trained @' || COALESCE(v_lname, 'your rival') || '. +' || v_xp || ' XP, +' || v_coins || ' coins, ' || v_caps || ' capsules.',
        '🏆', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'win', 'xp', v_xp, 'coins', v_coins, 'capsules', v_caps)
      FROM auth.users WHERE id = v_winner;

      SELECT username INTO v_wname FROM public.user_profiles WHERE id = v_winner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      SELECT v_loser, email, 'nemesis_overthrown',
        'Your Gym Rival week ended',
        '@' || COALESCE(v_wname, 'your rival') || ' edged you out this week. Roll a new rival and get them next time.',
        '🎯', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'loss')
      FROM auth.users WHERE id = v_loser;
    ELSE
      -- Draw: notify both, no rewards.
      SELECT email INTO v_wemail FROM auth.users WHERE id = v_owner;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_owner, v_wemail, 'nemesis_overthrown',
        'Your Gym Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.',
        '🤝', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'draw'));

      SELECT email INTO v_wemail FROM auth.users WHERE id = v_rival;
      INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
      VALUES (v_rival, v_wemail, 'nemesis_overthrown',
        'Your Gym Rival week ended in a draw',
        'Dead even — no winner this week. Roll a new rival.',
        '🤝', '/workout',
        jsonb_build_object('assignment_id', v_id, 'result', 'draw'));
    END IF;

    UPDATE public.gym_rival_assignments
       SET status = 'completed', winner_id = v_winner, settled_at = now()
     WHERE id = v_id;
    v_settled := v_settled + 1;
  END LOOP;

  RETURN v_settled;
END;
$gym_rival_settle_week$;

REVOKE ALL ON FUNCTION public.gym_rival_settle_week() FROM PUBLIC;

-- ── Cron schedules (idempotent: unschedule the old jobid, reschedule) ──────
DO $$
DECLARE v_job BIGINT;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'gym-rival-settle';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('gym-rival-settle', '5 0 * * 1', 'SELECT public.gym_rival_settle_week();');

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'gym-rival-afk-void';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('gym-rival-afk-void', '0 */6 * * *', 'SELECT public.gym_rival_void_stale_all();');
END $$;

NOTIFY pgrst, 'reload schema';
