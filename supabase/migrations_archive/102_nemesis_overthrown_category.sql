-- 102_nemesis_overthrown_category.sql
--
-- Wires the new `nemesis_overthrown` notification type (emitted by
-- src/lib/data/nemesis.js performOverthrow) into the
-- notification_type_category() mapping.
--
-- Also REPAIRS a regression introduced in migration 092: when 092
-- added the memory_reengagement type, the author rewrote
-- notification_type_category() but accidentally dropped several
-- mappings that 083 had explicitly added — namely
-- `streak_rescue_available`, `quest_expiring`, `quest_completed`,
-- `quest_reset`, `league_resolution`, and `league_starting_soon`.
-- Without those mappings the user's per-category toggle silently
-- doesn't apply to those types (they fall through to "always
-- deliver"). This migration is the FULL union of every notification
-- type the codebase emits.
--
-- Why a single CASE rather than a registry table: the lookup is on
-- every notifications-INSERT trigger path; an inline SQL CASE inlines
-- well in the trigger's STABLE function and avoids a per-row table
-- lookup. The maintenance cost is one CASE arm per new type — small.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    -- streak
    WHEN 'streak_break_warning'    THEN 'streak'
    WHEN 'streak_milestone'        THEN 'streak'
    WHEN 'streak_rescue_available' THEN 'streak'
    -- quests
    WHEN 'quest_expiring'          THEN 'quests'
    WHEN 'quest_expiry_warning'    THEN 'quests'
    WHEN 'quest_completed'         THEN 'quests'
    WHEN 'quest_claimed'           THEN 'quests'
    WHEN 'quest_reset'             THEN 'quests'
    -- league
    WHEN 'league_promoted'         THEN 'league'
    WHEN 'league_promotion'        THEN 'league'
    WHEN 'league_demoted'          THEN 'league'
    WHEN 'league_demotion'         THEN 'league'
    WHEN 'league_held'             THEN 'league'
    WHEN 'league_resolution'       THEN 'league'
    WHEN 'league_starting_soon'    THEN 'league'
    -- social
    WHEN 'friend_post'             THEN 'social'
    WHEN 'friend_follow'           THEN 'social'
    WHEN 'comment_reply'           THEN 'social'
    WHEN 'post_reaction'           THEN 'social'
    WHEN 'post_like'               THEN 'social'
    WHEN 'sticker_reaction'        THEN 'social'
    WHEN 'trade_offer'             THEN 'social'
    WHEN 'crew_everyone'           THEN 'social'
    -- achievements
    WHEN 'pr_set'                  THEN 'achievements'
    WHEN 'capsule_earned'          THEN 'achievements'
    WHEN 'coin_milestone'          THEN 'achievements'
    -- engagement
    WHEN 'welcome_back'            THEN 'engagement'
    WHEN 'weekly_gauntlet_started' THEN 'engagement'
    WHEN 'memory_reengagement'     THEN 'engagement'
    -- competitive
    WHEN 'duel_invite'             THEN 'competitive'
    WHEN 'duel_result'             THEN 'competitive'
    WHEN 'bounty_claim'            THEN 'competitive'
    WHEN 'bounty_beaten'           THEN 'competitive'
    WHEN 'crew_war_started'        THEN 'competitive'
    WHEN 'crew_war_resolved'       THEN 'competitive'
    WHEN 'nemesis_assigned'        THEN 'competitive'
    WHEN 'nemesis_overthrown'      THEN 'competitive'  -- NEW
    ELSE NULL  -- unmapped types fall through → always deliver (intentional)
  END;
$$;

NOTIFY pgrst, 'reload schema';
