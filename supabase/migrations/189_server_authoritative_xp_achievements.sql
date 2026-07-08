-- supabase/migrations/189_server_authoritative_xp_achievements.sql
--
-- Makes XP-milestone achievement granting server-authoritative.
--
-- Before: src/api/db.js `_invokeXp` detected XP milestones client-side and
-- INSERTed rows into public.achievements directly. The "achievements: owner
-- full access" policy (mig 001) lets any signed-in user insert arbitrary
-- rows for themselves — i.e. forge a "Legend" badge, or any achievement_id /
-- xp_awarded they like. Post-mig-188 the bonus XP is capped, so the residual
-- risk is cosmetic badge forgery + audit-trail pollution, but it's still an
-- integrity gap.
--
-- After:
--   1. grant_xp_milestone_achievements() — SECURITY DEFINER RPC that reads
--      the caller's OWN total_xp, inserts any crossed-and-unowned XP
--      milestones atomically, grants the bonus XP through the (capped)
--      increment_user_xp, self-heals achievements_unlocked_count, and returns
--      the newly-unlocked list so the client can still fire celebrations.
--      Milestone definitions are encoded here (mirrors the mig 071 capsule
--      pattern) — they MUST stay in sync with any client display copy.
--   2. RLS — replace the FOR ALL "owner full access" policy with explicit
--      SELECT / UPDATE / DELETE owner policies and NO client INSERT policy.
--      The only legitimate client insert was _invokeXp (now removed); the
--      account-purge DELETE path (src/lib/data/achievements.js) keeps working.
--      SECURITY DEFINER RPCs (this one, plus trophies/capsule grants) run as
--      the function owner and bypass RLS, so server-side inserts still work.
--
-- Idempotent; safe to re-run.

-- ── 1. Server-authoritative XP-milestone granting ──────────────────────────
CREATE OR REPLACE FUNCTION public.grant_xp_milestone_achievements()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := COALESCE(auth.email(), '');  -- guests have no email; match the old client behaviour
  v_total INTEGER;
  v_new   JSONB := '[]'::jsonb;
  v_count INTEGER;
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

  -- One block per milestone (ascending). Each is idempotent: it only fires
  -- when the threshold is crossed AND the row isn't already owned. The bonus
  -- is added to the running total so a bonus that crosses the NEXT threshold
  -- within the same call is still caught.

  IF v_total >= 250 AND NOT EXISTS (
       SELECT 1 FROM public.achievements WHERE user_id = v_uid AND achievement_id = 'xp_250') THEN
    INSERT INTO public.achievements (created_by, user_id, achievement_id, name, description, xp_awarded, unlocked_at)
      VALUES (v_email, v_uid, 'xp_250', 'First Steps', 'Earned your first 250 XP', 10, now());
    PERFORM public.increment_user_xp(v_uid, 10);
    v_new   := v_new || jsonb_build_object('id', 'xp_250', 'name', 'First Steps', 'xp_awarded', 10);
    v_total := v_total + 10;
  END IF;

  IF v_total >= 1000 AND NOT EXISTS (
       SELECT 1 FROM public.achievements WHERE user_id = v_uid AND achievement_id = 'xp_1000') THEN
    INSERT INTO public.achievements (created_by, user_id, achievement_id, name, description, xp_awarded, unlocked_at)
      VALUES (v_email, v_uid, 'xp_1000', 'Getting Serious', 'Earned 1,000 XP total', 25, now());
    PERFORM public.increment_user_xp(v_uid, 25);
    v_new   := v_new || jsonb_build_object('id', 'xp_1000', 'name', 'Getting Serious', 'xp_awarded', 25);
    v_total := v_total + 25;
  END IF;

  IF v_total >= 5000 AND NOT EXISTS (
       SELECT 1 FROM public.achievements WHERE user_id = v_uid AND achievement_id = 'xp_5000') THEN
    INSERT INTO public.achievements (created_by, user_id, achievement_id, name, description, xp_awarded, unlocked_at)
      VALUES (v_email, v_uid, 'xp_5000', 'Dedicated', 'Earned 5,000 XP total', 50, now());
    PERFORM public.increment_user_xp(v_uid, 50);
    v_new   := v_new || jsonb_build_object('id', 'xp_5000', 'name', 'Dedicated', 'xp_awarded', 50);
    v_total := v_total + 50;
  END IF;

  IF v_total >= 10000 AND NOT EXISTS (
       SELECT 1 FROM public.achievements WHERE user_id = v_uid AND achievement_id = 'xp_10000') THEN
    INSERT INTO public.achievements (created_by, user_id, achievement_id, name, description, xp_awarded, unlocked_at)
      VALUES (v_email, v_uid, 'xp_10000', 'Elite Athlete', 'Earned 10,000 XP total', 100, now());
    PERFORM public.increment_user_xp(v_uid, 100);
    v_new   := v_new || jsonb_build_object('id', 'xp_10000', 'name', 'Elite Athlete', 'xp_awarded', 100);
    v_total := v_total + 100;
  END IF;

  IF v_total >= 25000 AND NOT EXISTS (
       SELECT 1 FROM public.achievements WHERE user_id = v_uid AND achievement_id = 'xp_25000') THEN
    INSERT INTO public.achievements (created_by, user_id, achievement_id, name, description, xp_awarded, unlocked_at)
      VALUES (v_email, v_uid, 'xp_25000', 'Legend', 'Earned 25,000 XP total', 200, now());
    PERFORM public.increment_user_xp(v_uid, 200);
    v_new   := v_new || jsonb_build_object('id', 'xp_25000', 'name', 'Legend', 'xp_awarded', 200);
    v_total := v_total + 200;
  END IF;

  -- Self-heal the counter from the source of truth (the rows themselves).
  SELECT count(*) INTO v_count FROM public.achievements WHERE user_id = v_uid;
  UPDATE public.user_profiles
    SET achievements_unlocked_count = v_count
    WHERE id = v_uid;

  RETURN jsonb_build_object('new_achievements', v_new, 'unlocked_count', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_xp_milestone_achievements() TO authenticated;

-- ── 2. RLS — drop the client INSERT capability, keep SELECT/UPDATE/DELETE ───
-- Splitting the FOR ALL policy lets clients still read their badges and the
-- account-purge flow still delete them, while making INSERT impossible from
-- the client. Only SECURITY DEFINER RPCs (this one + trophies/capsule grants)
-- can create achievement rows now.
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "achievements: owner full access" ON public.achievements;
DROP POLICY IF EXISTS "achievements: owner read"   ON public.achievements;
DROP POLICY IF EXISTS "achievements: owner update" ON public.achievements;
DROP POLICY IF EXISTS "achievements: owner delete" ON public.achievements;

CREATE POLICY "achievements: owner read"
  ON public.achievements FOR SELECT
  USING (auth.email() = created_by OR auth.uid() = user_id);

CREATE POLICY "achievements: owner update"
  ON public.achievements FOR UPDATE
  USING (auth.email() = created_by OR auth.uid() = user_id)
  WITH CHECK (auth.email() = created_by OR auth.uid() = user_id);

CREATE POLICY "achievements: owner delete"
  ON public.achievements FOR DELETE
  USING (auth.email() = created_by OR auth.uid() = user_id);

-- NOTE: deliberately NO "FOR INSERT" policy. With RLS enabled and no INSERT
-- policy, client inserts are denied; SECURITY DEFINER grant RPCs bypass RLS.
