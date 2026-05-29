-- 166_layout_defaults.sql
--
-- App-wide default layouts for the Dashboard / Workout / Nutrition
-- reorderable surfaces. Admin presses "Set as default layout" on any
-- of those pages, takes a one-shot snapshot of their current widget
-- order + section layouts, and writes it here. New users (and anyone
-- who taps Reset) read this and fall back to it.
--
-- Snapshot semantics — NOT a sync. Future drags by the admin don't
-- silently overwrite the default; the admin has to explicitly re-tap
-- the button to push a new snapshot.
--
-- Paste-safe per CLAUDE.md.

-- ── Defaults table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_layout_defaults (
  surface          TEXT PRIMARY KEY,            -- 'dashboard' | 'workout' | 'nutrition'
  widget_order     JSONB,                       -- ordered array of section IDs
  section_layouts  JSONB,                       -- per-section layout map (dashboard hotdog/hamburger)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT
);

ALTER TABLE public.app_layout_defaults ENABLE ROW LEVEL SECURITY;

-- Read: everyone (so new users can fall back to the default).
DROP POLICY IF EXISTS "layout_defaults: read all" ON public.app_layout_defaults;
CREATE POLICY "layout_defaults: read all"
  ON public.app_layout_defaults FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.app_layout_defaults TO authenticated;


-- ── Admin gate helper ─────────────────────────────────────────────
-- Mirrors src/lib/adminRoles.js ADMIN_USERNAMES — when one changes,
-- change the other. Inlined here instead of relying on migration 084's
-- is_app_admin() so this migration is standalone.

CREATE OR REPLACE FUNCTION public.is_layout_admin(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_email    TEXT;
BEGIN
  IF p_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT lower(COALESCE(username, '')),
         lower(COALESCE(email,    ''))
    INTO v_username, v_email
    FROM public.user_profiles
   WHERE id = p_uid;
  RETURN v_username IN ('sean', 'seanj', 'kegan', 'keganbergeron', 'admin')
      OR split_part(v_email, '@', 1) IN ('sean', 'seanj', 'kegan', 'keganbergeron', 'admin');
END;
$$;


-- ── Write RPC ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_layout_default(
  p_surface         TEXT,
  p_widget_order    JSONB,
  p_section_layouts JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT := auth.email();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_surface NOT IN ('dashboard', 'workout', 'nutrition') THEN
    RAISE EXCEPTION 'invalid_surface: %', p_surface USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_layout_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_widget_order) <> 'array' THEN
    RAISE EXCEPTION 'widget_order must be a JSONB array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.app_layout_defaults
    (surface, widget_order, section_layouts, updated_at, updated_by)
  VALUES
    (p_surface, p_widget_order, p_section_layouts, NOW(), v_email)
  ON CONFLICT (surface) DO UPDATE
    SET widget_order    = EXCLUDED.widget_order,
        section_layouts = EXCLUDED.section_layouts,
        updated_at      = NOW(),
        updated_by      = EXCLUDED.updated_by;

  RETURN jsonb_build_object(
    'success',    true,
    'surface',    p_surface,
    'updated_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_layout_default(TEXT, JSONB, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
