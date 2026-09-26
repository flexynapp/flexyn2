-- Migration 187: add covering indexes for unindexed foreign keys (performance)
--
-- The Supabase performance advisor flags 65 foreign keys with no covering
-- index. Without one, every lookup/join on the FK column does a sequential
-- scan, and — more importantly here — every cascade DELETE on the parent
-- must seq-scan the child table. Account deletion cascades across ~30 of
-- these tables, so this directly speeds up that flow (and per-user reads on
-- workout_logs / nutrition_logs / hub_* etc.).
--
-- All single-column, all IF NOT EXISTS (idempotent), no behavioral change.
-- Names + columns generated from the live prod schema (verified). At the
-- current data volume each build is instant; for very large tables later,
-- prefer CREATE INDEX CONCURRENTLY (cannot run in a txn) to avoid locks.

CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements (user_id);
CREATE INDEX IF NOT EXISTS idx_body_metrics_user_id ON body_metrics (user_id);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reporter_user_id ON bug_reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_cardio_logs_user_id ON cardio_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_assigned_regimens_assigned_by ON crew_assigned_regimens (assigned_by);
CREATE INDEX IF NOT EXISTS idx_crew_assigned_regimens_regimen_id ON crew_assigned_regimens (regimen_id);
CREATE INDEX IF NOT EXISTS idx_crew_challenges_created_by ON crew_challenges (created_by);
CREATE INDEX IF NOT EXISTS idx_crew_members_user_id ON crew_members (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_message_reactions_user_id ON crew_message_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_messages_sender_id ON crew_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_crew_war_contributions_crew_id ON crew_war_contributions (crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_wars_winner_crew_id ON crew_wars (winner_crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_xp_claims_user_id ON crew_xp_claims (user_id);
CREATE INDEX IF NOT EXISTS idx_crews_created_by ON crews (created_by);
CREATE INDEX IF NOT EXISTS idx_dm_message_reactions_user_id ON dm_message_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_dm_poll_votes_user_id ON dm_poll_votes (user_id);
CREATE INDEX IF NOT EXISTS idx_duels_winner_id ON duels (winner_id);
CREATE INDEX IF NOT EXISTS idx_exercise_forms_user_id ON exercise_forms (user_id);
CREATE INDEX IF NOT EXISTS idx_exercise_groups_user_id ON exercise_groups (user_id);
CREATE INDEX IF NOT EXISTS idx_food_items_user_id ON food_items (user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user_id ON goals (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_checkins_gym_id ON gym_checkins (gym_id);
CREATE INDEX IF NOT EXISTS idx_gym_event_rsvps_user_id ON gym_event_rsvps (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_events_created_by ON gym_events (created_by);
CREATE INDEX IF NOT EXISTS idx_gym_feed_comments_parent_id ON gym_feed_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_comments_author_id ON gym_feed_comments (author_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_post_reactions_user_id ON gym_feed_post_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_gym_feed_posts_author_id ON gym_feed_posts (author_id);
CREATE INDEX IF NOT EXISTS idx_gym_verification_queue_reviewed_by ON gym_verification_queue (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_hub_comment_likes_comment_id ON hub_comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS idx_hub_comment_likes_user_id ON hub_comment_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_comments_parent_comment_id ON hub_comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_hub_comments_user_id ON hub_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_conversations_user_id ON hub_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_follows_user_id ON hub_follows (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_replied_to_message_id ON hub_messages (replied_to_message_id);
CREATE INDEX IF NOT EXISTS idx_hub_messages_user_id ON hub_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_posts_user_id ON hub_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_reactions_user_id ON hub_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_hub_reports_reporter_user_id ON hub_reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_injury_logs_user_id ON injury_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_bundles_seller_user_id ON marketplace_bundles (seller_user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_wishlist_listing_id ON marketplace_wishlist (listing_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_id ON nutrition_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_organization_challenges_created_by ON organization_challenges (created_by);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations (owner_id);
CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_claimed_by_id ON pending_duel_invites (claimed_by_id);
CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_resulting_duel_id ON pending_duel_invites (resulting_duel_id);
CREATE INDEX IF NOT EXISTS idx_planned_cardio_completed_cardio_id ON planned_cardio (completed_cardio_id);
CREATE INDEX IF NOT EXISTS idx_post_sticker_reactions_user_id ON post_sticker_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_regimen_reviews_reviewer_id ON regimen_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_regimens_user_id ON regimens (user_id);
CREATE INDEX IF NOT EXISTS idx_roll_call_responses_user_id ON roll_call_responses (user_id);
CREATE INDEX IF NOT EXISTS idx_status_note_likes_liker_id ON status_note_likes (liker_id);
CREATE INDEX IF NOT EXISTS idx_status_notes_user_id ON status_notes (user_id);
CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories (user_id);
CREATE INDEX IF NOT EXISTS idx_stories_crew_id ON stories (crew_id);
CREATE INDEX IF NOT EXISTS idx_story_highlight_items_story_id ON story_highlight_items (story_id);
CREATE INDEX IF NOT EXISTS idx_story_poll_votes_voter_id ON story_poll_votes (voter_id);
CREATE INDEX IF NOT EXISTS idx_story_reactions_user_id ON story_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_trainer_listings_regimen_id ON trainer_listings (regimen_id);
CREATE INDEX IF NOT EXISTS idx_trainer_purchases_regimen_id ON trainer_purchases (regimen_id);
CREATE INDEX IF NOT EXISTS idx_user_gauntlet_completions_challenge_id ON user_gauntlet_completions (challenge_id);
CREATE INDEX IF NOT EXISTS idx_weekly_gauntlet_notifications_gauntlet_id ON weekly_gauntlet_notifications (gauntlet_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_user_id ON workout_templates (user_id);

NOTIFY pgrst, 'reload schema';
