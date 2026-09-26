-- 204_function_search_path_hardening.sql
--
-- Defense-in-depth: pin an explicit search_path on the 51 functions the
-- Supabase linter flagged as "function_search_path_mutable". Without a fixed
-- search_path a function resolves unqualified names against the caller's
-- search_path, so if an attacker can create an object in an earlier schema on
-- that path they can shadow a real table/function the function relies on. All
-- of these already qualify most references, but pinning search_path closes the
-- gap uniformly. No behavioural change — same schema resolution these already
-- assume ('public' then 'pg_catalog').
--
-- Applied with ALTER FUNCTION ... SET search_path (not CREATE OR REPLACE) so
-- the function bodies are untouched.

ALTER FUNCTION public._tg_sync_league_member_count() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public._weighted_pick(keys text[], weights numeric[]) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.bounty_beaten_text(p_language text, p_claimant text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.bounty_claim_text(p_language text, p_claimant text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.bump_regimen_review_updated_at() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.comment_reply_text(p_language text, p_commenter text, p_snippet text, p_is_reply boolean) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.crew_challenge_completed_text(p_language text, p_challenge_title text, p_crew_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.crew_challenge_created_text(p_language text, p_challenge_title text, p_crew_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.crew_war_resolved_text(p_language text, p_opponent text, p_outcome text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.crew_war_started_text(p_language text, p_opponent text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.dm_received_text(p_language text, p_sender_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.duel_invite_text(p_language text, p_challenger text, p_duel_type text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.duel_result_text(p_language text, p_opponent text, p_outcome text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_bio_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_comment_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_crew_message_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_crew_name_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_custom_quote_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_custom_quotes_cap() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_gym_feed_comment_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_gym_feed_post_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_gym_text_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_message_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_org_challenge_title_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_organization_name_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_post_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_trainer_listing_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.enforce_username_profanity() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.friend_follow_text(p_language text, p_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.friend_post_text(p_language text, p_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.generate_referral_code() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.gym_event_rsvp_count_sync() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.gym_feed_comment_count_sync() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.gym_feed_rxn_count_sync() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.gym_members_count_sync() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.is_bio_clean(p_bio text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.is_text_clean(p_text text, p_strict boolean) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.is_username_clean(p_username text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.league_resolution_text(p_language text, p_outcome text, p_from_tier text, p_to_tier text, p_coins integer, p_capsule text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.memory_reengagement_text(p_language text, p_years_ago integer, p_top_lift text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.nemesis_assigned_text(p_language text, p_nemesis_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.nemesis_overthrown_text(p_language text, p_dethroned_name text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.notification_type_category(p_type text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.quest_expiry_text(p_language text, p_remaining integer) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.report_resolution_text(p_language text, p_status text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.streak_break_text(p_language text, p_streak integer) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.sync_cardio_type() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.sync_reaction_fields() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.trainer_listing_stats_sync() SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.weekly_gauntlet_started_text(p_language text, p_title text) SET search_path TO 'public', 'pg_catalog';
ALTER FUNCTION public.welcome_back_text(p_language text) SET search_path TO 'public', 'pg_catalog';
