-- 083_notification_category_unification.sql
--
-- Unifies and repairs the notification_type_category mapping that has
-- drifted across migrations 036 → 065 → 069 → 081 → 082.
--
-- THE BUG WE'RE FIXING
-- ────────────────────
-- Migration 036 established six categories with SINGULAR keys:
--   streak, quests, league, social, achievements, engagement
-- and registered the type→category mapping for 17 notification types.
--
-- Migration 065 (duel notifications) called CREATE OR REPLACE on
-- notification_type_category() and:
--   • Switched category names to PLURAL ('streaks', 'leagues') for
--     two categories — accidentally diverging from the column the
--     trigger reads in user_profiles.notification_prefs.
--   • Dropped 8 of 036's mappings (streak_milestone, quest_claimed,
--     league_held, comment_reply, sticker_reaction, trade_offer,
--     pr_set, capsule_earned, coin_milestone) — making those types
--     unmapped → fail-open → always push.
--
-- Migration 069 (competitive notifications) kept 065's plural form
-- and added 4 more types but didn't restore the dropped mappings.
--
-- The Settings UI in src/components/SettingsPanel.jsx renders toggles
-- keyed by SINGULAR names ('streak', 'league') because it pre-dates
-- the regression. So:
--   • A user toggling "Streak reminders" off writes
--     notification_prefs['streak'] = false.
--   • The push trigger looks up notification_type_category('streak_break_warning')
--     which returns 'streaks' (plural).
--   • The trigger checks prefs['streaks'] — not found — and pushes anyway.
--
-- Net effect: per-category mute has been silently broken for streak,
-- league, and ALL the dropped categories since migration 065 landed.
--
-- THE FIX
-- ───────
-- 1. CREATE OR REPLACE notification_type_category() with the full,
--    canonical mapping using SINGULAR category names (matching 036
--    and the Settings UI).
-- 2. Add 'competitive' as a first-class category covering duels,
--    bounties, crew wars, and the new nemesis_assigned type. The
--    Settings UI already has a "Duels, bounties & crew wars" toggle
--    keyed 'competitive'; we just had no server-side acceptance for it.
-- 3. Map weekly_gauntlet_started → 'engagement' (matches the audience
--    filter the cron in migration 082 already enforces pre-insert).
-- 4. Map nemesis_assigned → 'competitive' (was intentionally unmapped
--    in 081; mapping it now respects the user's UI choice).
-- 5. CREATE OR REPLACE update_notification_pref() to accept the
--    'competitive' key in the whitelist so the UI toggle actually
--    persists. Without this, the Settings panel's competitive toggle
--    has been silently failing (the optimistic UI flips, the RPC
--    rejects, the panel reverts on next reload).
-- 6. Backfill notification_prefs.competitive = true for existing rows
--    so the toggle starts in the "all categories on" state for users
--    who pre-date this column.
-- 7. Migrate any user who somehow ended up with plural keys back to
--    singular (defensive — no code path actually wrote them, but if a
--    direct-SQL operator did, we don't want them stranded).

-- ── 1. Canonical category mapping (singular keys) ───────────────────────

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    -- streak (singular)
    WHEN 'streak_milestone'        THEN 'streak'
    WHEN 'streak_break_warning'    THEN 'streak'
    -- quests
    WHEN 'quest_claimed'           THEN 'quests'
    WHEN 'quest_expiry_warning'    THEN 'quests'
    -- league (singular). We map BOTH the 036 spellings (promoted/demoted/held)
    -- AND the 065 spellings (promotion/demotion) because both have been
    -- emitted at various points; without both the trigger leaves the older
    -- type names unmapped → always pushes regardless of pref.
    WHEN 'league_promoted'         THEN 'league'
    WHEN 'league_demoted'          THEN 'league'
    WHEN 'league_held'             THEN 'league'
    WHEN 'league_promotion'        THEN 'league'
    WHEN 'league_demotion'         THEN 'league'
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
    -- competitive (NEW first-class category for duels/bounties/crew wars/nemesis)
    WHEN 'duel_invite'             THEN 'competitive'
    WHEN 'duel_result'             THEN 'competitive'
    WHEN 'bounty_claim'            THEN 'competitive'
    WHEN 'bounty_beaten'           THEN 'competitive'
    WHEN 'crew_war_started'        THEN 'competitive'
    WHEN 'crew_war_resolved'       THEN 'competitive'
    WHEN 'nemesis_assigned'        THEN 'competitive'
    ELSE NULL  -- unmapped types fall through → always deliver (intentional)
  END;
$$;

-- ── 2. Client RPC whitelist refresh ─────────────────────────────────────
-- Accept 'competitive' in addition to the original 036 categories so the
-- Settings panel's toggle actually persists. We preserve the SECURITY
-- DEFINER + SET search_path posture from 036.

CREATE OR REPLACE FUNCTION public.update_notification_pref(
  p_category TEXT,
  p_enabled  BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_category NOT IN (
    'streak', 'quests', 'league', 'social',
    'achievements', 'engagement', 'competitive'
  ) THEN
    RAISE EXCEPTION 'unknown category %', p_category USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_profiles
     SET notification_prefs = jsonb_set(
           COALESCE(notification_prefs, '{}'::jsonb),
           ARRAY[p_category],
           to_jsonb(p_enabled),
           true
         )
   WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_notification_pref(TEXT, BOOLEAN) TO authenticated;

-- ── 3. Backfill 'competitive' for existing rows ─────────────────────────
-- Without this, users who pre-date the competitive category would have
-- notification_prefs missing the key entirely. The trigger's "missing key
-- = default on" behavior means pushes still fire, so this isn't a bug —
-- but the Settings toggle then shows the switch as ON (defaulted via
-- `prefs[key] !== false`) which matches reality. We include the key
-- explicitly so the persisted state matches the displayed state.

UPDATE public.user_profiles
   SET notification_prefs = jsonb_set(
         COALESCE(notification_prefs, '{}'::jsonb),
         ARRAY['competitive'],
         'true'::jsonb,
         true
       )
 WHERE notification_prefs IS NULL
    OR NOT (notification_prefs ? 'competitive');

-- ── 4. Defensive: rename any plural keys to singular ─────────────────────
-- No application code path wrote 'streaks' or 'leagues' (the bug was in
-- the LOOKUP direction, not the WRITE direction — the Settings panel
-- always wrote singular). But a direct-SQL operator or a hand-debugging
-- session might have set the plural form; if so, fold it back into the
-- singular slot so the user's intent is preserved. The COALESCE prefers
-- an existing singular value if both are present (the singular one is
-- the canonical UI-written value).

UPDATE public.user_profiles
   SET notification_prefs =
     (notification_prefs - 'streaks' - 'leagues')
     || jsonb_build_object(
          'streak', COALESCE(notification_prefs -> 'streak',  notification_prefs -> 'streaks',  'true'::jsonb),
          'league', COALESCE(notification_prefs -> 'league',  notification_prefs -> 'leagues',  'true'::jsonb)
        )
 WHERE notification_prefs IS NOT NULL
   AND (notification_prefs ? 'streaks' OR notification_prefs ? 'leagues');

-- ── 5. Update DEFAULT clause on the column to include 'competitive' ─────
-- Affects INSERTs that don't specify notification_prefs (e.g. new auth
-- sign-up trigger). Doesn't touch existing rows — that's what the
-- backfill above handles.

ALTER TABLE public.user_profiles
  ALTER COLUMN notification_prefs SET DEFAULT
    '{"streak":true,"quests":true,"league":true,"social":true,"achievements":true,"engagement":true,"competitive":true}'::jsonb;

NOTIFY pgrst, 'reload schema';
