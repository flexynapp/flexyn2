-- 312_league_seasons_titles_trophies.sql
--
-- Phase 3 of the league work. Migration 310 made the weekly bracket resolve
-- and refuse to promote people who did not train. This gives the ladder a
-- REASON: a 28-day season that ends in something permanent.
--
-- ── WHAT A SEASON IS ──────────────────────────────────────────────────────
--
-- Four weekly brackets. The week still does all the moving; the season does
-- all the remembering. 28 days is not arbitrary — it matches `crew_seasons`
-- (migration 248) so "Season 7" means one thing in both surfaces and the two
-- ceremonies share a cadence.
--
-- ── WHAT IT PAYS ──────────────────────────────────────────────────────────
--
-- Coins and capsules are already the weekly reward, and they are consumable.
-- A season pays things that persist and that other people can see:
--
--   • a TITLE in user_inventory (item_type 'title'), rendered wherever
--     LOOT_TITLES already render — under @handle in HubPostCard, HubProfile,
--     leaderboard rows
--   • a TROPHY in user_trophies, pinnable via user_profiles.signature_trophy
--   • a capsule scaled to the tier reached
--
-- Eligibility is `weeks_qualified >= 2`, not final standing. This is the
-- Rocket League rule: reaching a rank is not enough, you have to have played.
-- Someone who trained twice and finished mid-table gets their season mark;
-- someone who was carried by one good week does not.
--
-- ── THE CHAMPION ──────────────────────────────────────────────────────────
--
-- One per season, to the highest season XP among everyone who reached Legend.
-- It pays NO coins on purpose. At the top of a ladder, status is the reward —
-- Duolingo's Diamond Tournament pays only a profile medal, and it is the most
-- chased thing in the product. `league_s{n}_champion` is minted once and can
-- never be earned again, which is the whole point.
--
-- This also gives Legend an endgame. Before this it was `promote: 0` — a room
-- with no exits.
--
-- ── SOFT RESET (kegan, 2026-08-08) ────────────────────────────────────────
--
-- Everyone drops one tier at season start, floor Bronze. The permanent reward
-- is the title and the trophy; the tier is only ever a statement about right
-- now. Without this the ladder ossifies — the same people sit in Legend and
-- there is nothing for a returning user to climb.
--
-- Deliberately NOT reset: league_inactive_weeks. Decay tracks recent
-- behaviour, not season identity, and zeroing it would hand every lapsed
-- account a fresh grace window every 28 days.
--
-- ── PASTE-SAFE ────────────────────────────────────────────────────────────
-- public.<table>, scalar SELECT ... INTO, bare columns in single-table
-- statements, least()/greatest() rather than bare angle brackets.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.league_seasons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number INTEGER NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_league_seasons_status
  ON public.league_seasons (status, season_number DESC);

ALTER TABLE public.league_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "league_seasons: read all" ON public.league_seasons;
CREATE POLICY "league_seasons: read all"
  ON public.league_seasons FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.league_seasons TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.league_seasons FROM authenticated, anon;

CREATE TABLE IF NOT EXISTS public.league_season_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES public.league_seasons(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email      TEXT NOT NULL,
  best_tier       TEXT NOT NULL DEFAULT 'bronze',
  weeks_qualified INTEGER NOT NULL DEFAULT 0,
  season_xp       INTEGER NOT NULL DEFAULT 0,
  final_rank      INTEGER,
  awarded_at      TIMESTAMPTZ,
  UNIQUE (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_season_stats_season
  ON public.league_season_stats (season_id, season_xp DESC);

CREATE INDEX IF NOT EXISTS idx_league_season_stats_user
  ON public.league_season_stats (user_id);

ALTER TABLE public.league_season_stats ENABLE ROW LEVEL SECURITY;

-- Readable by anyone signed in: this is a leaderboard, and the Legend season
-- board has to render to everyone chasing it.
DROP POLICY IF EXISTS "league_season_stats: read all" ON public.league_season_stats;
CREATE POLICY "league_season_stats: read all"
  ON public.league_season_stats FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.league_season_stats TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.league_season_stats FROM authenticated, anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Season names
--
-- A season needs a name or "Season 7" is a row id with a crown on it. Eight
-- theme words cycling by number, so nobody has to name one by hand every 28
-- days and the same word does not recur for over a year and a half.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.league_season_name(p_number INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $season_name$
DECLARE
  v_words CONSTANT TEXT[] := ARRAY[
    'Foundation', 'Ascent', 'Forge', 'Summit',
    'Ironclad', 'Vanguard', 'Bedrock', 'Apex'
  ];
BEGIN
  IF p_number IS NULL OR p_number < 1 THEN
    RETURN 'Season 1 · Foundation';
  END IF;
  RETURN 'Season ' || p_number || ' · ' || v_words[((p_number - 1) % 8) + 1];
END;
$season_name$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Get-or-open the current season
--
-- Same shape as current_crew_season() (migration 248), including the
-- re-read on conflict so two concurrent openers converge on one row.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.current_league_season()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cur_season$
DECLARE
  v_id   UUID;
  v_next INTEGER;
BEGIN
  SELECT id INTO v_id
    FROM public.league_seasons
   WHERE status = 'active'
   ORDER BY season_number DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT COALESCE(MAX(season_number), 0) + 1 INTO v_next FROM public.league_seasons;

  INSERT INTO public.league_seasons (season_number, name, starts_at, ends_at, status)
  VALUES (v_next, public.league_season_name(v_next), now(), now() + INTERVAL '28 days', 'active')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.league_seasons
     WHERE status = 'active'
     ORDER BY season_number DESC
     LIMIT 1;
  END IF;

  RETURN v_id;
END;
$cur_season$;

REVOKE ALL ON FUNCTION public.current_league_season() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_league_season() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_league_season() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Record a week into the season
--
-- Called once per member per bracket resolution. Accumulates season XP, keeps
-- the HIGHEST tier the member held, and counts qualifying weeks.
--
-- best_tier is a high-water mark rather than the final tier on purpose: the
-- soft reset and the decay path both move people down, and a season reward
-- should record what someone reached, not where they happened to land.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.league_season_record_internal(
  p_user_id   UUID,
  p_email     TEXT,
  p_tier      TEXT,
  p_qualified BOOLEAN,
  p_xp        INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $season_record$
DECLARE
  v_season   UUID;
  v_existing TEXT;
  v_rank_new INTEGER;
  v_rank_old INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_season := public.current_league_season();
  IF v_season IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.league_season_stats
    (season_id, user_id, user_email, best_tier, weeks_qualified, season_xp)
  VALUES
    (v_season, p_user_id, COALESCE(p_email, ''), COALESCE(p_tier, 'bronze'),
     CASE WHEN p_qualified THEN 1 ELSE 0 END, GREATEST(0, COALESCE(p_xp, 0)))
  ON CONFLICT (season_id, user_id) DO UPDATE
    SET weeks_qualified = public.league_season_stats.weeks_qualified
                          + CASE WHEN p_qualified THEN 1 ELSE 0 END,
        season_xp       = public.league_season_stats.season_xp
                          + GREATEST(0, COALESCE(p_xp, 0));

  -- Keep the high-water tier. Done as a separate step because the ladder is
  -- an ordered vocabulary, not something ON CONFLICT can compare.
  SELECT best_tier INTO v_existing
    FROM public.league_season_stats
   WHERE season_id = v_season AND user_id = p_user_id;

  v_rank_new := CASE COALESCE(p_tier, 'bronze')
                  WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2 WHEN 'gold' THEN 3
                  WHEN 'platinum' THEN 4 WHEN 'diamond' THEN 5 WHEN 'legend' THEN 6
                  ELSE 1 END;
  v_rank_old := CASE COALESCE(v_existing, 'bronze')
                  WHEN 'bronze' THEN 1 WHEN 'silver' THEN 2 WHEN 'gold' THEN 3
                  WHEN 'platinum' THEN 4 WHEN 'diamond' THEN 5 WHEN 'legend' THEN 6
                  ELSE 1 END;

  IF v_rank_new > v_rank_old THEN
    UPDATE public.league_season_stats
       SET best_tier = p_tier
     WHERE season_id = v_season AND user_id = p_user_id;
  END IF;
END;
$season_record$;

REVOKE ALL ON FUNCTION public.league_season_record_internal(UUID, TEXT, TEXT, BOOLEAN, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_season_record_internal(UUID, TEXT, TEXT, BOOLEAN, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.league_season_record_internal(UUID, TEXT, TEXT, BOOLEAN, INTEGER) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Re-emit the weekly resolver with the season hook
--
-- Identical to migration 310 except for the two league_season_record_internal
-- calls. Restated in full rather than patched, because CREATE OR REPLACE takes
-- a whole body and a partial mental diff is exactly how migrations 098 and 127
-- silently reverted the push fanout to a pre-Vault template.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_league_bracket_internal(p_league_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resolve$
DECLARE
  c_min_bracket CONSTANT INTEGER := 5;
  c_decay_grace CONSTANT INTEGER := 2;

  v_tier        TEXT;
  v_week_start  DATE;
  v_week_end    DATE;
  v_promote_pct NUMERIC;
  v_demote_pct  NUMERIC;
  v_min_days    INTEGER;
  v_min_xp      INTEGER;
  v_coins       INTEGER;
  v_capsule     TEXT;

  v_qualified   INTEGER := 0;
  v_promote_n   INTEGER := 0;
  v_demote_n    INTEGER := 0;
  v_rank        INTEGER := 0;
  v_touched     INTEGER := 0;

  v_mid         UUID;
  v_uid         UUID;
  v_email       TEXT;
  v_days        INTEGER;
  v_xp          INTEGER;
  v_is_q        BOOLEAN;
  v_outcome     TEXT;
  v_new_tier    TEXT;
  v_pay         INTEGER;
  v_cap         TEXT;
  v_quiet       INTEGER;
  v_shields     INTEGER;
  v_shielded    BOOLEAN;
BEGIN
  SELECT tier, week_start, week_end
    INTO v_tier, v_week_start, v_week_end
    FROM public.leagues
   WHERE id = p_league_id;

  IF v_tier IS NULL THEN
    RETURN 0;
  END IF;

  SELECT promote_pct, demote_pct, min_days, min_xp, reward_coins, reward_capsule
    INTO v_promote_pct, v_demote_pct, v_min_days, v_min_xp, v_coins, v_capsule
    FROM (VALUES
      ('bronze',   0.50, 0.00, 1, 0,   50, NULL::TEXT),
      ('silver',   0.40, 0.10, 1, 0,  100, NULL),
      ('gold',     0.30, 0.15, 2, 0,  200, 'standard'),
      ('platinum', 0.25, 0.20, 2, 0,  350, 'premium'),
      ('diamond',  0.20, 0.20, 3, 0,  600, 'premium'),
      ('legend',   0.00, 0.20, 3, 0, 1000, 'elite')
    ) AS cfg(tier_id, promote_pct, demote_pct, min_days, min_xp, reward_coins, reward_capsule)
   WHERE tier_id = v_tier;

  IF v_promote_pct IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_mid IN
    SELECT id FROM public.league_members WHERE league_id = p_league_id
  LOOP
    SELECT user_id, COALESCE(weekly_xp, 0) INTO v_uid, v_xp
      FROM public.league_members WHERE id = v_mid;

    v_days := public.league_active_days(v_uid, v_week_start, v_week_end);
    v_is_q := (v_days >= v_min_days) AND (v_xp >= v_min_xp);

    UPDATE public.league_members
       SET active_days = v_days, qualified = v_is_q
     WHERE id = v_mid;
  END LOOP;

  SELECT COUNT(*) INTO v_qualified
    FROM public.league_members
   WHERE league_id = p_league_id AND qualified = TRUE;

  IF v_qualified >= c_min_bracket THEN
    v_promote_n := GREATEST(1, CEIL(v_qualified * v_promote_pct))::INTEGER;
    v_demote_n  := FLOOR(v_qualified * v_demote_pct)::INTEGER;
    IF v_promote_pct = 0 THEN
      v_promote_n := 0;
    END IF;
  END IF;

  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = TRUE
     ORDER BY weekly_xp DESC NULLS LAST, joined_at ASC
  LOOP
    v_rank := v_rank + 1;

    SELECT user_id, user_email, COALESCE(weekly_xp, 0)
      INTO v_uid, v_email, v_xp
      FROM public.league_members WHERE id = v_mid;

    v_shielded := FALSE;

    IF v_promote_n > 0 AND v_rank <= v_promote_n THEN
      v_outcome  := 'promote';
      v_new_tier := CASE v_tier
                      WHEN 'bronze'   THEN 'silver'
                      WHEN 'silver'   THEN 'gold'
                      WHEN 'gold'     THEN 'platinum'
                      WHEN 'platinum' THEN 'diamond'
                      WHEN 'diamond'  THEN 'legend'
                      ELSE v_tier
                    END;
      v_pay := CASE WHEN v_rank = 1 THEN (v_coins * 3) / 2 ELSE v_coins END;
      v_cap := v_capsule;

    ELSIF v_demote_n > 0 AND v_rank > (v_qualified - v_demote_n) THEN
      SELECT COALESCE(league_shields_owned, 0) INTO v_shields
        FROM public.user_profiles WHERE id = v_uid;

      IF v_shields >= 1 THEN
        UPDATE public.user_profiles
           SET league_shields_owned = league_shields_owned - 1,
               league_shield_used_at = now()
         WHERE id = v_uid;
        v_shielded := TRUE;
        v_outcome  := 'hold';
        v_new_tier := v_tier;
        v_pay      := 0;
        v_cap      := NULL;
      ELSE
        v_outcome  := 'demote';
        v_new_tier := CASE v_tier
                        WHEN 'silver'   THEN 'bronze'
                        WHEN 'gold'     THEN 'silver'
                        WHEN 'platinum' THEN 'gold'
                        WHEN 'diamond'  THEN 'platinum'
                        WHEN 'legend'   THEN 'diamond'
                        ELSE v_tier
                      END;
        v_pay := 0;
        v_cap := NULL;
      END IF;

    ELSE
      v_outcome  := 'hold';
      v_new_tier := v_tier;
      v_pay      := GREATEST(1, v_coins / 4);
      v_cap      := NULL;
    END IF;

    UPDATE public.league_members
       SET rank = v_rank, outcome = v_outcome, coins_awarded = COALESCE(v_pay, 0)
     WHERE id = v_mid;

    UPDATE public.user_profiles
       SET league_inactive_weeks = 0
     WHERE id = v_uid;

    IF v_new_tier IS DISTINCT FROM v_tier THEN
      UPDATE public.user_profiles SET league_tier = v_new_tier WHERE id = v_uid;
    END IF;

    IF v_pay > 0 THEN
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + v_pay
       WHERE id = v_uid;
    END IF;

    IF v_cap IS NOT NULL THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_uid, v_email, v_cap);
    END IF;

    -- SEASON HOOK. The tier recorded is the one the member COMPETED at this
    -- week, not the one they were moved to — a promotion out of Gold is a
    -- Gold week, and the Platinum week is the one that follows.
    PERFORM public.league_season_record_internal(v_uid, v_email, v_tier, TRUE, v_xp);

    IF v_outcome IN ('promote', 'demote') OR v_shielded THEN
      PERFORM public.notify_league_resolution_internal(
        v_uid, v_outcome, v_tier, v_new_tier, COALESCE(v_pay, 0), v_cap);
    END IF;

    v_touched := v_touched + 1;
  END LOOP;

  FOR v_mid IN
    SELECT id FROM public.league_members
     WHERE league_id = p_league_id AND qualified = FALSE
  LOOP
    SELECT user_id, user_email INTO v_uid, v_email
      FROM public.league_members WHERE id = v_mid;

    UPDATE public.league_members
       SET outcome = 'unranked', coins_awarded = 0
     WHERE id = v_mid;

    UPDATE public.user_profiles
       SET league_inactive_weeks = COALESCE(league_inactive_weeks, 0) + 1
     WHERE id = v_uid;

    -- Recorded with qualified = FALSE: the season sees they were present but
    -- the week does not count toward the 2-of-4 eligibility bar.
    PERFORM public.league_season_record_internal(v_uid, v_email, v_tier, FALSE, 0);

    SELECT COALESCE(league_inactive_weeks, 0), COALESCE(league_shields_owned, 0)
      INTO v_quiet, v_shields
      FROM public.user_profiles WHERE id = v_uid;

    IF v_quiet > c_decay_grace AND v_tier <> 'bronze' THEN
      IF v_shields >= 1 THEN
        UPDATE public.user_profiles
           SET league_shields_owned = league_shields_owned - 1,
               league_shield_used_at = now()
         WHERE id = v_uid;
        PERFORM public.notify_league_resolution_internal(
          v_uid, 'hold', v_tier, v_tier, 0, NULL);
      ELSE
        v_new_tier := CASE v_tier
                        WHEN 'silver'   THEN 'bronze'
                        WHEN 'gold'     THEN 'silver'
                        WHEN 'platinum' THEN 'gold'
                        WHEN 'diamond'  THEN 'platinum'
                        WHEN 'legend'   THEN 'diamond'
                        ELSE v_tier
                      END;
        UPDATE public.user_profiles SET league_tier = v_new_tier WHERE id = v_uid;
        UPDATE public.league_members SET outcome = 'decayed' WHERE id = v_mid;
        PERFORM public.notify_league_resolution_internal(
          v_uid, 'demote', v_tier, v_new_tier, 0, NULL);
      END IF;
    END IF;

    v_touched := v_touched + 1;
  END LOOP;

  UPDATE public.leagues
     SET qualified_count = v_qualified,
         resolved_at = now()
   WHERE id = p_league_id;

  RETURN v_touched;
END;
$resolve$;

REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_league_bracket_internal(UUID) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Award one member their season mark
--
-- Title + trophy + capsule, all idempotent. Split out of the roller so the
-- award rules are readable on their own and so a single member can be
-- re-awarded by hand if a season ever needs repairing.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.award_league_season_internal(
  p_user_id   UUID,
  p_email     TEXT,
  p_number    INTEGER,
  p_tier      TEXT,
  p_champion  BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $award$
DECLARE
  v_item_id  TEXT;
  v_name     TEXT;
  v_rarity   TEXT;
  v_emoji    TEXT;
  v_capsule  TEXT;
  v_exists   INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_number IS NULL THEN
    RETURN;
  END IF;

  IF p_champion THEN
    v_item_id := 'league_s' || p_number || '_champion';
    v_name    := 'Champion, S' || p_number;
    v_rarity  := 'legendary';
    v_emoji   := '👑';
    v_capsule := 'elite';
  ELSE
    v_item_id := 'league_s' || p_number || '_' || COALESCE(p_tier, 'bronze');
    v_name    := 'Season ' || p_number || ' ' || initcap(COALESCE(p_tier, 'bronze'));
    v_rarity  := CASE COALESCE(p_tier, 'bronze')
                   WHEN 'legend'   THEN 'legendary'
                   WHEN 'diamond'  THEN 'epic'
                   WHEN 'platinum' THEN 'rare'
                   WHEN 'gold'     THEN 'uncommon'
                   ELSE 'common'
                 END;
    v_emoji   := CASE COALESCE(p_tier, 'bronze')
                   WHEN 'legend'   THEN '👑' WHEN 'diamond'  THEN '💎'
                   WHEN 'platinum' THEN '💠' WHEN 'gold'     THEN '🥇'
                   WHEN 'silver'   THEN '🥈' ELSE '🥉'
                 END;
    v_capsule := CASE COALESCE(p_tier, 'bronze')
                   WHEN 'legend'   THEN 'elite'
                   WHEN 'diamond'  THEN 'premium'
                   WHEN 'platinum' THEN 'premium'
                   WHEN 'gold'     THEN 'standard'
                   ELSE NULL
                 END;
  END IF;

  -- Title. user_inventory has no unique constraint on (user_id, item_id) —
  -- duplicates are legitimate there, that is how tradeable spares work — so
  -- the guard has to be explicit or a re-run mints a second copy.
  SELECT COUNT(*) INTO v_exists
    FROM public.user_inventory
   WHERE user_id = p_user_id AND item_id = v_item_id;

  IF v_exists = 0 THEN
    INSERT INTO public.user_inventory
      (user_id, user_email, item_id, item_name, item_emoji, item_rarity,
       item_type, acquired_via, is_listed)
    VALUES
      (p_user_id, COALESCE(p_email, ''), v_item_id, v_name, v_emoji, v_rarity,
       'title', 'league_season', FALSE);
  END IF;

  -- Trophy. UNIQUE (user_id, trophy_id) makes this one self-guarding.
  INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
  VALUES (p_user_id, COALESCE(p_email, ''), v_item_id)
  ON CONFLICT (user_id, trophy_id) DO NOTHING;

  IF v_capsule IS NOT NULL THEN
    INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
    VALUES (p_user_id, COALESCE(p_email, ''), v_capsule);
  END IF;
END;
$award$;

REVOKE ALL ON FUNCTION public.award_league_season_internal(UUID, TEXT, INTEGER, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_league_season_internal(UUID, TEXT, INTEGER, TEXT, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.award_league_season_internal(UUID, TEXT, INTEGER, TEXT, BOOLEAN) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Roll the season
--
-- Single-winner close, then award, then soft reset, then open the next one.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.roll_league_seasons()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $roll_season$
DECLARE
  c_min_weeks CONSTANT INTEGER := 2;   -- of 4, to collect anything

  v_season   UUID;
  v_number   INTEGER;
  v_next     INTEGER;
  v_uid      UUID;
  v_email    TEXT;
  v_tier     TEXT;
  v_weeks    INTEGER;
  v_champ    UUID;
  v_rank     INTEGER := 0;
  v_awarded  INTEGER := 0;
BEGIN
  SELECT id, season_number INTO v_season, v_number
    FROM public.league_seasons
   WHERE status = 'active'
     AND now() = GREATEST(now(), ends_at)
     AND NOT (now() = ends_at)
   ORDER BY season_number
   LIMIT 1;

  IF v_season IS NULL THEN
    RETURN 0;
  END IF;

  -- Only the firing whose UPDATE actually moves the row proceeds, so two
  -- overlapping crons cannot double-award.
  UPDATE public.league_seasons
     SET status = 'completed'
   WHERE id = v_season AND status = 'active';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Final standings by season XP.
  FOR v_uid IN
    SELECT user_id FROM public.league_season_stats
     WHERE season_id = v_season
     ORDER BY season_xp DESC, weeks_qualified DESC
  LOOP
    v_rank := v_rank + 1;
    UPDATE public.league_season_stats
       SET final_rank = v_rank
     WHERE season_id = v_season AND user_id = v_uid;
  END LOOP;

  -- The champion: highest season XP among everyone who reached Legend, and
  -- only if they actually played. NULL when nobody got there, which is the
  -- normal case early on — a season with no champion is fine, a champion
  -- nobody earned is not.
  SELECT user_id INTO v_champ
    FROM public.league_season_stats
   WHERE season_id = v_season
     AND best_tier = 'legend'
     AND weeks_qualified >= c_min_weeks
   ORDER BY season_xp DESC, weeks_qualified DESC
   LIMIT 1;

  FOR v_uid IN
    SELECT user_id FROM public.league_season_stats
     WHERE season_id = v_season
       AND weeks_qualified >= c_min_weeks
  LOOP
    SELECT user_email, best_tier, weeks_qualified
      INTO v_email, v_tier, v_weeks
      FROM public.league_season_stats
     WHERE season_id = v_season AND user_id = v_uid;

    PERFORM public.award_league_season_internal(v_uid, v_email, v_number, v_tier, FALSE);

    IF v_champ IS NOT NULL AND v_uid = v_champ THEN
      PERFORM public.award_league_season_internal(v_uid, v_email, v_number, v_tier, TRUE);
    END IF;

    UPDATE public.league_season_stats
       SET awarded_at = now()
     WHERE season_id = v_season AND user_id = v_uid;

    PERFORM public.notify_league_resolution_internal(
      v_uid, 'hold', v_tier, v_tier, 0, NULL);

    v_awarded := v_awarded + 1;
  END LOOP;

  -- SOFT RESET (kegan, 2026-08-08). Everyone down one, floor bronze. The
  -- title and trophy just banked are the permanent record; the tier is only
  -- ever a statement about right now.
  --
  -- Applied to every profile, not just season participants — a ladder with
  -- some people reset and some not is not a ladder.
  UPDATE public.user_profiles
     SET league_tier = CASE COALESCE(league_tier, 'bronze')
                         WHEN 'legend'   THEN 'diamond'
                         WHEN 'diamond'  THEN 'platinum'
                         WHEN 'platinum' THEN 'gold'
                         WHEN 'gold'     THEN 'silver'
                         WHEN 'silver'   THEN 'bronze'
                         ELSE 'bronze'
                       END
   WHERE COALESCE(league_tier, 'bronze') <> 'bronze';

  v_next := v_number + 1;
  INSERT INTO public.league_seasons (season_number, name, starts_at, ends_at, status)
  VALUES (v_next, public.league_season_name(v_next), now(), now() + INTERVAL '28 days', 'active')
  ON CONFLICT DO NOTHING;

  RETURN v_awarded;
END;
$roll_season$;

REVOKE ALL ON FUNCTION public.roll_league_seasons() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roll_league_seasons() FROM anon;
REVOKE ALL ON FUNCTION public.roll_league_seasons() FROM authenticated;

-- 03:40 daily. Twenty minutes after roll-crew-seasons (03:20) so the two
-- ceremonies never land in the same minute and a user gets them as two
-- separate moments rather than one pile of notifications.
SELECT cron.unschedule('roll-league-seasons')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'roll-league-seasons');

SELECT cron.schedule('roll-league-seasons', '40 3 * * *',
  'SELECT public.roll_league_seasons();');

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Reads for the client
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.my_league_season()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $my_season$
DECLARE
  v_uid    UUID := auth.uid();
  v_season UUID;
  v_num    INTEGER;
  v_name   TEXT;
  v_ends   TIMESTAMPTZ;
  v_tier   TEXT;
  v_weeks  INTEGER;
  v_xp     INTEGER;
  v_rank   INTEGER;
  v_field  INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_season := public.current_league_season();
  IF v_season IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT season_number, name, ends_at INTO v_num, v_name, v_ends
    FROM public.league_seasons WHERE id = v_season;

  SELECT best_tier, weeks_qualified, season_xp
    INTO v_tier, v_weeks, v_xp
    FROM public.league_season_stats
   WHERE season_id = v_season AND user_id = v_uid;

  SELECT COUNT(*) INTO v_field
    FROM public.league_season_stats WHERE season_id = v_season;

  SELECT COUNT(*) + 1 INTO v_rank
    FROM public.league_season_stats
   WHERE season_id = v_season
     AND season_xp > COALESCE(v_xp, 0);

  RETURN jsonb_build_object(
    'season_number',   v_num,
    'name',            v_name,
    'ends_at',         v_ends,
    'best_tier',       COALESCE(v_tier, 'bronze'),
    'weeks_qualified', COALESCE(v_weeks, 0),
    'weeks_needed',    2,
    'season_xp',       COALESCE(v_xp, 0),
    'season_rank',     CASE WHEN v_xp IS NULL THEN NULL ELSE v_rank END,
    'field_size',      COALESCE(v_field, 0)
  );
END;
$my_season$;

REVOKE ALL ON FUNCTION public.my_league_season() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_league_season() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_league_season() TO authenticated;

-- The Legend season board — what makes the top tier an endgame rather than a
-- room with no exits. Open to everyone: chasing it is the point.
CREATE OR REPLACE FUNCTION public.legend_season_board(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  user_id         UUID,
  username        TEXT,
  avatar_url      TEXT,
  season_xp       INTEGER,
  weeks_qualified INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $legend_board$
#variable_conflict use_column
DECLARE
  v_season UUID;
  v_limit  INTEGER;
  v_uid    UUID;
  v_name   TEXT;
  v_avatar TEXT;
  v_xp     INTEGER;
  v_weeks  INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_season
    FROM public.league_seasons
   WHERE status = 'active'
   ORDER BY season_number DESC
   LIMIT 1;

  IF v_season IS NULL THEN
    RETURN;
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));

  -- Deliberately a loop with two single-table statements rather than one
  -- join. A join needs `alias.column` tokens, and those are precisely what
  -- the deploy path mangles into `42601 syntax error at "<"` — see the
  -- paste-safety rule in CLAUDE.md. The board is capped at 100 rows.
  FOR v_uid, v_xp, v_weeks IN
    SELECT user_id, season_xp, weeks_qualified
      FROM public.league_season_stats
     WHERE season_id = v_season
       AND best_tier = 'legend'
     ORDER BY season_xp DESC, weeks_qualified DESC
     LIMIT v_limit
  LOOP
    SELECT username, avatar_url INTO v_name, v_avatar
      FROM public.public_profiles
     WHERE id = v_uid;

    user_id         := v_uid;
    username        := v_name;
    avatar_url      := v_avatar;
    season_xp       := v_xp;
    weeks_qualified := v_weeks;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$legend_board$;

REVOKE ALL ON FUNCTION public.legend_season_board(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legend_season_board(INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.legend_season_board(INTEGER) TO authenticated;

-- Open Season 1 now so the UI has something to render before the first roll.
SELECT public.current_league_season();

NOTIFY pgrst, 'reload schema';
