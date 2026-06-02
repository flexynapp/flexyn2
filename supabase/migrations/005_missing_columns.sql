-- ============================================================
-- Migration 005 — Critical missing columns
-- Fixes: goals (13 cols), cardio_logs (type + 8 cols),
--        regimens (is_public + attribution), workout_templates
--        (copy_count + attribution), nutrition_logs (notes)
-- ============================================================

-- ── goals ─────────────────────────────────────────────────────
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS goal_type                text DEFAULT 'strength',
  ADD COLUMN IF NOT EXISTS exercise_name            text,
  ADD COLUMN IF NOT EXISTS exercise_canonical       text,
  ADD COLUMN IF NOT EXISTS target_weight            numeric,
  ADD COLUMN IF NOT EXISTS target_reps              integer,
  ADD COLUMN IF NOT EXISTS period                   text DEFAULT 'lifetime',
  ADD COLUMN IF NOT EXISTS period_start_date        date,
  ADD COLUMN IF NOT EXISTS cardio_activity          text,
  ADD COLUMN IF NOT EXISTS target_distance_meters   numeric,
  ADD COLUMN IF NOT EXISTS target_duration_seconds  integer,
  ADD COLUMN IF NOT EXISTS target_sessions          integer,
  ADD COLUMN IF NOT EXISTS achieved_weight          numeric,
  ADD COLUMN IF NOT EXISTS achieved_reps            integer,
  ADD COLUMN IF NOT EXISTS notes                    text;

-- ── cardio_logs ───────────────────────────────────────────────
-- App writes `type`; schema had `activity_type`. Add `type` and
-- back-fill so existing rows are not lost.
ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS type                   text,
  ADD COLUMN IF NOT EXISTS duration_seconds       integer,
  ADD COLUMN IF NOT EXISTS mode                   text,
  ADD COLUMN IF NOT EXISTS pace_seconds_per_km    numeric,
  ADD COLUMN IF NOT EXISTS avg_speed_kmh          numeric,
  ADD COLUMN IF NOT EXISTS calories               numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS incline_percent        numeric,
  ADD COLUMN IF NOT EXISTS elevation_gain_m       numeric,
  ADD COLUMN IF NOT EXISTS gps_track              jsonb;

-- Sync existing activity_type → type and vice versa
UPDATE public.cardio_logs SET type = activity_type WHERE type IS NULL AND activity_type IS NOT NULL;
UPDATE public.cardio_logs SET activity_type = type WHERE activity_type IS NULL AND type IS NOT NULL;

-- Keep both columns in sync going forward
CREATE OR REPLACE FUNCTION public.sync_cardio_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS NULL AND NEW.activity_type IS NOT NULL THEN
    NEW.type := NEW.activity_type;
  ELSIF NEW.activity_type IS NULL AND NEW.type IS NOT NULL THEN
    NEW.activity_type := NEW.type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_cardio_type ON public.cardio_logs;
CREATE TRIGGER trg_sync_cardio_type
  BEFORE INSERT OR UPDATE ON public.cardio_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_cardio_type();

-- Also convert duration_min → duration_seconds for existing rows
UPDATE public.cardio_logs
  SET duration_seconds = duration_min * 60
  WHERE duration_seconds IS NULL AND duration_min IS NOT NULL;

-- ── regimens ─────────────────────────────────────────────────
ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS is_public                 boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_count                integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_template_id      uuid,
  ADD COLUMN IF NOT EXISTS original_author_username  text,
  ADD COLUMN IF NOT EXISTS exercises                 jsonb DEFAULT '[]';

-- Sync existing days → exercises (same data, different name)
UPDATE public.regimens SET exercises = days WHERE exercises = '[]' AND days IS NOT NULL AND days != '[]';

-- ── workout_templates ─────────────────────────────────────────
ALTER TABLE public.workout_templates
  ADD COLUMN IF NOT EXISTS copy_count                integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_template_id      uuid,
  ADD COLUMN IF NOT EXISTS original_author_username  text,
  ADD COLUMN IF NOT EXISTS author_username           text;

-- ── nutrition_logs ────────────────────────────────────────────
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS notes text;

-- ── Re-grant for new columns ──────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
