-- 036_notification_prefs_and_language.sql
--
-- Two related additions to user_profiles, both feeding migration 034's
-- push fanout trigger and migration 037's welcome-back / quest crons.
--
-- 1. preferred_language — ISO 639-1 code. The client (LanguageContext)
--    already reads/writes this via db.auth.updateMe(), but no migration
--    ever added the column. Adding it now so server-side push text
--    can be rendered in the user's language.
--
-- 2. notification_prefs — JSONB of per-category opt-in/opt-out flags.
--    Right now push is all-or-nothing: a user who wants friend pings
--    but hates streak nudges has to disable everything. Categories:
--
--       streak        streak_milestone, streak_break_warning
--       quests        quest_claimed, quest_expiry_warning
--       league        league_promoted, league_demoted, league_held
--       social        friend_post, friend_follow, comment_reply,
--                     post_reaction, sticker_reaction, trade_offer
--       achievements  pr_set, capsule_earned, coin_milestone
--       engagement    welcome_back
--
--    Default: all categories ON. Existing rows back-fill with this
--    default so we don't silently mute current users.

-- preferred_language is added in migration 035 (so its cron can reference
-- it before 036 runs). Re-stating IF NOT EXISTS here is safe and serves as
-- documentation that 036 also depends on it.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT,
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB
    DEFAULT '{"streak":true,"quests":true,"league":true,"social":true,"achievements":true,"engagement":true}'::jsonb;

-- Back-fill notification_prefs for any row that pre-dates this column.
-- The DEFAULT clause only applies to inserts after the ALTER; existing
-- rows would be NULL without this UPDATE.
UPDATE public.user_profiles
   SET notification_prefs = '{"streak":true,"quests":true,"league":true,"social":true,"achievements":true,"engagement":true}'::jsonb
 WHERE notification_prefs IS NULL;

-- ── Type → category mapping ─────────────────────────────────────────────
--
-- The trigger in migration 034 (refreshed below) calls this to decide
-- which preference flag gates a given notification type. Returns NULL
-- for unmapped types so they fall through and always fan out (we'd
-- rather over-deliver an unmapped type than silently drop it).

CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'streak_milestone'        THEN 'streak'
    WHEN 'streak_break_warning'    THEN 'streak'
    WHEN 'quest_claimed'           THEN 'quests'
    WHEN 'quest_expiry_warning'    THEN 'quests'
    WHEN 'league_promoted'         THEN 'league'
    WHEN 'league_demoted'          THEN 'league'
    WHEN 'league_held'             THEN 'league'
    WHEN 'friend_post'             THEN 'social'
    WHEN 'friend_follow'           THEN 'social'
    WHEN 'comment_reply'           THEN 'social'
    WHEN 'post_reaction'           THEN 'social'
    WHEN 'sticker_reaction'        THEN 'social'
    WHEN 'trade_offer'             THEN 'social'
    WHEN 'pr_set'                  THEN 'achievements'
    WHEN 'capsule_earned'          THEN 'achievements'
    WHEN 'coin_milestone'          THEN 'achievements'
    WHEN 'welcome_back'            THEN 'engagement'
    ELSE NULL
  END;
$$;

-- ── Client RPC: update a single category ─────────────────────────────────
--
-- The Settings UI calls this when the user toggles a category. We jsonb_set
-- to avoid clobbering other keys (race-safe vs. a UPDATE with the full
-- object if the user has two devices open).

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
  IF p_category NOT IN ('streak','quests','league','social','achievements','engagement') THEN
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

NOTIFY pgrst, 'reload schema';
