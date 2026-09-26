-- 098_a_tier_batch.sql
--
-- Batches several A-tier additions into a single migration:
--   • Quiet-hours preference on user_profiles + gating in the
--     notification push trigger (A12)
--   • is_template flag on regimens to mark canonical built-in
--     programs (A1)
--   • is_user_created flag + RPC on bounties so users can post
--     bounties on themselves (A4)
--   • crew_challenges table (A13)
--
-- Each addition is independent; bundling lets us ship one round-trip
-- to the SQL Editor instead of four.

-- ── A12: Quiet hours ─────────────────────────────────────────────────
-- Two integer columns (0-23) defining a do-not-disturb window. NULL
-- means no quiet hours. The window may wrap midnight (e.g. 22→7).
-- The push trigger from migration 034 reads these and short-circuits
-- delivery when now() in the user's local TZ falls inside the window.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS quiet_hours_start INTEGER CHECK (quiet_hours_start IS NULL OR quiet_hours_start BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS quiet_hours_end   INTEGER CHECK (quiet_hours_end   IS NULL OR quiet_hours_end   BETWEEN 0 AND 23);

-- Helper: is `now` within the user's quiet-hours window? Used by the
-- push trigger AND by future server-side schedulers (welcome-back,
-- streak-break, gauntlet, etc.) to suppress notifications.
--
-- The window wraps midnight when start >= end:
--   start=22, end=7  → quiet from 22:00 → 06:59 the next day
--   start=1,  end=5  → quiet from 01:00 → 04:59
--   start=NULL or end=NULL → never quiet
--
-- timezone_offset is read from user_profiles (existing column) so we
-- shift now() into the user's local frame before comparing.

CREATE OR REPLACE FUNCTION public.is_in_quiet_hours(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_start  INTEGER;
  v_end    INTEGER;
  v_offset INTEGER;
  v_local_hour INTEGER;
BEGIN
  SELECT quiet_hours_start, quiet_hours_end, COALESCE(timezone_offset, 0)
    INTO v_start, v_end, v_offset
    FROM public.user_profiles WHERE id = p_user_id;
  IF v_start IS NULL OR v_end IS NULL THEN RETURN FALSE; END IF;

  -- Compute user-local hour 0-23.
  v_local_hour := EXTRACT(HOUR FROM (now() + (v_offset || ' minutes')::interval))::int;

  IF v_start = v_end THEN
    RETURN FALSE; -- empty window, never quiet
  ELSIF v_start < v_end THEN
    -- Simple non-wrapping window.
    RETURN v_local_hour >= v_start AND v_local_hour < v_end;
  ELSE
    -- Wraps midnight: hours after start OR hours before end.
    RETURN v_local_hour >= v_start OR v_local_hour < v_end;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.is_in_quiet_hours(UUID) FROM PUBLIC;

-- Patch the push fanout trigger to short-circuit on quiet hours. The
-- in-app notification still inserts; only the push delivery is
-- suppressed. CRITICAL types (currently none) could be added as a
-- whitelist later.

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_body     JSONB;
  v_category TEXT;
  v_prefs    JSONB;
  v_quiet    BOOLEAN;
BEGIN
  BEGIN
    v_url    := current_setting('app.send_push_url',    true);
    v_secret := current_setting('app.send_push_secret', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  -- Per-category prefs (migration 036 + 083).
  BEGIN
    v_category := public.notification_type_category(NEW.type);
    IF v_category IS NOT NULL THEN
      SELECT notification_prefs INTO v_prefs FROM public.user_profiles WHERE id = NEW.user_id;
      IF v_prefs IS NOT NULL AND v_prefs ? v_category AND (v_prefs ->> v_category) = 'false' THEN
        RETURN NEW;
      END IF;
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
  END;

  -- Quiet hours (NEW in mig 098). Short-circuit push delivery when
  -- the user's local time falls inside their DND window. In-app row
  -- already inserted, so they'll see it next time they open the app.
  BEGIN
    v_quiet := public.is_in_quiet_hours(NEW.user_id);
    IF v_quiet THEN RETURN NEW; END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
  END;

  v_body := jsonb_build_object(
    'user_id', NEW.user_id,
    'title',   COALESCE(NEW.title, 'Flexyn'),
    'body',    COALESCE(NEW.body,  ''),
    'icon',    NEW.icon,
    'url',     COALESCE(NEW.link_url, '/'),
    'tag',     NEW.type
  );

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'Content-Type',         'application/json',
        'X-Send-Push-Secret',   v_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_fanout] dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_push_fanout() FROM PUBLIC;

-- ── A1: Program template flag on regimens ────────────────────────────
-- Marks a regimen as a canonical, app-curated program (5/3/1, PPL,
-- etc.) vs. a user-built routine. Clients filter by this to surface
-- a "Start from a proven program" picker.

ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS template_id TEXT; -- slug like 'ppl', '531', 'gzclp'

CREATE INDEX IF NOT EXISTS idx_regimens_is_template
  ON public.regimens (is_template) WHERE is_template = TRUE;

-- Note: actual seeded program rows are inserted by the client on
-- first-time-template-tap (so each user gets a personal copy), not
-- by a global INSERT here. That keeps RLS simple and lets a user
-- modify their copy without affecting other users' versions.

-- ── A4: User-created bounties ────────────────────────────────────────
-- Bounties were auto-generated; allow users to post bounties on
-- themselves. is_user_created flag + a SECURITY DEFINER RPC that
-- enforces the caller IS the target (you can only post a bounty on
-- YOUR OWN record, not someone else's — anti-griefing).

ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS is_user_created BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.create_user_bounty(
  p_metric        TEXT,
  p_exercise_name TEXT,
  p_target_value  NUMERIC,
  p_difficulty    TEXT,
  p_expires_at    TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_username TEXT;
  v_avatar   TEXT;
  v_entry    INTEGER;
  v_reward   INTEGER;
  v_id       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_metric NOT IN ('weekly_volume', 'session_volume', 'single_lift_weight', 'single_lift_reps') THEN
    RAISE EXCEPTION 'invalid metric' USING ERRCODE = '22023';
  END IF;
  IF p_target_value IS NULL OR p_target_value <= 0 THEN
    RAISE EXCEPTION 'target_value must be positive' USING ERRCODE = '22023';
  END IF;
  IF p_difficulty NOT IN ('easy', 'medium', 'hard') THEN
    RAISE EXCEPTION 'invalid difficulty' USING ERRCODE = '22023';
  END IF;

  SELECT username, avatar_url INTO v_username, v_avatar
    FROM public.user_profiles WHERE id = v_uid;

  -- Reward scale matches DIFFICULTY_CONFIG in src/lib/data/bounties.js
  v_entry  := CASE p_difficulty WHEN 'easy' THEN 10 WHEN 'medium' THEN 15 ELSE 20 END;
  v_reward := CASE p_difficulty WHEN 'easy' THEN 60 WHEN 'medium' THEN 100 ELSE 175 END;

  INSERT INTO public.bounties (
    target_user_id, target_username, target_avatar_url,
    metric, exercise_name, target_value,
    difficulty, entry_fee, reward,
    is_user_created, expires_at
  )
  VALUES (
    v_uid, v_username, v_avatar,
    p_metric, p_exercise_name, p_target_value,
    p_difficulty, v_entry, v_reward,
    TRUE, COALESCE(p_expires_at, now() + INTERVAL '48 hours')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_user_bounty(TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_user_bounty(TEXT, TEXT, NUMERIC, TEXT, TIMESTAMPTZ) TO authenticated;

-- ── A13: Crew challenges ─────────────────────────────────────────────
-- A crew sets a collective goal (target volume / sessions / PRs by a
-- deadline). Members see progress in the crew chat header. End-of-
-- challenge announces winner or completion.

CREATE TABLE IF NOT EXISTS public.crew_challenges (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id      UUID        NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  created_by   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  metric       TEXT        NOT NULL CHECK (metric IN ('total_volume', 'total_sessions', 'total_xp', 'days_active')),
  target_value INTEGER     NOT NULL CHECK (target_value > 0),
  current_value INTEGER    NOT NULL DEFAULT 0,
  starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crew_challenges_crew
  ON public.crew_challenges (crew_id, status, ends_at DESC);

ALTER TABLE public.crew_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_challenges: members read" ON public.crew_challenges;
CREATE POLICY "crew_challenges: members read"
  ON public.crew_challenges FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.crew_members cm
     WHERE cm.crew_id = crew_challenges.crew_id
       AND cm.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "crew_challenges: admins write" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins write"
  ON public.crew_challenges FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.crew_members cm
     WHERE cm.crew_id = crew_challenges.crew_id
       AND cm.user_id = auth.uid()
       AND cm.is_admin = TRUE
  ))
  WITH CHECK (created_by = auth.uid());

NOTIFY pgrst, 'reload schema';
