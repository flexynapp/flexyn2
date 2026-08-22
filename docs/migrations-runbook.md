# Migrations Runbook

Every SQL migration that lives in `supabase/migrations/`, in execution
order, with a one-line description and a callout for any that need
follow-up (Vault secrets, Edge Function deploy, etc.). All migrations
are idempotent — re-running is safe.

If you're staring at a Supabase project and don't know what's deployed,
run the **State check** query at the bottom of this file and compare.

---

## How to apply a migration

Every migration in this repo is plain SQL designed for the **Supabase
SQL Editor**. No CLI required.

1. Open Supabase dashboard → SQL Editor → New query.
2. Paste the contents of the migration file (or a multi-migration paste
   block — see [`docs/push-notifications-setup.md`](push-notifications-setup.md)
   for an example).
3. Click **Run**.
4. Verify with the state-check query below.

---

## Migration catalog

Purposes below 055 are hand-written; the rest are lifted from each
migration's own header comment, so they carry that file's framing rather
than a summary of it. **Follow-up needed?** flags only migrations that
depend on config living outside `supabase/migrations/` — specifically ones
touching `vault` — because replaying the SQL alone leaves those wired to a
dead endpoint. See
[Migrations that need no SQL](#migrations-that-need-no-sql--what-they-do-need).

| # | File | Purpose | Follow-up needed? |
|---|---|---|---|
| 001 | `001_initial_schema.sql` | Bootstrap: `user_profiles`, RLS policies, public-profile read | — |
| 002 | `002_user_profile_columns.sql` | Add missing profile columns (onboarding, fitness goals, etc.) | — |
| 003 | `003_grant_permissions.sql` | Grant Supabase role table privileges | — |
| 004 | `004_schema_patches.sql` | Post-migration schema fixes from the Base44 → Supabase port | — |
| 005 | `005_missing_columns.sql` | Critical columns missed in 002 (weight_lbs, height_inches, etc.) | — |
| 006 | `006_data_integrity.sql` | Foreign-key + CHECK-constraint hardening | — |
| 007 | `007_reports.sql` | Content-reports + bug-reports tables | — |
| 008 | `008_storage_bucket.sql` | `uploads` Supabase Storage bucket for avatars/meal photos | — |
| 009 | `009_loot_system.sql` | Loot capsules, inventory, marketplace tables | — |
| 010 | `010_sticker_variants.sql` | `variant` column on `user_inventory` (sticker rarity) | — |
| 011 | `011_fix_sticker_reactions_and_message_rls.sql` | RLS hardening on `hub_messages` + sticker reactions | — |
| 012 | `012_hub_messages_attachment.sql` | `attachment_url` column on `hub_messages` (DM image sharing) | — |
| 013 | `013_onboarding_timestamp.sql` | `onboarding_completed_at` timestamp | — |
| 014 | `014_gamification.sql` | Daily quests + login streak tables | — |
| 015 | `015_sticker_reactions_avatar.sql` | Denormalize avatar/name onto `post_sticker_reactions` | — |
| 016 | `016_leagues_workout_streak.sql` | Weekly leagues + workout-streak tracking | — |
| 017 | `017_notifications.sql` | In-app notifications table + RLS | — |
| 018 | `018_bump_upload_size.sql` | Storage bucket per-file limit → 50 MB | — |
| 019 | `019_titles_and_frames.sql` | Profile titles + frames loot types | — |
| 020 | `020_fix_league_members_rls.sql` | Fix infinite RLS recursion on `league_members` | — |
| 021 | `021_loot_theme_id.sql` | `loot_theme_id` column for equipped themes | — |
| 022 | `022_achievement_milestone_capsules.sql` | Track achievement-milestone capsule grants | — |
| 023 | `023_atomic_volume_distance.sql` | Atomic counter RPCs (replace client read-modify-write) | — |
| 024 | `024_atomic_post_reaction.sql` | Atomic post-reaction state transition | — |
| 025 | `025_marketplace_atomic_purchase.sql` | Marketplace concurrency hardening | — |
| 026 | `026_notifications_harden.sql` | Cross-user `create_notification_for` RPC with type allowlist | — |
| 027 | `027_leagues_atomic.sql` | League join/leave/resolve concurrency fixes | — |
| 028 | `028_server_capsule_roll.sql` | Server-side capsule roll (closes loot-forgery exploit) | — |
| 029 | `029_validate_sticker_reaction.sql` | Block sticker-reaction forgery via SECURITY DEFINER RPC | — |
| 030 | `030_goal_complete_atomic.sql` | Atomic goal-completion + `increment_flex_coins` RPC | — |
| 031 | `031_coin_shop_purchase.sql` | Atomic coin-shop purchase RPC | — |
| 032 | `032_volume_distance_allow_negative.sql` | Allow negative deltas in the volume/distance counters | — |
| 033 | `033_push_subscriptions.sql` | Web Push subscription table + idempotent upsert RPC | — |
| 034 | `034_notification_push_trigger.sql` | AFTER INSERT trigger on `notifications` → pg_net → send-push Edge Function | **Vault + Edge Function** |
| 035 | `035_streak_break_reminders.sql` | Hourly cron + `streak_break_text` server-side i18n (15 languages); timezone columns | — |
| 036 | `036_notification_prefs_and_language.sql` | Per-category `notification_prefs` JSONB + `notification_type_category` helper + `update_notification_pref` RPC | — |
| 037 | `037_welcome_back_and_quest_crons.sql` | Welcome-back (hourly) + quest-expiry (every 15 min) crons + their text helpers | — |
| 038 | `038_push_secrets_via_vault.sql` | Re-point trigger at Supabase Vault (managed-Postgres compatibility) | **Vault secrets** |
| 039 | `039_notifications_delete_policy.sql` | DELETE RLS policy on `notifications` (unblocks trash/clear-all in UI) | — |
| 040 | `040_league_resolution_i18n.sql` | `league_resolution_text` + `notify_league_resolution_for` RPC (15 languages × 3 outcomes) | — |
| 041 | `041_friend_notifications_i18n.sql` | `friend_post_text` + `friend_follow_text` + matching RPCs (per-recipient i18n) | — |
| 042 | `042_security_hardening.sql` | Real security + dep-fragility fixes (the hardening pass) | — |
| 043 | `043_stories.sql` | 24-hour Photo Stories: `stories` + `story_views` tables + RLS policies | — |
| 044 | `044_story_likes.sql` | `story_likes` table (❤️ reactions on stories) + RLS | — |
| 045 | `045_story_media.sql` | Add `overlay_text` + `media_type` columns to `stories` | — |
| 046 | `046_story_dms.sql` | `story_dms_disabled` on `user_profiles` + `overlay_style` JSONB on `stories` | — |
| 047 | `047_story_enhancements.sql` | 25h expiry, privacy, `story_blocks`, `status_notes`, `status_note_likes` | — |
| 048 | `048_crews.sql` | Crews group chat: 5 tables + 2 SECURITY DEFINER RPCs (`is_crew_member`, `is_crew_admin`) | — |
| 049 | `049_profile_extensions.sql` | Add `city`, `country_flag`, `trophy_case` (JSONB), `trophy_case_visible` to `user_profiles` | — |
| 050 | `050_username_profanity_check.sql` | `is_username_clean()` function + `enforce_username_profanity` trigger on `user_profiles.username` (raises 23514 on banned content) | — |
| 051 | `051_weekly_debriefs.sql` | `weekly_debriefs` table + RLS policies (auto-populated by a Sunday cron — needs the `generateWeeklyDebriefs` Edge Function + `app.debrief_func_url` + `app.debrief_cron_secret` DB settings to actually generate data) | **Edge Function + DB settings** |
| 052 | `052_injury_logs.sql` | `injury_logs` table for Recovery Mode + RLS | — |
| 053 | `053_exercise_groups.sql` | `exercise_groups` table for superset/circuit metadata + RLS | — |
| 054 | `054_bio_profanity_check.sql` | `is_bio_clean()` function + `enforce_bio_profanity` trigger on `user_profiles.bio` (mirrors 050 for the second user-visible free-text field; raises 23514 on banned content) | — |
| 054 | `054_duels.sql` | Workout Duels: challenger vs opponent, three duel types. | — |
| 055 | `055_crew_wars.sql` | Crew Wars: weekly crew vs crew XP competitions. | — |
| 055 | `055_first_workout_capsule_flag.sql` | Adds the idempotency flag for the day-1 loot drop introduced alongside the welcome-capsule discoverability work. | — |
| 056 | `056_nemesis.sql` | Nemesis System: auto-assigned rival slightly above the user's level. | — |
| 057 | `057_prestige.sql` | Prestige System: max-level reset with permanent status symbols. | — |
| 058 | `058_crew_wars_rls_fix.sql` | Fix crew_wars RLS: add insert/update policies so crew members can enter matchmaking and update scores from the client. | — |
| 059 | `059_bounties.sql` | Bounty System: auto-generated social challenges with Flex Coin rewards. | — |
| 060 | `060_gauntlet.sql` | Gauntlet Path: 10-challenge linear progression + weekly community gauntlet. | — |
| 061 | `061_weekly_debrief_rpc.sql` | Generate_my_weekly_debrief: SECURITY DEFINER RPC that computes and upserts a user's weekly debrief from workout_logs + nutrition_logs. | — |
| 062 | `062_chat_pinning.sql` | Adds is_pinned flag to both hub_messages (DMs) and crew_messages (Crew chats). | — |
| 063 | `063_notifications.sql` | 063_notifications.sql (corrected) In-app notifications for three social events. | — |
| 064 | `064_dm_reactions_reply_lastactive.sql` | DM emoji reactions, inline reply columns, last_active_at | — |
| 064 | `064_security_definer_search_path.sql` | Harden SECURITY DEFINER helpers with explicit search_path SECURITY DEFINER functions run with the privileges of their owner (typically the database superuser created by Supabase). | — |
| 065 | `065_crew_features.sql` | Crew batch: discovery, announcements, shared plans, stats, war visibility, roles (moderator), and crew-private posts. | — |
| 065 | `065_duel_notifications.sql` | Wires Duels into the existing notifications + push pipeline. | — |
| 066 | `066_audit_fixes_rls_indexes.sql` | Three quick-win fixes surfaced by a security + perf audit: 1. | — |
| 067 | `067_league_rewards_atomic.sql` | Atomic, server-side league reward distribution. | — |
| 068 | `068_atomic_claims.sql` | Closes two CRITICAL economic-integrity bugs surfaced by the marketplace audit: 1. | — |
| 069 | `069_competitive_notifications.sql` | Wires the remaining competitive features into the existing notifications + push pipeline. | — |
| 070 | `070_atomic_capsule_grants.sql` | Closes three CRITICAL economic bugs from the capsules audit: 1. | — |
| 071 | `071_atomic_achievement_milestones.sql` | Closes the last capsule-audit race: grantForAchievementMilestone in src/lib/data/capsules.js inserted capsules one-at-a-time, then bumped user_profiles.milestone_capsules_awarded by the number inserted in a SECOND statement. | — |
| 072 | `072_external_duel_invites.sql` | "Challenge a friend who isn't on Flexyn yet" — the viral wedge for the Duels system. | — |
| 073 | `073_audit_schema_fixes.sql` | Consolidated schema-level fixes from the 4-surface audit pass: Onboarding (1 CRITICAL, 2 HIGH), Stories (1 CRITICAL, 2 HIGH), plus a couple of MEDIUMs. | — |
| 074 | `074_fix_finalize_capsule_column.sql` | Two corrections to migration 070's atomic capsule grants: 1. | — |
| 075 | `075_security_and_concurrency_fixes.sql` | Three fixes from the cross-app bug audit: 1. | — |
| 076 | `076_crew_war_contribute_atomic.sql` | Closes a HIGH race surfaced by the cross-app audit. | — |
| 077 | `077_atomic_post_counter.sql` | Closes the read-modify-write race in src/lib/data/hubPosts.js incrementCounter, called from every like / unlike / comment add / comment delete: const post = await get(postId); const next = Math.max(0,… | — |
| 078 | `078_atomic_cancel_listing.sql` | Closes a real orphan-inventory bug in src/components/hub/MarketplaceFeed.jsx: await marketplace.cancelListing(listing.id); // sets status=cancelled await inventory.setListed(listing.inventory_id, fals… | — |
| 079 | `079_atomic_duel_submit.sql` | Closes a HIGH race in src/lib/data/duels.js submitDuelResult. | — |
| 080 | `080_push_fanout_fix.sql` | Two production bugs in the Web Push fanout pipeline, discovered while bringing up the first live deploy. | **Vault config** |
| 081 | `081_nemesis_notifications_i18n.sql` | Server-side i18n + SECURITY DEFINER RPC for the "Meet your nemesis" notification fired when a user gets a new rival assigned. | — |
| 082 | `082_gauntlet_weekly_reset_cron.sql` | Weekly Gauntlet lifecycle management + push notification for new weeks. | — |
| 083 | `083_notification_category_unification.sql` | Unifies and repairs the notification_type_category mapping that has drifted across migrations 036 → 065 → 069 → 081 → 082. | — |
| 084 | `084_fix_sticker_reactions_column_types.sql` | Production-only schema drift fix for public.post_sticker_reactions. | — |
| 085 | `085_service_role_grants_audit.sql` | Grants service_role table-level DML on every RLS-enabled public table that's missing it. | — |
| 086 | `086_comment_reply_notifications_i18n.sql` | Wires hub comments + replies into the notification/push pipeline. | — |
| 087 | `087_streak_rescue.sql` | One-tap streak rescue. Migration 035 already pushes a "your streak is about to break" notification in the user's local 18-21h window when a 2+ day streak is at risk. | — |
| 088 | `088_live_activity.sql` | Strava-style "live activity" presence. | — |
| 089 | `089_referrals.sql` | Invite-a-friend referral system. | — |
| 090 | `090_crew_discovery.sql` | Surfaces "suggested crews" — non-full crews the caller is not yet a member of, sorted by member count descending. | — |
| 091 | `091_follow_suggestions.sql` | Surfaces "suggested follows" — popular active users the caller isn't yet following. | — |
| 092 | `092_memory_reengagement.sql` | Server-side memory finder + push trigger for the "you trained on this day N years ago — hit it again?" re-engagement nudge. | — |
| 093 | `093_friend_leaderboards.sql` | Server-side weekly leaderboard scoped to the caller's mutual follows. | — |
| 094 | `094_cardio_hr_zones.sql` | Extends cardio_logs with HR-zone time-in-zone tracking. | — |
| 095 | `095_sleep_tracking.sql` | New domain: sleep + perceived-recovery tracking. | — |
| 096 | `096_mood_logs.sql` | Daily mood tracker. Single-emoji choice (😩😐🙂😄🔥) stored as an integer 1-5 with optional notes. | — |
| 097 | `097_story_reactions.sql` | Emoji reactions on stories. | — |
| 098 | `098_a_tier_batch.sql` | Batches several A-tier additions into a single migration: • Quiet-hours preference on user_profiles + gating in the notification push trigger (A12) • is_template flag on regimens to mark canonical bui… | — |
| 099 | `099_story_highlights.sql` | Story Highlights — pinned "best of" stories that live permanently on a user's profile beyond the normal 24-hour story TTL. | — |
| 100 | `100_quiet_hours_timezone_fix.sql` | HOTFIX: migration 098's is_in_quiet_hours() function references a column named `timezone_offset` on user_profiles. | — |
| 101 | `101_audit_fix_batch.sql` | HOTFIX batch for three column/function-name bugs of the SAME class as the timezone_offset bug fixed in migration 100. | — |
| 102 | `102_content_profanity_checks.sql` | Server-side enforcement of profanity rules across user-generated text surfaces. | — |
| 102 | `102_nemesis_overthrown_category.sql` | Wires the new `nemesis_overthrown` notification type (emitted by src/lib/data/nemesis.js performOverthrow) into the notification_type_category() mapping. | — |
| 103 | `103_hub_social_features.sql` | Migration 103: Hub social features Adds: post editing (edited_at), post scheduling (publish_at), repost mechanism (original_post_id), hashtag arrays (hashtags), website_url on user_profiles, and PYMK helper function. | — |
| 103 | `103_moderator_reports.sql` | Moderator-side RPCs for resolving content reports filed via the existing hub_reports table (migration 007). | — |
| 104 | `104_crew_challenge_notifications.sql` | Wires push notifications for crew_challenges (added in migration 098). | — |
| 104 | `104_report_resolution_notifications.sql` | Close the loop with the user who filed a report. | — |
| 105 | `105_post_content_warnings.sql` | Add content-warning ("CW") support to hub_posts. | — |
| 106 | `106_general_user_blocks.sql` | General-purpose user-block table. | — |
| 107 | `107_user_mutes.sql` | Soft "mute" for the Hub feed — hides a user's posts from your feed without breaking any other surface. | — |
| 108 | `108_pymk_auth_gate.sql` | Fix a privacy leak in get_people_you_may_know (mig 103_hub_social_features). | — |
| 109 | `109_block_user_full_column_fix.sql` | CRITICAL BUG FIX for mig 106_general_user_blocks. | — |
| 110 | `110_moderator_rpcs_search_path.sql` | Hardening fix for mig 103_moderator_reports. | — |
| 111 | `111_hub_content_expansion.sql` | Hub content expansion Adds: video posts, saved posts, creator analytics (post views), live workout sessions, poll votes timeline, collaborator posts. | — |
| 111 | `111_nemesis_overthrown_i18n.sql` | FIX: the nemesis_overthrown notification I shipped earlier this session (mig 102 + nemesis.js performOverthrow change) bypassed the server-side i18n pattern every other competitive notification uses. | — |
| 111 | `111_story_overlays.sql` | Persistent overlays on stories — extends the composer past a single text overlay (the StoryPreviewSheet's current state) into a multi- overlay model that supports text, owned stickers, and emoji. | — |
| 112 | `112_increment_overthrow_count.sql` | Audit finding: the performOverthrow flow in src/lib/data/nemesis.js has been silently failing to increment user_profiles.overthrow_count since the feature shipped (mig 056). | — |
| 112 | `112_story_poll_votes.sql` | Backing table for poll-overlay voting on stories. | — |
| 113 | `113_message_requests.sql` | Conversation acceptance flag for the new "Message Requests" inbox. | — |
| 114 | `114_dm_delete_and_schedule.sql` | Two additions to hub_messages backing 18b: • deleted_at timestamptz — soft-delete by sender. | — |
| 115 | `115_dm_rich_media.sql` | Adds rich-media columns to hub_messages for batch 18c: • message_type TEXT — 'text' \| 'sticker' \| 'gif' \| 'voice' \| etc. | — |
| 116 | `116_group_conversations.sql` | Group DMs. hub_conversations.participant_emails is already a text[] (mig 001) and the RLS policy uses `auth.email() = any(...)`, so the table already supports N-participant threads. | — |
| 117 | `117_cardio_expansion.sql` | Cardio feature expansion: heart rate, cadence, power, swim tracking, named routes, VO2max, cardio templates, and planned cardio scheduling. | — |
| 117 | `117_privacy_mode.sql` | Two opt-in privacy controls on user_profiles: • is_private — when TRUE, only followers see the profile page content (level, regimens, workouts, progress photos). | — |
| 118 | `118_regimen_reviews.sql` | Star-rating + review system for public regimens. | — |
| 119 | `119_marketplace_sold_counts.sql` | "Sold X times" counter for marketplace listings. | — |
| 120 | `120_regimen_difficulty.sql` | Add a difficulty tag to regimens so the community store can filter by skill level. | — |
| 121 | `121_marketplace_wishlist.sql` | "Save for later" on marketplace listings. | — |
| 122 | `122_marketplace_featured.sql` | Editorial "Featured this week" slot on marketplace listings. | — |
| 123 | `123_nutrition_recipes_plans.sql` | Three additive nutrition features: • nutrition_recipes — user-built multi-ingredient meals saved as a single loggable item. | — |
| 124 | `124_coin_gifting.sql` | Peer-to-peer flex-coin gifting. | — |
| 125 | `125_period_leaderboard.sql` | Adds get_period_leaderboard(p_board, p_period, p_limit) — top-N users by workout volume / XP / sessions over a time window. | — |
| 126 | `126_emoji_reactions.sql` | Arbitrary-emoji reactions on hub posts. | — |
| 127 | `127_notification_snooze.sql` | Per-category notification snooze. | — |
| 128 | `128_cycle_tracking.sql` | Period / cycle tracking. Strictly opt-in (off by default), private to the owner (RLS), no friends/crew sharing. | — |
| 129 | `129_fitness_assessment.sql` | 4-question fitness self-assessment captured in onboarding. | — |
| 130 | `130_crew_message_reactions.sql` | Formalises the crew_message_reactions table that CrewMessageItem.jsx already references (with a graceful try/catch in case it didn't exist). | — |
| 131 | `131_seasonal_shop_items.sql` | Adds availability windows to marketplace_listings so admins can create limited-time or seasonal items that appear / disappear automatically. | — |
| 132 | `132_monthly_leagues.sql` | Monthly league track — mirrors the weekly leagues schema but at calendar-month grain. | — |
| 133 | `133_body_metrics_measurements.sql` | Adds circumference measurement columns to body_metrics so the onboarding body-baseline step and Progress tab can store waist / chest / hip alongside the existing weight + body-fat. | — |
| 134 | `134_bundle_deals.sql` | Bundle deals: a seller can group marketplace listings into a named bundle and offer a percentage discount when a buyer purchases all items together. | — |
| 135 | `135_gym_businesses.sql` | Gym Business Accounts foundation. | — |
| 136 | `136_gym_member_notifications.sql` | Notify the gym owner when someone joins their gym. | — |
| 137 | `137_gym_demo_seed_and_polish.sql` | "Make sure the map shows something" — seeds 25 demonstration gyms across the major US metros so the national map renders alive from the moment the migrations land, instead of staring at a blank continent waiting for real owners to sign up. | — |
| 138 | `138_gym_feed_social.sql` | "Social home page" for each gym. | — |
| 139 | `139_gym_event_rsvps.sql` | Event RSVPs. Three statuses: 'going' \| 'maybe' \| 'cant'. | — |
| 140 | `140_gym_about_fields.sql` | "About" surface for a gym: weekly hours, amenity list, and a small photo gallery beyond the single cover image. | — |
| 141 | `141_gym_integrity_fixes.sql` | Hardens gym social/competition surfaces against the defects surfaced in the May 2026 QA audit. | — |
| 141 | `141_hub_security_exploits.sql` | Supabase/migrations/141_hub_security_exploits.sql Closes four exploits surfaced by the Hub security audit, all of the same class as the Block bug fixed in mig 109: SECURITY DEFINER RPCs and an over-br… | — |
| 142 | `142_public_profiles_and_gym_leaderboard.sql` | Three additions that power the viral public surfaces: 1. | — |
| 142 | `142_user_profiles_privileged_columns.sql` | Supabase/migrations/142_user_profiles_privileged_columns.sql Closes a CRITICAL exploit found in the Onboarding security audit: the user_profiles UPDATE policy from mig 001 has `USING (auth.uid() = id)` but NO `WITH CHECK` clause. | — |
| 142 | `142_workout_idempotency_reconcile_and_bar_volume.sql` | Three workout-tab integrity upgrades surfaced by the May 2026 zero-tolerance audit: C-2: Idempotency key on workout_logs. | — |
| 143 | `143_trainer_tier.sql` | Proprietary Creator / Trainer Tier — paywalled regimen marketplace. | — |
| 144 | `144_bio_and_dm_polls.sql` | Two additions that support the audit fixes shipped in this session: 1. | — |
| 144 | `144_bug_report_admin_pipeline.sql` | Re-pipes the bug-report flow so admin-filed user bug reports actually reach the moderator queue. | — |
| 145 | `145_journal_entries.sql` | "My Journal" overhaul — moves the journal from a localStorage-only textarea to a server-backed entry per day so it survives sign-out, syncs across devices, and can hold a title + markdown body + attachments. | — |
| 146 | `146_corporate_wellness.sql` | Corporate Wellness Portal — a B2B org tenant layered over the existing gamification stack. | — |
| 147 | `147_critical_security_and_correctness_fixes.sql` | Five fixes for issues surfaced in the 2026-05-25 overnight audit (see audit-findings/02-rpc-auth-gating.md and 03-migrations-143-146.md). | — |
| 148 | `148_rls_gaps_blocking_user_flows.sql` | Three user-facing flows are silently RLS-blocked in production today (see audit-findings/06-rls-coverage.md), plus two monthly-league economy-bypass policies. | — |
| 149 | `149_gym_checkins.sql` | Gym Check-In streak/XP multiplier. | — |
| 149 | `149_live_activity_rail_email_column.sql` | Adds `email` to the get_active_followees() RPC return so the LiveActivityRail can navigate to the canonical /hub?profile=<email> profile route. | — |
| 150 | `150_gym_approval_geo_optional.sql` | Unblocks the admin gym-verification queue. | — |
| 150 | `150_gym_consistency_leaderboard.sql` | Effort/consistency gym leaderboard (#5). | — |
| 151 | `151_signature_trophy.sql` | Profile "Signature Trophy": one emoji the user pins from their existing trophy_case to flex right next to their name on the Hub feed + profile. | — |
| 152 | `152_bounty_economy_integrity.sql` | Closes a coin-minting exploit in the bounty economy (QA audit, pre-beta): 1. | — |
| 153 | `153_custom_quotes.sql` | User-authored "quote of the day" entries (up to 20) that cycle into the Dashboard quote rotation alongside the built-in pool. | — |
| 154 | `154_bounty_v2_and_custom_quotes_hardening.sql` | Wave-50 follow-up to mig 152 (bounty economy integrity) + mig 153 (custom quotes). | — |
| 155 | `155_corporate_hr_fix_and_listing_profanity.sql` | Server-side follow-ups from the Wave-52 parallel audit. | — |
| 156 | `156_corporate_hr_dedup_actors.sql` | Code-review follow-up to mig 155. | — |
| 157 | `157_hub_profanity_and_notify_hardening.sql` | Wave-54 follow-up. Two real exploits surfaced by the Hub-feed audit: 1. | — |
| 158 | `158_gym_security_and_profanity.sql` | Wave-56 follow-up to the gym-ecosystem parallel audits. | — |
| 159 | `159_critical_cheat_and_privacy_fixes.sql` | Wave-57 follow-up. Server-side critical fixes from the parallel audits on Messages/DMs, Crews, Duels+Gauntlet+Nemesis, Cardio+ Coach+Progress+Nutrition. | — |
| 160 | `160_fix_mig_159_blockers.sql` | URGENT follow-up to mig 159. | — |
| 161 | `161_user_gender.sql` | Capture biological sex so the app can calibrate per-sex. | — |
| 162 | `162_step_logs.sql` | Manual daily step tracking. | — |
| 163 | `163_routines.sql` | "My Routine" — user-built weekly training calendars. | — |
| 164 | `164_crew_avatar.sql` | Adds a crew-level avatar so crews can have a profile photo instead of always showing the Shield fallback icon. | — |
| 165 | `165_daily_flexyn_drop.sql` | "Today's Flexyn Drop" — the daily-rotating branded merch on the Marketplace. | — |
| 165 | `165_journal_mood_score.sql` | Adds a mood_score column to journal_entries so tapping a mood emoji on the dashboard automatically tags that day's journal entry. | — |
| 166 | `166_duel_expiry_cron.sql` | Adds a pg_cron job that automatically flips overdue duels to 'expired' so the UI never shows a stale pending/active card after the deadline passes. | — |
| 166 | `166_layout_defaults.sql` | App-wide default layouts for the Dashboard / Workout / Nutrition reorderable surfaces. | — |
| 167 | `167_earned_trophies.sql` | Auto-awarded milestone trophies — distinct from the existing decorative trophy_case JSONB on user_profiles (that one stores 5 emoji slots the user picks for display). | — |
| 168 | `168_weekly_gauntlet_notifications_rls.sql` | Defense-in-depth: enable RLS on the dedup tracking table introduced in migration 082. | — |
| 169 | `169_explicit_grants_for_087_089_092_095.sql` | Defense-in-depth — add explicit service_role GRANTs for the four tables introduced in migrations 087 / 089 / 092 / 095. | — |
| 170 | `170_regimens_public_read_widening.sql` | BUG: user-published regimens stopped showing up in the public store. | — |
| 171 | `171_solo_challenges.sql` | Solo Challenges — a second class of bounty that doesn't require a target user. | — |
| 172 | `172_guest_signin_support.sql` | Beta access: anonymous sign-in for testers who can't (or don't want to) deal with email magic-link / OAuth friction. | — |
| 173 | `173_stat_column_integrity_and_streak_rpcs.sql` | Supabase/migrations/173_stat_column_integrity_and_streak_rpcs.sql Completes the privileged-column lockdown started in migration 142. | — |
| 174 | `174_recognize_meal_quota_and_progress_photos_bucket.sql` | Recognize-meal per-user rate limit + private progress-photos bucket Two independent ship-readiness fixes (2026-06 audit): • C22 — the recognize-meal Edge Function had no per-user cap, so any authentic… | — |
| 175 | `175_food_items_community_columns.sql` | Community barcode food submissions (2026-06 audit fix) The "Food Not Found → save for everyone" flow wrote nutrition/vitamins/ source payloads to columns that did not exist (silently stripped by the e… | — |
| 176 | `176_increment_flex_coins_mint_guard.sql` | Close the flex-coin mint without breaking legitimate grants C18 (2026-06 audit): increment_flex_coins(p_delta) is SECURITY DEFINER, granted to authenticated, and applied any positive p_delta to the ca… | — |
| 177 | `177_notification_category_mapper_fix.sql` | Repair notification_type_category() — un-break migration 136 C12 (2026-06 audit): migration 136 did `CREATE OR REPLACE` on notification_type_category() with INVENTED type names that no code path ever… | — |
| 178 | `178_post_privacy_and_blocking_rls.sql` | Enforce post privacy + blocking in RLS (was client-side theater) C20 (2026-06 audit): hub_posts read policy was `USING (true)` (mig 001), and the crew-scope policy (mig 065) is permissive so it only ever ORs access wider. | — |
| 179 | `179_admin_users_table.sql` | Move app-admin authority off a mutable username (C24) is_app_admin(p_user_id) returned `lower(username) IN ('sean','seanj', 'kegan','admin')` (mig 103). | — |
| 180 | `180_crew_war_xp_clamp.sql` | Bound crew-war XP contributions (C18, competitive integrity) contribute_crew_war_xp(p_war_id, p_crew_id, p_xp) (mig 076) validated membership + active war but accepted any p_xp > 0 with no upper bound… | — |
| 181 | `181_dm_received_notifications.sql` | Notify on new direct messages (C11 — DMs were invisible while closed) Nothing inserted a notification (and therefore nothing pushed) when a DM arrived. | — |
| 182 | `182_public_profiles_view.sql` | Public_profiles view — whitelisted cross-user profile reads C19 (2026-06 audit): user_profiles is world-readable via `USING (true)` (mig 001 "Public profiles are readable by all") and the client read… | — |
| 183 | `183_user_profiles_lockdown_STAGED.sql` | Lock user_profiles base-table reads to the owner (STAGED) ⚠️ RUN THIS ONLY AFTER: 1. | — |
| 184 | `184_advisor_flagged_always_true_policies.sql` | Close the always-true RLS policies the prod advisors flag The Supabase security advisors (run live 2026-06-10) still report these `rls_policy_always_true` findings, which means migrations 147/148 — th… | — |
| 185 | `185_storage_listing_and_internal_fn_lockdown.sql` | Stop uploads-bucket enumeration + lock internal trigger helpers Two advisor findings (live 2026-06-10), both safe to close: • public_bucket_allows_listing on `uploads`: the "uploads: public read" SELE… | — |
| 186 | `186_anon_rpc_surface_lockdown.sql` | Remove the anon RPC surface from cross-user notify + trigger bodies The advisor flags ~80 SECURITY DEFINER functions as anon-executable. | — |
| 187 | `187_unindexed_foreign_keys.sql` | Add covering indexes for unindexed foreign keys (performance) The Supabase performance advisor flags 65 foreign keys with no covering index. | — |
| 188 | `188_xp_daily_rate_limit_and_audit_ledger.sql` | Supabase/migrations/188_xp_daily_rate_limit_and_audit_ledger.sql Closes the last remaining XP-farming vector and adds an audit trail. | — |
| 189 | `189_server_authoritative_xp_achievements.sql` | Supabase/migrations/189_server_authoritative_xp_achievements.sql Makes XP-milestone achievement granting server-authoritative. | — |
| 190 | `190_weekly_rate_lbs.sql` | Adds user_profiles.weekly_rate_lbs — the explicit weekly weight-change rate (lbs/week; negative = loss, positive = gain). | — |
| 191 | `191_nutrition_goal_columns.sql` | Adds the five user_profiles columns the nutrition-goal onboarding (src/components/nutrition/NutritionOnboardingModal.jsx) has always written but no migration ever created: nutrition_goal 'lose' \| 'mai… | — |
| 192 | `192_economy_rpc_hardening.sql` | Closes three economy holes found by the pre-launch security audit (2026-07-12). | — |
| 193 | `193_orphaned_columns_and_guest_email_backfill.sql` | Companion to 192, from the same pre-launch audit (2026-07-12). | — |
| 194 | `194_restore_increment_copy_count.sql` | Dead-feature fix from the pre-launch audit (2026-07-12). | — |
| 195 | `195_public_profiles_email_harvest_fix.sql` | SECURITY FINDING (documented) + the resolve_profile_email helper. | — |
| 196 | `196_dashboard_widgets_column.sql` | Cross-device persistence for the dashboard Widget Library layout. | — |
| 197 | `197_economy_cheat_hardening.sql` | XP / economy anti-cheat audit remediation. | — |
| 198 | `198_xp_action_rate_limits_and_capsule_oneshot.sql` | XP anti-farm remediation (audit part 2) + capsule one-shot fix. | — |
| 199 | `199_daily_quest_reward_hardening.sql` | CRITICAL: user_daily_quests was fully client-managed. | — |
| 200 | `200_hub_post_counter_integrity.sql` | Increment_hub_post_counter(p_post_id, p_field, p_delta) let any signed-in user change ANY post's like_count / dislike_count / comment_count by an arbitrary delta — decoupled from the real hub_reactions / hub_comments rows. | — |
| 201 | `201_gauntlet_server_validation.sql` | Complete_gauntlet_challenge trusted the CLIENT's "challenge met" decision: the app evaluates the target in evaluateChallengeCriteria() and calls the RPC with workoutLogId = null, and the RPC awarded x… | — |
| 202 | `202_duel_server_scoring_and_bundle_fix.sql` | (1) submit_duel_result_atomic already recomputed VOLUME server-side for 'open' duels, but 'exercise' duels scored off the client's reps/weight and 'mirror' duels off the client's sets_completed (60% o… | — |
| 203 | `203_lock_increment_user_xp_from_public.sql` | Follow-up to 198. The per-action XP caps (grant_action_xp) are only enforced if the raw increment_user_xp RPC is NOT directly client-callable — otherwise a client just calls increment_user_xp(uid, 50000) and skips the caps. | — |
| 204 | `204_function_search_path_hardening.sql` | Defense-in-depth: pin an explicit search_path on the 51 functions the Supabase linter flagged as "function_search_path_mutable". | — |
| 205 | `205_referral_cap_and_bounty_escrow.sql` | Closes two coin faucets found in the economy audit. | — |
| 206 | `206_public_profile_rpc.sql` | The /@:username public profile page (PublicProfile.jsx) is the ONLY anon reader of the public_profiles view. | — |
| 207 | `207_revoke_anon_public_profiles.sql` | RUN THIS ONLY AFTER the PublicProfile.jsx change (migration 206 companion) has deployed to production via Netlify. | — |
| 208 | `208_hub_follows_populate_ids.sql` | Hub_follows has follower_id / followee_id uuid columns (since the initial schema) but NOTHING ever populated them — follows are written email-only (follower_email / followee_email). | — |
| 209 | `209_hub_messages_recipient_id.sql` | Foundation for migrating direct messages off email. | — |
| 210 | `210_block_tables_blocked_id.sql` | Last of the id-column foundations. | — |
| 211 | `211_hub_live_sessions_host_user_id.sql` | Hub_live_sessions identified the host only by host_email — no host id. | — |
| 212 | `212_crew_weekly_stats_rpc.sql` | Crew stats panel showed 0 volume / null PR for every member except the signed-in viewer. | — |
| 213 | `213_revoke_anon_execute_secdef.sql` | Hardening: strip anonymous EXECUTE from SECURITY DEFINER functions. | — |
| 214 | `214_regrant_anon_rls_predicate_fns.sql` | Corrective follow-up to 213. | — |
| 215 | `215_rls_initplan_wrap_auth.sql` | Performance: fix the Supabase advisor's auth_rls_initplan finding across all 191 public RLS policies (102 tables). | — |
| 216 | `216_hub_conversations_participant_ids_backfill.sql` | Hub_conversations.participant_ids (uuid[]) exists but was never populated — every row carried an empty array while participant_emails held the real membership. | — |
| 217 | `217_hub_follows_bidirectional_id_email.sql` | Mig 208 added a BEFORE INSERT/UPDATE trigger that fills follower_id / followee_id FROM the emails. | — |
| 217 | `217_merge_permissive_select_policies.sql` | Performance/hygiene: collapse pairs of PERMISSIVE SELECT policies that target the SAME role set on the same table into one policy (multiple_permissive_ policies advisor finding). | — |
| 218 | `218_index_unindexed_fks.sql` | (renumbered from 216 to avoid collision with 216_hub_conversations_ participant_ids_backfill.sql, which landed on main first.) Performance: add covering indexes for the 65 foreign keys the Supabase ad… | — |
| 218 | `218_pymk_returns_user_id.sql` | Get_people_you_may_know returned (email, mutual_count), forcing the client (PeopleYouMayKnow.jsx) to hydrate candidates by matching users.list() rows on email — a public_profiles email read that blocks dropping email from the view. | — |
| 219 | `219_hub_posts_collaborator_ids.sql` | The composer's co-author picker stored selected collaborators as hub_posts.collaborator_emails (mig 111), which forced HubComposer to read other users' emails off users.list() / the public_profiles view to resolve the picked user. | — |
| 220 | `220_public_profiles_drop_email.sql` | FINAL step of the email→id migration: drop the `email` column from the public_profiles view. | — |
| 221 | `221_gym_rival_rename.sql` | Phase 1b of the Nemesis → Gym Rival rework: rename the DB objects that back the feature. | — |
| 221 | `221_hot_path_indexes.sql` | Viral-load prep, pass 1: covering indexes for the hottest read paths. | — |
| 222 | `222_batched_push_fanout.sql` | Viral-load prep, pass 4: kill the push-fanout write amplification. | — |
| 222 | `222_gym_rival_confirmation_afk.sql` | Adds the weekly Gym Rival lifecycle: mutual opt-in confirmation, inactivity gating on matching, and a 48h AFK void. | — |
| 223 | `223_dm_unread_count_rpc.sql` | Viral-load prep, pass 5: stop pulling message rows to count them. | — |
| 223 | `223_gym_rival_settlement.sql` | Phase 3b — authoritative weekly settlement + reward granting for Gym Rival, plus a batch AFK-void safety net. | — |
| 224 | `224_gym_rival_record.sql` | Win / loss record for a user across all their settled Gym Rival matches. | — |
| 225 | `225_rival_types.sql` | Adds the Rival TYPE dimension: a match is a Gym Rival (competes on workout VOLUME) or a Cardio Rival (competes on DISTANCE). | — |
| 226 | `226_rival_decline.sql` | Decline a PENDING rival match (either party). | — |
| 227 | `227_nutrition_recipes_directions_public.sql` | Finishes the recipes feature (builds on mig 123): • directions — freeform prep steps for the recipe. | — |
| 228 | `228_nutrition_recipes_image.sql` | Adds an optional food image to user recipes. | — |
| 229 | `229_recognize_meal_quota_cap_3.sql` | Lower the Photo-AI (recognize-meal) per-user daily cap from 30 → 3. | — |
| 230 | `230_nutrition_logs_photo_meta.sql` | Persist the Photo-AI photo + recognition breakdown alongside the meal log so a saved meal can be re-opened later showing the original image and the full nutrient/ingredient detail. | — |
| 231 | `231_recognize_meal_quota_owner_exempt.sql` | Give specific owner/tester accounts UNLIMITED Photo-AI (recognize-meal) scans, while every other account keeps the daily cap from migration 229. | — |
| 232 | `232_story_reports.sql` | Stories are now reportable from the story viewer (a Flag button in the viewer's top bar), so hub_reports.reported_type must accept 'story' alongside the existing 'post' / 'comment'. | — |
| 233 | `233_story_hard_delete_24h.sql` | Hard-delete stories once they expire (Instagram behaviour: 24h, then gone). | — |
| 234 | `234_dm_message_requests.sql` | "Message requests" for 1:1 DMs — the send-gating half. | — |
| 235 | `235_dm_auto_accept_on_follow.sql` | "Once they are following them, messages are then direct" — the RETROACTIVE half of the message-requests feature. | — |
| 236 | `236_storage_gc.sql` | Actually reclaim orphaned storage blobs. | **Vault config** |
| 237 | `237_dm_delivered_at.sql` | A real delivery signal for DM status ticks. | — |
| 238 | `238_read_receipts_opt_out.sql` | Read-receipt opt-out, enforced server-side. | — |
| 239 | `239_fix_suggested_followees_ambiguity.sql` | Fixes a LIVE 400 on every Hub load: POST /rest/v1/rpc/get_suggested_followees 42702: column reference "email" is ambiguous It could refer to either a PL/pgSQL variable or a table column. | — |
| 240 | `240_start_dm_conversation_guest_email.sql` | Fixes "Could not start conversation. | — |
| 241 | `241_dm_identity_guest_safe.sql` | "Two account test failed, receiving user could not accept the message request." WHAT BROKE taught start_dm_conversation that an anonymous ("Continue as guest") session has no JWT email, so auth.email() returns ''. | — |
| 242 | `242_ensure_my_league_rpc.sql` | Fixes the live 403 on every league join, WITHOUT handing the client write access to the leaderboard. | — |
| 243 | `243_weekly_debrief_email_backfill.sql` | Fixes the live 400 on Weekly Debrief generation. | — |
| 244 | `244_dm_purge_unsend_guest_identity.sql` | Re-issues the half of migration 241 that did not land. | — |
| 245 | `245_league_members_xp_lockdown.sql` | Closes an XP-forgery vector on league standings. | — |
| 246 | `246_crew_challenge_server_progress.sql` | Makes crew challenges actually work, and makes them forgery-proof. | — |
| 247 | `247_crew_war_integrity_and_matchmaking.sql` | Crew Wars: close a live score-forgery hole, then make the feature actually run end to end. | — |
| 248 | `248_crew_progression_seasons_divisions.sql` | Gives a Crew a body, a season and a division. | — |
| 249 | `249_crew_war_multi_metric_scoring.sql` | Makes a Crew War worth watching: scored on training rather than on XP, derived on the server rather than sent by the client, and settled on a heartbeat rather than a drip. | — |
| 249 | `249_referral_stats_claimed_flag.sql` | Adds `has_claimed` + `claimed_code` to my_referral_stats(). | — |
| 250 | `250_crew_membership_door.sql` | Puts a door on crew membership: approval, invitation, banning, and a way to see who has stopped turning up. | — |
| 251 | `251_crew_treasury_and_perks.sql` | A treasury worth defending: wars and challenges now pay the crew as well as its members, and a leader can spend that balance on something the whole crew keeps. | — |
| 252 | `252_one_crew_per_user_and_leaving.sql` | A user belongs to one crew, and can leave the one they're in. | — |
| 253 | `253_trade_escrow.sql` | Real trading. Until now "trading" was a chat message: TradeOfferDialog embedded a [TRADE_OFFER_V1] JSON blob in a DM, and Accept sent a text reply. | — |
| 254 | `254_fix_finalize_capsule_on_conflict.sql` | CRITICAL: every capsule claim has been destroying its loot. | — |
| 255 | `255_atomic_capsule_open.sql` | Close the roll/grant gap for good. | — |
| 256 | `256_capsule_pity.sql` | Real pity. The streak counter stops being trivia and becomes a promise. | — |
| 257 | `257_leaderboard_rpc_all_boards.sql` | Moves the ALL-TIME global leaderboard off the client and onto the server, and closes two defects in the existing get_period_leaderboard (mig 125). | — |
| 258 | `258_leaderboard_view_lockdown.sql` | Fixes a data exposure introduced by migration 257. | — |
| 259 | `259_fix_around_me_temp_table.sql` | Get_leaderboard_around_me has never worked. | — |
| 260 | `260_dashboard_layout.sql` | Makes the "Customize home" layout follow the user instead of the device. | — |
| 261 | `261_xp_level_source_of_truth_and_column_guard.sql` | Fixes the two critical findings in docs/xp-audit-2026-07-29.md. | — |
| 262 | `262_cardio_and_other_xp_caps.sql` | Fixes F4 from docs/xp-audit-2026-07-29.md. | — |
| 263 | `263_level_reward_schedule_rebalance.sql` | Fixes F5 from docs/xp-audit-2026-07-29.md. | — |
| 264 | `264_flex_coin_ledger_and_mint_ceiling.sql` | Fixes C1 and C2 from docs/coin-economy-audit-2026-07-29.md, and drops the redundant trigger migration 261 added for the withdrawn finding F1. | — |
| 265 | `265_quest_reward_rebalance.sql` | Fixes C3 and C4 from docs/coin-economy-audit-2026-07-29.md. | — |
| 266 | `266_capsule_mint_lockdown.sql` | Fixes L1 and L4 from docs/loot-system-audit-2026-07-29.md, plus L5 while in the same place. | — |
| 267 | `267_loot_catalog_server_authority.sql` | Fixes L2 and L3 from docs/loot-system-audit-2026-07-29.md. | — |
| 268 | `268_training_spaces_equipment.sql` | Phase 1 of the equipment picker — see docs/gym-equipment-picker-prompt.md. | — |
| 269 | `269_gym_owner_and_demo_dedupe.sql` | Two production data fixes, both found while auditing the equipment picker's owner-curation path. | — |
| 270 | `270_training_spaces_membership_gate.sql` | SECURITY FIX for migration 268. | — |
| 271 | `271_home_space_uniqueness.sql` | One "My gear" space per user, enforced by the database. | — |
| 272 | `272_uploads_bucket_accepts_video.sql` | Let the `uploads` bucket accept the file types the app actually sends. | — |
| 273 | `273_uploads_owner_select_for_delete.sql` | Let users see their OWN objects in the `uploads` bucket, so deleting them actually deletes them. | — |
| 274 | `274_push_fanout_reads_vault_again.sql` | Make push fanout read its URL and secret from the Vault again, so it actually dispatches. | **Vault config** |
| 275 | `275_home_gym.sql` | "My Gym" — a single home gym per user, picked during onboarding. | — |
| 276 | `276_scheduled_workouts.sql` | Scheduled workouts — "Schedule it" on the AI Coach plan card. | — |
| 277 | `277_welcome_and_first_workout_capsules.sql` | Two capsule grants that have never once landed. | — |
| 278 | `278_backfill_welcome_and_first_workout_capsules.sql` | One-time backfill for the two grants migration 277 repaired. | — |
| 279 | `279_crew_assigned_regimens_update_policy.sql` | `assignRegimenToCrew` (src/lib/data/crews.js) upserts on (crew_id, regimen_id) with `assigned_by` and `note` as payload. | — |
| 280 | `280_recognize_meal_quota_no_charge_on_failure.sql` | Photo-AI was charging a scan for work it never delivered. | — |
| 281 | `281_capsule_drops_no_themes.sql` | Themes are switched off as a reward. | — |
| 282 | `282_weighted_pick_is_volatile.sql` | SEPARATE FROM 281 ON PURPOSE. | — |
| 283 | `283_close_email_harvest_and_profile_fks.sql` | Two unrelated defects from the 2026-08-04 review batch, bundled because both are one-paste fixes and neither can wait for the other. | — |
| 284 | `284_admin_purge_user_data.sql` | The server half of real account deletion. | — |
| 285 | `285_close_the_post_sweep_gaps.sql` | Closes the backend findings from the #26-50 acceptance review, plus the structural cause behind two of them. | — |
| 286 | `286_gc_dispatch_ledger_actor_and_local_xp_day.sql` | Three fixes from the #51-75 acceptance review. | **Vault config** |
| 287 | `287_perform_prestige_server_side_eligibility.sql` | Perform_prestige — server-side eligibility + atomic award Found by the double-fire / interaction audit (Aug 2026). | — |
| 288 | `288_notify_rpcs_verify_the_event.sql` | Notify_*_for — verify the event before notifying Found by the interaction audit (Aug 2026), chasing the same "client-trusted value" thread as migration 287. | — |
| 289 | `289_revoke_anon_on_notify_rpcs.sql` | Close two notify_X_for RPCs to `anon` Caught by get_advisors immediately after 288, which is the reason CLAUDE.md says to run it after touching any SECURITY DEFINER function. | — |
| 290 | `290_stories_server_side_privacy.sql` | Story privacy was enforced only on the client Found by the Hub interaction audit (Aug 2026). | — |
| 291 | `291_revoke_anon_gym_members.sql` | Close anon access to gym_members added two things together: CREATE POLICY "Public can view gym membership list" ON public.gym_members FOR SELECT TO anon USING (TRUE); GRANT SELECT ON public.gym_member… | — |
| 292 | `292_hub_reactions_owner_read.sql` | Hub_reactions was world-readable `hub_posts` has a real read policy — is_blocked(), publish_at, and a hub_follows join for followers-only posts. | — |
| 293 | `293_guest_mode_and_goals_completed_at.sql` | Make guest accounts work, and restore goal completion Two fixes. | — |
| 294 | `294_body_stats_numeric.sql` | Body stats were TEXT columns with client-only validation weight_lbs, weight_kg, height_inches and height_cm are all `text`. | — |
| 295 | `295_hub_messages_scheduled_policy_restrictive.sql` | Every DM in the app was readable by every signed-in user SEVERITY: highest of this audit. | — |
| 296 | `296_hub_comments_inherit_post_visibility.sql` | Comments on a private post were readable by anyone Third instance of one pattern in this audit: the parent is gated, the child is not. | — |
| 297 | `297_monthly_league_server_derived_writer.sql` | Monthly leagues had no writer, so they never ran `monthly_leagues` and `monthly_league_members` have been empty since they were created. | — |
| 298 | `298_crew_xp_fuel_server_amount.sql` | Closes the last client-priced XP grant in the app. | — |
| 299 | `299_home_gym_custom.sql` | "My gym isn't listed" — create a community gym from a typed name and the user's own location, when OpenStreetMap has never heard of it. | — |
| 300 | `300_osm_gym_cache.sql` | Cache OpenStreetMap gyms in our own Postgres so the picker stops asking a donated public service from a phone on cellular. | — |
| 301 | `301_gym_public_preview.sql` | Two halves of one decision: close the roster, then publish an anonymised preview in its place. | — |
| 302 | `302_block_probe_close.sql` | `is_blocked(p_viewer_id, p_author_email)` is EXECUTE-able by anon, and takes the viewer as a PARAMETER — so anyone, signed out, can ask "does user X block email Y?" for any pair they can guess. | — |
| 303 | `303_feed_read_authenticated_only.sql` | The hub feed's SELECT policies are TO PUBLIC, so they are written to be evaluated by `anon`. | — |
| 304 | `304_block_probe_close_authenticated.sql` | Finishes what 302 started. | — |
| 305 | `305_coach_chat_quota.sql` | Per-user daily cap for the `coach-chat` Edge Function. | — |
| 306 | `306_guest_account_sweep.sql` | Sweep abandoned guest accounts on a schedule. | — |
| 307 | `307_coach_chat_circuit_breaker.sql` | A global daily ceiling on coach-chat, plus a smaller cap for guests. | — |
| 308 | `308_crew_directory_and_top_board.sql` | The Crews Hub: a browsable directory of public crews, and a global board that ranks crews against each other. | — |
| 309 | `309_block_mute_identity_without_email.sql` | Settings renders the blocked and muted lists, and it had nothing to render but the address: `maskEmail(b.blocked_email)`. | — |
| 310 | `310_league_rollover_and_activity_gate.sql` | Makes the weekly league actually resolve, and makes it resolve CORRECTLY. | — |
| 311 | `311_crews_read_authenticated_only.sql` | Scope the crews SELECT policy to `authenticated`. | — |
| 312 | `312_league_seasons_titles_trophies.sql` | Phase 3 of the league work. | — |
| 313 | `313_public_profiles_definer_read_only.sql` | Cross-user profile reads have returned NOTHING since migration 183, for every user, and it has been invisible. | — |
| 314 | `314_block_mute_username_snapshot.sql` | Gave the blocked and muted lists a user id so Settings could render a handle instead of an address. | — |
| 315 | `315_public_profiles_row_rules.sql` | Put the profile privacy rules in the database, where they are enforced, instead of in the client, where they are decoration. | — |
| 316 | `316_daily_quests_xp_crew_and_streaks.sql` | Daily quests paid coins and nothing else. | — |
| 317 | `317_league_season_one_starts_october.sql` | Season 1 starts 2026-10-01 (kegan, 2026-08-09), not the moment migration 312 was applied. | — |
| 320 | `320_marketplace_bundle_conservation_and_listing_guard.sql` | Two marketplace holes found in the 2026-08-09 audit. | — |
| 321 | `321_seller_can_delete_own_listing.sql` | Sellers keep the ability to delete their own listings. | — |
| 322 | `322_listing_guard_trigger_can_see_its_caller.sql` | 's guard trigger never guarded anything. | — |
| 323 | `323_trophy_ladders.sql` | Extends the earned-trophy engine (mig 167) from 18 flat badges to a LADDER system with infinite tails, and folds in the achievements catalog that was never earnable. | — |
| 324 | `324_gym_member_count_is_derived.sql` | Camp Quannapowitt read 2 members against 1 real gym_members row, and the counter is not cosmetic: it is on every map pin, in the gym list, in the "N members" line on the hub, and it decides whether th… | — |
| 324 | `324_trophy_prerequisites.sql` | Takes the trophy catalog from 73 to 120 obtainable achievements and adds a PREREQUISITE ENGINE: a trophy can require other trophies, and stays genuinely unobtainable until they are all earned. | — |
| 325 | `325_gym_public_card_only.sql` | Gym_businesses carried `Public can view active gyms` — USING (is_active = true) TO anon — so every column of every gym was readable by anyone holding the anon key, and the anon key ships inside the client bundle. | — |
| 326 | `326_close_gym_vs_gym_to_anon.sql` | Get_gym_vs_gym_leaderboard is SECURITY DEFINER and EXECUTE-able by anon, which makes it the last anon-reachable door into gym data after mig 325 closed the table. | — |
| 327 | `327_gym_vs_gym_five_member_floor.sql` | 301 established the rule: gym activity may be shown without identity only for gyms with at least five members, because below that an individual's attendance is derivable by subtraction — the roster is… | — |
| 328 | `328_weekly_review_v2.sql` | "Weekly Reviews" (formerly Debrief Vault) — v2 of the weekly summary. | — |
| 329 | `329_backfill_workout_total_volume.sql` | The column had never been written by anything, on any row, ever. | — |
| 330 | `330_weekly_review_cardio_duration.sql` | Identical to 328's function except for ONE statement: the conditioning block now reads cardio duration from duration_seconds when duration_min is NULL. | — |
| 331 | `331_weekly_review_one_body.sql` | ONE body for the weekly review, callable two ways. | — |
| 332 | `332_weekly_reviews_cron.sql` | Schedules the weekly review generator, and does it the way the LAST attempt should have been done. | **Vault config** |
| 333 | `333_weekly_review_daily_steps.sql` | Adds `daily_steps` (seven totals, Monday-first) and `prev_steps` to the conditioning payload. | — |
| 334 | `334_dm_notifications_and_scheduled_release.sql` | Four defects found auditing the DM surface end to end. | — |
| 335 | `335_cardio_minutes_challenge_reads_seconds.sql` | The "60 min of cardio this week" challenge could never progress. | — |
| 336 | `336_kick_storage_gc_uses_pg_net.sql` | The storage GC cron has never dispatched a single request. | — |
| 337 | `337_kick_storage_gc_timeout.sql` | The storage GC dispatch records a timeout for work that SUCCEEDS. | — |
| 338 | `338_backfill_orphaned_uploads.sql` | Enqueue the upload blobs that nothing references and nothing ever queued. | — |
| 339 | `339_pgnet_timeouts_for_remaining_callers.sql` | The other three pg_net callers still record timeouts for work that succeeds. | — |
| 340 | `340_drop_planned_cardio.sql` | Retire the second scheduler — cardio plans move onto `scheduled_workouts`. | — |
| 341 | `341_retire_achievements_table.sql` | Retire `public.achievements`; XP milestones + the capsule clamp move onto `user_trophies`. | — |
| 342 | `342_rls_owner_write_check.sql` | Cross-user row injection: an OR write-check let you stamp another user's email on a row. | — |
| 343 | `343_food_item_requests.sql` | A barcode miss files a moderated request instead of publishing straight into the shared food catalogue. | — |
| 344 | `344_meal_plans_one_per_slot.sql` | Unique index on `meal_plans (user_id, plan_date, meal_type)`. `upsert` sent no `id`, so every re-fill of a slot appended a row the grid could not show — 6 of 8 production rows were unreachable. **Applied 2026-08-11**, with a one-off dedupe of 6 rows recorded in the file head but deliberately not restated in it. | Fails `23505` on a database that still holds duplicates — dedupe first |
| 345 | `345_food_items_moderation_gate.sql` | 343's moderation queue was enforced in the CLIENT only. Verified against production as a real non-admin: a direct `INSERT` into `food_items` with `is_verified = TRUE, source = 'member_request'` was accepted, read by a third user, and the owner could flip `is_verified` on their own row. Splits the `ALL` policy — constrained INSERT, no client UPDATE, DELETE only while unreviewed — and scopes both read policies to `authenticated` so the `TO PUBLIC` verified-read stops depending on `anon` lacking EXECUTE on `current_user_email()`. | Nothing to dedupe. Ends in a `SELECT` over `pg_policies`: expect 4 rows, none with `cmd = 'ALL'` or `'UPDATE'` |
| 346 | `346_review_adoption_guard_reads_the_real_column.sql` | `trg_enforce_review_adoption` has never blocked a non-owner since mig 118: it queried `parent_regimen_id` / `parent_id` (neither exists) and its own `EXCEPTION WHEN undefined_column THEN RETURN NEW` swallowed the error and allowed the insert. Points it at `original_template_id`, which exists and which every clone path writes, and removes the handler. Proven by executing an insert as a real authenticated stranger, before and after. | Safe to re-run; `CREATE OR REPLACE` + guarded `DROP TRIGGER` |
| 347 | `347_goals_policy_scoped_to_authenticated.sql` | `goals` had one policy, `owner full access [ALL]`, with an EMPTY `polroles` — i.e. `TO PUBLIC` — while `anon` holds table SELECT. Probed as `anon`: blocked, but only by `42501 permission denied for function current_user_email`, which CLAUDE.md calls "not a boundary" (cf. mig 303). Cross-user authenticated reads were already correctly scoped (probed, 0 rows), so the predicate was right and only the audience was wrong. Uses `ALTER POLICY … TO` so the expression is never restated — it is full of tokens the paste pipeline mangles. **Applied 2026-08-12** — verified `roles = authenticated`, one policy, both expressions intact. | Idempotent; re-running sets the same role list |
| 348 | `348_report_email_notify.sql` | Email a moderator on every new content report — AFTER INSERT trigger on `hub_reports` → `report-notify` Edge Function. Destination lives in the Vault so it can be swapped without a redeploy. | Applied 2026-08-12 as 343; renumbered to 348 after 343–347 landed on main first |
| 349 | `349_workout_cardio_logs_policies_scoped.sql` | The `goals`/347 shape on the two tables behind All Workouts. Both `workout_logs` and `cardio_logs` had one policy, `owner full access [ALL]`, with an EMPTY `polroles` — i.e. `TO PUBLIC` — while `anon` holds table SELECT. Probed as `anon`: blocked on both, but only by `42501 permission denied for function current_user_email`, which CLAUDE.md calls "not a boundary" (cf. migs 303, 347). Probed as a real authenticated non-owner with the identity asserted distinct from the row owner: 0 rows on both, and the OWNER still saw their 2 rows — so the predicate was right and only the audience was wrong. Scoping one policy is safe here because each table has exactly one, so the `food_items`/345 un-shadowing trap cannot apply. Uses `ALTER POLICY … TO` so neither expression is restated. **Applied 2026-08-12** — verified `roles = {authenticated}` on both, one policy each, both USING and WITH CHECK intact. Re-probed after applying: anon now returns **0 rows cleanly** rather than `42501` (no policy applies to it at all — the point of the change), non-owner reads 0 on both tables, a non-owner INSERT forging another user's `user_id` is rejected, and both owners still read their own rows (2 workout_logs, 2 cardio_logs). | Idempotent; re-running sets the same role list. Ends in a `SELECT` over `pg_policies`: expect 2 rows, both `roles = {authenticated}`, both `using_expr_intact = t` |
| 350 | `350_display_name_and_username_change.sql` | A chosen `display_name` beside the @handle, plus the first way to CHANGE a handle. Deliberately a NEW column, not `full_name`: 19 of that column's 21 values are two-part real names typed into a signup form, and publishing them as public display names would have exposed 19 real identities in one deploy with no opt-in. NULL renders today's screen exactly (handle alone). The handle half needed three things, not one — there was **no unique index on `username` at all** (0 duplicates across 31 handles is luck, not a guarantee), `username` is **not** in `user_profiles_block_privileged_updates` so any client could PATCH it straight through PostgREST, and there was no RPC. Adds a case-insensitive unique index, a trigger making a handle CHANGE rpc-only (NULL → value stays open so onboarding can still claim a first handle), and `set_username()` returning a jsonb verdict. Verified against production in a rolled-back transaction as role `authenticated` with real JWT claims: taken (exact + differing case) → `taken`; 2-char and `has space` → `invalid`; own handle → `unchanged` with the cooldown NOT spent; free handle → `changed` +30d; second change same day → `cooldown`; **direct UPDATE bypassing the RPC → 42501 with the handle unmoved**. View replaced with `display_name` APPENDED (never mid-list); confirmed after: 33 columns, no `email` column, 57 rows readable. | Idempotent — `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, guarded `DROP TRIGGER`, `CREATE OR REPLACE`. The index fails `23505` on a database that has since acquired duplicate handles — dedupe first |
| 351 | `351_private_profile.sql` | Makes the existing `is_private` flag mean something beyond the stats. `public_profiles` already gated XP/streaks/trophies correctly — everything else Sean listed was wide open: `hub_follows` SELECT was `USING (true)` (the whole follow graph, so follower/following counts), `user_trophies` SELECT was `USING (true)` (badges), and `hub_posts` served every `privacy = 'public'` row to every authenticated reader (posts + post count). Hiding those in the client would have been theatre. Adds `viewer_can_see_activity(text)` — SECURITY DEFINER, viewer from `auth.uid()` — and gates all three. **`authenticated` MUST hold EXECUTE on it**: a policy expression runs as the invoking role, and revoking it makes every SELECT on those tables fail `42501` (measured on the first attempt). Safe to expose because it takes only the SUBJECT, unlike `is_blocked`, which takes the viewer. Also moves **`bio` OUT of the `full_view` gate** — a private profile must stay recognisable enough to follow, which is why username/display name/avatar were already exempt. 0 of 57 profiles are private, so this is a no-op on live data AND the new branch has never executed — verified against SEEDED private profiles instead, rolled back. With sean (16 posts, 21 trophies) private, viewed by a real non-follower: posts 27→12, trophies 56→35, follows 44→24, **rows gained by the stranger: 0 in every table**; a follower kept all 27/56, and sean kept his own. Stranger's view of the private profile: username ✓, avatar ✓, bio ✓, city/XP/level/streak/trophy_case all NULL. A first pass using evrock was VACUOUS — he has 0 posts and 0 trophies, so those two branches never ran and the counts matched for the wrong reason. | Idempotent — `CREATE OR REPLACE` + guarded `DROP POLICY`. Run AFTER 350: the view it replaces carries `display_name`. Do NOT set `security_invoker=true` on the view |
| 352 | `352_nutrition_recipes_hide_author_email.sql` | Publishing a recipe handed the author's EMAIL to every other user. Mig 227 added a `TO authenticated` SELECT policy for published rows and its own comment claims `author_username` exists "so Discover never has to expose user_email (privacy)" — but RLS is ROW-level, so a policy that grants the row grants every column, and the client read `select('*')`. Proven against production as a genuinely different authenticated user (probe identity asserted, `relrowsecurity` confirmed, rolled back): user B got user A's real email. Guests are `authenticated` too. Fix is column privileges, because scoping the client's select list is not a boundary — anyone with the anon key can ask PostgREST for `select=user_email` directly. Order matters: a column-level REVOKE against a table-level grant is a silent no-op, so table SELECT is revoked and re-granted column by column. Verified in a rolled-back transaction: the safe list still reads for a second user AND RLS still filters, while `SELECT user_email` now raises `42501`. Also REVOKEs anon's inherited SELECT (measured: anon already saw 0 rows, held back only by every current policy being `TO authenticated` — the mig-303 shape, closed before someone adds a `TO PUBLIC` policy). Second half backfills `meal_plans.food_snapshot` from the recipe: `recipe_id` has no FK on purpose, but it was the only thing stored, so a plan that outlived its recipe rendered as a bare "—". **0 rows are public and always have been — this lands before the feature is used, not after.** **APPLIED 2026-08-12** — verified live, not just by the grant catalog: a second real authenticated user still reads a published recipe's safe columns (Discover works), `SELECT user_email` as that same user raises `42501`, the OWNER's INSERT … RETURNING the 14 safe columns still succeeds (the save path was the one thing a column revoke could have broken), and `anon` now gets `42501` outright rather than 0-rows-by-policy. Catalog check returned 14 / 0 / 0 / 0. | **Run AFTER the matching client build is live** — the old client selected `*` and would 42501 on every recipe read. Idempotent: re-running re-grants the same columns and the backfill is `WHERE food_snapshot IS NULL`. Backfill UPDATE uses a column-renaming CTE so it carries no `alias.column` tokens |
| 353 | `353_gym_feed_owner_moderation.sql` | A gym owner can pin a member's post but not delete it, and the app shows them a Delete button anyway. Both feed DELETE policies are `USING (author_id = auth.uid())`, while `GymFeedTab.jsx` renders the control to `isAuthor || isOwner` (:348/:370) and the comment control to `author || isPostAuthorOrGymOwner` (:507). A DELETE that matches no rows is not an error, so `deleteFeedPost`'s `{ ok: !error }` reports success and the post is still there on the next read. Proved against production by seeding one post authored by a non-owner and issuing the DELETE as the gym owner over role `authenticated`: `no error raised · ROW_COUNT = 0`, post still present, while `toggle_pin_gym_post` succeeded for the same user — pinning goes through an RPC that checks `owner_id`, deleting went straight to the table. The seeded row was removed in the same block and the table verified back to 0. Adds `is_gym_owner(uuid)` and `can_moderate_gym_comment(uuid)` as SECURITY DEFINER helpers — hoisted so the policies stay bare-column and survive the paste pipeline — then widens both DELETE policies. **NOT the whole story: the gym feed still has no REPORT path at all** (`hub_reports` exists and backs the Hub feed; `GymFeedTab.jsx` has no match for report/flag/moderate/block), which is the release-blocking half and is a product change rather than a policy one. | Idempotent — `CREATE OR REPLACE` + guarded `DROP POLICY`. Ends in a SELECT printing `author + owner` per policy, because the SQL editor hides `RAISE NOTICE` |
| 354 | `354_regimens_user_id_backfill.sql` | Two `regimens` rows carry a NULL `user_id`, leaving them held by `created_by` alone — the one key that can change out from under them, since `current_user_email()` reads the live JWT address first and nothing rewrites `created_by` when it moves. Measured across the ten email-keyed tables: 274 of 276 rows carry `user_id`; these are the other two, both on real non-guest accounts so mig 306's guest cron never swept them. **Not a live bug — do not "fix" the write path.** `makeEntity().create` injects both keys and the surrounding rows prove it, so these are isolated historical misses, most likely db.js's strip-and-retry dropping the column on a 42703 before it existed. Joins on `user_profiles.email` rather than `auth.users.email` because a guest's auth email is NULL while the profile placeholder is not; rows whose `created_by` matches no profile are left alone, since a NULL is honest about an owner we cannot identify where a guessed uid would not be. | Idempotent — `WHERE user_id IS NULL`. Written without a join alias on purpose, for the paste pipeline. Ends in a SELECT: expect `remaining_null = 0`, total unchanged at 33 |
| 355 | `355_meal_plans_multi_meal_slot.sql` | **Reverses 344.** A day can legitimately carry two dinners, and every plan template already needed two meals in one slot — `snack1` and `snack2` both map to the single `snack` type — so no template could ever be applied whole while 344's unique index existed. 344's diagnosis fit the incident and not the domain: its 6 unreachable rows were one diary entry mirrored repeatedly, never two different meals, so the identity being violated was the MIRROR's. Drops `meal_plans_user_date_slot_uniq`, moves uniqueness to `(user_id, food_snapshot->>'log_id')` (partial — planner-created rows carry no log_id) so the mirror stays idempotent, and caps a slot at three with a BEFORE INSERT OR UPDATE trigger raising `check_violation`. Three because TWO is the floor a template needs and past three a day stops being a plan and becomes a record — which `syncPlannerDiaryLog` already mirrors into `nutrition_logs`, uncapped. Verified against production inside a rolled-back transaction: three meals into one dinner slot accepted, the fourth refused `23514`, a second row carrying an existing `log_id` refused `23505`, then rolled back and production re-confirmed unchanged. **APPLIED 2026-08-13** — `slot_uniq_gone = true, log_uniq_present = 1, cap_trigger_present = 1`. | Idempotent — `DROP INDEX IF EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, `CREATE OR REPLACE` + guarded `DROP TRIGGER`. 344 keeps its file but gained a SUPERSEDED header: run alone it would restore the old rule. In migration order it is harmless. The client half (`b1b0c076`) is what makes this visible — without it `upsert` still collapses a second meal into the first |
| 356 | `356_crew_war_roster_matchmaking.sql` | Crew Wars matched on season division alone — a result, not a description of who trains in a crew, so six lifters could be drawn against two. Snapshots five numbers onto the queue row (`match_roster`, `match_age`, `match_strength`, `match_cadence`, `match_division`) and ranks candidates with `crew_match_gap`, a coverage-aware distance that compares a dimension only when BOTH crews have it — age is set on 26 of 60 profiles and `activity_level` on 0 of 60, so reading a missing value as zero would rank crews on absence. Tolerance opens 0.15 per 12 h waited. Also fixes scoring: `recompute_crew_war` set each side to `SUM(xp_contributed)`, so a 12-person crew beat a 4-person crew on headcount; each side now scores its top N where N is the smaller roster. Measured on seeded rows — old 1500–1400 to the bigger crew, new 500–1400 to the crew that trained. | Idempotent — `ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE`. Verified end to end in a rolled-back transaction against production |

| 357 | `357_crew_ranks_and_the_door.sql` | Crew ranks 1-3 (member / moderator / leader), and the hole that made them decorative. `crew_members` had one INSERT policy — `WITH CHECK (user_id = auth.uid())` — constraining which USER, never which CREW or which RANK, while `crew_members_sync_role` KEPT a client-supplied `role` on insert. Proved against production as a real authenticated guest with no invite: an INSERT naming `role = 'leader'` into a crew with `is_public = FALSE` was **accepted**, and `is_crew_admin` then returned true — which gates editing the crew, assigning regimens, creating challenges, kicking members, changing roles and starting wars. Rolled back, nothing left behind. Adds `crew_rank` (internal), `my_crew_rank` and `can_remove_crew_member` (both caller-scoped, granted), `create_crew_atomic` as the founder's door, then DROPs the INSERT policy and REVOKEs INSERT — `join_crew_atomic` and `create_crew_atomic` are SECURITY DEFINER and remain the only two doors. A guard trigger pins rank on any client insert and refuses demoting the last leader (23514). Moderators gain: start/cancel war, pin, delete any message, assign regimens, crew challenges, remove rank-1 members. Leader-only: promote/demote, edit crew, treasury. | Idempotent — guarded `DROP POLICY`/`DROP TRIGGER` + `CREATE OR REPLACE`. Verified end to end in a rolled-back transaction: the escalation INSERT refused, member refused a war start, moderator allowed, last-leader demotion refused, moderator refused a leader demotion |

| 358 | `358_crew_war_start_is_leader_only.sql` | Starting a crew war goes back to **leader only** (kegan, 2026-08-15). 357 put it at rank 2 on the reasoning that entering matchmaking is operational rather than structural; that was a judgement call filling a gap in the brief, which named only what a MEMBER may not do, and the call is the product owner's — it commits every member to a seven-day competition. Supersedes two of 357's bodies (`join_crew_war_queue`, `leave_crew_war_queue`), gate only: rank 2 → rank 3. **A new file rather than an edit to 357, because 357 is applied** — a later migration redefining a function is invisible in the file that owns the feature, which is how push sat dead for months. Nothing else moves: moderators keep pinning, deleting any message, assigning regimens, crew challenges, roll call and removing rank-1 members. Mirrored in `src/lib/crewPermissions.js`. | Idempotent — `CREATE OR REPLACE` only. Matchmaking body byte-identical to 356/357 |

| 359 | `359_crew_transfer_and_plausible_war_volume.sql` | **Transfer Leadership** — `transfer_crew_leadership(crew, target)` promotes the target and steps the caller down in one transaction. Two client UPDATEs cannot do this: 357's guard refuses any demotion leaving zero leaders, so the order matters and the client must not choose it. **Plausible war volume** — `detectImplausibleWorkout` (src/lib/workoutFatigue.js) models what a lifter can do in a day from bodyweight/age/sex, and is called ONLY from Workout.jsx and EditWorkoutModal; `public.workout_logs` has **zero triggers** (measured), so a crafted request writes anything and war scoring read it under a flat `LEAST(200000, …)` that is identical for a 120 lb 55-year-old and a 250 lb 25-year-old. `crew_member_volume_ceiling` ports the model to SQL and scores each member against their own ceiling. **Only ever tightens** (200,000 stays the absolute cap) and is a **no-op on an unknown profile** (the model lands on 201,600/week, clamped straight back to 200,000) — verified 200000 / 107100 / 200000. Coverage: weight_lbs 27 of 60 profiles, age 26, gender 13. Does NOT gate the log itself, only what it can win. **Strength is now bodyweight-relative** — `crew_match_strength` averaged absolute e1RM, which ranks heavyweights above pound-for-pound stronger crews and then matches them; members with no bodyweight are skipped rather than mixed in, and the units of `match_strength` change (~225 → ~1.4; `crew_wars` held 0 rows, verified). | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction: transfer leaves exactly 1 leader with ranks swapped, a stepped-down leader is refused 42501, ceiling model exact on three profiles |

| 360 | `360_workout_plausibility_and_head_to_head.sql` | **The plausibility model finally runs on the server.** `detectImplausibleWorkout` was client-only and `workout_logs` had no triggers, so a crafted request wrote anything. A BEFORE INSERT/UPDATE trigger now sets `implausible` + `implausible_ratio` from the lifter's modelled daily ceiling, summing the same day's other logs so the answer to a cap is not "post it in ten pieces". **It FLAGS, it does not reject** — a reject destroys the session (weight_lbs is blank on 33 of 60 profiles, so a strong lifter with an empty profile trips a 160 lb ceiling honestly), the real client already blocks, and a reject teaches the threshold while a flag accumulates the pattern a ban decision needs. The trigger assigns the column on every write, so a client cannot self-declare `implausible = false`. A flagged session stops counting toward a crew war — volume, sessions AND days; 359 capped volume alone, which left the 50/100-point session and day components fully payable on a forgery. Does NOT touch XP, gym leaderboards or weekly reviews. **Also: the war shows BOTH rosters** — `get_crew_war_breakdown` returned own-crew members only; it now returns every member of both crews with a name and a score, and withholds `volume_lbs`/`sessions`/`days_active` for rivals (a rival's score is the contest, their training calendar is not). Still gated on belonging to one of the two crews. | Idempotent — `ADD COLUMN IF NOT EXISTS`, guarded `DROP TRIGGER`, `CREATE OR REPLACE`. Backfill is a no-op UPDATE that fires the trigger, so history is classified by the same rule as new rows. Verified in a rolled-back transaction: honest 11,250 session unflagged, forgery flagged at ratio 14.06 despite the client sending FALSE, and a day split across four rows caught (2 flagged) |

| 361 | `361_implausible_excluded_from_xp_and_gym_boards.sql` | Extends 360's `implausible` flag from crew wars to the credited-volume path and the gym boards: `reconcile_my_workout_volume` (credits `user_profiles.total_volume_lbs`), `get_gym_consistency_leaderboard`, `get_gym_community_progress`, `get_gym_public_preview`, `get_gym_vs_gym_leaderboard`, `league_active_days`. **The line is competitive-or-credited vs personal history** — 24 functions read `workout_logs` and they do not get one treatment. A row ranked against other people or converted into a balance filters; a row shown back to the person who wrote it does not, because hiding a session from someone's own weekly review makes the app lie to them about their own week, and a false positive (weight_lbs is set on 27 of 60 profiles) would delete real history from the only place they would notice. `reconcile_my_workout_volume` carries the SAME predicate on its SELECT and its UPDATE — filtering only the sum would stamp a flagged row `volume_credited_at` while crediting nothing, spending it silently. Every body is the INSTALLED definition via `pg_get_functiondef` plus one predicate, not a reconstruction. `NOT COALESCE(implausible, FALSE)` throughout, never `= FALSE`: a row that escaped the backfill is NULL and must read as fine. **Still unfiltered and listed in the migration foot, not missed**: `complete_bounty_claim`, `complete_gauntlet_challenge`, `submit_duel_result_atomic` (each takes a specific `p_workout_log_id` and needs an early guard, not a WHERE), plus `get_friend_leaderboard` and `get_period_leaderboard`. | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction with a seeded 450,000 lb forgery: gym volume 2250 not 452250, gym and consistency active-days 1 not 2, reconcile delta 2250, league active days 1, and the forgery left uncredited rather than stamped |

| 362 | `362_flagged_logs_cannot_buy_awards.sql` | The last five paths that accepted an implausible log. **Two shapes, two treatments.** `complete_bounty_claim`, `complete_gauntlet_challenge` and `submit_duel_result_atomic` each take a specific `p_workout_log_id`, so each gets an early guard (`public.workout_log_is_flagged`, internal) right after the ownership check it already does, raising `implausible_workout_log` (22023). **Raising is right here and was wrong in 360**: refusing to SAVE a workout destroys the session, refusing to SPEND one on a bounty costs only the bounty — the log stays in their history, so a false positive is recoverable. `get_friend_leaderboard` and `get_period_leaderboard` are aggregates and take 361's predicate. Two edit hazards worth knowing: `get_period_leaderboard` needed **parentheses**, not just an AND — its `WHERE v_since IS NULL OR date >= v_since` would otherwise have become `v_since IS NULL OR (date >= … AND NOT implausible)` and left the all-time board unfiltered while looking right; and `get_friend_leaderboard` was rebuilt **alias-free** (`#variable_conflict use_column`) because its body ran on `wl.` / `hf1.` / `p.` tokens the clipboard mangles, with the hub_follows self-join re-expressed as two CTEs plus EXISTS. The three award bodies are the INSTALLED definitions with the guard INJECTED, not retyped. | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction: friend board 2 rows before / 2 after with a 0-row symmetric diff on seeded mutual follows, duel refuses a forged log with `implausible_workout_log` and still accepts an honest one, gauntlet refuses. Bounty's guard is the same three injected lines and was not separately exercised |
| 363 | `363_gym_rival_week_state.sql` | **The rival's number was structurally always zero.** `getWeeklyRivalStats` read the RIVAL's `workout_logs` / `cardio_logs` from the browser, and both tables carry one owner-only policy with no rival exception — so the right-hand column of the Gym Rival scoreboard could never be anything but 0, and the screen rendered "0 — 0" and concluded "Dead even — keep training." Measured on production 2026-08-16: 0 of 44 assignment rows have ever been confirmed, accepted, settled or won. Adds `gym_rival_week_state(assignment)` — SECURITY DEFINER, gated on the caller being one of the two participants, returning both sides' RAW volume and distance (so the client formats with the user's own weight/distance preference), the settler's own week window, the 48h AFK deadline, who has logged since accepting, and `is_stalled`. **The window matches `gym_rival_settle_week()` exactly** — `date_trunc('week', accepted_at)` to +7 days — so what the screen counts is what the settler scores; the UI's old countdown was `msUntilWeekEnd()`, pure calendar arithmetic that never read the assignment, which is why three rows 69–77 days old with `accepted_at` NULL still printed "14h 18m left" and re-armed every Monday. **Also fixes the cardio AFK void**: `gym_rival_void_stale_all()` and `gym_rival_void_stale()` tested `workout_logs` only, so a Cardio Rival match voided at 48h even when both runners logged every day; both now branch on `rival_type`. | Idempotent — `CREATE OR REPLACE` only, plus REVOKE/GRANT. Read-only RPC; the cron-only voider stays REVOKEd from anon and authenticated |

| 364 | `364_gym_rival_matchmaking.sql` | **Gym Rival matchmaking, modelled on Crew Wars** (kegan, 2026-08-16). `gym_rival_roll` ordered candidates by `abs(total_xp - my_xp)` and nothing else — lifetime XP is an account-age proxy, not a measure of how someone trains, and it is blind to the contest (a Cardio Rival week is decided on distance, which XP says nothing about). Ports `crew_match_gap`'s shape to one lifter: a weighted distance normalised to [0,1] whose important property is that a dimension unknown to EITHER side is dropped from numerator AND denominator, so a missing bodyweight neither penalises nor flatters (only 27 of 56 profiles carry `weight_lbs`). Weights — 3.0 weekly OUTPUT in the contest's own metric (volume for gym, distance for cardio), 2.0 cadence in days/week, 1.5 level, 2.0 bodyweight-relative strength (both known only, same e1RM/bodyweight basis as `crew_match_strength`), 1.0 age (both known only). Adds `gym_rival_user_stats(uid, type)` and `gym_rival_match_gap(...)`, plus `gym_rival_assignments.match_gap` so the UI can state how close a matchup is instead of asserting it is fair. Also new: a **21-day rematch cooldown** (pass 2 drops it rather than reporting no rivals on a small pool) and **near-tie jitter** — candidates within 0.02 take a coin flip, so Reroll can actually return someone else. | Idempotent — `ADD COLUMN IF NOT EXISTS` + `CREATE OR REPLACE`. Verified in rolled-back transactions: identical inputs → 0.0000, maximally apart → 0.9947, unknown-on-one-side exactly equals unknown-on-both (0.1778); a live roll returned a pending row at gap 0.0767; and on seeded profiles the new ranking picks a lifter who trains identically on a 3-week-old account (gap 0.0434) where the old XP ordering picked someone with 3.5x the weekly volume whose lifetime XP was within 100 |

| 365 | `365_gym_rival_roll_needs_a_reachable_rival.sql` | **`gym_rival_roll` threw 23502 and destroyed the whole match whenever it picked an anonymous guest.** The roll ends by notifying the rival — `INSERT INTO notifications (user_id, user_email, …) SELECT v_rival, email … FROM auth.users` — and `notifications.user_email` is NOT NULL while `auth.users.email` is NULL for every `signInAnonymously()` account. The exception aborted the function, taking the new assignment row AND the reassignment of the caller's previous match with it; the client caught it as a generic failure and rendered "Could not find a Gym Rival. Try again", so it read as an empty pool rather than a crash, and a retry drew from the same pool and failed again. Measured on production 2026-08-16: **9 of 14 eligible candidates were emailless guests**, so roughly two rolls in three failed outright. NOT introduced by 364 — that notification block is unchanged since the feature shipped — but 364's verification is what surfaced it. Two-part fix: the candidate pool now requires an email (a rival who cannot be told cannot accept, and a match stays PENDING until they do; guests are also swept after 7 days, so such a match was dead on arrival even when the INSERT happened to succeed), and the notification INSERT carries `AND email IS NOT NULL` so delivery failing can never again destroy the match. | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction as a real authenticated user: 9 of 9 rolls returned a rival (cardio + 8 gym rerolls), 0 emailless rivals picked, the 21-day cooldown skipped the rival just matched, and 8 rerolls produced 3 distinct opponents |

| 367 | `367_crew_generational_challenges_and_trophies.sql` | **Pre-built generational crew challenges, and the trophy completing one pays out** (kegan, 2026-08-16). The leader picks from a catalog gated on crew level; each challenge carries a unique trophy the crew keeps. The leader-composed challenge from 098 stays (kegan's call) — both kinds live in `crew_challenges` and `template_key IS NULL` means the old free-form kind. Measured first: `crew_challenges` held **ZERO rows** in production and `crew_challenge_contributions` zero, so the composed feature had never been used once since 098 and nothing here migrates data. New: `crew_challenge_templates` (public reference data, seeded with four level-1 rows, one per metric), `crew_trophies` (crew-owned, unlike per-user `user_trophies`; `title` copied in at award time so retuning the catalog cannot rewrite a trophy somebody already holds), `get_crew_challenge_catalog` (returns LOCKED rungs too — a ladder whose next rung is invisible gives a crew no reason to level up), `start_crew_generational_challenge` (leader-only, per 358's precedent), `get_crew_trophies`. **`ends_at` loses its NOT NULL** — a generational challenge has no deadline and NULL says so, where a far-future sentinel renders as "ends in 36,500 days", a lie the user can see. **The client cannot create a templated challenge**: the INSERT policy is `is_crew_moderator`, so a rank-2 member who could set `template_key` from the browser would post `target_value=1` against a template and mint the crew's trophy in one request — the guard trigger nulls `template_key` on every client INSERT and pins it on UPDATE, leaving the definer RPC as the only door. Window floor is the LATER of challenge start and `joined_at`, so a crew stuck at 80% cannot recruit a veteran and land his back catalogue on the bar. One member is capped at 60% of the target, so a goal cannot be soloed but a crew of two can still finish it. **Also closes a missed hole from the 361/362 sweep**: `sync_my_crew_challenge_progress` reads `workout_logs` for volume/sessions/days and pays XP, coins and `award_crew_progress`, with no plausibility filter — it is squarely competitive-or-credited and CLAUDE.md's list classified only fifteen of the twenty-four readers. Now `NOT COALESCE(implausible, FALSE)`. | Idempotent — `CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING` on the seed. Verified in rolled-back transactions against production across three probes, 33 assertions: catalog returns 4 rows all `available`; leader start writes `template_key` with `ends_at=null`; restarting the same template and starting a second while one is active both refuse; a rank-1 member is refused (42501) and a non-member cannot read the catalog; a smuggled `template_key` on a client INSERT comes back NULL; a level-5 template reads `locked` and refuses to start. The 360 trigger flagged a seeded absurd row itself, and credited days came to **12, not the 13 that counting it would give**; one member capped at **6 of 10**, leaving the challenge active; a member whose `joined_at` was moved to 3 days ago credited **3, not 12**. On completion the trophy row appears (`crew_thirty_days / Unbroken`), the catalog flips to `earned`, and a re-sync returns `{"updated": 0}` with still exactly one trophy |
| 366 | `366_notifications_always_have_a_deliverable_email.sql` | **Ten notification RPCs raise 23502 whenever their target is an anonymous guest, and the exception rolls back whatever the caller was doing.** All ten share one shape — `SELECT email INTO v_email FROM auth.users` then `INSERT INTO notifications (user_email …)` — and they are asking the wrong table: measured 2026-08-16, `auth.users.email` is 29 of 56 populated (0 of 27 guests) while `user_profiles.email` is **56 of 56** (27 of 27 guests). Affected, confirmed by reading the installed bodies: `create_notification_for`, `notify_friend_follow_for`, `notify_friend_post_for`, `_notify_duel_result_inner`, `gym_rival_decline`, `notify_league_resolution_for`, `notify_league_resolution_internal`, `notify_gym_rival_assigned_for`, `notify_gym_rival_overthrown_for`, `gym_rival_settle_week` (two inserts). **Urgent rather than theoretical: 21 of the rows in `league_members` are emailless guests, and `resolve_league_bracket_internal` calls the league notifier from inside its per-member loop under the `roll_weekly_leagues` cron — so one guest outcome aborts the entire weekly league rollover for every user.** It has not fired only because `qualified` has been 0 in every league to date; a member of the current week already has two active days. Fixed with ONE trigger rather than ten rewrites, following mig 264's precedent: a BEFORE INSERT trigger fills `user_email` from `user_profiles` when an insert leaves it NULL, which also immunises every notify RPC written from here on. Safe because `user_email` is denormalised for delivery, not identity, and the push fan-out does not read it (verified — `notify_push_fanout_batch` never mentions the column). | Idempotent — `CREATE OR REPLACE` + guarded `DROP TRIGGER`. Verified in rolled-back transactions on a real fixture: `gym_rival_decline` against a guest counterpart threw 23502 before and SUCCEEDED after, filling `guest_<uuid>@flexyn.guest` from the profile; a supplied address is preserved unchanged |

| 367 | `367_public_crew_badges.sql` | Shows a lifter's crew under their username on the Gym Rival screens (kegan, 2026-08-16). Needs a server function because `crew_members`' only SELECT policy is `is_crew_member(crew_id)` — a client can read membership ONLY for a crew it already belongs to, so a direct query for a rival's crew returns an empty set rather than an error and the badge would render blank for almost everyone. Same shape as the Gym Rival stats defect fixed in 363. `public_crew_badges(uuid[])` is SECURITY DEFINER, authenticated-only, batched (the menu needs two lifters at once), and returns name / tag / avatar keyed by user. **Every crew is visible, public or private** — kegan's call: private crews stay visible and privacy is enforced at the JOIN instead (apply, and a moderator or leader accepts). Measuring agrees: **all 4 production crews are private**, so a public-only gate would have rendered the badge for nobody. The badge carries identity only — no rank, roster, war record or activity. Two things measured while building it: `crews.tag` is **NULL on all 4 crews**, so the client normalises it and never renders an empty bracket; and one crew per user is an invariant enforced by the `crew_members_one_crew()` trigger (23505), so "which crew" has one answer. | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction as a real authenticated user who belongs to NO crew: all 4 real crews returned for their members, which a direct client read cannot do; empty array, NULL array and a crewless user each return 0 rows. **The OUT params are named `member_id` / `badge_crew_id` on purpose** — naming them `user_id` / `crew_id` shadows the `crew_members` columns and raises 42702 |

| 368 | `368_crew_applications.sql` | **Moderators can now review crew applications, and somebody is finally told one exists.** Private crews are visible and joining is an application a moderator or leader accepts (kegan, 2026-08-16). Two real gaps: `list_crew_join_requests` and `decide_crew_join_request` both gated on `is_admin = TRUE`, the legacy boolean predating 357's rank vocabulary — a moderator is rank 2 with `is_admin = FALSE`, so they could neither see the queue nor decide it; both now use `crew_rank() >= 2`, and `CrewJoinRequests.jsx` moves from `RANK.LEADER` to `>= RANK.MODERATOR` in the same commit. And nothing notified anyone — an AFTER INSERT OR UPDATE OF status trigger tells every rank-2+ member when an application arrives, and `decide_` tells the applicant the outcome. **A wrong conclusion is recorded in the migration head rather than deleted**: the first draft added a `request_to_join_crew` RPC because no such function existed and `crew_join_requests` has no INSERT policy. Both true, conclusion false — `join_crew_atomic` already files the application for a non-public crew with `ON CONFLICT DO UPDATE` and returns `status='requested'`, and being SECURITY DEFINER it needs no INSERT policy. Shipping the new RPC would have produced two implementations of one rule. `crew_join_requests.message` is deliberately left unwritten — no surface collects one. | Idempotent — `CREATE OR REPLACE` + guarded `DROP TRIGGER`. Verified in a rolled-back transaction driving the EXISTING door: join_crew_atomic → 'requested', 3 reviewers notified, re-apply stays 1 row, moderator sees the queue, applicant sees 0 and is refused 42501 on self-approve, moderator approves → member, applicant notified |

| 369 | `369_postdeploy_fixes.sql` | **Four defects found by an adversarial post-deploy verification of 363–368**, each reproduced against production in a rolled-back transaction. Two are regressions from this batch. **(1) 363's match week had no right edge** — every aggregate was bounded `>= v_since` only while `week_ends` was returned and rendered as "this week". Live assignment 24675d94 reported `you_distance` 3941.54 for the week of 2026-06-08 when the true in-week total was **0**; all of it came from sessions dated 2026-08-07/09, eight weeks past the window. Invisible until now because `gym_rival_settle_week` normally closes a match when the window passes — it can't for rows with NULL `accepted_at`, which is all three live ones. **(2) 364's roll destroyed the caller's match before knowing a replacement existed** — the `SET status='reassigned'` was the FIRST statement and the `IF v_rival IS NULL THEN RETURN` came after both search passes, so an empty pool cost you the match you had and returned nothing while the client said "No available rivals — check back soon". Reachable by the passage of time alone (pool 3 → 0 by 2026-08-20 on the 7-day activity filter); the WHERE also matched `rival_id = v_uid`, silently cancelling a challenge somebody else sent you. Search now runs before any mutation. **(3) 366's fill could still raise 23502** — `user_profiles.email` is nullable AND client-writable (`authenticated` holds column UPDATE, and the privileged-column guard doesn't cover `email`), so a user can null their own and make every notify path targeting them abort its caller. Verified as a real authenticated user. The fill now falls through user_profiles → auth.users → an RFC 2606 `.invalid` placeholder and can never return NULL. **(4) 368's rank>=2 gate made a reviewer-less crew a permanent dead letter** — crew "Butt Crackers" is private with one rank-1 member who is also `crews.created_by`: applications filed, 0 notifications, `list` returned `[]`, `decide` raised 42501, and the member could not promote himself. Adds `crew_can_review()` (rank>=2, OR any member when the crew has NO rank>=2 member — self-healing) and a one-shot backfill promoting the oldest member of any reviewer-less crew. | Idempotent — `CREATE OR REPLACE` only, plus one guarded backfill UPDATE. Verified rolled-back: in-window distance 3941.54 → **0.00**; empty pool → 0 rows returned and the live match stays `active` (open matches 1/1); reviewer-less crews 0; nulled profile email → notification lands via the auth.users fallback, no 23502. Positive controls: healthy pool still rolls (gap 0.0654), exactly one open match after, 3 distinct rivals over 6 rerolls, 0 emailless rivals picked |

| 370 | `370_crew_discovery_lists_every_crew.sql` | **Crew discovery rendered empty for every user, and had since crews shipped.** `get_public_crews` filtered `WHERE is_public = TRUE`; all 4 production crews are private; the column defaults to false and **nothing in the product can set it** — `create_crew_atomic` inserts only (name, created_by) and the single client UPDATE path passes `avatar_url`. So the directory and `get_suggested_crews` both returned 0 rows for all 56 users and a DM link was the only way into a crew. The fix is not a visibility toggle but kegan's rule (2026-08-16): private crews stay VISIBLE and privacy lives at the JOIN — `join_crew_atomic` already refuses a private crew and files a `crew_join_requests` row instead. Dropping the filter reveals a crew's public identity (name, tag, avatar, member count, level, trophies, war record) and nothing about its roster: `crew_members` is member-only readable, and messages, war board and treasury are each gated independently. Rows gain **`is_public`** so the button can say Apply rather than Join before the tap, and **`request_status`** — the CALLER's own pending request, scoped to `auth.uid()` — so "Awaiting review" survives a reload instead of living only in React state. `is_public` is deliberately not a filter or a sort. | Idempotent — `CREATE OR REPLACE` only. Paste-safe by construction like the function it replaces: every CTE renames its columns and joins USING them, so there is no short `alias.column` token to mangle. Verified in a rolled-back transaction as a real authenticated user: **4 crews listed, was 0**; first row carries `is_public=false` and `request_status=null`; the name/tag/description search still filters |
| 371 | `371_view_and_reaction_email_leak.sql` | **Two tables handed every user's email to anyone holding any signed-in token.** `hub_post_views` (mig 111) and `story_reactions` (mig 097) both shipped `FOR SELECT USING (TRUE)` plus a table-level SELECT grant to `authenticated`, and both carry a denormalised email column — so `?select=viewer_email` / `?select=user_email` returned the whole user base. `SignInToContinue` offers one-tap anonymous sign-in, so the token costs nothing. `hub_post_views` is the worse of the two: `HubPostCard` writes a row for every post scrolled past (IntersectionObserver, 2s dwell), making it a full who-read-whose-post graph the product exposes nowhere. Same class as 195/207/220/283, same shape 292 fixed on `hub_reactions`. **Narrowing is safe because every consumer was checked first**: `hubPostViews.js` only ever issues `.select('id', { count: 'exact', head: true })` — it counts rows and never reads `viewer_email`, and its sole surface is `CreatorAnalyticsPanel`, mounted behind `analyticsOpen && isMine`, i.e. an author on their OWN post. `storyReactions.js` only writes and reads the caller's own row; `listReactionsForStory()` is the one function selecting `user_email` and it is **dead — zero call sites**. So reads become author-or-self (`hub_post_views`) and own-row (`story_reactions`). **RLS is row-level, so the email columns also need a GRANT change**: narrowing rows still left a post's author able to harvest the email of everyone who viewed their post, so the table-level SELECT is revoked and re-granted per column with `viewer_email` deliberately absent — order is load-bearing, a column GRANT does not override a table-level one. Identity goes through `public.current_user_email()` (mig 241), never `auth.email()`, which is NULL for the guest tokens most likely to be scrolling the feed. | Idempotent — `DROP POLICY IF EXISTS` before every `CREATE`. Paste-safe: no `alias.column` tokens, correlation done with `post_id IN (SELECT id FROM public.hub_posts …)` rather than an aliased EXISTS. **NOT YET APPLIED to production** — the bundle ends in two verification SELECTs that are the proof it ran: no SELECT policy on either table may still carry `qual = true`, and `has_column_privilege('authenticated', …, 'viewer_email'/'user_email', 'SELECT')` must be false for both |
| 372 | `372_crew_description_and_tag_profanity.sql` | Extends the crew slur gate from `name` to `description` and `tag`, which the crew settings sheet makes writable for the first time (measured 2026-08-16: 4 crews, 0 with either set). Migration 370 now lists every crew to every signed-in user, so both columns are public text. **The trap: the trigger was `BEFORE INSERT OR UPDATE OF name`, so `CREATE OR REPLACE FUNCTION` alone changes nothing** — the new body is verifiably live on the trigger and an `UPDATE crews SET description = <slur>` still goes through, because the column list is the gate. This migration recreates the TRIGGER. `is_text_clean` is a slur and harassment filter, not a swear filter, and this does not move that line. | Verification attempts the writes rather than checking the function exists — that is the only thing that distinguishes the fix from the no-op above |
| 373 | `373_gym_rival_bodyweight_volume.sql` | **Bodyweight training scored zero in Gym Rival and the zero reached the payout.** Every rival volume query was `SUM(weight * reps)` filtered to numeric weights, so a real production set (Push-Up, weight 0, reps 5) contributed nothing — while `you_logged` is a bare EXISTS and returned TRUE. The disagreement is the bug: the lifter shows 0 lb beside a rival's real number, `gym_rival_net_rating` can only draw or lose, and `gym_rival_void_stale` will not release them because it voids on *did not log*. A calisthenics athlete was locked into a week they could not win, and matchmaking read them as never training. **The formula had been copied into four places** (week_state computes it twice), so this adds ONE function and repoints all three callers rather than patching the expression four times. Load is `bodyweight × factor + added_weight`, factors set by kegan for pull-up 1.0 / dip 0.95 / push-up 0.65 and the rest on the same basis, drawn from the movements `exerciseEquipment.js` already classifies as bodyweight so the two lists can be diffed. **Holds and unrecognised names are 0 on purpose** — a plank's reps are seconds, and scoring bodyweight × 60 would make the plank the strongest lift in the app. | No bodyweight on file means no credit, deliberately. Weighted calisthenics now score the athlete's mass AND the belt; the old expression scored the belt alone |
| 376 | `376_guest_trophies_carry_a_findable_email.sql` | **A guest's earned trophies are invisible on every surface that looks them up by email.** Starts with a correction: I reported that `grant_eligible_trophies` throws 23502 for a guest, having read migration 167 instead of the installed body. 167 DID ship a bare `auth.email()`, so the crash was real when it shipped, and **migration 293 fixed it when guest mode landed** by wrapping it `COALESCE(auth.email(), '')`. Nothing throws today. **The COALESCE is the real defect, and it is quieter.** A guest's trophy row is written with `user_email = ''` — measured on production: **12 rows across 9 users**, with 27 of 56 profiles carrying no `auth.users.email`. That is not inert, because `user_trophies` is read BY EMAIL on two live paths (`leaderboardStats.js:45`, `ProfileBadgeShowcase.jsx:93`, both falling back to the address when no user id is to hand). A guest has a perfectly good `user_profiles.email` (56 of 56 populated), so the lookup runs with a real address and matches nothing. The trophies are not lost, they are unfindable by the key those callers use. Same root cause 366 found for notifications, and the same fix: ONE `BEFORE INSERT OR UPDATE OF user_email` trigger rather than rewriting the writers, so `grant_eligible_trophies` and `award_league_season_internal` are left untouched and may keep writing `''`. Applied to `user_capsules` and `user_inventory` too — both measured clean (0 of 202, 0 of 288) but both written by the same `COALESCE(p_email, '')`. **The one difference from 366 is the whole point**: `notifications_fill_user_email` tests `IS NULL` only, and here the bad value is the EMPTY STRING that `COALESCE` produces and a NOT NULL column accepts. | Idempotent — `CREATE OR REPLACE` + guarded `DROP TRIGGER`, and the backfill is written as an UPDATE through the trigger so the fallback chain is not duplicated. Verified in a rolled-back transaction on production, 9 assertions: empty rows 12 -> **0**, **61 of 61** trophy rows now match their owner's profile address, a named guest goes from 0 to **2** rows returned by an email lookup, a fresh insert writing `''` comes back as the guest address, and a supplied real address is preserved unchanged. **The negative test is the one that justifies the design: a NULL-only guard would have matched 0 rows**, so 366's exact pattern would have been a silent no-op here |
| 378 | `378_matchmaking_gives_for_a_stronger_smaller_crew.sql` | **A small crew that tried to make up a roster gap with strength was pushed further away by doing it.** Kegan: "make mismatch in members possible if one of the members is just incredibly strong, there should be some give for faster matchmaking." **The reason it never matched is that the two terms fought each other**: a small-but-strong crew paid the roster penalty AND paid again for the strength difference that was compensating for it. Measured on the installed function, 2v5 with the small crew much stronger scored **0.2532** against a 0.15 first-pass tolerance. **The argument for loosening is not "matchmaking is slow"** — `recompute_crew_war` already scores each side's TOP N where N is the SMALLER roster (mig 356), so a five-person crew never fields five against a four. Roster size is already neutralised at scoring time, and the matchmaker was spending 2.0 of a 9.5 denominator guarding an unfairness the scoring rule had removed. Three changes: roster weight **2.0 -> 1.2**; the roster term is discounted up to **75%** by how much stronger the SMALLER crew is per head; and the strength term becomes **asymmetric**, dropping 2.0 -> 0.5 only in the direction where the smaller crew is the stronger one, because there it is compensation rather than mismatch. The denominator carries the same asymmetric weight so the result stays normalised to [0,1] and the 0.15 tolerance keeps its meaning. Signature unchanged; `join_crew_war_queue` and `pair_waiting_crew_wars` both call it positionally. **THE GATE ON `sizes_differ` IS LOAD-BEARING AND WAS MISSING FROM THE FIRST MODEL.** `p_roster_a <= p_roster_b` treats an EQUAL pairing as "a is smaller", so two four-person crews with wildly different strength collected the compensation discount and matched far too easily: 4v4 at 2.20 against 1.00 fell from 0.1283 to **0.0354**. Gated, it reads 0.1254, essentially unchanged — correct, because with equal rosters there is no size gap for strength to compensate for. Caught by modelling the formula against a case table before writing the migration, not after. | Idempotent — `CREATE OR REPLACE` only. Verified in a rolled-back transaction on production: 2v5 small-much-stronger **0.2532 -> 0.0649**, 2v5 slightly-stronger -> 0.0972, 2v6 much-stronger -> 0.0670, all now inside the first-pass tolerance; **2v5 with the small crew WEAKER stays refused at 0.1535**; cross-division 2v5 stays at 0.4816 so division still dominates and a strong small crew cannot jump leagues; identical crews 0.0000 and the extreme case 0.9911, so the result stays bounded |
| 379 | `379_notification_metadata_names.sql` | **Three notification types named somebody and stored only an id, so the reader could never see them in their own language.** `notifications.title` is written once and never re-rendered, so a row is frozen in whatever language produced it — proven in production data, where a live `streak_milestone` row reads `🔥 Racha de inicio: ¡Día 1!` regardless of that user's language now. `src/lib/notificationText.js` rebuilds the sentence from `type` + `metadata`, but only when metadata carries everything the sentence names. Three live types did not: `crew_war_started` and `crew_war_resolved` render "⚔️ Crew war vs Spermguzzlegains" off `opponent_crew_id` alone, and `nemesis_assigned` renders "@sefseg declined the challenge" off `assignment_id` alone. **The name is already in scope in every writer** — `v_crew_b.name`, `v_opponent`, `v_name` — so the obvious fix is one extra pair per `jsonb_build_object`. There are FOUR writers (`notify_crew_war_started_for`, `notify_crew_war_resolved_for`, `gym_rival_roll`, `gym_rival_decline`), and restating them means re-emitting ~250 lines of working SECURITY DEFINER code dense with `v_war.crew_a_id` / `cm.user_id` / `up.email` — precisely the tokens the paste pipeline turns into `42601`. **Migration 264 made this call already**, in its own words: a trigger "rather than by restating 22 SECURITY DEFINER functions". One BEFORE INSERT trigger resolves the name into metadata, and it buys what the per-function edit cannot: any FUTURE writer of these types is enriched without anybody remembering to. Cost is one indexed lookup per inserted row on three types; every other type returns before touching a table. **`nemesis_assigned` has THREE writers and three shapes**, which only the live rows revealed: `gym_rival_roll` stores `initiator_id`, `notify_gym_rival_assigned_for` stores `rival_name` and has never fired, and `gym_rival_decline` stores neither party — so for the decline the actor is derived as whichever side of the assignment is not the recipient. | Idempotent — `CREATE OR REPLACE` + guarded `DROP TRIGGER`, and both the trigger and the backfill skip a row that already carries the name. The backfill is a `DO` loop with scalar variables rather than `UPDATE ... FROM`, because the join form needs `n.metadata` / `c.name` / `a.user_id` and would mangle on paste. Verified in a rolled-back transaction on production: trigger installs, **18 crew-war rows named**, and a seeded probe proves both `nemesis_assigned` shapes — the invite resolves to the initiator and the decline resolves to the other party. **`rival_rows_named` comes back 0 and that is correct, not a bug**: all four live `nemesis_assigned` rows point at a profile and an assignment that have since been deleted, so there is no name to resolve and the client keeps falling back. Checking that before calling it a defect is the difference between a fix and a wrong diagnosis |
| 377 | `377_hide_from_search_is_enforced.sql` | **"Hide from search" did nothing, on either surface that names it.** Settings → Privacy has written `user_profiles.hide_from_search` since migration 117 and its own comment says the flag "removes the account from user-search + PYMK" — nothing read it. `filterSearchable()` in `src/lib/privacy.js` exists for exactly this job, says so in its docblock ("Used by: User search / PYMK"), and had **zero call sites**: it appeared only in comments. Neither `get_suggested_followees` nor `get_people_you_may_know` mentioned the column. So a user who turned the toggle on stayed in search results, in People You May Know and in the follow-suggestion rail, with nothing to indicate the setting was inert. Both functions now exclude `hide_from_search`, and the client half ships in the same commit: search applies `filterSearchable` to the list it already holds, and both halves of `getRecommendations` plus the PYMK profile fetch filter in the QUERY so a hidden profile never crosses the wire. **Hiding affects DISCOVERY, not existence** — a hidden profile is still reachable by link, still visible to its own followers, still owns its posts. That is what the toggle claims, and it is why this is a filter on two functions rather than an RLS change: making the row unreadable would break the feed for people already following them. `IS NOT TRUE` rather than `= FALSE` because the column is NOT NULL today but an ALTER dropping that would turn `= FALSE` into "exclude everyone whose flag is unset". | Idempotent — `CREATE OR REPLACE` plus REVOKE/GRANT. **Both bodies are restated CTE-first with no `alias.column` tokens**, so the bundle survives the paste pipeline: the previous `get_suggested_followees` used a `p.` alias throughout, and adding one WHERE line to it would have shipped a bundle that mangles on paste. Same signatures, column order, ordering, clamps and auth guard as before. Self-verifying, and it verifies by CALLING rather than by inspecting `pg_proc` — a rewritten body that raises 42702 "ambiguous column" only fails when invoked, which is why migration 239 exists for this same function. Impersonates a real user, counts the rail, hides whoever it offered first, counts again, and asserts both directions inside a rolled-back transaction: hidden users disappear AND ordinary users still come back, since a function returning nothing would satisfy the exclusion check on its own |
| 375 | `375_plausibility_reaches_gym_rival_and_solo.sql` | **Finishes the sweep 360/361/362/367 started, and the headline is that a forged workout was winning Gym Rival weeks and being paid for it.** Measured 2026-08-16: **31** functions read `workout_logs`, not the 24 CLAUDE.md recorded (the Gym Rival work 363-365/373/374 added several), 16 carried no plausibility filter, and only 5 of those were the documented deliberate ones. The other 11 had never been classified. The chain that mattered: `gym_rival_settle_week` -> `gym_rival_net_rating` -> **`gym_rival_volume_lbs`, which read `workout_logs` with no filter** -> picks `v_winner` -> `award_xp_internal`, flex coins, loot capsules and the "You won your Rival week!" push. Competitive AND credited, the strongest case on the filter side of the line, completely open. One predicate on `gym_rival_volume_lbs` closes four readers (settlement, `gym_rival_net_rating`, the `gym_rival_week_state` scoreboard, the `gym_rival_user_stats` matchmaker). Also filtered: `update_solo_challenge_progress` (solo challenges pay out; its `beat_any_pr` branch needed it twice, because the session count is the CLAMP on a client-supplied `p_prs_hit`), `gym_rival_user_stats`' own cadence and e1RM reads, and the `crew_match_cadence` / `crew_match_strength` matchmaking snapshots. **`mark_workout_volume_credited` is the subtle one**: 361 gave `reconcile_my_workout_volume` the same predicate on its SELECT and its UPDATE so a flagged row could not be stamped `volume_credited_at` while crediting nothing, but this is a SECOND client-callable path to that same stamp and had no predicate — a flagged row spent silently, and permanently uncreditable if the flag were ever cleared. Now a no-op on a flagged row rather than a RAISE, because the client calls it as bookkeeping after reconcile has already correctly declined. **Deliberately still unfiltered, and the reasoning is in the migration header so it is not rediscovered**: `gym_rival_void_stale`/`_all` (a PRESENCE question for the 48h AFK void — filtering means an honest heavy session that trips the model stops counting as showing up and voids the user's match), `sweep_stale_guest_accounts` (asks whether an account has ANY data before DELETING it), and `get_crew_weekly_stats`/`_crew_member_week_stats` (the crew's own panel, pays nothing, ranks only inside a group you already belong to — same call already made for `get_crew_inactive_members`, and the closest of the three). | Idempotent — `CREATE OR REPLACE` only. Every body is the INSTALLED definition via `pg_get_functiondef` plus one predicate. **`gym_rival_user_stats` proves why that rule exists**: written from memory it came out with a different RETURNS TABLE column order AND different names (`level, strength, age_years` vs the real `strength, lifter_age, lifter_level`), which would have reshaped the contract for every caller. Verified in a rolled-back transaction on production, 14 assertions, two of which discriminate 1000-fold: gym rival volume **1,350 not 1,351,350**, and solo-challenge progress **1,350 not 1,351,350**, against a seeded forgery the 360 trigger flagged itself. The credited-stamp guard was checked BOTH ways (flagged row not stamped, honest row still stamped) |
| 374 | `374_gym_rival_settlement_can_actually_pay.sql` | **Gym Rival settlement has never once completed, and it never could have.** Proven by execution against production — seeded, rolled back, with `auth.uid()` NULL, which is exactly the context pg_cron jobid 15 (`gym-rival-settle`, Mondays 00:05) runs in: settleable rows selected 1, `gym_rival_settle_week()` **raised 42501 unauthenticated**, assignments completed 0, winner XP unchanged, notifications 0. The cause is one line: the settler calls `increment_user_xp(v_winner, v_xp)`, and that function — read from the INSTALLED body, not migration 042 — opens `v_uid UUID := auth.uid()` and raises when it is NULL, while its `p_user_id` parameter is accepted and never referenced. That is deliberate and correct (042 made it ignore the client-supplied id so a caller cannot credit somebody else); it is simply the wrong tool for a cron settler, which has no session and legitimately must credit a third party. So the exception propagated and every Monday the job rolled back with nothing done. The second failure mode never got a chance to bite: invoked from a user session instead, `increment_user_xp` would have credited **the caller** 5,000 XP regardless of who won. **Two independent reasons nothing has settled, and this fixes one** — 44 assignments exist (41 reassigned, 3 active) with `accepted_at` NULL and both confirm flags FALSE on all 44, so the settler's WHERE has never selected a row either. This does not make the feature work; it makes it capable of working the first time somebody accepts. The accept path was **checked rather than assumed, and the first probe was wrong**: confirming both sides of an ACTIVE row returns success and writes nothing, which reads like a broken button, but those three are legacy pre-222 rows in exactly the `is_stalled` state `gym_rival_week_state` already reports; against a genuinely pending row the handshake is correct end to end. **The fix** is `award_xp_internal(uuid, integer)` — SECURITY DEFINER, in the shape CLAUDE.md documents for `is_blocked`, REVOKEd from PUBLIC / anon / authenticated so it is reachable only from other SECURITY DEFINER callers. **Not a relaxation of 042**: the client-callable `increment_user_xp` is untouched and still ignores its parameter, so anything a client can reach still credits `auth.uid()` and only `auth.uid()`. The awarder keeps BOTH protections of the function it mirrors — the append-only ledger that drives the rolling cap and is the tamper-proof log (188) — because "just UPDATE the row" would put an unlogged, uncapped XP write into the codebase, which is the hole the ledger exists to close. | Idempotent — `CREATE OR REPLACE` plus REVOKEs. Paste-safe: `NEW.`/`OLD.` and bare columns only. Self-verifying, and it verifies by DOING rather than by inspecting the catalog: seeds a match, settles it, and asserts settled-one / XP-to-the-winner / ledger-written / 5 capsules / 2 `nemesis_overthrown` notifications, all inside a savepoint that is rolled back, ending in a SELECT because the Supabase editor hides RAISE NOTICE |
| 379 | `379_crew_posts_reach_the_crew.sql` | **A crew-only post was readable by nobody, including the crew.** The composer has offered a Crew privacy since crews shipped and sends `crew_id` on all three of its `create()` paths; **`hub_posts` has never had a `crew_id` column**. `makeEntity().create` catches PostgREST's `PGRST204`, strips the unknown key and retries — by design, so the client can run ahead of an unapplied migration — so the insert SUCCEEDED and the scoping was discarded with no error anywhere. The row landed `privacy = 'crew'` with no crew, and the read policy admits only `public` or `followers`, so the single reader was the author. Not a leak, a black hole; one such row is in production (2026-05-25, body "hi"). **The branch asks whether the VIEWER is in `crew_id` and never asks anything about the author** — a deliberate decision (kegan, 2026-08-22): a crew post stays with the crew after its author leaves. Write side is a `BEFORE INSERT OR UPDATE OF crew_id` trigger rather than a restated WITH CHECK, the call 264 made, so `hub_posts: owner write` is left untouched. `is_crew_member` was already SECURITY DEFINER, granted to authenticated and a plain `SELECT EXISTS`, so it is legal in a policy and cannot RAISE — the trap 357 documents. **The guard is strict about a missing session**: with no JWT `auth.uid()` is NULL and the insert is refused, which is worth knowing before writing a cron job that posts to a crew. Found while verifying: seeding a crew post as `postgres` raised 42501 until the seed moved above the CREATE TRIGGER. `ON DELETE SET NULL`, never CASCADE — deleting a crew must not delete a member's posts. | Idempotent — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded DROP on the policy and trigger, `CREATE OR REPLACE` on the function, and it ends in a SELECT because the SQL editor hides RAISE NOTICE. **Equivalence was proved on seeded data, not asserted**: the policy rewrite was captured as a full visible-row-id set per viewer before and after, inside a rolled-back transaction on production, and diffed BOTH directions. A crew mate went 29 -> 30 gaining exactly `probe:crewX`; an outsider 28 -> 28; the author 33 -> 33; **nobody lost a row**. The crew mate did NOT gain the post addressed to a crew they are not in, nor the scheduled one, so the embargo and the wrong-crew case both still hold. Six further assertions as real authenticated users: the crew mate still sees the post **after the author is deleted from the crew**, posting into your own crew is accepted, into a crew you are not in is refused 42501, an ordinary post with no crew still works, MOVING a post into a crew you are not in is refused 42501 (the `UPDATE OF` gate), and an outsider still sees nothing. Probe identities were asserted, not assumed |

---

## Follow-up checklist for migrations 034 + 038

These two migrations enable **push notification delivery**. After
running them, the database is fully wired but won't actually deliver a
push until you complete the setup in
[`docs/push-notifications-setup.md`](push-notifications-setup.md):

- [ ] Generate VAPID key pair (browser DevTools snippet in the runbook)
- [ ] Set Edge Function secrets in dashboard → Project Settings →
      Edge Functions → Secrets:
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT` (e.g. `mailto:ops@flexyn.app`)
  - `SEND_PUSH_TRIGGER_SECRET` (any 256-bit hex string)
- [ ] Deploy `send-push` Edge Function (paste
      `supabase/functions/send-push/index.ts` into the Edge Functions
      UI, click Deploy)
- [ ] Add `VITE_VAPID_PUBLIC_KEY` to client `.env` (and Netlify env
      vars)
- [ ] Create two Vault secrets in SQL Editor (`send_push_url`,
      `send_push_secret` — see the runbook for the exact commands)

Until those are done, the trigger inserts notifications into the DB
correctly, but `notify_push_fanout()` no-ops on missing Vault secrets
and no Web Push is sent. That's safe — it's the intended
graceful-degrade path.

---

## The catalog above is enforced

`src/lib/__tests__/migrationCatalog.test.js` fails if a file in
`supabase/migrations/` has no row above, if a row names a file that no longer
exists, or if a filename appears twice. It runs with the rest of the suite —
`npm test` — and in CI on every push.

That guard exists because the catalog had reached 54 rows against 363 files
before anyone noticed. Nothing regenerates it: adding a migration is a code
change, adding its row is an act of memory, and the table stayed quietly
wrong for months while being consulted and believed.

**Editing this file triggers CI on purpose.** `.github/workflows/test.yml`
skips markdown-only pushes, since prose cannot break the suite and
`eslint.config.js` ignores `docs/**` outright — but it re-includes this one
file by name:

```yaml
paths-ignore:
  - '**/*.md'
  - '!docs/migrations-runbook.md'
```

Without that negation a runbook-only edit would skip CI, and the one change
most likely to break the catalog guard — editing the catalog — would be the
one change never tested.

---

## State check

Paste this into the SQL Editor to inspect what's deployed:

```sql
-- Migration evidence — counts row by row. All counts should match
-- the "Expected" column on a fully-applied environment.
SELECT 'columns on user_profiles' AS what,
       count(*)::int               AS actual,
       '15+'                       AS expected
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'user_profiles'
UNION ALL
SELECT 'notifications table exists', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'notifications'
UNION ALL
SELECT 'push_subscriptions table exists', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
UNION ALL
-- The fan-out is a STATEMENT-level trigger over a transition table, and the
-- name carries the `_batch` suffix. This check read `trg_notifications_push_fanout`
-- until 2026-08-20 and so reported 0 against a healthy database — which, given
-- push once sent nothing for months, is the most alarming possible false
-- alarm. Verified installed: AFTER INSERT ... REFERENCING NEW TABLE AS
-- new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_push_fanout_batch().
SELECT 'push fanout trigger', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'notifications'
   AND trigger_name = 'trg_notifications_push_fanout_batch'
UNION ALL
SELECT 'cron jobs (streak + welcome + quest)', count(*), '3'
  FROM cron.job
 WHERE jobname IN (
   'streak_break_reminders_hourly',
   'welcome_back_hourly',
   'quest_expiry_15min'
 )
UNION ALL
SELECT 'i18n text helpers', count(*), '6'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN (
     'streak_break_text', 'welcome_back_text', 'quest_expiry_text',
     'league_resolution_text', 'friend_post_text', 'friend_follow_text'
   )
UNION ALL
SELECT 'notify_*_for RPCs', count(*), '3'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN (
     'notify_league_resolution_for',
     'notify_friend_post_for',
     'notify_friend_follow_for'
   )
UNION ALL
SELECT 'vault secrets (push)', count(*), '2 (after setup)'
  FROM vault.secrets
 WHERE name IN ('send_push_url', 'send_push_secret')
UNION ALL
SELECT 'delete-own policy on notifications', count(*), '1'
  FROM pg_policies
 WHERE tablename = 'notifications'
   AND policyname = 'notifications: delete own'
UNION ALL
SELECT 'stories tables (043-047)', count(*), '6'
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'stories','story_views','story_likes',
     'story_blocks','status_notes','status_note_likes'
   )
UNION ALL
SELECT 'crews tables (048)', count(*), '5'
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'crews','crew_members','crew_messages',
     'roll_call_responses','crew_xp_claims'
   )
UNION ALL
SELECT 'crew RPCs (048)', count(*), '2'
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('is_crew_member','is_crew_admin')
UNION ALL
SELECT 'profile extension columns (049)', count(*), '4'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'user_profiles'
   AND column_name IN ('city','country_flag','trophy_case','trophy_case_visible')
UNION ALL
-- Expected 2, not 1. `information_schema.triggers` emits ONE ROW PER EVENT,
-- and this is `BEFORE INSERT OR UPDATE OF username`, so a single correctly
-- installed trigger appears twice. Confirmed 2026-08-20 against pg_trigger,
-- which holds exactly one row for it. Every other check in this file counting
-- an INSERT-only or UPDATE-only trigger stays at 1 for the same reason.
SELECT 'username profanity trigger (050)', count(*), '2'
  FROM information_schema.triggers
 WHERE event_object_table = 'user_profiles'
   AND trigger_name = 'trg_username_profanity'
UNION ALL
SELECT 'weekly_debriefs table (051)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'weekly_debriefs'
UNION ALL
SELECT 'injury_logs table (052)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'injury_logs'
UNION ALL
SELECT 'exercise_groups table (053)', count(*), '1'
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'exercise_groups'
UNION ALL
SELECT 'bio profanity trigger (054)', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'user_profiles'
   AND trigger_name = 'trg_bio_profanity';
```

---

## Migrations that need no SQL — what they DO need

Two pipelines here are not only SQL. **Nothing in this section lives in
`supabase/migrations/`** — replaying every migration into a fresh project
gets you the functions and crons and none of the config below, so each
one comes back wired to a dead endpoint. Treat this table as the
prerequisite list whenever a project is rebuilt or a cron "runs" without
doing anything.

The push step-by-step is in
[`docs/push-notifications-setup.md`](push-notifications-setup.md).

| Pipeline | Layer | What | Where to set it |
|---|---|---|---|
| Push | Client | `VITE_VAPID_PUBLIC_KEY` | `.env` locally + Netlify env vars |
| Push | Edge Function | `VAPID_*` and `SEND_PUSH_TRIGGER_SECRET` | Supabase dashboard → Project Settings → Edge Functions → Secrets |
| Push | Edge Function deploy | `send-push` | Supabase dashboard → Edge Functions → Deploy from UI |
| Push | Vault | `send_push_url`, `send_push_secret` | SQL Editor → `SELECT vault.create_secret(...)` |
| Weekly reviews | Edge Function | `DEBRIEF_CRON_SECRET` | `supabase secrets set` (see CLAUDE.md) |
| Weekly reviews | Vault | `debrief_func_url`, `debrief_cron_secret` | SQL Editor → `SELECT vault.create_secret(...)` |
| Storage GC | Edge Function | `STORAGE_GC_SECRET` | `supabase secrets set` (see CLAUDE.md) |
| Storage GC | Edge Function deploy | `storage-gc` | MCP `deploy_edge_function`, or dashboard |
| Storage GC | Vault | `storage_gc_url`, `storage_gc_secret` | SQL Editor → `SELECT vault.create_secret(...)` |

**A vault URL must carry the project ref, and a placeholder there fails
in a way nothing reports.** `storage_gc_url` shipped as
`https://YOUR-PROJECT-REF.functions.supabase.co/storage-gc` — the
template was never substituted. That hostname still resolves, so the
request reaches Supabase's functions gateway and comes back
`400 Project not specified.` into `net._http_response`, which nobody
reads. The cron logged `succeeded` every five minutes for as long as it
had existed. Correct form, matching `send_push_url`:

```
https://<project-ref>.functions.supabase.co/<function-slug>
```

Two cheap checks that would have caught it, both worth running after any
rebuild:

```sql
-- every vault URL should contain the project ref
SELECT name, length(decrypted_secret) AS len,
       position('<project-ref>' in decrypted_secret) > 0 AS has_ref
FROM vault.decrypted_secrets
WHERE decrypted_secret LIKE 'https://%';

-- a shared secret should look generated, not typed
SELECT name, length(decrypted_secret) AS len
FROM vault.decrypted_secrets
WHERE name LIKE '%secret%';
```

The URL lengths cluster tightly (60–73) when they are right, and every
shared secret should be **64** — a 32-byte hex string. `storage_gc_secret`
sat at 23 next to two siblings at 64, and it did not match what the
function had; the vault and the Edge Function env are two separate places
and nothing reconciles them. Rotate both together:

```sql
SELECT vault.update_secret(
         (SELECT id FROM vault.secrets WHERE name = 'storage_gc_secret'),
         encode(extensions.gen_random_bytes(32), 'hex'),
         'storage_gc_secret'
       );
```

then push the new value into the function without printing it, using the
`supabase db query --linked` → `supabase secrets set` chain documented in
CLAUDE.md. Rotating breaks the old secret immediately, so the cron returns
401 until the second half lands.

---

## `net._http_response` lies about success

The section above is about a cron reporting `succeeded` while doing
nothing. This is the mirror image, and it bites when you go looking for
the first problem: **a row in `net._http_response` with `timed_out = true`
does not mean the work failed.**

`net.http_post`'s `timeout_milliseconds` defaults to **5000**, and a cold
Supabase Edge Function boot measures **~4.8s** here. pg_net abandons the
request; the function keeps running and finishes anyway. Measured on
2026-08-10, the first storage-GC cycle that ever ran:

| Where | What it said |
|---|---|
| `net._http_response` id 212 | `Timeout of 5000 ms reached. Total time: 5002.584 ms` |
| `storage_cleanup_queue.processed_at` | `19:15:05.788`, `last_error` NULL, both blobs gone |

The work completed **0.56s after** the request was recorded as timed out.
The single row anyone would consult to ask "did it run?" said no, and was
wrong.

**The rule: verify a dispatch against the thing it was supposed to CHANGE**
— the queue, the row, the column — never against `net._http_response`
alone. That table is authoritative for *failure* (a 400 or 401 there is
real, and it is the only place a dispatch error surfaces) but not for
*success*.

This is not a livelock. A timed-out cold call still leaves the instance
warm, so the next firing answers instantly — it self-heals. The cost is
one misleading row per idle gap, not a stuck job.

Migrations 337 and 339 passed `timeout_milliseconds := 30000` to all four
callers that existed then. The default is still 5000 and nothing enforces
this, so **any new `net.http_post` call must pass it explicitly.** The
worst case is a rarely-invoked function: `kick_weekly_reviews` runs
`0 20 * * 0`, once a week, so its endpoint is cold on *every* firing —
guaranteed to take the path the others only risk.

Audit every caller after adding one:

```sql
SELECT proname,
       position('timeout_milliseconds' in pg_get_functiondef(oid)) > 0 AS has_timeout
FROM pg_proc
WHERE pronamespace::regnamespace::text = 'public'
  AND prokind = 'f'
  AND pg_get_functiondef(oid) LIKE '%net.http_post%'
ORDER BY 1;
```

Every row should read `true`. The `prokind = 'f'` filter is required, not
cosmetic — without it `pg_get_functiondef` is handed an aggregate and the
whole query dies with `42809: "array_agg" is an aggregate function`.

---

## Smoke tests

Run [`supabase/tests/cron_smoke_tests.sql`](../supabase/tests/cron_smoke_tests.sql)
in the SQL Editor whenever you've touched 034 → 041. It produces a
PASS/FAIL grid for the pure helpers (text functions, type-category
mapping) and verifies every cron job + trigger is registered.
Read-only, safe to run anytime.
