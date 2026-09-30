-- Lead Lifter trophies (Kegan, 2026-09-30): "trophies for each league, given
-- to the top lifter in each league and additionally for each league rank,
-- like the top lifter in Gold 3 at the end of the week when
-- demotion/promotion occurs ... titled 'Gold 3 Lead Lifter week (x)'".
--
-- WHAT IS AWARDED, at the Monday roll, for the week that just closed:
--
--   * One trophy per league LEVEL: "Gold III Lead Lifter, Week 40" goes to
--     the top lifter of everyone who raced that week in Gold at level III.
--   * One trophy per LEAGUE: "Gold Lead Lifter, Week 40" goes to the top
--     lifter across all four Gold levels.
--
-- "Top lifter" is the ranking the weekly bracket already shows: qualified
-- members only (trained the league's minimum days), most days trained first,
-- then weekly XP, then Strength Score, then who joined the week first. A
-- group needs at least TWO qualified lifters, so nobody is handed a "Lead"
-- trophy for being the only person who showed up.
--
-- WHERE THE LEAGUE AND LEVEL COME FROM. The league is the member's own tier
-- for that week (league_members.tier), not the bracket's: brackets can be
-- mixed. The level is derived exactly as the app shows it
-- (src/lib/leagueTiers.js leagueLevel): 1 + qualified weeks earlier in the
-- current stint in that league, capped at IV, with the stint ending at the
-- first earlier week spent in a different league. It is computed from weeks
-- BEFORE the one being awarded, so it is the level the lifter saw on their
-- card all week.
--
-- Trophy ids are generated, like season trophies (league_s{n}_{tier}):
--   league_lead_{tier}_{level}_{isoyear}w{isoweek}   e.g. league_lead_gold_3_2026w40
--   league_lead_{tier}_{isoyear}w{isoweek}           e.g. league_lead_gold_2026w40
-- The week is the ISO week of the Monday the race started. The client parses
-- the id (parseLeadTrophy in src/lib/trophyDefinitions.js), so a new trophy
-- needs no catalog row.
--
-- league_lead_awards records every award, keyed (week_start, tier, level), so
-- the award is idempotent however many times the roll runs and there is a
-- history of who led each group. level 0 means the whole league. It has no
-- client grants; the app reads trophies from user_trophies.
--
-- Additive only: roll_weekly_leagues gains one call after its loop, wrapped so
-- a trophy failure can never roll back the week's payouts or placements. No
-- user data is changed or deleted. Server only: no client can insert a
-- trophy (user_trophies has no client INSERT policy).

------------------------------------------------------------------------------
-- Record of awards
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.league_lead_awards (
  week_start     date        NOT NULL,
  tier           text        NOT NULL,
  level          smallint    NOT NULL CHECK (level BETWEEN 0 AND 4),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trophy_id      text        NOT NULL,
  active_days    integer,
  weekly_xp      integer,
  strength_score numeric,
  field_size     integer     NOT NULL,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, tier, level)
);
CREATE INDEX IF NOT EXISTS league_lead_awards_user_idx ON public.league_lead_awards (user_id);
ALTER TABLE public.league_lead_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_lead_awards FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- The level a lifter held in a league during a given week (1 to 4)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_level_at(p_user_id uuid, p_tier text, p_week_start date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH h AS (
    SELECT COALESCE(m.tier, l.tier) AS tier, m.qualified, l.week_start
      FROM public.league_members m
      JOIN public.leagues l ON l.id = m.league_id
     WHERE m.user_id = p_user_id
       AND l.is_resolved
       AND l.week_start < p_week_start
     ORDER BY l.week_start DESC
     LIMIT 52
  ), s AS (
    SELECT tier, qualified,
           bool_or(tier IS DISTINCT FROM p_tier)
             OVER (ORDER BY week_start DESC ROWS UNBOUNDED PRECEDING) AS broken
      FROM h
  )
  SELECT LEAST(4, 1 + COALESCE((SELECT count(*)::integer FROM s
                                 WHERE NOT broken AND qualified IS TRUE), 0));
$function$;
REVOKE ALL ON FUNCTION public.league_level_at(uuid, text, date) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- Names, in the lifter's language, for the notification
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.league_lead_text(p_lang text, p_tier text, p_level integer, p_week integer)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  l text := CASE WHEN p_lang IN ('es', 'fr') THEN p_lang ELSE 'en' END;
  i integer := public.league_tier_rank(p_tier);
  tier_name text;
  grp text;
BEGIN
  tier_name := CASE l
    WHEN 'es' THEN (ARRAY['Bronce','Plata','Oro','Platino','Diamante','Leyenda'])[i]
    WHEN 'fr' THEN (ARRAY['Bronze','Argent','Or','Platine','Diamant','Légende'])[i]
    ELSE (ARRAY['Bronze','Silver','Gold','Platinum','Diamond','Legend'])[i] END;
  -- "Gold III" for a level, the league's own name for the whole league.
  grp := CASE WHEN p_level BETWEEN 1 AND 4
              THEN tier_name || ' ' || (ARRAY['I','II','III','IV'])[p_level]
              ELSE CASE l WHEN 'es' THEN 'la Liga ' || tier_name
                          WHEN 'fr' THEN 'Ligue ' || tier_name
                          ELSE 'the ' || tier_name || ' League' END END;

  RETURN jsonb_build_object(
    'title', CASE l
      WHEN 'es' THEN 'Atleta líder de ' || CASE WHEN p_level BETWEEN 1 AND 4 THEN grp ELSE 'la Liga ' || tier_name END
                     || ', semana ' || p_week
      WHEN 'fr' THEN 'Athlète de tête en ' || grp || ', semaine ' || p_week
      ELSE CASE WHEN p_level BETWEEN 1 AND 4 THEN grp ELSE tier_name END
           || ' Lead Lifter, Week ' || p_week END,
    'body', CASE l
      WHEN 'es' THEN 'Terminaste en primer lugar en ' || grp || ' esta semana. El trofeo ya está en tu vitrina.'
      WHEN 'fr' THEN 'Vous finissez à la première place en ' || grp || ' cette semaine. Le trophée est dans votre vitrine.'
      ELSE 'You finished first in ' || grp || ' this week. The trophy is in your case.' END);
END;
$function$;

------------------------------------------------------------------------------
-- Notification category: a league event, so the League toggle mutes it
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_type_category(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE p_type
    WHEN 'streak_milestone'         THEN 'streak'
    WHEN 'streak_break_warning'     THEN 'streak'
    WHEN 'streak_rescued'           THEN 'streak'
    WHEN 'quest_claimed'            THEN 'quests'
    WHEN 'quest_expiry_warning'     THEN 'quests'
    WHEN 'league_promoted'          THEN 'league'
    WHEN 'league_demoted'           THEN 'league'
    WHEN 'league_held'              THEN 'league'
    WHEN 'league_promotion'         THEN 'league'
    WHEN 'league_demotion'          THEN 'league'
    WHEN 'league_trophy'            THEN 'league'
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
    WHEN 'pr_set'                   THEN 'achievements'
    WHEN 'capsule_earned'           THEN 'achievements'
    WHEN 'coin_milestone'           THEN 'achievements'
    WHEN 'rival_month_bonus'        THEN 'achievements'
    WHEN 'welcome_back'             THEN 'engagement'
    WHEN 'weekly_gauntlet_started'  THEN 'engagement'
    WHEN 'memory_reengagement'      THEN 'engagement'
    WHEN 'referral_success'         THEN 'engagement'
    WHEN 'comeback_protocol'        THEN 'engagement'
    WHEN 'past_you_nudge'           THEN 'engagement'
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
    WHEN 'past_you_checkpoint'      THEN 'competitive'
    ELSE NULL
  END;
$function$;

------------------------------------------------------------------------------
-- The award
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_league_lead_trophies_internal(p_week_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  -- A "Lead" trophy means you beat someone.
  c_min_field CONSTANT integer := 2;
  v_week    integer := to_char(p_week_start, 'IW')::integer;
  v_suffix  text    := to_char(p_week_start, 'IYYY') || 'w' || to_char(p_week_start, 'IW');
  v_win     record;
  v_trophy  text;
  v_lang    text;
  v_text    jsonb;
  v_n       integer := 0;
BEGIN
  IF p_week_start IS NULL THEN RETURN 0; END IF;
  -- Only once every bracket of that week has been resolved.
  IF EXISTS (SELECT 1 FROM public.leagues WHERE week_start = p_week_start AND NOT is_resolved)
     OR NOT EXISTS (SELECT 1 FROM public.leagues WHERE week_start = p_week_start) THEN
    RETURN 0;
  END IF;

  FOR v_win IN
    WITH racers AS (
      -- One row per lifter (their best, should they ever sit in two brackets).
      SELECT DISTINCT ON (m.user_id)
             m.user_id,
             COALESCE(m.tier, l.tier)       AS tier,
             COALESCE(m.active_days, 0)     AS days,
             COALESCE(m.weekly_xp, 0)       AS xp,
             COALESCE(s.score, 0)           AS score,
             m.joined_at
        FROM public.league_members m
        JOIN public.leagues l ON l.id = m.league_id
        LEFT JOIN public.league_strength s ON s.user_id = m.user_id
       WHERE l.week_start = p_week_start
         AND m.qualified IS TRUE
       ORDER BY m.user_id, COALESCE(m.active_days, 0) DESC, COALESCE(m.weekly_xp, 0) DESC
    ), leveled AS (
      SELECT r.*, public.league_level_at(r.user_id, r.tier, p_week_start) AS lvl
        FROM racers r
    ), groups AS (
      -- Each level of each league, and each league as a whole (level 0).
      SELECT tier, lvl AS grp_level, user_id, days, xp, score, joined_at FROM leveled
      UNION ALL
      SELECT tier, 0, user_id, days, xp, score, joined_at FROM leveled
    ), ranked AS (
      SELECT g.*,
             count(*) OVER (PARTITION BY tier, grp_level) AS field,
             row_number() OVER (PARTITION BY tier, grp_level
                                ORDER BY days DESC, xp DESC, score DESC, joined_at ASC, user_id) AS pos
        FROM groups g
    )
    SELECT * FROM ranked
     WHERE pos = 1 AND field >= c_min_field
     ORDER BY public.league_tier_rank(tier), grp_level
  LOOP
    v_trophy := 'league_lead_' || v_win.tier
             || CASE WHEN v_win.grp_level > 0 THEN '_' || v_win.grp_level ELSE '' END
             || '_' || v_suffix;

    INSERT INTO public.league_lead_awards
      (week_start, tier, level, user_id, trophy_id, active_days, weekly_xp, strength_score, field_size)
    VALUES
      (p_week_start, v_win.tier, v_win.grp_level, v_win.user_id, v_trophy,
       v_win.days, v_win.xp, v_win.score, v_win.field)
    ON CONFLICT (week_start, tier, level) DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- user_email is filled from the profile by trg_user_trophies_fill_email.
    INSERT INTO public.user_trophies (user_id, user_email, trophy_id)
    VALUES (v_win.user_id, '', v_trophy)
    ON CONFLICT (user_id, trophy_id) DO NOTHING;

    SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = v_win.user_id;
    v_text := public.league_lead_text(COALESCE(v_lang, 'en'), v_win.tier, v_win.grp_level, v_week);
    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (v_win.user_id,
            (SELECT email FROM public.user_profiles WHERE id = v_win.user_id),
            'league_trophy', v_text->>'title', v_text->>'body', '🏆', '/progress',
            jsonb_build_object('trophy_id', v_trophy, 'tier', v_win.tier,
                               'level', v_win.grp_level, 'week', v_week,
                               'week_start', p_week_start));

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.award_league_lead_trophies_internal(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.league_lead_text(text, text, integer, integer) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- The roll: unchanged, plus the award once the loop has resolved everything.
-- Body copied from the installed function (pg_get_functiondef, 2026-09-30).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.roll_weekly_leagues()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      UUID;
  v_start   DATE;
  v_end     DATE;
  v_uid     UUID;
  v_claimed INTEGER := 0;
  v_weeks   DATE[] := '{}';
  v_week    DATE;
BEGIN
  FOR v_id, v_start, v_end IN
    SELECT id, week_start, week_end FROM public.leagues
     WHERE is_resolved = FALSE
       AND week_end = LEAST(week_end, CURRENT_DATE)
       AND NOT (week_end = CURRENT_DATE)
     ORDER BY week_start
  LOOP
    UPDATE public.leagues
       SET is_resolved = TRUE
     WHERE id = v_id AND is_resolved = FALSE;

    IF FOUND THEN
      UPDATE public.league_members m
         SET weekly_xp = LEAST(150000, GREATEST(0, COALESCE((
               SELECT SUM(g.amount) FROM public.xp_grant_log g
                WHERE g.user_id = m.user_id
                  AND g.granted_at >= v_start::TIMESTAMPTZ
                  AND g.granted_at < (v_end + 1)::TIMESTAMPTZ), 0)))
       WHERE m.league_id = v_id;

      PERFORM public.resolve_league_bracket_internal(v_id);

      -- Then the tier moves, from strength. One lifter's failure must not
      -- stop everyone else's placement or roll back the week's payouts.
      FOR v_uid IN SELECT DISTINCT user_id FROM public.league_members WHERE league_id = v_id LOOP
        BEGIN
          PERFORM public.league_apply_strength_placement(v_uid);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'league placement failed for %: %', v_uid, SQLERRM;
        END;
      END LOOP;

      IF NOT (v_start = ANY (v_weeks)) THEN
        v_weeks := v_weeks || v_start;
      END IF;
      v_claimed := v_claimed + 1;
    END IF;
  END LOOP;

  -- Lead Lifter trophies, once every bracket of the week is resolved. A
  -- failure here must not undo the payouts and placements above.
  FOREACH v_week IN ARRAY v_weeks LOOP
    BEGIN
      PERFORM public.award_league_lead_trophies_internal(v_week);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'lead lifter trophies failed for week %: %', v_week, SQLERRM;
    END;
  END LOOP;

  RETURN v_claimed;
END;
$function$;

------------------------------------------------------------------------------
-- Probe: seeded, rolled back. Two weeks in the year 2001 so nothing real is
-- touched. Week 1 builds levels; week 2 is awarded.
--   A gold, qualified in week 1 -> Gold II in week 2; 3 days, 100 XP
--   B gold, qualified in week 1 -> Gold II in week 2; 3 days, 200 XP  (wins Gold II)
--   C gold, NOT qualified week 1 -> Gold I;           4 days,  50 XP  (wins Gold I and Gold)
--   D silver in week 1           -> Gold I (new stint); 1 day, 999 XP
--   F silver alone in week 2     -> no trophy (field of one)
------------------------------------------------------------------------------
DO $probe$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_f uuid := gen_random_uuid();
  v_l1 uuid;
  v_l2 uuid;
  v_n integer;
  v_t jsonb;
BEGIN
  -- Pure pieces.
  v_t := public.league_lead_text('en', 'gold', 3, 40);
  IF v_t->>'title' <> 'Gold III Lead Lifter, Week 40' THEN
    RAISE EXCEPTION 'probe: en title %', v_t->>'title';
  END IF;
  v_t := public.league_lead_text('en', 'gold', 0, 40);
  IF v_t->>'title' <> 'Gold Lead Lifter, Week 40' OR v_t->>'body' NOT LIKE '%the Gold League%' THEN
    RAISE EXCEPTION 'probe: en league text %', v_t;
  END IF;
  IF public.league_lead_text('es', 'gold', 3, 40)->>'title' <> 'Atleta líder de Oro III, semana 40'
     OR public.league_lead_text('fr', 'silver', 0, 7)->>'title' <> 'Athlète de tête en Ligue Argent, semaine 7' THEN
    RAISE EXCEPTION 'probe: es/fr titles';
  END IF;
  IF public.notification_type_category('league_trophy') <> 'league'
     OR public.notification_type_category('dm_received') <> 'social' THEN
    RAISE EXCEPTION 'probe: notification category';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    SELECT u, 'lead-probe-' || u || '@example.invalid', 'authenticated', 'authenticated', FALSE
      FROM unnest(ARRAY[v_a, v_b, v_c, v_d, v_f]) u;
    INSERT INTO public.user_profiles (id, email, username)
    SELECT u, 'lead-probe-' || u || '@example.invalid', 'zqleadprobe' || left(u::text, 8)
      FROM unnest(ARRAY[v_a, v_b, v_c, v_d, v_f]) u
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;
    UPDATE public.user_profiles SET preferred_language = 'es' WHERE id = v_c;

    INSERT INTO public.leagues (tier, week_start, week_end, is_resolved)
    VALUES ('gold', DATE '2001-01-01', DATE '2001-01-07', TRUE) RETURNING id INTO v_l1;
    INSERT INTO public.leagues (tier, week_start, week_end, is_resolved)
    VALUES ('gold', DATE '2001-01-08', DATE '2001-01-14', TRUE) RETURNING id INTO v_l2;

    INSERT INTO public.league_members (league_id, user_id, user_email, tier, qualified, active_days, weekly_xp)
    VALUES (v_l1, v_a, 'x', 'gold',   TRUE,  2, 10),
           (v_l1, v_b, 'x', 'gold',   TRUE,  2, 10),
           (v_l1, v_c, 'x', 'gold',   FALSE, 0, 0),
           (v_l1, v_d, 'x', 'silver', TRUE,  1, 10),
           (v_l2, v_a, 'x', 'gold',   TRUE,  3, 100),
           (v_l2, v_b, 'x', 'gold',   TRUE,  3, 200),
           (v_l2, v_c, 'x', 'gold',   TRUE,  4, 50),
           (v_l2, v_d, 'x', 'gold',   TRUE,  1, 999),
           (v_l2, v_f, 'x', 'silver', TRUE,  5, 500);

    IF public.league_level_at(v_a, 'gold', DATE '2001-01-08') <> 2
       OR public.league_level_at(v_c, 'gold', DATE '2001-01-08') <> 1
       OR public.league_level_at(v_d, 'gold', DATE '2001-01-08') <> 1
       OR public.league_level_at(v_d, 'silver', DATE '2001-01-08') <> 2 THEN
      RAISE EXCEPTION 'probe: levels wrong';
    END IF;

    -- An unresolved bracket that week holds the award back.
    UPDATE public.leagues SET is_resolved = FALSE WHERE id = v_l2;
    IF public.award_league_lead_trophies_internal(DATE '2001-01-08') <> 0 THEN
      RAISE EXCEPTION 'probe: awarded before the week resolved';
    END IF;
    UPDATE public.leagues SET is_resolved = TRUE WHERE id = v_l2;

    v_n := public.award_league_lead_trophies_internal(DATE '2001-01-08');
    IF v_n <> 3 THEN RAISE EXCEPTION 'probe: expected 3 awards, got %', v_n; END IF;

    IF NOT EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_b AND trophy_id = 'league_lead_gold_2_2001w02')
       OR NOT EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_c AND trophy_id = 'league_lead_gold_1_2001w02')
       OR NOT EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_c AND trophy_id = 'league_lead_gold_2001w02')
       OR EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id IN (v_a, v_d, v_f) AND trophy_id LIKE 'league_lead_%') THEN
      RAISE EXCEPTION 'probe: wrong winners';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_c AND COALESCE(user_email, '') = '') THEN
      RAISE EXCEPTION 'probe: trophy email not filled';
    END IF;
    IF (SELECT title FROM public.notifications WHERE user_id = v_c AND type = 'league_trophy'
          AND metadata->>'level' = '0') <> 'Atleta líder de la Liga Oro, semana 2' THEN
      RAISE EXCEPTION 'probe: winner notification';
    END IF;

    -- Idempotent: a second run adds nothing and notifies nobody again.
    IF public.award_league_lead_trophies_internal(DATE '2001-01-08') <> 0
       OR (SELECT count(*) FROM public.notifications WHERE user_id IN (v_b, v_c) AND type = 'league_trophy') <> 3 THEN
      RAISE EXCEPTION 'probe: not idempotent';
    END IF;

    -- No client door.
    IF has_function_privilege('authenticated', 'public.award_league_lead_trophies_internal(date)', 'EXECUTE')
       OR has_table_privilege('authenticated', 'public.league_lead_awards', 'SELECT') THEN
      RAISE EXCEPTION 'probe: client can reach the award';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;
