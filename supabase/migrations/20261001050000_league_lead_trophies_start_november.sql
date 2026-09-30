-- Lead Lifter trophies start in November (Kegan, 2026-09-30).
--
-- 20261001001000 wired the award into the Monday roll, which would have
-- handed out the first trophies on 2026-10-05. Kegan asked for them to
-- start in November instead. The first week awarded is the first full
-- November week, Monday 2026-11-02 to Sunday 2026-11-08 (ISO week 45),
-- which the roll on Monday 2026-11-09 pays out. Earlier weeks are skipped
-- and never back-filled: nothing is written for them, so no trophies,
-- no award rows and no notifications.
--
-- Only the date floor is new. The rest of the body is the installed one,
-- unchanged. The roll itself is not touched.

CREATE OR REPLACE FUNCTION public.award_league_lead_trophies_internal(p_week_start date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  -- A "Lead" trophy means you beat someone.
  c_min_field CONSTANT integer := 2;
  -- Kegan: start in November. First awarded week is Mon 2026-11-02.
  c_first_week CONSTANT date := DATE '2026-11-02';
  v_week    integer := to_char(p_week_start, 'IW')::integer;
  v_suffix  text    := to_char(p_week_start, 'IYYY') || 'w' || to_char(p_week_start, 'IW');
  v_win     record;
  v_trophy  text;
  v_lang    text;
  v_text    jsonb;
  v_n       integer := 0;
BEGIN
  IF p_week_start IS NULL OR p_week_start < c_first_week THEN RETURN 0; END IF;
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

------------------------------------------------------------------------------
-- Probe, rolled back: a resolved October week awards nothing, and the same
-- field in the first November week awards as before.
------------------------------------------------------------------------------
DO $probe$
DECLARE
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_oct uuid;
  v_nov uuid;
  v_n integer;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, aud, role, is_anonymous)
    SELECT u, 'lead-nov-probe-' || u || '@example.invalid', 'authenticated', 'authenticated', FALSE
      FROM unnest(ARRAY[v_a, v_b]) u;
    INSERT INTO public.user_profiles (id, email, username)
    SELECT u, 'lead-nov-probe-' || u || '@example.invalid', 'zqleadnov' || left(u::text, 8)
      FROM unnest(ARRAY[v_a, v_b]) u
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username;

    INSERT INTO public.leagues (tier, week_start, week_end, is_resolved)
    VALUES ('gold', DATE '2026-10-26', DATE '2026-11-01', TRUE) RETURNING id INTO v_oct;
    INSERT INTO public.leagues (tier, week_start, week_end, is_resolved)
    VALUES ('gold', DATE '2026-11-02', DATE '2026-11-08', TRUE) RETURNING id INTO v_nov;
    INSERT INTO public.league_members (league_id, user_id, user_email, tier, qualified, active_days, weekly_xp)
    VALUES (v_oct, v_a, 'x', 'gold', TRUE, 3, 100),
           (v_oct, v_b, 'x', 'gold', TRUE, 2, 100),
           (v_nov, v_a, 'x', 'gold', TRUE, 3, 100),
           (v_nov, v_b, 'x', 'gold', TRUE, 2, 100);

    -- Separate statements: an EXISTS in the same statement as the award
    -- call reads a snapshot taken before the award's own inserts.
    v_n := public.award_league_lead_trophies_internal(DATE '2026-10-26');
    IF v_n <> 0
       OR EXISTS (SELECT 1 FROM public.league_lead_awards WHERE week_start = DATE '2026-10-26') THEN
      RAISE EXCEPTION 'probe: October week was awarded';
    END IF;
    -- a wins the league and the level (both are level 2 in November, after October in gold).
    v_n := public.award_league_lead_trophies_internal(DATE '2026-11-02');
    IF v_n <> 2
       OR NOT EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_a AND trophy_id = 'league_lead_gold_2026w45')
       OR EXISTS (SELECT 1 FROM public.user_trophies WHERE user_id = v_b AND trophy_id LIKE 'league_lead_%') THEN
      RAISE EXCEPTION 'probe: first November week did not award as expected';
    END IF;

    RAISE EXCEPTION 'probe_ok';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
  END;
END;
$probe$;
