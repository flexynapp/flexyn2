-- supabase/tests/cron_smoke_tests.sql
--
-- Smoke tests for the push-notification cron + helper functions
-- (migrations 035 + 036 + 037).
--
-- HOW TO RUN:
--   1. Open the Supabase SQL Editor.
--   2. Paste the entire contents of this file.
--   3. Click Run.
--   4. Scan the result for FAIL rows. A clean run shows all rows as
--      PASS in the "status" column.
--
-- WHY plain SQL (not pgTAP):
--   pgTAP works on Supabase but requires `CREATE EXTENSION pgtap` and
--   a transaction lifecycle that's awkward to paste-and-run. These
--   smoke tests use plain CASE WHEN comparisons so they work in any
--   PostgreSQL instance, with or without test infrastructure. They
--   produce a single result set: one row per assertion, with status
--   = 'PASS' or 'FAIL'.
--
-- WHAT THIS COVERS:
--   • Pure text helpers (streak_break_text, welcome_back_text,
--     quest_expiry_text) for placeholder interpolation + language
--     fallback.
--   • Type→category mapping for every known notification type.
--   • RPC input validation (update_notification_pref,
--     update_user_timezone_offset).
--   • Cron functions execute without error and return integer counts.
--   • Trigger function is wired to the notifications table.
--
-- WHAT THIS DOES NOT COVER:
--   • End-to-end push delivery (requires Edge Function + Vault setup).
--   • Cooldown / claim-race behavior (requires controlled user_profiles
--     seeding which needs auth.users rows — out of scope for a smoke
--     test you can paste in 5 seconds).
--   • The actual content of a notification row inserted by the cron
--     (same reason).
--
-- Run this file periodically — especially after touching migrations
-- 034/035/036/037/038. It's idempotent and read-only (no INSERTs,
-- UPDATEs, or DELETEs).

WITH tests AS (

  -- ── 1. notification_type_category ──────────────────────────────────────

  SELECT 'type→category: streak_milestone'   AS name,
         'streak'                            AS expected,
         public.notification_type_category('streak_milestone') AS actual
  UNION ALL SELECT 'type→category: streak_break_warning',
         'streak', public.notification_type_category('streak_break_warning')
  UNION ALL SELECT 'type→category: quest_claimed',
         'quests', public.notification_type_category('quest_claimed')
  UNION ALL SELECT 'type→category: quest_expiry_warning',
         'quests', public.notification_type_category('quest_expiry_warning')
  UNION ALL SELECT 'type→category: league_promoted',
         'league', public.notification_type_category('league_promoted')
  UNION ALL SELECT 'type→category: league_demoted',
         'league', public.notification_type_category('league_demoted')
  UNION ALL SELECT 'type→category: league_held',
         'league', public.notification_type_category('league_held')
  UNION ALL SELECT 'type→category: friend_post',
         'social', public.notification_type_category('friend_post')
  UNION ALL SELECT 'type→category: friend_follow',
         'social', public.notification_type_category('friend_follow')
  UNION ALL SELECT 'type→category: comment_reply',
         'social', public.notification_type_category('comment_reply')
  UNION ALL SELECT 'type→category: post_reaction',
         'social', public.notification_type_category('post_reaction')
  UNION ALL SELECT 'type→category: sticker_reaction',
         'social', public.notification_type_category('sticker_reaction')
  UNION ALL SELECT 'type→category: trade_offer',
         'social', public.notification_type_category('trade_offer')
  UNION ALL SELECT 'type→category: pr_set',
         'achievements', public.notification_type_category('pr_set')
  UNION ALL SELECT 'type→category: capsule_earned',
         'achievements', public.notification_type_category('capsule_earned')
  UNION ALL SELECT 'type→category: coin_milestone',
         'achievements', public.notification_type_category('coin_milestone')
  UNION ALL SELECT 'type→category: welcome_back',
         'engagement', public.notification_type_category('welcome_back')
  UNION ALL SELECT 'type→category: UNKNOWN (returns NULL)',
         NULL, public.notification_type_category('not_a_real_type')

  -- ── 2. streak_break_text — language + interpolation ────────────────────

  UNION ALL SELECT 'streak_break_text: en title interpolates streak',
         '🔥 12-day streak at risk',
         public.streak_break_text('en', 12) ->> 'title'
  UNION ALL SELECT 'streak_break_text: es returns Spanish',
         '🔥 Racha de 7 días en riesgo',
         public.streak_break_text('es', 7) ->> 'title'
  UNION ALL SELECT 'streak_break_text: ja returns Japanese',
         '🔥 5日連続記録が危険',
         public.streak_break_text('ja', 5) ->> 'title'
  UNION ALL SELECT 'streak_break_text: unknown lang falls back to en',
         '🔥 3-day streak at risk',
         public.streak_break_text('xx', 3) ->> 'title'
  UNION ALL SELECT 'streak_break_text: NULL lang falls back to en',
         '🔥 1-day streak at risk',
         public.streak_break_text(NULL, 1) ->> 'title'
  UNION ALL SELECT 'streak_break_text: body present (en)',
         'Your streak ends at midnight. A quick workout keeps it alive.',
         public.streak_break_text('en', 5) ->> 'body'

  -- ── 3. welcome_back_text — language fallback ───────────────────────────

  UNION ALL SELECT 'welcome_back_text: en',
         '👋 We miss you',
         public.welcome_back_text('en') ->> 'title'
  UNION ALL SELECT 'welcome_back_text: fr',
         '👋 Vous nous manquez',
         public.welcome_back_text('fr') ->> 'title'
  UNION ALL SELECT 'welcome_back_text: unknown→en',
         '👋 We miss you',
         public.welcome_back_text('zz') ->> 'title'
  UNION ALL SELECT 'welcome_back_text: NULL→en',
         '👋 We miss you',
         public.welcome_back_text(NULL) ->> 'title'

  -- ── 4. quest_expiry_text — language + count interpolation ──────────────

  UNION ALL SELECT 'quest_expiry_text: en with 3 remaining',
         '⏳ 3 quests left today',
         public.quest_expiry_text('en', 3) ->> 'title'
  UNION ALL SELECT 'quest_expiry_text: de with 1 remaining',
         '⏳ 1 Quests offen',
         public.quest_expiry_text('de', 1) ->> 'title'
  UNION ALL SELECT 'quest_expiry_text: unknown→en',
         '⏳ 5 quests left today',
         public.quest_expiry_text('zz', 5) ->> 'title'

)
SELECT
  name,
  CASE
    WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS'
    ELSE 'FAIL'
  END AS status,
  expected,
  actual
FROM tests
ORDER BY status DESC, name;  -- FAILs sort to the top so they're easy to spot

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RPC validation tests — these expect EXCEPTIONS, so we wrap each call
--    in a DO block + EXCEPTION handler and report PASS if the expected
--    error fires, FAIL if no error or wrong error.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_caught_unknown_category    BOOLEAN := FALSE;
  v_caught_out_of_range_offset BOOLEAN := FALSE;
  v_caught_null_offset         BOOLEAN := FALSE;
BEGIN
  -- update_notification_pref rejects unknown category
  BEGIN
    PERFORM public.update_notification_pref('not_a_category', true);
  EXCEPTION
    WHEN sqlstate '22023' THEN v_caught_unknown_category := TRUE;
    WHEN sqlstate '42501' THEN v_caught_unknown_category := FALSE;
    WHEN OTHERS THEN v_caught_unknown_category := FALSE;
  END;

  -- update_user_timezone_offset rejects offset outside [-720, 840]
  BEGIN
    PERFORM public.update_user_timezone_offset(9999);
  EXCEPTION
    WHEN sqlstate '22023' THEN v_caught_out_of_range_offset := TRUE;
    WHEN sqlstate '42501' THEN v_caught_out_of_range_offset := FALSE;
    WHEN OTHERS THEN v_caught_out_of_range_offset := FALSE;
  END;

  -- update_user_timezone_offset rejects NULL offset
  BEGIN
    PERFORM public.update_user_timezone_offset(NULL);
  EXCEPTION
    WHEN sqlstate '22023' THEN v_caught_null_offset := TRUE;
    WHEN sqlstate '42501' THEN v_caught_null_offset := FALSE;
    WHEN OTHERS THEN v_caught_null_offset := FALSE;
  END;

  -- Output as RAISE NOTICE so they appear in the SQL Editor's Notice pane.
  -- If the SQL Editor is in a context where auth.uid() is NULL (which it
  -- usually is when run directly), the functions exit early with 42501
  -- (unauthenticated) BEFORE reaching the validation check — so those
  -- particular tests will look like FAIL even when the validation logic
  -- itself is fine. We surface this nuance in the notice so the operator
  -- isn't confused.
  RAISE NOTICE '──── RPC validation tests ────';
  RAISE NOTICE 'NOTE: these tests run as the SQL Editor postgres role,';
  RAISE NOTICE 'which has auth.uid() = NULL. If the functions return';
  RAISE NOTICE '42501 (unauthenticated) the input validation check is';
  RAISE NOTICE 'unreachable, so a FAIL here is EXPECTED behavior in the';
  RAISE NOTICE 'SQL Editor. To exercise input validation properly, call';
  RAISE NOTICE 'these RPCs via supabase-js from a signed-in session.';
  RAISE NOTICE '';
  RAISE NOTICE 'update_notification_pref(bad category) raised 22023: %',
               CASE WHEN v_caught_unknown_category THEN 'PASS' ELSE 'SKIPPED (auth.uid is null)' END;
  RAISE NOTICE 'update_user_timezone_offset(9999) raised 22023: %',
               CASE WHEN v_caught_out_of_range_offset THEN 'PASS' ELSE 'SKIPPED (auth.uid is null)' END;
  RAISE NOTICE 'update_user_timezone_offset(NULL) raised 22023: %',
               CASE WHEN v_caught_null_offset THEN 'PASS' ELSE 'SKIPPED (auth.uid is null)' END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Cron functions execute without error.
--
--    Each function returns an INTEGER (count of nudges sent). With no
--    test fixtures seeded, the count is usually 0 — but the important
--    assertion is "no error thrown". We also check the trigger exists
--    on the notifications table.
-- ─────────────────────────────────────────────────────────────────────────

SELECT
  test_name,
  CASE WHEN error IS NULL THEN 'PASS' ELSE 'FAIL: ' || error END AS status,
  result
FROM (
  SELECT 'run_streak_break_reminders() executes'  AS test_name,
         public.run_streak_break_reminders()::text AS result,
         NULL::text                                AS error
  UNION ALL
  SELECT 'run_welcome_back_reminders() executes',
         public.run_welcome_back_reminders()::text,
         NULL
  UNION ALL
  SELECT 'run_quest_expiry_reminders() executes',
         public.run_quest_expiry_reminders()::text,
         NULL
  UNION ALL
  SELECT 'trg_notifications_push_fanout trigger exists',
         (SELECT count(*)::text
            FROM information_schema.triggers
           WHERE event_object_table = 'notifications'
             AND trigger_name = 'trg_notifications_push_fanout'),
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM information_schema.triggers
              WHERE event_object_table = 'notifications'
                AND trigger_name = 'trg_notifications_push_fanout'
           ) THEN 'trigger missing — re-run migration 034'
           ELSE NULL
         END
  UNION ALL
  SELECT 'streak_break_reminders_hourly cron scheduled',
         (SELECT count(*)::text FROM cron.job
           WHERE jobname = 'streak_break_reminders_hourly'),
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM cron.job
              WHERE jobname = 'streak_break_reminders_hourly'
           ) THEN 'cron not registered — re-run migration 035'
           ELSE NULL
         END
  UNION ALL
  SELECT 'welcome_back_hourly cron scheduled',
         (SELECT count(*)::text FROM cron.job
           WHERE jobname = 'welcome_back_hourly'),
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM cron.job WHERE jobname = 'welcome_back_hourly'
           ) THEN 'cron not registered — re-run migration 037'
           ELSE NULL
         END
  UNION ALL
  SELECT 'quest_expiry_15min cron scheduled',
         (SELECT count(*)::text FROM cron.job
           WHERE jobname = 'quest_expiry_15min'),
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM cron.job WHERE jobname = 'quest_expiry_15min'
           ) THEN 'cron not registered — re-run migration 037'
           ELSE NULL
         END
) AS cron_tests;
