-- 218_index_unindexed_fks.sql
-- (renumbered from 216 to avoid collision with 216_hub_conversations_
--  participant_ids_backfill.sql, which landed on main first.)
--
-- Performance: add covering indexes for the 65 foreign keys the Supabase
-- advisor flagged as unindexed (unindexed_foreign_keys). An FK with no index
-- on its referencing column forces a sequential scan on cascade deletes and on
-- joins/filters by that column — most of these are user_id / author_id / *_id
-- columns the app filters on constantly.
--
-- Explicit statements (not catalog-driven) so the migration is paste-safe:
-- every line is CREATE INDEX ... ON public.<table> (<bare column>), no joins,
-- no alias.column tokens. All IF NOT EXISTS, so it is idempotent and safe to
-- re-run. On the current near-empty pre-launch DB each build is instant.

CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON public.achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_body_metrics_user_id ON public.body_metrics (user_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter_user_id ON public.bug_reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_cardio_logs_user_id ON public.cardio_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_assigned_regimens_assigned_by ON public.crew_assigned_regimens (assigned_by);
CREATE INDEX IF NOT EXISTS idx_crew_assigned_regimens_regimen_id ON public.crew_assigned_regimens (regimen_id);
CREATE INDEX IF NOT EXISTS idx_crew_challenges_created_by ON public.crew_challenges (created_by);
CREATE INDEX IF NOT EXISTS idx_crew_members_user_id ON public.crew_members (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_message_reactions_user_id ON public.crew_message_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_messages_sender_id ON public.crew_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_crew_war_contributions_crew_id ON public.crew_war_contributions (crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_wars_winner_crew_id ON public.crew_wars (winner_crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_xp_claims_user_id ON public.crew_xp_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON public.crews (created_by);
CREATE INDEX IF NOT EXISTS idx_dm_message_reactions_user_id ON public.dm_message_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_dm_poll_votes_user_id ON public.dm_poll_votes (user_id);
CREATE INDEX IF NOT EXISTS idx_duels_winner_id ON public.duels (winner_id);
CREATE INDEX IF NOT EXISTS idx_exercise_forms_user_id ON public.exercise_forms (user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_groups_user_id ON public.exercise_groups (user_id);
CREATE INDEX IF NOT EXISTS idx_food_items_user_id ON public.food_items (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_checkins_gym_id ON public.gym_checkins (gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_event_rsvps_user_id ON public.gym_event_rsvps (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_events_created_by ON public.gym_events (created_by);
CREATE INDEX IF NOT EXISTS idx_gym_feed_comments_author_id ON public.gym_feed_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_comments_parent_id ON public.gym_feed_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_post_reactions_user_id ON public.gym_feed_post_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_posts_author_id ON public.gym_feed_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_gym_verification_queue_reviewed_by ON public.gym_verification_queue (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_hub_comment_likes_comment_id ON public.hub_comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS idx_hub_comment_likes_user_id ON public.hub_comment_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_comments_parent_comment_id ON public.hub_comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_hub_comments_user_id ON public.hub_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_conversations_user_id ON public.hub_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_follows_user_id ON public.hub_follows (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_replied_to_message_id ON public.hub_messages (replied_to_message_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_user_id ON public.hub_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_posts_user_id ON public.hub_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_reactions_user_id ON public.hub_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_reports_reporter_user_id ON public.hub_reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_injury_logs_user_id ON public.injury_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_bundles_seller_user_id ON public.marketplace_bundles (seller_user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_wishlist_listing_id ON public.marketplace_wishlist (listing_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_id ON public.nutrition_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_organization_challenges_created_by ON public.organization_challenges (created_by);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON public.organizations (owner_id);
CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_claimed_by_id ON public.pending_duel_invites (claimed_by_id);
CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_resulting_duel_id ON public.pending_duel_invites (resulting_duel_id);
CREATE INDEX IF NOT EXISTS idx_planned_cardio_completed_cardio_id ON public.planned_cardio (completed_cardio_id);
CREATE INDEX IF NOT EXISTS idx_post_sticker_reactions_user_id ON public.post_sticker_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_regimen_reviews_reviewer_id ON public.regimen_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_regimens_user_id ON public.regimens (user_id);
CREATE INDEX IF NOT EXISTS idx_roll_call_responses_user_id ON public.roll_call_responses (user_id);
CREATE INDEX IF NOT EXISTS idx_status_note_likes_liker_id ON public.status_note_likes (liker_id);
CREATE INDEX IF NOT EXISTS idx_status_notes_user_id ON public.status_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_stories_crew_id ON public.stories (crew_id);
CREATE INDEX IF NOT EXISTS idx_stories_user_id ON public.stories (user_id);
CREATE INDEX IF NOT EXISTS idx_story_highlight_items_story_id ON public.story_highlight_items (story_id);
CREATE INDEX IF NOT EXISTS idx_story_poll_votes_voter_id ON public.story_poll_votes (voter_id);
CREATE INDEX IF NOT EXISTS idx_story_reactions_user_id ON public.story_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_trainer_listings_regimen_id ON public.trainer_listings (regimen_id);
CREATE INDEX IF NOT EXISTS idx_trainer_purchases_regimen_id ON public.trainer_purchases (regimen_id);
CREATE INDEX IF NOT EXISTS idx_user_gauntlet_completions_challenge_id ON public.user_gauntlet_completions (challenge_id);
CREATE INDEX IF NOT EXISTS idx_weekly_gauntlet_notifications_gauntlet_id ON public.weekly_gauntlet_notifications (gauntlet_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_user_id ON public.workout_templates (user_id);
