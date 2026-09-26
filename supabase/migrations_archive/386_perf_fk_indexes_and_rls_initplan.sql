-- 386_perf_fk_indexes_and_rls_initplan.sql
--
-- Performance pass from the Supabase performance advisor (read 2026-09-24),
-- done before launch traffic rather than after.
--
-- 1. 19 foreign keys with no covering index. Deletes on the parent table (a
--    user deleting their account cascades through all of these) and joins
--    on the child column seq-scan without one.
-- 2. 15 RLS policies that call auth.uid() bare, which Postgres re-evaluates
--    per ROW. Wrapping it as (SELECT auth.uid()) makes it an initplan that
--    runs once per statement. Same value, same meaning. The expressions below
--    were copied from pg_policies on production, not from the migrations that
--    created them, and only the auth.uid() calls change.
--    ALTER POLICY keeps each policy's roles and command as they are.
--
-- Deliberately NOT done:
--  * The 61 "unused index" findings. With 2 weekly actives almost every index
--    is unused; that measures traffic, not usefulness. Revisit after launch.
--  * The 78 "multiple permissive policies" findings. Merging policies is an
--    RLS rewrite and needs the seeded before/after proof CLAUDE.md asks for.
--    None of the hot tables (workout_logs, hub_posts, notifications) are in
--    the initplan list, so the payoff today is small either way.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS, and ALTER POLICY can be re-run.
-- Paste-safe: bare columns and public.fn() calls only.

-- ── 1. Foreign-key indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS crew_bans_banned_by_idx                 ON public.crew_bans (banned_by);
CREATE INDEX IF NOT EXISTS crew_bans_user_id_idx                   ON public.crew_bans (user_id);
CREATE INDEX IF NOT EXISTS crew_challenge_contributions_user_id_idx ON public.crew_challenge_contributions (user_id);
CREATE INDEX IF NOT EXISTS crew_challenges_template_key_idx        ON public.crew_challenges (template_key);
CREATE INDEX IF NOT EXISTS crew_invites_invited_by_idx             ON public.crew_invites (invited_by);
CREATE INDEX IF NOT EXISTS crew_invites_invited_user_id_idx        ON public.crew_invites (invited_user_id);
CREATE INDEX IF NOT EXISTS crew_join_requests_decided_by_idx       ON public.crew_join_requests (decided_by);
CREATE INDEX IF NOT EXISTS crew_join_requests_user_id_idx          ON public.crew_join_requests (user_id);
CREATE INDEX IF NOT EXISTS crew_perk_purchases_bought_by_idx       ON public.crew_perk_purchases (bought_by);
CREATE INDEX IF NOT EXISTS crew_perk_purchases_perk_key_idx        ON public.crew_perk_purchases (perk_key);
CREATE INDEX IF NOT EXISTS crew_season_stats_crew_id_idx           ON public.crew_season_stats (crew_id);
CREATE INDEX IF NOT EXISTS crew_treasury_ledger_actor_user_id_idx  ON public.crew_treasury_ledger (actor_user_id);
CREATE INDEX IF NOT EXISTS equipment_models_submitted_by_idx       ON public.equipment_models (submitted_by);
CREATE INDEX IF NOT EXISTS equipment_photos_uploaded_by_idx        ON public.equipment_photos (uploaded_by);
CREATE INDEX IF NOT EXISTS food_item_requests_requester_user_id_idx ON public.food_item_requests (requester_user_id);
CREATE INDEX IF NOT EXISTS space_equipment_added_by_idx            ON public.space_equipment (added_by);
CREATE INDEX IF NOT EXISTS space_equipment_model_id_idx            ON public.space_equipment (model_id);
CREATE INDEX IF NOT EXISTS training_spaces_gym_id_idx              ON public.training_spaces (gym_id);
CREATE INDEX IF NOT EXISTS user_mutes_muted_id_idx                 ON public.user_mutes (muted_id);

-- ── 2. auth.uid() once per statement, not once per row ───────────────────
ALTER POLICY "food_item_requests_insert_own" ON public.food_item_requests
  WITH CHECK (requester_user_id = (SELECT auth.uid()));
ALTER POLICY "food_item_requests_select_own" ON public.food_item_requests
  USING (requester_user_id = (SELECT auth.uid()));

ALTER POLICY "crew_challenges: admins insert" ON public.crew_challenges
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.is_crew_moderator(crew_id));

ALTER POLICY "Users read own scheduled workouts" ON public.scheduled_workouts
  USING (user_id = (SELECT auth.uid()));
ALTER POLICY "Users update own scheduled workouts" ON public.scheduled_workouts
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
ALTER POLICY "Users delete own scheduled workouts" ON public.scheduled_workouts
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "crew_messages_delete" ON public.crew_messages
  USING (sender_id = (SELECT auth.uid()) OR public.is_crew_moderator(crew_id));

ALTER POLICY "gym_rival_rival_read" ON public.gym_rival_assignments
  USING (rival_id = (SELECT auth.uid()));

ALTER POLICY "coach_chat_quota_select_own" ON public.coach_chat_quota
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "gym_feed_comments: author or moderator delete" ON public.gym_feed_comments
  USING (author_id = (SELECT auth.uid()) OR public.can_moderate_gym_comment(post_id));

ALTER POLICY "gym_feed: author or gym owner delete" ON public.gym_feed_posts
  USING (author_id = (SELECT auth.uid()) OR public.is_gym_owner(gym_id));

ALTER POLICY "user_quest_stats_select_own" ON public.user_quest_stats
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "crew_join_requests: read" ON public.crew_join_requests
  USING (user_id = (SELECT auth.uid()) OR public.is_crew_admin(crew_id));

ALTER POLICY "crew_invites: read" ON public.crew_invites
  USING (invited_user_id = (SELECT auth.uid()) OR public.is_crew_admin(crew_id));

ALTER POLICY "trades: parties can view own offers" ON public.trade_offers
  USING (from_user_id = (SELECT auth.uid()) OR to_user_id = (SELECT auth.uid()));

-- Check: expect 19 new indexes and 0 policies left calling auth.uid() bare.
SELECT
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
     'crew_bans_banned_by_idx','crew_bans_user_id_idx','crew_challenge_contributions_user_id_idx',
     'crew_challenges_template_key_idx','crew_invites_invited_by_idx','crew_invites_invited_user_id_idx',
     'crew_join_requests_decided_by_idx','crew_join_requests_user_id_idx','crew_perk_purchases_bought_by_idx',
     'crew_perk_purchases_perk_key_idx','crew_season_stats_crew_id_idx','crew_treasury_ledger_actor_user_id_idx',
     'equipment_models_submitted_by_idx','equipment_photos_uploaded_by_idx','food_item_requests_requester_user_id_idx',
     'space_equipment_added_by_idx','space_equipment_model_id_idx','training_spaces_gym_id_idx','user_mutes_muted_id_idx'
  )) AS fk_indexes_present,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname IN (
     'food_item_requests_insert_own','food_item_requests_select_own','crew_challenges: admins insert',
     'Users read own scheduled workouts','Users update own scheduled workouts','Users delete own scheduled workouts',
     'crew_messages_delete','gym_rival_rival_read','coach_chat_quota_select_own',
     'gym_feed_comments: author or moderator delete','gym_feed: author or gym owner delete',
     'user_quest_stats_select_own','crew_join_requests: read','crew_invites: read','trades: parties can view own offers')
   AND (coalesce(qual,'') ~ 'auth\.uid\(\)' AND coalesce(qual,'') !~ 'SELECT auth\.uid\(\)'
        OR coalesce(with_check,'') ~ 'auth\.uid\(\)' AND coalesce(with_check,'') !~ 'SELECT auth\.uid\(\)')
  ) AS policies_still_per_row;
