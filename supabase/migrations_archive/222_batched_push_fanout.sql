-- 222_batched_push_fanout.sql
--
-- Viral-load prep, pass 4: kill the push-fanout write amplification.
--
-- BEFORE: notify_push_fanout (034/080/098/127) was FOR EACH ROW — one
-- user_profiles prefs SELECT + one pg_net HTTP POST per notification
-- inserted. Bulk fanouts multiplied it: the hourly gauntlet activation
-- (082) loops over every user active in the last 14 days, so one
-- gauntlet flip produced N inserts → N trigger fires → N sequential
-- outbound HTTP calls through the pg_net queue. Under viral load that
-- queue becomes the bottleneck that delays ALL pushes.
--
-- AFTER, three coordinated changes:
--   1. The trigger is now FOR EACH STATEMENT with a transition table:
--      one INSERT statement → prefs/snooze/quiet-hours filtering as one
--      set-based query → ONE HTTP POST per 200 eligible rows, carrying
--      { "notifications": [ ... ] }.
--   2. The send-push Edge Function (same commit) accepts that batch
--      shape alongside the legacy single shape — one subscription
--      lookup and one expired-cleanup per batch.
--   3. The two biggest per-row INSERT loops become single INSERT …
--      SELECT statements so they actually benefit: 082's gauntlet
--      fanout and 104's two crew-challenge RPCs. Single-row inserts
--      everywhere else behave exactly as before (a statement of one
--      row = a batch of one).
--
-- ⚠ DEPLOY ORDER: deploy the updated send-push Edge Function BEFORE
--   running this migration. The new trigger sends batch payloads; the
--   old function build answers 400 user_id_required to those. The
--   updated function accepts both shapes, so function-first is safe in
--   both directions.
--
-- Idempotency: CREATE OR REPLACE + DROP TRIGGER IF EXISTS throughout.
-- The old notify_push_fanout() row-level function is left in place
-- (unreferenced) so a rollback is just re-pointing the trigger.

-- ── Preconditions ────────────────────────────────────────────────────
-- The batch trigger calls these helpers un-guarded (set-based SQL can't
-- wrap each call in an EXCEPTION handler the way the per-row loop did),
-- so refuse to install if the schema predates them.
DO $precheck$
BEGIN
  IF to_regproc('public.notification_type_category') IS NULL
     OR to_regproc('public.is_category_snoozed') IS NULL
     OR to_regproc('public.is_in_quiet_hours') IS NULL THEN
    RAISE EXCEPTION 'migration 222 requires migrations 083, 098 and 127 (category / snooze / quiet-hours helpers) to be applied first';
  END IF;
END;
$precheck$;

-- ── 1. Statement-level fanout trigger ────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_push_fanout_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fanout_batch$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_chunk  JSONB;
BEGIN
  -- Same short-circuit as the row-level version: when the push secrets
  -- aren't configured the in-app rows still land, we just skip dispatch.
  BEGIN
    v_url    := current_setting('app.send_push_url',    true);
    v_secret := current_setting('app.send_push_secret', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NULL;
  END IF;

  -- Filter the whole statement's rows in one pass (prefs → snooze →
  -- quiet hours, mirroring 036/083 + 127 + 098), then dispatch in
  -- chunks of 200 payloads per HTTP call.
  FOR v_chunk IN
    WITH candidate AS (
      SELECT user_id                   AS target_user_id,
             COALESCE(title, 'Flexyn') AS push_title,
             COALESCE(body, '')        AS push_body,
             icon                      AS push_icon,
             COALESCE(link_url, '/')   AS push_url,
             type                      AS push_tag,
             public.notification_type_category(type) AS push_category
        FROM new_rows
    ),
    prefs AS (
      SELECT id                 AS pref_user_id,
             notification_prefs AS pref_json
        FROM public.user_profiles
       WHERE id IN (SELECT target_user_id FROM candidate)
    ),
    eligible AS (
      SELECT target_user_id, push_title, push_body, push_icon, push_url, push_tag
        FROM candidate
        LEFT JOIN prefs ON pref_user_id = target_user_id
       WHERE (
               push_category IS NULL
               OR pref_json IS NULL
               OR NOT (pref_json ? push_category)
               OR (pref_json ->> push_category) <> 'false'
             )
         AND (
               push_category IS NULL
               OR NOT COALESCE(public.is_category_snoozed(target_user_id, push_category), false)
             )
         AND NOT COALESCE(public.is_in_quiet_hours(target_user_id), false)
    ),
    numbered AS (
      SELECT row_number() OVER () AS rn,
             jsonb_build_object(
               'user_id', target_user_id,
               'title',   push_title,
               'body',    push_body,
               'icon',    push_icon,
               'url',     push_url,
               'tag',     push_tag
             ) AS push_payload
        FROM eligible
    )
    SELECT jsonb_agg(push_payload)
      FROM numbered
     GROUP BY (rn - 1) / 200
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        body    := jsonb_build_object('notifications', v_chunk),
        headers := jsonb_build_object(
          'Content-Type',       'application/json',
          'X-Send-Push-Secret', v_secret
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[notify_push_fanout_batch] dispatch failed: %', SQLERRM;
    END;
  END LOOP;

  RETURN NULL;
END;
$fanout_batch$;

REVOKE ALL ON FUNCTION public.notify_push_fanout_batch() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notifications_push_fanout       ON public.notifications;
DROP TRIGGER IF EXISTS trg_notifications_push_fanout_batch ON public.notifications;

CREATE TRIGGER trg_notifications_push_fanout_batch
  AFTER INSERT ON public.notifications
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notify_push_fanout_batch();

-- ── 2. Gauntlet weekly activation: set-based fanout (was per-user loop) ──

CREATE OR REPLACE FUNCTION public.advance_weekly_gauntlet_statuses()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $advance_gauntlets$
DECLARE
  v_today          DATE := (now() AT TIME ZONE 'UTC')::date;
  v_gauntlet_id    UUID;
  v_gauntlet_title TEXT;
  v_count          INTEGER := 0;
BEGIN
  -- Close expired gauntlets first (no notification — passive).
  UPDATE public.weekly_gauntlets
     SET status = 'closed'
   WHERE status = 'active'
     AND week_end < v_today;

  -- Activate upcoming gauntlets whose window has begun. Usually 0 or 1
  -- per hour, so the outer loop stays; the per-user fanout inside is
  -- now ONE statement (dedup claim + localized notification insert),
  -- which the statement trigger above turns into chunked batch pushes.
  FOR v_gauntlet_id, v_gauntlet_title IN
    WITH activated AS (
      UPDATE public.weekly_gauntlets
         SET status = 'active'
       WHERE status = 'upcoming'
         AND week_start <= v_today
         AND week_end   >= v_today
       RETURNING id, title
    )
    SELECT id, title FROM activated
  LOOP
    v_count := v_count + 1;

    -- Eligibility mirrors the welcome_back cron in 037: active in the
    -- last 14 days, engagement pushes not opted out, auth row intact.
    -- The claimed CTE keeps the per-(user, gauntlet) dedup from 082:
    -- ON CONFLICT DO NOTHING means a retry of a partial run only
    -- notifies users the first run didn't reach.
    WITH eligible AS (
      SELECT id                                 AS notif_user_id,
             email                              AS notif_email,
             COALESCE(preferred_language, 'en') AS notif_lang
        FROM public.user_profiles
       WHERE email IS NOT NULL
         AND last_login_date IS NOT NULL
         AND last_login_date >= v_today - INTERVAL '14 days'
         AND (
               notification_prefs IS NULL
               OR (notification_prefs ->> 'engagement') IS NULL
               OR (notification_prefs ->> 'engagement') <> 'false'
             )
    ),
    claimed AS (
      INSERT INTO public.weekly_gauntlet_notifications (user_id, gauntlet_id)
      SELECT notif_user_id, v_gauntlet_id FROM eligible
      ON CONFLICT DO NOTHING
      RETURNING user_id AS claimed_user_id
    ),
    localized AS (
      SELECT notif_user_id,
             notif_email,
             public.weekly_gauntlet_started_text(notif_lang, v_gauntlet_title) AS notif_text
        FROM eligible
        JOIN claimed ON claimed_user_id = notif_user_id
    )
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT notif_user_id,
           notif_email,
           'weekly_gauntlet_started',
           notif_text ->> 'title',
           notif_text ->> 'body',
           '🏔️',
           '/gauntlet',
           jsonb_build_object('gauntlet_id',    v_gauntlet_id,
                              'gauntlet_title', v_gauntlet_title)
      FROM localized;
  END LOOP;

  RETURN v_count;
END;
$advance_gauntlets$;

REVOKE ALL ON FUNCTION public.advance_weekly_gauntlet_statuses() FROM PUBLIC;

-- ── 3. Crew-challenge fanouts: set-based (were per-member loops) ─────

CREATE OR REPLACE FUNCTION public.notify_crew_challenge_created_for(p_challenge_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $crew_chal_created$
DECLARE
  v_caller       UUID := auth.uid();
  v_chal_id      UUID;
  v_chal_crew_id UUID;
  v_chal_title   TEXT;
  v_chal_metric  TEXT;
  v_chal_target  INTEGER;
  v_chal_ends_at TIMESTAMPTZ;
  v_chal_creator UUID;
  v_crew_name    TEXT;
  v_count        INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'challenge_id required' USING ERRCODE = '22023';
  END IF;

  SELECT id, crew_id, title, metric, target_value, ends_at, created_by
    INTO v_chal_id, v_chal_crew_id, v_chal_title, v_chal_metric,
         v_chal_target, v_chal_ends_at, v_chal_creator
    FROM public.crew_challenges
   WHERE id = p_challenge_id;
  IF v_chal_id IS NULL THEN RETURN 0; END IF;

  -- Caller must be a member of this crew (creator is a stronger check;
  -- either is accepted so a co-admin can re-trigger after a partial
  -- failure — same posture as 104).
  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = v_chal_crew_id
       AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not a crew member' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_crew_name FROM public.crews WHERE id = v_chal_crew_id;

  -- Every member EXCEPT the creator, one INSERT statement.
  WITH member_rows AS (
    SELECT user_id AS member_user_id
      FROM public.crew_members
     WHERE crew_id = v_chal_crew_id
       AND user_id <> v_chal_creator
  ),
  recipient AS (
    SELECT id                                 AS notif_user_id,
           email                              AS notif_email,
           COALESCE(preferred_language, 'en') AS notif_lang
      FROM public.user_profiles
     WHERE email IS NOT NULL
       AND id IN (SELECT member_user_id FROM member_rows)
  ),
  localized AS (
    SELECT notif_user_id,
           notif_email,
           public.crew_challenge_created_text(notif_lang, v_chal_title, v_crew_name) AS notif_text
      FROM recipient
  ),
  inserted AS (
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT notif_user_id,
           notif_email,
           'crew_challenge_created',
           notif_text ->> 'title',
           notif_text ->> 'body',
           '🎯',
           '/hub',
           jsonb_build_object(
             'challenge_id', p_challenge_id,
             'crew_id',      v_chal_crew_id,
             'metric',       v_chal_metric,
             'target_value', v_chal_target,
             'ends_at',      v_chal_ends_at
           )
      FROM localized
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END;
$crew_chal_created$;

REVOKE ALL ON FUNCTION public.notify_crew_challenge_created_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_challenge_created_for(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_crew_challenge_completed_for(p_challenge_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $crew_chal_completed$
DECLARE
  v_caller       UUID := auth.uid();
  v_chal_id      UUID;
  v_chal_crew_id UUID;
  v_chal_title   TEXT;
  v_chal_metric  TEXT;
  v_chal_target  INTEGER;
  v_chal_status  TEXT;
  v_crew_name    TEXT;
  v_count        INT := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_challenge_id IS NULL THEN
    RAISE EXCEPTION 'challenge_id required' USING ERRCODE = '22023';
  END IF;

  SELECT id, crew_id, title, metric, target_value, status
    INTO v_chal_id, v_chal_crew_id, v_chal_title, v_chal_metric,
         v_chal_target, v_chal_status
    FROM public.crew_challenges
   WHERE id = p_challenge_id;
  IF v_chal_id IS NULL THEN RETURN 0; END IF;
  -- Only fan out for an actually-completed challenge — over-eager
  -- client retries are a no-op, not an error (same as 104).
  IF v_chal_status <> 'completed' THEN RETURN 0; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.crew_members
     WHERE crew_id = v_chal_crew_id
       AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'not a crew member' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_crew_name FROM public.crews WHERE id = v_chal_crew_id;

  -- Every member INCLUDING the creator — collective win, one statement.
  WITH member_rows AS (
    SELECT user_id AS member_user_id
      FROM public.crew_members
     WHERE crew_id = v_chal_crew_id
  ),
  recipient AS (
    SELECT id                                 AS notif_user_id,
           email                              AS notif_email,
           COALESCE(preferred_language, 'en') AS notif_lang
      FROM public.user_profiles
     WHERE email IS NOT NULL
       AND id IN (SELECT member_user_id FROM member_rows)
  ),
  localized AS (
    SELECT notif_user_id,
           notif_email,
           public.crew_challenge_completed_text(notif_lang, v_chal_title, v_crew_name) AS notif_text
      FROM recipient
  ),
  inserted AS (
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    SELECT notif_user_id,
           notif_email,
           'crew_challenge_completed',
           notif_text ->> 'title',
           notif_text ->> 'body',
           '🏆',
           '/hub',
           jsonb_build_object(
             'challenge_id', p_challenge_id,
             'crew_id',      v_chal_crew_id,
             'metric',       v_chal_metric,
             'target_value', v_chal_target
           )
      FROM localized
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;

  RETURN v_count;
END;
$crew_chal_completed$;

REVOKE ALL ON FUNCTION public.notify_crew_challenge_completed_for(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_challenge_completed_for(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
