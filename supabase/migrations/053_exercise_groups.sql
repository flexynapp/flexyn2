-- 053_exercise_groups.sql
-- Persists superset/circuit group metadata.
-- Exercises carry a group_id (UUID string) in their JSONB; this table holds
-- the group configuration (type, rest durations, round count).

CREATE TABLE IF NOT EXISTS public.exercise_groups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  regimen_id          UUID,               -- null for freestyle session groups
  type                TEXT NOT NULL DEFAULT 'superset'
                      CHECK (type IN ('superset','circuit')),
  intra_rest_seconds  INT NOT NULL DEFAULT 15,   -- rest between exercises in a round
  inter_rest_seconds  INT NOT NULL DEFAULT 90,   -- rest between full rounds
  round_count         INT NOT NULL DEFAULT 3,
  order_index         INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.exercise_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exercise_groups_own"
  ON public.exercise_groups
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
