-- 341_retire_achievements_table.sql
--
-- Retires `public.achievements`.
--
-- The table was superseded by `user_trophies` (migs 167 + 323) but never
-- removed, and it kept two live server-side consumers pointed at it. It
-- holds ONE row in all of production, which is what made both consumers
-- fail silently rather than loudly:
--
--   1. grant_xp_milestone_achievements() wrote its five xp_* milestone
--      rows there. Those rows had no client definition anywhere, so a
--      user who crossed 250 XP got a badge that rendered as nothing.
--
--   2. grant_achievement_milestones() clamped the capsule ladder against
--      `count(*) FROM achievements WHERE created_by = <email>`. With one
--      row in the table that count is 0 for everybody, so
--      `v_safe_count := LEAST(p_unlocked_count, v_server_count)` was 0
--      and the milestone-capsule ladder has granted NOTHING since the
--      trophy migration. Measured before writing this: 0 users have ever
--      had milestone_capsules_awarded > 0, while 2 users already hold 5+
--      real trophies and are owed the first rung. The clamp is a genuine
--      anti-cheat guard — it stops a client passing an inflated count —
--      so it is repointed, not removed.
--
-- Both are rewritten onto user_trophies here, the one legacy row is
-- carried over so nobody loses a badge, and the table is dropped.
--
-- Deliberately NOT done: no backfill of the capsules already owed. The
-- ladder is idempotent and self-healing, so the two users collect on the
-- next XP grant through the normal path rather than by a one-shot write
-- into the economy.

-- ── 1. Carry the legacy rows over ────────────────────────────────────
-- ON CONFLICT because a user may already hold the trophy id.
INSERT INTO public.user_trophies (user_id, user_email, trophy_id, earned_at)
SELECT user_id, created_by, achievement_id, COALESCE(unlocked_at, created_at, now())
  FROM public.achievements
 WHERE user_id IS NOT NULL
   AND achievement_id IS NOT NULL
ON CONFLICT (user_id, trophy_id) DO NOTHING;

-- ── 2. XP milestones now write user_trophies ─────────────────────────
-- Same five thresholds and the same bonus XP as before. The bonus is why
-- these cannot simply be folded into grant_eligible_trophies(): that
-- function grants badges and awards no XP, so routing them through it
-- would hand over the badge and silently drop the payout.
CREATE OR REPLACE FUNCTION public.grant_xp_milestone_achievements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := COALESCE(NULLIF(public.current_user_email(), ''), '');
  v_total INTEGER;
  v_new   JSONB := '[]'::jsonb;
  v_count INTEGER;
  v_row   RECORD;
  v_has   BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(total_xp, 0) INTO v_total
    FROM public.user_profiles
   WHERE id = v_uid;

  IF v_total IS NULL THEN
    RETURN jsonb_build_object('new_achievements', v_new, 'unlocked_count', 0);
  END IF;

  -- Ascending, so a user crossing several at once collects them in order
  -- and each payout is counted into the running total before the next
  -- threshold is tested.
  FOR v_row IN
    SELECT * FROM (VALUES
      ('xp_250',     250,   10,  'First Steps'),
      ('xp_1000',    1000,  25,  'Getting Serious'),
      ('xp_5000',    5000,  50,  'Dedicated'),
      ('xp_10000',   10000, 100, 'Elite Athlete'),
      ('xp_25000',   25000, 200, 'Legend')
    ) AS m(tid, threshold, bonus, label)
    ORDER BY threshold
  LOOP
    IF v_total >= v_row.threshold THEN
      SELECT EXISTS (
        SELECT 1 FROM public.user_trophies
         WHERE user_id = v_uid AND trophy_id = v_row.tid
      ) INTO v_has;

      IF NOT v_has THEN
        INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
        VALUES (v_uid, v_email, v_row.tid)
        ON CONFLICT (user_id, trophy_id) DO NOTHING;

        PERFORM public.increment_user_xp(v_uid, v_row.bonus);

        v_new := v_new || jsonb_build_object(
          'id', v_row.tid, 'name', v_row.label, 'xp_awarded', v_row.bonus);
        v_total := v_total + v_row.bonus;
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
    FROM public.user_trophies
   WHERE user_id = v_uid;

  UPDATE public.user_profiles
     SET achievements_unlocked_count = v_count
   WHERE id = v_uid;

  RETURN jsonb_build_object('new_achievements', v_new, 'unlocked_count', v_count);
END;
$function$;

-- ── 3. Capsule ladder clamps against the LIVE table ──────────────────
-- Only the count source changes. Keying on user_id rather than the email
-- also picks up guest rows, whose created_by is '' (the same defect class
-- already fixed in the trophy readers).
CREATE OR REPLACE FUNCTION public.grant_achievement_milestones(p_unlocked_count integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             UUID := auth.uid();
  v_email           TEXT;
  v_server_count    INT;
  v_safe_count      INT;
  v_already_awarded INT;
  v_milestone       RECORD;
  v_granted_count   INT := 0;
  v_granted_payload JSONB := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_unlocked_count IS NULL OR p_unlocked_count < 0 THEN
    RAISE EXCEPTION 'invalid unlocked_count' USING ERRCODE = '22023';
  END IF;

  SELECT email, COALESCE(milestone_capsules_awarded, 0)
    INTO v_email, v_already_awarded
    FROM public.user_profiles
   WHERE id = v_uid
     FOR UPDATE;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'user_profile not found' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::int INTO v_server_count
    FROM public.user_trophies
   WHERE user_id = v_uid;

  v_safe_count := LEAST(p_unlocked_count, v_server_count);

  FOR v_milestone IN
    SELECT * FROM (VALUES
      (1, 5,   'standard'),
      (2, 10,  'standard'),
      (3, 25,  'premium'),
      (4, 50,  'premium'),
      (5, 100, 'elite')
    ) AS m(idx, threshold, capsule_type)
    WHERE m.threshold <= v_safe_count
      AND m.idx > v_already_awarded
    ORDER BY m.idx
  LOOP
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (v_uid, v_email, v_milestone.capsule_type);
    v_granted_count := v_granted_count + 1;
    v_granted_payload := v_granted_payload || jsonb_build_object(
      'threshold', v_milestone.threshold, 'type', v_milestone.capsule_type);
  END LOOP;

  IF v_granted_count = 0 THEN
    RETURN jsonb_build_object(
      'granted_count', 0, 'granted', '[]'::jsonb,
      'awarded_total', v_already_awarded, 'server_count', v_server_count);
  END IF;

  UPDATE public.user_profiles
     SET milestone_capsules_awarded = v_already_awarded + v_granted_count
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'granted_count', v_granted_count, 'granted', v_granted_payload,
    'awarded_total', v_already_awarded + v_granted_count,
    'server_count', v_server_count);
END;
$function$;

-- ── 4. Drop the table ────────────────────────────────────────────────
-- No inbound FKs, no triggers, no views depend on it (checked). Its three
-- owner-scoped RLS policies go with it.
DROP TABLE IF EXISTS public.achievements;

-- ── 5. Prove it ran ──────────────────────────────────────────────────
-- The SQL editor hides RAISE NOTICE, so the bundle ends in a SELECT.
SELECT
  (SELECT count(*) FROM public.user_trophies) AS trophies_now,
  (SELECT count(*) FROM public.user_trophies
    WHERE trophy_id LIKE 'xp\_%') AS xp_milestones_carried,
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='achievements') AS achievements_table_left,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('grant_xp_milestone_achievements','grant_achievement_milestones')
      AND p.prosrc ILIKE '%user_trophies%') AS rpcs_repointed;
