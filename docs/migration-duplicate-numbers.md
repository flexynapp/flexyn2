# Duplicate migration numbers — audit

Convention (per CLAUDE.md): files at the same `NNN` are tolerated when
their bodies touch disjoint database objects. This file records the
**17 disjoint groups · 0 groups need follow-up**

audit per duplicate group so a future contributor can verify nothing
conflicts.

## 054 (2 files)
- `054_bio_profanity_check.sql`
  - touches: public.enforce_bio_profanity, public.is_bio_clean
- `054_duels.sql`
  - touches: duels_challenger_idx, duels_opponent_idx, duels_participants, duels_status_idx, public.duels
  ✓ disjoint — safe to coexist at this number

## 055 (2 files)
- `055_crew_wars.sql`
  - touches: crew_war_contrib_own, crew_war_contrib_read, crew_war_contrib_user_idx, crew_war_contrib_war_idx, crew_wars_crew_a_idx, crew_wars_crew_b_idx
- `055_first_workout_capsule_flag.sql`
  - touches: public.user_profiles
  ✓ disjoint — safe to coexist at this number

## 064 (2 files)
- `064_dm_reactions_reply_lastactive.sql`
  - touches: dm_message_reactions, dm_rxns_delete, dm_rxns_insert, dm_rxns_select, hub_messages, idx_dm_msg_rxns_msg
- `064_security_definer_search_path.sql`
  ✓ disjoint — safe to coexist at this number

## 065 (2 files)
- `065_crew_features.sql`
  - touches: authenticated, crew, crew_assigned_regimens, crew_members, crew_messages, crew_war_contributions_war_user_idx
- `065_duel_notifications.sql`
  - touches: public.duel_invite_text, public.duel_result_text, public.notification_type_category, public.notify_duel_invite_for, public.notify_duel_result_for
  ✓ disjoint — safe to coexist at this number

## 102 (2 files)
- `102_content_profanity_checks.sql`
  - touches: public.enforce_comment_profanity, public.enforce_crew_name_profanity, public.enforce_message_profanity, public.enforce_post_profanity, public.is_text_clean
- `102_nemesis_overthrown_category.sql`
  - touches: public.notification_type_category
  ✓ disjoint — safe to coexist at this number

## 103 (2 files)
- `103_hub_social_features.sql`
  - touches: get_people_you_may_know, hub_posts, idx_hub_posts_hashtags, idx_hub_posts_original_post_id, idx_hub_posts_publish_at, use
- `103_moderator_reports.sql`
  - touches: public.delete_reported_content, public.is_app_admin, public.list_reports_for_admin, public.resolve_report
  ✓ disjoint — safe to coexist at this number

## 104 (2 files)
- `104_crew_challenge_notifications.sql`
  - touches: public.crew_challenge_completed_text, public.crew_challenge_created_text, public.notification_type_category, public.notify_crew_challenge_completed_for, public.notify_crew_challenge_created_for
- `104_report_resolution_notifications.sql`
  - touches: public.notify_report_resolved, public.report_resolution_text
  ✓ disjoint — safe to coexist at this number

## 111 (3 files)
- `111_hub_content_expansion.sql`
  - touches: hub_live_sessions, hub_live_sessions_host_write, hub_live_sessions_read, hub_post_views, hub_post_views_insert, hub_post_views_select
- `111_nemesis_overthrown_i18n.sql`
  - touches: public.nemesis_overthrown_text, public.notify_nemesis_overthrown_for
- `111_story_overlays.sql`
  - touches: public.stories
  ✓ disjoint — safe to coexist at this number

## 112 (2 files)
- `112_increment_overthrow_count.sql`
  - touches: public.increment_overthrow_count
- `112_story_poll_votes.sql`
  - touches: idx_story_poll_votes_story, public.cast_story_poll_vote, public.story_poll_results, public.story_poll_votes, story_poll_votes
  ✓ disjoint — safe to coexist at this number

## 117 (2 files)
- `117_cardio_expansion.sql`
  - touches: cardio_logs, cardio_templates, cardio_templates_own, planned_cardio, planned_cardio_own
- `117_privacy_mode.sql`
  - touches: idx_user_profiles_search_visible, public.user_profiles
  ✓ disjoint — safe to coexist at this number

## 141 (2 files)
- `141_gym_integrity_fixes.sql`
  - touches: gym_events, gym_feed_rxn, public.get_gym_leaderboard, public.toggle_gym_feed_reaction, public.toggle_pin_gym_post
- `141_hub_security_exploits.sql`
  - touches: hub_messages, public.mark_message_read, public.schedule_my_message, public.toggle_crew_reaction, public.toggle_dm_reaction
  ✓ disjoint — safe to coexist at this number

## 142 (3 files)
- `142_public_profiles_and_gym_leaderboard.sql`
  - touches: public, public.get_gym_vs_gym_leaderboard, public.gym_businesses, public.gym_members
- `142_user_profiles_privileged_columns.sql`
  - touches: public.user_profiles_block_privileged_updates, users
- `142_workout_idempotency_reconcile_and_bar_volume.sql`
  - touches: public.mark_workout_volume_credited, public.reconcile_my_workout_volume, public.user_profiles, public.workout_logs, workout_logs_uncredited_idx
  ✓ disjoint — safe to coexist at this number

## 144 (2 files)
- `144_bio_and_dm_polls.sql`
  - touches: dm_poll_votes, dm_poll_votes_poll_idx, dm_polls, dm_polls_conversation_idx, dm_polls_creator_idx, public.cast_dm_poll_vote
- `144_bug_report_admin_pipeline.sql`
  - touches: bug_reports_status_idx, public.bug_reports, public.list_bug_reports_for_admin, public.resolve_bug_report
  ✓ disjoint — safe to coexist at this number

## 149 (2 files)
- `149_gym_checkins.sql`
  - touches: gym_checkins, gym_checkins_user_date_idx, public.check_in_to_gym, public.gym_checkins, public.has_gym_checkin_today
- `149_live_activity_rail_email_column.sql`
  - touches: public.get_active_followees
  ✓ disjoint — safe to coexist at this number

## 150 (2 files)
- `150_gym_approval_geo_optional.sql`
  - touches: public.approve_gym_verification, public.gym_businesses
- `150_gym_consistency_leaderboard.sql`
  - touches: public.get_gym_consistency_leaderboard
  ✓ disjoint — safe to coexist at this number

## 165 (2 files)
- `165_daily_flexyn_drop.sql`
  - touches: branded_items, idx_user_branded_items_user_id, public.purchase_branded_item, public.user_branded_items
- `165_journal_mood_score.sql`
  - touches: journal_entries
  ✓ disjoint — safe to coexist at this number

## 166 (2 files)
- `166_duel_expiry_cron.sql`
- `166_layout_defaults.sql`
  - touches: layout_defaults, public.app_layout_defaults, public.is_layout_admin, public.set_layout_default
  ✓ disjoint — safe to coexist at this number
