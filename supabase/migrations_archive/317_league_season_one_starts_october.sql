-- 317_league_season_one_starts_october.sql
--
-- Season 1 starts 2026-10-01 (kegan, 2026-08-09), not the moment migration
-- 312 was applied.
--
-- ── WHAT WAS WRONG WITH THE OLD BEHAVIOUR ─────────────────────────────────
--
-- current_league_season() is get-or-open: the first caller after 312 landed
-- opened Season 1 there and then, dated 2026-08-09 → 2026-09-06. That is fine
-- as a default and wrong as a launch. It also makes a scheduled start
-- impossible to express — inserting a future-dated season does nothing,
-- because the next caller sees no *started* season and immediately opens
-- another one alongside it.
--
-- So this teaches the opener two things it did not know:
--
--   1. A season only counts once `starts_at` has passed.
--   2. If a season is already scheduled for the future, DO NOT open one now.
--      Return NULL and let the pre-season be a real state.
--
-- ── WHAT A PRE-SEASON MEANS ───────────────────────────────────────────────
--
-- Between now and 1 October there is no active season, and that is deliberate
-- rather than a gap:
--
--   • Weekly brackets carry on exactly as they are. Promotion, demotion, the
--     activity gate, decay and payouts all live in roll_weekly_leagues and
--     never touch a season.
--   • league_season_record_internal no-ops, because current_league_season()
--     returns NULL. Weeks trained before launch do not bank toward Season 1 —
--     which is the point of naming a start date.
--   • roll_league_seasons() finds nothing to roll: it only looks at active
--     seasons whose ends_at has passed, and Season 1's has not.
--   • my_league_season() returns a PRE-SEASON payload rather than NULL, so the
--     UI can say "Season 1 starts 1 Oct" instead of silently dropping the line
--     and looking broken.
--
-- ── WHY 1 OCTOBER LANDS CLEANLY ───────────────────────────────────────────
--
-- 1 Oct 2026 is a Thursday, so the boundary does not sit on a week edge — but
-- what matters is how many weekly RESOLUTIONS fall inside the season, because
-- that is when a week is recorded. Season 1 runs 1 Oct → 29 Oct, and the
-- Mondays inside it are the 5th, 12th, 19th and 26th: exactly four, which is
-- the four-week season the reward rules assume (two qualifying weeks of four).
-- No adjustment needed.
--
-- Safe to re-run. Season 1 currently holds zero league_season_stats rows, so
-- moving its dates loses nothing.
--
-- Paste-safe: public.<table>, scalar SELECT ... INTO, bare columns in
-- single-table statements, least()/greatest() instead of angle brackets.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Move Season 1
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.league_seasons
   SET starts_at = TIMESTAMPTZ '2026-10-01 00:00:00+00',
       ends_at   = TIMESTAMPTZ '2026-10-29 00:00:00+00'
 WHERE season_number = 1
   AND status = 'active';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The opener respects a scheduled start
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.current_league_season()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $cur_season$
DECLARE
  v_id      UUID;
  v_pending UUID;
  v_next    INTEGER;
BEGIN
  -- An active season that has actually begun.
  SELECT id INTO v_id
    FROM public.league_seasons
   WHERE status = 'active'
     AND starts_at = LEAST(starts_at, now())
   ORDER BY season_number DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- A season is scheduled but has not started. This is the pre-season, and it
  -- must NOT auto-open a second season alongside the scheduled one — which is
  -- exactly what the old get-or-open did, and why a launch date could not be
  -- set at all.
  SELECT id INTO v_pending
    FROM public.league_seasons
   WHERE status = 'active'
     AND starts_at = GREATEST(starts_at, now())
     AND NOT (starts_at = now())
   ORDER BY season_number
   LIMIT 1;

  IF v_pending IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Nothing active and nothing scheduled: open one now. Unchanged behaviour,
  -- and the path seasons 2+ take when roll_league_seasons chains them.
  SELECT COALESCE(MAX(season_number), 0) + 1 INTO v_next FROM public.league_seasons;

  INSERT INTO public.league_seasons (season_number, name, starts_at, ends_at, status)
  VALUES (v_next, public.league_season_name(v_next), now(), now() + INTERVAL '28 days', 'active')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.league_seasons
     WHERE status = 'active'
       AND starts_at = LEAST(starts_at, now())
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
-- 3. The read reports the pre-season instead of going silent
--
-- Returning NULL would make the standings header simply omit the season line,
-- which is indistinguishable from "this feature isn't deployed". A countdown
-- is the more honest answer and it is also the more useful one.
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
  v_starts TIMESTAMPTZ;
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

  -- Pre-season: report the scheduled one so the UI can count down to it.
  IF v_season IS NULL THEN
    SELECT season_number, name, starts_at, ends_at
      INTO v_num, v_name, v_starts, v_ends
      FROM public.league_seasons
     WHERE status = 'active'
       AND starts_at = GREATEST(starts_at, now())
       AND NOT (starts_at = now())
     ORDER BY season_number
     LIMIT 1;

    IF v_num IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
      'pre_season',      TRUE,
      'season_number',   v_num,
      'name',            v_name,
      'starts_at',       v_starts,
      'ends_at',         v_ends,
      'best_tier',       'bronze',
      'weeks_qualified', 0,
      'weeks_needed',    2,
      'season_xp',       0,
      'season_rank',     NULL,
      'field_size',      0
    );
  END IF;

  SELECT season_number, name, starts_at, ends_at
    INTO v_num, v_name, v_starts, v_ends
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
    'pre_season',      FALSE,
    'season_number',   v_num,
    'name',            v_name,
    'starts_at',       v_starts,
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

NOTIFY pgrst, 'reload schema';
