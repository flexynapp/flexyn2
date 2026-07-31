-- 274_push_fanout_reads_vault_again.sql
--
-- Make push fanout read its URL and secret from the Vault again, so it
-- actually dispatches. Push has never sent a single request.
--
-- ── What was really wrong ────────────────────────────────────────────
--
-- CLAUDE.md has carried this open bug: "the fanout's one recorded HTTP
-- call 404s, pointing at a bad send_push_url", with a suggested fix of
-- vault.update_secret(). Both halves of that are wrong, and measuring it
-- rather than re-reading it is what showed why.
--
-- 1. THE 404 IS NOT PUSH. `net._http_response` holds exactly one row,
--    status 404, timestamped 2026-07-26 20:00:00.24, with the body
--    {"code":"NOT_FOUND","message":"Requested function was not found"}.
--    Cron job 5 runs `0 20 * * 0` — Sundays at 20:00 — and posts to
--    /functions/v1/generateWeeklyDebriefs. 2026-07-26 was a Sunday, and
--    the deployed function list is send-push, recognize-meal, storage-gc:
--    there is no generateWeeklyDebriefs. That is the Weekly Debriefs
--    follow-up CLAUDE.md already lists as unbuilt, firing weekly against
--    an endpoint that doesn't exist. It has nothing to do with push.
--    (CLAUDE.md asserted "every net.http_post caller in the applied
--    migrations is push-related, so that 404 can't be attributed to
--    another feature". Job 5 is a raw cron command, not a migration
--    function body, which is why that sweep missed it.)
--
-- 2. THE VAULT URL IS CORRECT, AND NEVER READ. The stored value is
--    https://<ref>.functions.supabase.co/send-push — the exact form
--    CLAUDE.md verified returns 401 (function exists, auth required),
--    not the underscore variant that 404s. Updating it would change
--    nothing, because the installed function does not look at it.
--
-- The actual defect: migration 080 taught the fanout to read
-- vault.decrypted_secrets, and migrations 098 and 127 later redefined the
-- function from the pre-080 template, silently reverting it to
-- `current_setting('app.send_push_url', true)`. Managed Supabase blocks
-- `ALTER DATABASE … SET`, which is the whole reason mig 038 moved these
-- into the Vault, so those GUCs are NULL — confirmed in a live session,
-- both read back NULL. The function therefore hits its "secrets missing"
-- guard and returns before dispatching, every single time.
--
-- That guard is deliberately silent (mig 034) so partial deploys don't
-- break notification inserts, so this failed invisibly: in-app rows kept
-- landing, `net._http_response` stayed empty of push traffic, and nothing
-- anywhere raised. It also explains why push looked "deployed but not
-- delivering" — there was never a request to deliver.
--
-- ── The fix ──────────────────────────────────────────────────────────
--
-- Restore mig 080's read order in both fanout functions: Vault first,
-- falling back to the GUCs so a self-hosted or legacy host that does set
-- them still works. Everything else in both bodies is unchanged —
-- category prefs, snooze, quiet hours, and the batch chunking at 200.
--
-- NOTE: only `trg_notifications_push_fanout_batch` (STATEMENT level) is
-- currently attached to `notifications`. `notify_push_fanout` is the
-- row-level variant, live in earlier revisions and left in place; both
-- are fixed so re-attaching either is safe.
--
-- Idempotent: CREATE OR REPLACE only, no trigger changes.

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_body     JSONB;
  v_category TEXT;
  v_prefs    JSONB;
  v_quiet    BOOLEAN;
  v_snoozed  BOOLEAN;
BEGIN
  -- Vault first (mig 038/080), GUCs only as a fallback.
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'send_push_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'send_push_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  IF v_url IS NULL OR v_url = '' THEN
    BEGIN v_url := current_setting('app.send_push_url', true);
    EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    BEGIN v_secret := current_setting('app.send_push_secret', true);
    EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

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

  IF v_category IS NOT NULL THEN
    BEGIN
      v_snoozed := public.is_category_snoozed(NEW.user_id, v_category);
      IF v_snoozed THEN RETURN NEW; END IF;
    EXCEPTION WHEN undefined_function THEN NULL;
    WHEN OTHERS THEN NULL;
    END;
  END IF;

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
        'Content-Type',       'application/json',
        'X-Send-Push-Secret', v_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_fanout] dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.notify_push_fanout_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_chunk  JSONB;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'send_push_url' LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'send_push_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  IF v_url IS NULL OR v_url = '' THEN
    BEGIN v_url := current_setting('app.send_push_url', true);
    EXCEPTION WHEN OTHERS THEN v_url := NULL; END;
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    BEGIN v_secret := current_setting('app.send_push_secret', true);
    EXCEPTION WHEN OTHERS THEN v_secret := NULL; END;
  END IF;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NULL;
  END IF;

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
$function$;

-- Should now report true for both.
SELECT proname,
       pg_get_functiondef(oid) LIKE '%decrypted_secrets%' AS reads_vault
  FROM pg_proc
 WHERE proname IN ('notify_push_fanout', 'notify_push_fanout_batch')
 ORDER BY proname;
