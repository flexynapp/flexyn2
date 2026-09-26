-- 079_atomic_duel_submit.sql
--
-- Closes a HIGH race in src/lib/data/duels.js submitDuelResult.
--
-- The previous client flow:
--   const updates = { [resultField]: result };
--   if (otherResult) { updates.status='completed'; updates.winner_id=...; }
--   await supabase.from('duels').update(updates).eq('id', duelId);
--
-- Two concurrent submissions (challenger + opponent both finishing
-- their workouts within network latency of each other) BOTH read the
-- duel with otherResult=null. Both write ONLY their own result column,
-- neither sets status='completed' or winner_id. The duel ends up with
-- both results filled in but stuck on status='active' with winner_id
-- null — the UI never proceeds to "show winner" and the duel hangs.
--
-- Atomic RPC takes a FOR UPDATE lock on the duel row, writes the
-- caller's result, and — if both results are now present — computes
-- the winner inline and flips status='completed'. The scoring logic
-- mirrors src/lib/data/duels.js resolveDuelWinner + scoreMirrorDuel
-- exactly; keep these in lockstep when changing either side.

-- Helper: compute volume from an exercises JSONB array (mirror duel's
-- prescribed template uses this shape).
CREATE OR REPLACE FUNCTION public._duel_calc_volume(p_exercises JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_total NUMERIC := 0;
  v_ex    JSONB;
  v_set   JSONB;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_total := v_total + COALESCE((v_set->>'weight')::NUMERIC, 0)
                           * COALESCE((v_set->>'reps')::NUMERIC, 0);
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Helper: mirror duel score (matches scoreMirrorDuel in duels.js).
CREATE OR REPLACE FUNCTION public._duel_score_mirror(p_result JSONB, p_template JSONB)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_exercises  JSONB;
  v_prescribed INT := 0;
  v_completed  INT := 0;
  v_completion NUMERIC;
  v_volume_pr  NUMERIC;
  v_volume_a   NUMERIC;
  v_ratio      NUMERIC;
  v_ex         JSONB;
BEGIN
  IF p_template IS NULL THEN RETURN 0; END IF;
  v_exercises := p_template->'exercises';
  IF v_exercises IS NULL OR jsonb_typeof(v_exercises) <> 'array' THEN RETURN 0; END IF;

  -- Prescribed set count: sum of len(ex.sets) over each exercise.
  FOR v_ex IN SELECT * FROM jsonb_array_elements(v_exercises) LOOP
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      v_prescribed := v_prescribed + jsonb_array_length(v_ex->'sets');
    END IF;
  END LOOP;
  IF v_prescribed = 0 THEN RETURN 0; END IF;

  v_completed  := COALESCE((p_result->>'sets_completed')::INT, 0);
  v_completion := LEAST(v_completed::NUMERIC / v_prescribed, 1);

  v_volume_pr := public._duel_calc_volume(v_exercises);
  v_volume_a  := COALESCE((p_result->>'volume')::NUMERIC, 0);
  v_ratio     := CASE WHEN v_volume_pr > 0 THEN LEAST(v_volume_a / v_volume_pr, 1.5) ELSE 1 END;

  RETURN ROUND((v_completion * 0.6 + (v_ratio / 1.5) * 0.4) * 1000)::INT;
END;
$$;

-- Helper: resolve duel winner from completed-state duel row.
-- Returns NULL on tie.
CREATE OR REPLACE FUNCTION public._duel_resolve_winner(p_duel public.duels)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_c_score NUMERIC;
  v_o_score NUMERIC;
BEGIN
  IF p_duel.challenger_result IS NULL OR p_duel.opponent_result IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_duel.type = 'mirror' THEN
    v_c_score := public._duel_score_mirror(p_duel.challenger_result, p_duel.session_template);
    v_o_score := public._duel_score_mirror(p_duel.opponent_result,  p_duel.session_template);
  ELSIF p_duel.type = 'open' THEN
    v_c_score := COALESCE((p_duel.challenger_result->>'volume')::NUMERIC, 0);
    v_o_score := COALESCE((p_duel.opponent_result->>'volume')::NUMERIC,  0);
  ELSE
    -- exercise duel: reps OR weight, mirroring the JS fallback
    v_c_score := COALESCE((p_duel.challenger_result->>'reps')::NUMERIC,
                          (p_duel.challenger_result->>'weight')::NUMERIC, 0);
    v_o_score := COALESCE((p_duel.opponent_result->>'reps')::NUMERIC,
                          (p_duel.opponent_result->>'weight')::NUMERIC, 0);
  END IF;

  IF v_c_score = v_o_score THEN RETURN NULL; END IF;
  IF v_c_score > v_o_score THEN RETURN p_duel.challenger_id; ELSE RETURN p_duel.opponent_id; END IF;
END;
$$;

-- Main RPC: caller submits their result. Function decides role from
-- auth.uid(), writes the result, and if both sides are now in,
-- atomically flips status=completed + winner_id.
CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(
  p_duel_id UUID,
  p_result  JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_duel   public.duels%ROWTYPE;
  v_role   TEXT;
  v_winner UUID;
  v_completed BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_duel_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'duel_id and result required' USING ERRCODE = '22023';
  END IF;

  -- Lock the duel. Concurrent submissions serialize here.
  SELECT * INTO v_duel FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_duel.id IS NULL THEN
    RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023';
  END IF;
  IF v_duel.status = 'completed' OR v_duel.status = 'expired' OR v_duel.status = 'declined' THEN
    -- Idempotent return — the duel is already finalized.
    RETURN jsonb_build_object(
      'duel_id',        p_duel_id,
      'status',         v_duel.status,
      'winner_id',      v_duel.winner_id,
      'already_final',  TRUE
    );
  END IF;

  IF v_duel.challenger_id = v_uid THEN
    v_role := 'challenger';
    UPDATE public.duels SET challenger_result = p_result WHERE id = p_duel_id;
    v_duel.challenger_result := p_result;
  ELSIF v_duel.opponent_id = v_uid THEN
    v_role := 'opponent';
    UPDATE public.duels SET opponent_result = p_result WHERE id = p_duel_id;
    v_duel.opponent_result := p_result;
  ELSE
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;

  -- Both submitted? Resolve winner + complete under the same lock.
  IF v_duel.challenger_result IS NOT NULL AND v_duel.opponent_result IS NOT NULL THEN
    v_winner := public._duel_resolve_winner(v_duel);
    UPDATE public.duels
       SET status    = 'completed',
           winner_id = v_winner
     WHERE id = p_duel_id;
    v_completed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'duel_id',       p_duel_id,
    'role',          v_role,
    'status',        CASE WHEN v_completed THEN 'completed' ELSE v_duel.status END,
    'winner_id',     v_winner,
    'completed',     v_completed,
    'already_final', FALSE
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.submit_duel_result_atomic(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_duel_result_atomic(UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
