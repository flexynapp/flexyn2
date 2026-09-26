-- 127_notification_snooze.sql
--
-- Per-category notification snooze. The existing on/off toggles in
-- notification_prefs are permanent (until the user un-toggles); this
-- adds a temporary "mute for 1 hour" affordance that auto-expires.
--
-- Storage: a single JSONB column on user_profiles, keyed by category
-- name, valued with the ISO timestamp at which the snooze EXPIRES.
-- A category is currently snoozed when its value > now().
--
-- Categories match the per-cat toggles in notification_prefs:
--   streak, quests, league, social, achievements, engagement, competitive

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS notification_snoozes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.is_category_snoozed(p_user_id UUID, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_until TEXT;
  v_ts    TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_category IS NULL THEN RETURN FALSE; END IF;
  SELECT notification_snoozes ->> p_category INTO v_until
    FROM public.user_profiles WHERE id = p_user_id;
  IF v_until IS NULL OR v_until = '' THEN RETURN FALSE; END IF;
  BEGIN
    v_ts := v_until::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
  RETURN v_ts > now();
END;
$$;

REVOKE ALL ON FUNCTION public.is_category_snoozed(UUID, TEXT) FROM PUBLIC;

-- ── snooze_notification_category RPC ──────────────────────────────────
-- Sets the snooze expiry for the caller's category. Pass 0 minutes
-- (or NULL) to clear. Returns the new expiry (or NULL when cleared).

CREATE OR REPLACE FUNCTION public.snooze_notification_category(
  p_category TEXT,
  p_minutes  INT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $snooze$
DECLARE
  v_uid    UUID := auth.uid();
  v_until  TIMESTAMPTZ;
  v_snooze JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_category IS NULL THEN
    RAISE EXCEPTION 'category required' USING ERRCODE = '22023';
  END IF;
  -- Soft cap at 24h so a misclick can't permanently mute someone.
  IF p_minutes IS NOT NULL AND (p_minutes < 0 OR p_minutes > 1440) THEN
    RAISE EXCEPTION 'minutes must be 0..1440' USING ERRCODE = '22023';
  END IF;

  IF p_minutes IS NULL OR p_minutes = 0 THEN
    -- Clear.
    UPDATE public.user_profiles
       SET notification_snoozes = COALESCE(notification_snoozes, '{}'::jsonb) - p_category
     WHERE id = v_uid;
    RETURN NULL;
  END IF;

  v_until := now() + (p_minutes || ' minutes')::interval;
  UPDATE public.user_profiles
     SET notification_snoozes = COALESCE(notification_snoozes, '{}'::jsonb)
       || jsonb_build_object(p_category, to_char(v_until, 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   WHERE id = v_uid;
  RETURN v_until;
END;
$snooze$;

REVOKE ALL ON FUNCTION public.snooze_notification_category(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snooze_notification_category(TEXT, INT) TO authenticated;

-- ── Patch notify_push_fanout to short-circuit on active snooze ───────
-- Same shape as the existing quiet-hours check (mig 098): in-app row
-- still inserts; only the push delivery is suppressed. Sits AFTER the
-- per-category on/off check so a permanent-off still wins, and BEFORE
-- quiet hours so a snooze can suppress even when not in DND.

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
  v_snoozed  BOOLEAN;
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

  -- Per-category permanent on/off (mig 036 + 083).
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

  -- Per-category temporary snooze (mig 127). Only checked when we
  -- resolved a category above; types without a category are never
  -- snoozable through this path.
  IF v_category IS NOT NULL THEN
    BEGIN
      v_snoozed := public.is_category_snoozed(NEW.user_id, v_category);
      IF v_snoozed THEN RETURN NEW; END IF;
    EXCEPTION WHEN undefined_function THEN NULL;
    WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Quiet hours (mig 098).
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

NOTIFY pgrst, 'reload schema';
