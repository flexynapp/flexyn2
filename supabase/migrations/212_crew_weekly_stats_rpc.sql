-- 212_crew_weekly_stats_rpc.sql
--
-- Crew stats panel showed 0 volume / null PR for every member except the
-- signed-in viewer. Root cause: getCrewStats read each member's WorkoutLog
-- from the client, but workout_logs has ONE RLS policy —
-- "workout_logs: owner full access" = (auth.email()=created_by OR
-- auth.uid()=user_id). There is no crew-scoped read policy, so every OTHER
-- member's rows are RLS-blocked and return nothing.
--
-- Fix: aggregate server-side in a SECURITY DEFINER RPC that bypasses the
-- per-row RLS but is GATED on the caller's own crew_members membership
-- (auth.uid()) — so it only ever exposes stats for a crew the caller
-- belongs to. Returns a JSONB array, one object per member:
--   { user_id, volume_lbs, best_pr: { exercise, weight, reps, e1rm } | null }
-- Also collapses the old O(16) per-member client round-trips into one call.
--
-- We reuse the existing public._duel_calc_volume(jsonb) helper (mig 079) for
-- volume so the weight*reps math stays identical to the duel/bounty paths.
-- Best PR uses the same Epley 1RM approximation as the client
-- (r > 1 ? w*(1+r/30) : w).

-- ── Helper: best Epley 1RM across an exercises[] array ────────────────────────
-- Pure function over a jsonb array of {name, sets:[{weight,reps}]} objects.
-- Returns {exercise, weight, reps, e1rm} for the top set, or NULL if empty.
CREATE OR REPLACE FUNCTION public._best_1rm_from_exercises(p_exercises jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ex        jsonb;
  v_set       jsonb;
  v_w         numeric;
  v_r         numeric;
  v_e1rm      numeric;
  v_best_e1rm numeric := NULL;
  v_best      jsonb   := NULL;
  v_name      text;
BEGIN
  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR v_ex IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
    v_name := v_ex->>'name';
    IF jsonb_typeof(v_ex->'sets') = 'array' THEN
      FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
        v_w := COALESCE((v_set->>'weight')::numeric, 0);
        v_r := COALESCE((v_set->>'reps')::numeric, 0);
        IF v_r > 1 THEN
          v_e1rm := v_w * (1 + v_r / 30);
        ELSE
          v_e1rm := v_w;
        END IF;
        IF v_best_e1rm IS NULL OR v_e1rm > v_best_e1rm THEN
          v_best_e1rm := v_e1rm;
          v_best := jsonb_build_object(
            'exercise', v_name,
            'weight',   v_w,
            'reps',     v_r,
            'e1rm',     v_e1rm
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_best;
END;
$$;

-- ── Helper: one member's last-7-days volume + best PR ─────────────────────────
-- SECURITY DEFINER so it reliably bypasses workout_logs RLS regardless of the
-- calling context, and REVOKEd from PUBLIC below so it is only reachable via
-- the membership-gated get_crew_weekly_stats RPC (never called directly with
-- an arbitrary p_user_id). Single-table read: all columns are bare.
CREATE OR REPLACE FUNCTION public._crew_member_week_stats(p_user_id uuid, p_since date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_combined jsonb;
BEGIN
  -- Flatten every exercise object across the member's in-window logs into one
  -- array, then hand it to the shared volume + best-1RM helpers.
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO v_combined
  FROM public.workout_logs,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(exercises) = 'array' THEN exercises ELSE '[]'::jsonb END
       ) AS elem
  WHERE user_id = p_user_id
    AND date >= p_since;

  RETURN jsonb_build_object(
    'volume_lbs', public._duel_calc_volume(v_combined),
    'best_pr',    public._best_1rm_from_exercises(v_combined)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._crew_member_week_stats(uuid, date) FROM PUBLIC;

-- ── RPC: crew-scoped weekly stats ────────────────────────────────────────────
-- Gated on the caller's own membership; returns [] for a crew the caller isn't
-- in. One row per member: { user_id, volume_lbs, best_pr }.
CREATE OR REPLACE FUNCTION public.get_crew_weekly_stats(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_since  date  := (now() - interval '7 days')::date;
  v_result jsonb;
BEGIN
  IF p_crew_id IS NULL OR auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Caller must belong to the crew they are asking about.
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
    WHERE crew_id = p_crew_id AND user_id = auth.uid()
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('user_id', user_id)
           || public._crew_member_week_stats(user_id, v_since)
         ), '[]'::jsonb)
  INTO v_result
  FROM public.crew_members
  WHERE crew_id = p_crew_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_crew_weekly_stats(uuid) TO authenticated;
