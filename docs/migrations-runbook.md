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
SELECT 'push fanout trigger', count(*), '1'
  FROM information_schema.triggers
 WHERE event_object_table = 'notifications'
   AND trigger_name = 'trg_notifications_push_fanout'
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
SELECT 'username profanity trigger (050)', count(*), '1'
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
