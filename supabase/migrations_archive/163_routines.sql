-- 163_routines.sql
--
-- "My Routine" — user-built weekly training calendars. Each row is one named
-- routine owned by a user. `days` is a 7-slot JSONB array, index 0 = Monday
-- … 6 = Sunday; each slot:
--   { "label": "Leg Day", "focus": "legs", "isRest": false,
--     "exercises": [{ "name": "Back Squat", "muscles": ["Legs"] }, ...] }
--
-- At most one routine per user is `is_active` — that's the one that drives
-- "today's plan" on the Workout screen. A user can keep many (cut/bulk/etc.);
-- the ~50 cap is enforced client/data-layer side (no economy weight, so a
-- hard server trigger is overkill).
--
-- One row per routine + JSONB days keeps the whole week in a single read and
-- mirrors how regimens already store their exercise payloads.
--
-- Paste-safe + idempotent.

CREATE TABLE IF NOT EXISTS public.routines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  name       TEXT NOT NULL,
  days       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routines_user ON public.routines (user_id, created_at);

-- At most one active routine per user. Partial unique index — only enforced
-- on the active row, so inactive routines never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_routines_one_active
  ON public.routines (user_id) WHERE is_active = TRUE;

ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "routines: owner all" ON public.routines;
CREATE POLICY "routines: owner all"
  ON public.routines FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.routines TO authenticated;

NOTIFY pgrst, 'reload schema';
