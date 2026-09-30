-- "We miss you" at most twice per absence.
--
-- run_welcome_back_reminders sent one every 5 days for as long as someone
-- had been away 3 to 30 days: up to six per absence. Measured 2026-09-30:
-- 181 rows across 36 people, 23 of them ever opened (13%). Past the second
-- one it is noise, and a push people learn to ignore is a push they turn
-- off, taking the useful ones with it.
--
-- Now: the first one on day 3 of an absence, one more once the absence
-- reaches 10 days, then nothing until they come back. No new column is
-- needed, because the last send and the last login already say which of
-- the two has gone out:
--   * nothing sent since the last login   -> the first is due
--   * the first went before day 10        -> the second is due at day 10
--   * a send on or after day 10           -> both have gone out
-- The 5-day spacing guard stays as a floor.
--
-- Everything else is the installed body, read with pg_get_functiondef on
-- 2026-09-30, unchanged.

CREATE OR REPLACE FUNCTION public.run_welcome_back_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now   TIMESTAMPTZ := now();
  v_count INTEGER := 0;
  v_row   RECORD;
  v_text  JSONB;
BEGIN
  FOR v_row IN
    UPDATE public.user_profiles AS p
       SET last_welcome_back_at = v_now
     WHERE p.timezone_offset_minutes IS NOT NULL
       AND p.last_login_date IS NOT NULL
       AND p.last_login_date <= (v_now AT TIME ZONE 'UTC')::date - INTERVAL '3 days'
       AND p.last_login_date >  (v_now AT TIME ZONE 'UTC')::date - INTERVAL '30 days'
       AND (p.last_welcome_back_at IS NULL OR p.last_welcome_back_at < v_now - INTERVAL '5 days')
       AND (
             -- first of this absence
             p.last_welcome_back_at IS NULL
          OR (p.last_welcome_back_at AT TIME ZONE 'UTC')::date <= p.last_login_date
             -- second, once the absence reaches 10 days
          OR (p.last_login_date <= (v_now AT TIME ZONE 'UTC')::date - INTERVAL '10 days'
              AND (p.last_welcome_back_at AT TIME ZONE 'UTC')::date < p.last_login_date + 10)
           )
       AND (p.notification_prefs IS NULL
            OR (p.notification_prefs ->> 'engagement') IS NULL
            OR (p.notification_prefs ->> 'engagement') <> 'false')
       AND EXTRACT(HOUR FROM (v_now + (p.timezone_offset_minutes || ' minutes')::interval) AT TIME ZONE 'UTC')
           BETWEEN 18 AND 20
    RETURNING p.id AS user_id, p.email AS user_email, p.preferred_language
  LOOP
    IF v_row.user_email IS NULL THEN CONTINUE; END IF;
    v_text := public.welcome_back_text(COALESCE(v_row.preferred_language, 'en'));
    INSERT INTO public.notifications
      (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES
      (v_row.user_id, v_row.user_email, 'welcome_back',
       v_text ->> 'title', v_text ->> 'body', '👋', '/dashboard', '{}'::jsonb);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- The cron calls this as its owner; nobody else should be able to fire it.
REVOKE ALL ON FUNCTION public.run_welcome_back_reminders() FROM PUBLIC, anon, authenticated;
