-- Other people's emails stop being readable on six shared tables.
--
-- League standings, season stats, marketplace listings and bundles, and
-- sticker reactions are readable by every signed-in user, and each row
-- carried its owner's email. The app has read them by explicit column list
-- without the email since #224, and names people by user id. Row policies
-- cannot hide a column, so SELECT is now granted column by column: every
-- column except the email one.
--
-- What this does NOT change: who can see which rows (the policies are
-- untouched), plain writes (INSERT, UPDATE and DELETE grants are untouched,
-- so the app still sends the email on insert where the column is NOT NULL),
-- and SECURITY DEFINER functions, which run as the table owner.
--
-- Three consequences a contributor has to know:
--   * select('*') on these tables now fails with 42501. Name the columns.
--   * An upsert may not set the email column (ON CONFLICT DO UPDATE reads
--     EXCLUDED, which needs SELECT). Leave it out or fill it in a trigger.
--   * A column added to one of these tables later is NOT readable by the
--     app until it is granted here too.
-- Undo is a plain GRANT SELECT ON <table> TO anon, authenticated.

REVOKE SELECT ON public.league_members FROM anon, authenticated;
GRANT SELECT (id, league_id, user_id, weekly_xp, rank, joined_at, active_days,
              qualified, outcome, coins_awarded)
  ON public.league_members TO anon, authenticated;

REVOKE SELECT ON public.league_season_stats FROM anon, authenticated;
GRANT SELECT (id, season_id, user_id, best_tier, weeks_qualified, season_xp,
              final_rank, awarded_at)
  ON public.league_season_stats TO anon, authenticated;

REVOKE SELECT ON public.monthly_league_members FROM anon, authenticated;
GRANT SELECT (id, league_id, user_id, monthly_xp, rank, joined_at)
  ON public.monthly_league_members TO anon, authenticated;

REVOKE SELECT ON public.marketplace_listings FROM anon, authenticated;
GRANT SELECT (id, seller_user_id, seller_username, inventory_id, item_id,
              item_name, item_emoji, item_rarity, listing_type, asking_price,
              trade_for_rarity, status, created_at, available_from,
              available_until, bundle_id, is_featured, featured_until)
  ON public.marketplace_listings TO anon, authenticated;

REVOKE SELECT ON public.marketplace_bundles FROM anon, authenticated;
GRANT SELECT (id, seller_user_id, title, discount_pct, status, created_at)
  ON public.marketplace_bundles TO anon, authenticated;

REVOKE SELECT ON public.post_sticker_reactions FROM anon, authenticated;
GRANT SELECT (id, post_id, user_id, item_id, item_name, item_emoji, variant,
              created_at, item_rarity, user_avatar_url, user_name)
  ON public.post_sticker_reactions TO anon, authenticated;

-- Probe, run as a real signed-in user and rolled back: the email columns
-- are refused, the column lists the app sends still read, and a bundle can
-- still be created, read back, upserted (without the email) and deleted.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_me_em  text;
  v_bundle uuid := gen_random_uuid();
  v_title  text;
  v_tbl    text;
  v_col    text;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email)
  VALUES (v_me, 'probe_m_' || v_me || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  -- Each email column is refused, and so is select *.
  FOR v_tbl, v_col IN VALUES
    ('league_members', 'user_email'),
    ('league_season_stats', 'user_email'),
    ('monthly_league_members', 'user_email'),
    ('marketplace_listings', 'seller_email'),
    ('marketplace_bundles', 'seller_email'),
    ('post_sticker_reactions', 'user_email')
  LOOP
    BEGIN
      EXECUTE format('SELECT %I FROM public.%I LIMIT 1', v_col, v_tbl);
      RAISE EXCEPTION 'probe: %.% still readable', v_tbl, v_col;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('SELECT * FROM public.%I LIMIT 1', v_tbl);
      RAISE EXCEPTION 'probe: select * on % still allowed', v_tbl;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- The column lists the app sends (leagues.js, leagueSeasons.js,
  -- marketplace.js, stickerReactions.js) still read.
  PERFORM id, league_id, user_id, weekly_xp, rank, joined_at, active_days,
          qualified, outcome, coins_awarded
     FROM public.league_members LIMIT 1;
  PERFORM season_id, best_tier, weeks_qualified, season_xp, final_rank, awarded_at
     FROM public.league_season_stats WHERE user_id = v_me;
  PERFORM id, seller_user_id, seller_username, inventory_id, item_id, item_name,
          item_emoji, item_rarity, listing_type, asking_price, trade_for_rarity,
          status, created_at, available_from, available_until, bundle_id,
          is_featured, featured_until
     FROM public.marketplace_listings WHERE seller_user_id = v_me;
  PERFORM id, post_id, user_id, item_id, item_name, item_emoji, item_rarity,
          variant, created_at, user_avatar_url, user_name
     FROM public.post_sticker_reactions LIMIT 1;

  -- createBundle: insert with the email, read back the granted columns.
  INSERT INTO public.marketplace_bundles (id, seller_user_id, seller_email, title, discount_pct, status)
  VALUES (v_bundle, v_me, v_me_em, 'probe', 10, 'active')
  RETURNING title INTO v_title;
  IF v_title IS DISTINCT FROM 'probe' THEN
    RAISE EXCEPTION 'probe: bundle insert did not read back';
  END IF;

  -- An upsert that sets the email from EXCLUDED is refused: Postgres needs
  -- SELECT on every column read from EXCLUDED. This is why the sticker
  -- reaction upsert stopped sending user_email (migration 20260930141500)
  -- before this lock.
  BEGIN
    INSERT INTO public.marketplace_bundles (id, seller_user_id, seller_email, title, discount_pct, status)
    VALUES (v_bundle, v_me, v_me_em, 'probe2', 10, 'active')
    ON CONFLICT (id) DO UPDATE
      SET seller_email = EXCLUDED.seller_email, title = EXCLUDED.title;
    RAISE EXCEPTION 'probe: upsert reading EXCLUDED.seller_email allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- One that leaves the email out works.
  INSERT INTO public.marketplace_bundles (id, seller_user_id, seller_email, title, discount_pct, status)
  VALUES (v_bundle, v_me, v_me_em, 'probe2', 10, 'active')
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;
  SELECT title INTO v_title FROM public.marketplace_bundles WHERE id = v_bundle;
  IF v_title IS DISTINCT FROM 'probe2' THEN
    RAISE EXCEPTION 'probe: bundle upsert did not apply';
  END IF;

  DELETE FROM public.marketplace_bundles WHERE id = v_bundle AND status = 'active';
  IF EXISTS (SELECT 1 FROM public.marketplace_bundles WHERE id = v_bundle) THEN
    RAISE EXCEPTION 'probe: bundle delete did nothing';
  END IF;

  EXECUTE 'RESET role';
  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
