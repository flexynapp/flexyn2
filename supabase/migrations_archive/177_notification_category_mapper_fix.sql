-- Migration 177: repair notification_type_category() — un-break migration 136
--
-- C12 (2026-06 audit): migration 136 did `CREATE OR REPLACE` on
-- notification_type_category() with INVENTED type names that no code path
-- ever inserts — 'streak_break' (real: 'streak_break_warning'),
-- 'quest_complete'/'quest_expiring' (real: 'quest_claimed'/
-- 'quest_expiry_warning'), 'pr_celebrated' (real: 'pr_set'),
-- 'capsule_milestone' (real: 'capsule_earned'), 'milestone_hit' (real:
-- 'coin_milestone'), 'memory_resurfaced' (real: 'memory_reengagement'),
-- 'referral_credited' (real: 'referral_success'), and dropped real types
-- like 'post_like', 'crew_everyone', 'streak_milestone'. Unmapped types
-- return NULL, and the push-fanout trigger + quiet-hours gate treat NULL
-- as "no category" → FAIL OPEN → always push. Net effect: the Settings
-- toggles for streak, quests, achievements, most social (incl. the
-- highest-volume post_like), and quiet-hours silently did nothing for
-- those types. This is exactly the regression migration 083's head
-- comment documents fixing — 136 reintroduced it.
--
-- This re-emits the canonical 083 mapping (SINGULAR category keys, which
-- the Settings UI writes) and ADDS the genuinely-new post-083 types using
-- their REAL inserted names (verified against the notify_*_for RPC bodies
-- and client inserts): nemesis_overthrown, gauntlet_path_completed,
-- crew_challenge_created/completed, coin_gift, gym_member_joined,
-- story_reaction, memory_reengagement, referral_success, streak_rescued,
-- comeback_protocol, and dm_received (migration 181).
--
-- 136's phantom names are intentionally NOT carried over: nothing inserts
-- them, and an unmapped type's fail-open behavior is unchanged from before.

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    -- streak (singular)
    WHEN 'streak_milestone'         THEN 'streak'
    WHEN 'streak_break_warning'     THEN 'streak'
    WHEN 'streak_rescued'           THEN 'streak'
    -- quests
    WHEN 'quest_claimed'            THEN 'quests'
    WHEN 'quest_expiry_warning'     THEN 'quests'
    -- league. Map both the 036 (promoted/demoted/held) and 065
    -- (promotion/demotion) spellings — both have been emitted.
    WHEN 'league_promoted'          THEN 'league'
    WHEN 'league_demoted'           THEN 'league'
    WHEN 'league_held'              THEN 'league'
    WHEN 'league_promotion'         THEN 'league'
    WHEN 'league_demotion'          THEN 'league'
    -- social
    WHEN 'friend_post'              THEN 'social'
    WHEN 'friend_follow'            THEN 'social'
    WHEN 'comment_reply'            THEN 'social'
    WHEN 'post_reaction'            THEN 'social'
    WHEN 'post_like'                THEN 'social'
    WHEN 'sticker_reaction'         THEN 'social'
    WHEN 'trade_offer'              THEN 'social'
    WHEN 'crew_everyone'            THEN 'social'
    WHEN 'coin_gift'                THEN 'social'
    WHEN 'gym_member_joined'        THEN 'social'
    WHEN 'story_reaction'           THEN 'social'
    WHEN 'dm_received'              THEN 'social'
    -- achievements
    WHEN 'pr_set'                   THEN 'achievements'
    WHEN 'capsule_earned'           THEN 'achievements'
    WHEN 'coin_milestone'           THEN 'achievements'
    -- engagement
    WHEN 'welcome_back'             THEN 'engagement'
    WHEN 'weekly_gauntlet_started'  THEN 'engagement'
    WHEN 'memory_reengagement'      THEN 'engagement'
    WHEN 'referral_success'         THEN 'engagement'
    WHEN 'comeback_protocol'        THEN 'engagement'
    -- competitive (duels / bounties / crew wars / nemesis / gauntlet / crew challenges)
    WHEN 'duel_invite'              THEN 'competitive'
    WHEN 'duel_result'              THEN 'competitive'
    WHEN 'bounty_claim'             THEN 'competitive'
    WHEN 'bounty_beaten'            THEN 'competitive'
    WHEN 'crew_war_started'         THEN 'competitive'
    WHEN 'crew_war_resolved'        THEN 'competitive'
    WHEN 'nemesis_assigned'         THEN 'competitive'
    WHEN 'nemesis_overthrown'       THEN 'competitive'
    WHEN 'gauntlet_path_completed'  THEN 'competitive'
    WHEN 'crew_challenge_created'   THEN 'competitive'
    WHEN 'crew_challenge_completed' THEN 'competitive'
    ELSE NULL  -- unmapped types fall through → always deliver (intentional)
  END;
$$;

NOTIFY pgrst, 'reload schema';
