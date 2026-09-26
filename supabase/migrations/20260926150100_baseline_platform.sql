-- Baseline, part 2 of 3: what `supabase db dump` leaves out.
--
-- The schema dump (part 1) covers the public schema. Production also
-- depends on objects that live in Supabase-managed schemas or are stored
-- as rows, and a fresh database (a preview branch) has none of them:
--
--   1. The trigger on auth.users that creates a profile row at sign-up.
--   2. The two storage buckets and the policies on storage.objects.
--   3. The pg_cron schedule (21 jobs).
--
-- Copied from production on 2026-09-26 (cron.job, pg_policies,
-- storage.buckets, pg_get_triggerdef). Production already has all of it;
-- this file is recorded there as applied, not run.
--
-- Everything here is written to be safe to run twice.

-- 1. Profile row on sign-up -------------------------------------------------

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Storage ------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('progress-photos', 'progress-photos', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp']),
  ('uploads', 'uploads', true, 52428800,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic',
         'image/heif','image/avif','video/mp4','video/quicktime','video/webm'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "progress-photos: owner delete" ON storage.objects;
CREATE POLICY "progress-photos: owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "progress-photos: owner insert" ON storage.objects;
CREATE POLICY "progress-photos: owner insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "progress-photos: owner read" ON storage.objects;
CREATE POLICY "progress-photos: owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "progress-photos: owner update" ON storage.objects;
CREATE POLICY "progress-photos: owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- Copied exactly as production has it, including the anon branch
-- (auth.uid() IS NULL). That branch lets a signed-out caller upload to any
-- path in this public bucket; it is tracked as a separate fix, not changed
-- in a baseline whose job is to match production.
DROP POLICY IF EXISTS "uploads: authenticated users can upload" ON storage.objects;
CREATE POLICY "uploads: authenticated users can upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'uploads' AND ((auth.uid() IS NULL) OR (storage.foldername(name))[1] = (auth.uid())::text));

DROP POLICY IF EXISTS "uploads: read own objects" ON storage.objects;
CREATE POLICY "uploads: read own objects" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text);

DROP POLICY IF EXISTS "uploads: users can delete own files" ON storage.objects;
CREATE POLICY "uploads: users can delete own files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS "uploads: users can update own files" ON storage.objects;
CREATE POLICY "uploads: users can update own files" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'uploads' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- 3. Scheduled jobs -----------------------------------------------------------
-- cron.schedule(name, …) replaces a job of the same name, so this is
-- idempotent. On a preview branch the jobs that call Edge Functions find no
-- Vault secrets and return early by design (see CLAUDE.md, push section).

SELECT cron.schedule('streak_break_reminders_hourly',  '0 * * * *',    $$SELECT public.run_streak_break_reminders();$$);
SELECT cron.schedule('welcome_back_hourly',            '0 * * * *',    $$SELECT public.run_welcome_back_reminders();$$);
SELECT cron.schedule('quest_expiry_15min',             '*/15 * * * *', $$SELECT public.run_quest_expiry_reminders();$$);
SELECT cron.schedule('weekly_gauntlet_advance_hourly', '7 * * * *',    $$SELECT public.advance_weekly_gauntlet_statuses();$$);
SELECT cron.schedule('memory_reengagement_hourly',     '19 * * * *',   $$SELECT public.dispatch_memory_reengagement();$$);
SELECT cron.schedule('release-scheduled-messages',     '* * * * *',    $$SELECT public.release_scheduled_messages();$$);
SELECT cron.schedule('expire-overdue-duels',           '*/15 * * * *', $$
    UPDATE public.duels
    SET    status = 'expired'
    WHERE  status IN ('pending', 'active')
      AND  expires_at IS NOT NULL
      AND  expires_at < NOW();
$$);
SELECT cron.schedule('sweep-expired-bounties',         '*/30 * * * *', $$SELECT public.sweep_expired_bounties();$$);
SELECT cron.schedule('gym-rival-settle',               '5 0 * * 1',    $$SELECT public.gym_rival_settle_week();$$);
SELECT cron.schedule('gym-rival-afk-void',             '0 */6 * * *',  $$SELECT public.gym_rival_void_stale_all();$$);
SELECT cron.schedule('purge_expired_stories',          '*/15 * * * *', $$SELECT public.purge_expired_stories();$$);
SELECT cron.schedule('storage_gc_kick',                '*/5 * * * *',  $$SELECT public.kick_storage_gc();$$);
SELECT cron.schedule('resolve-crew-wars',              '*/15 * * * *', $$SELECT public.resolve_due_crew_wars();$$);
SELECT cron.schedule('roll-crew-seasons',              '20 3 * * *',   $$SELECT public.roll_crew_seasons();$$);
SELECT cron.schedule('recompute-crew-wars',            '10 * * * *',   $$SELECT public.recompute_active_crew_wars();$$);
SELECT cron.schedule('scheduled-workout-reminders',    '5 * * * *',    $$SELECT public.fire_scheduled_workout_reminders();$$);
SELECT cron.schedule('guest_account_sweep',            '0 4 * * *',    $$SELECT public.sweep_stale_guest_accounts(7, 200);$$);
SELECT cron.schedule('roll-weekly-leagues',            '10 0 * * 1',   $$SELECT public.roll_weekly_leagues();$$);
SELECT cron.schedule('roll-league-seasons',            '40 3 * * *',   $$SELECT public.roll_league_seasons();$$);
SELECT cron.schedule('weekly-reviews-generator',       '0 20 * * 0',   $$SELECT public.kick_weekly_reviews();$$);
SELECT cron.schedule('ops-collect-alerts',             '50 * * * *',   $$SELECT public.ops_collect_alerts();$$);
