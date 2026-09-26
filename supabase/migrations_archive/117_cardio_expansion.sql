-- 117_cardio_expansion.sql
-- Cardio feature expansion: heart rate, cadence, power, swim tracking,
-- named routes, VO2max, cardio templates, and planned cardio scheduling.
--
-- New columns on cardio_logs (all nullable, no breaking changes):
--   avg_heart_rate   INT          — beats per minute average
--   cadence_spm      INT          — steps/strokes per minute
--   power_watts      INT          — cycling watts (power meter)
--   pool_length_m    INT          — pool length in meters (swim only)
--   laps             INT          — lap count (swim only)
--   stroke_type      TEXT         — freestyle / backstroke / etc. (swim only)
--   route_name       TEXT         — named GPS route or custom label
--   vo2max_estimate  NUMERIC(5,1) — mL/kg/min estimate (running only)
--
-- New tables:
--   cardio_templates — saved quick-start configurations
--   planned_cardio   — future-dated scheduled sessions

-- ── Extend cardio_logs ────────────────────────────────────────────────────
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS avg_heart_rate  INT          NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS cadence_spm     INT          NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS power_watts     INT          NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS pool_length_m   INT          NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS laps            INT          NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS stroke_type     TEXT         NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS route_name      TEXT         NULL;
ALTER TABLE cardio_logs ADD COLUMN IF NOT EXISTS vo2max_estimate NUMERIC(5,1) NULL;

-- ── cardio_templates ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cardio_templates (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       TEXT         NOT NULL,
  name             TEXT         NOT NULL,
  type             TEXT         NOT NULL,
  distance_meters  NUMERIC      NULL,
  duration_seconds INT          NULL,
  incline_percent  NUMERIC      NULL,
  avg_heart_rate   INT          NULL,
  cadence_spm      INT          NULL,
  power_watts      INT          NULL,
  pool_length_m    INT          NULL,
  laps             INT          NULL,
  stroke_type      TEXT         NULL,
  notes            TEXT         NULL,
  created_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE cardio_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cardio_templates_own" ON cardio_templates;
CREATE POLICY "cardio_templates_own" ON cardio_templates
  FOR ALL
  USING (created_by = (SELECT email FROM user_profiles WHERE id = auth.uid()));

GRANT ALL ON cardio_templates TO authenticated;

-- ── planned_cardio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planned_cardio (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          TEXT        NOT NULL,
  planned_date        DATE        NOT NULL,
  type                TEXT        NOT NULL DEFAULT 'running_outside',
  title               TEXT        NOT NULL,
  distance_meters     NUMERIC     NULL,
  duration_seconds    INT         NULL,
  notes               TEXT        NULL,
  completed_cardio_id UUID        NULL REFERENCES cardio_logs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE planned_cardio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planned_cardio_own" ON planned_cardio;
CREATE POLICY "planned_cardio_own" ON planned_cardio
  FOR ALL
  USING (created_by = (SELECT email FROM user_profiles WHERE id = auth.uid()));

GRANT ALL ON planned_cardio TO authenticated;

NOTIFY pgrst, 'reload schema';
