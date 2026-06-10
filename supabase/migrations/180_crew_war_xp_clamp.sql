-- Migration 180: bound crew-war XP contributions (C18, competitive integrity)
--
-- contribute_crew_war_xp(p_war_id, p_crew_id, p_xp) (mig 076) validated
-- membership + active war but accepted any p_xp > 0 with no upper bound
-- and no tie to a real workout, so
--   supabase.rpc('contribute_crew_war_xp', { p_war_id, p_crew_id, p_xp: 1e9 })
-- instantly won the war for the caller's crew — corrupting OTHER players'
-- competitive standing and firing the win celebration + push fanout.
--
-- The durable fix is to derive XP server-side from the caller's actual
-- workout (the bounty-152 recompute pattern); that is a larger change.
-- This migration removes the instant-win exploit now, non-breakingly, by
--   • clamping a single contribution to a per-call ceiling, and
--   • capping a user's total contribution to one war (looping the call
--     can't exceed the cap), crediting only the remaining headroom to
--     both the per-user row and the crew aggregate so they stay in sync.
-- Ceilings are generous vs one workout's XP, far below game-breaking.
--
-- Also rewrites the body from %ROWTYPE + record-dotted access (v_war.id —
-- which the paste pipeline mangles) to scalar SELECT ... INTO, so the
-- function is paste-safe per the repo convention. Behavior is otherwise
-- identical to migration 076.

CREATE OR REPLACE FUNCTION public.contribute_crew_war_xp(
  p_war_id  UUID,
  p_crew_id UUID,
  p_xp      INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_status       TEXT;
  v_crew_a       UUID;
  v_crew_b       UUID;
  v_is_member    INT;
  v_prior        INT;
  v_max_per_call CONSTANT INT := 5000;    -- ceiling on one contribution
  v_max_per_war  CONSTANT INT := 50000;   -- ceiling on a user's total per war
  v_requested    INT;
  v_credit       INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_war_id IS NULL OR p_crew_id IS NULL OR p_xp IS NULL OR p_xp <= 0 THEN
    RAISE EXCEPTION 'war_id, crew_id, and positive xp required' USING ERRCODE = '22023';
  END IF;

  -- Lock the war row; read its scalars (no %ROWTYPE / record access).
  SELECT status, crew_a_id, crew_b_id
    INTO v_status, v_crew_a, v_crew_b
    FROM public.crew_wars
   WHERE id = p_war_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'war not found' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'war not active' USING ERRCODE = '22023';
  END IF;
  IF p_crew_id <> v_crew_a AND p_crew_id <> v_crew_b THEN
    RAISE EXCEPTION 'crew not in this war' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_is_member
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid;
  IF v_is_member = 0 THEN
    RAISE EXCEPTION 'not a member of this crew' USING ERRCODE = '42501';
  END IF;

  -- Per-call clamp, then cap total contribution to this war.
  v_requested := LEAST(p_xp, v_max_per_call);

  SELECT COALESCE(xp_contributed, 0) INTO v_prior
    FROM public.crew_war_contributions
   WHERE war_id = p_war_id AND user_id = v_uid;
  v_prior := COALESCE(v_prior, 0);

  v_credit := LEAST(v_max_per_war, v_prior + v_requested) - v_prior;
  IF v_credit <= 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'war_id', p_war_id,
                              'crew_id', p_crew_id, 'xp', 0, 'capped', TRUE);
  END IF;

  -- Per-user contribution (upsert), then the matching crew aggregate.
  INSERT INTO public.crew_war_contributions
    (war_id, user_id, crew_id, xp_contributed, updated_at)
  VALUES
    (p_war_id, v_uid, p_crew_id, v_credit, NOW())
  ON CONFLICT (war_id, user_id) DO UPDATE
     SET xp_contributed = public.crew_war_contributions.xp_contributed + EXCLUDED.xp_contributed,
         updated_at     = NOW();

  IF p_crew_id = v_crew_a THEN
    UPDATE public.crew_wars
       SET crew_a_score = COALESCE(crew_a_score, 0) + v_credit
     WHERE id = p_war_id;
  ELSE
    UPDATE public.crew_wars
       SET crew_b_score = COALESCE(crew_b_score, 0) + v_credit
     WHERE id = p_war_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'war_id',  p_war_id,
    'crew_id', p_crew_id,
    'xp',      v_credit
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
