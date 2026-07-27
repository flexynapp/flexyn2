-- 242_ensure_my_league_rpc.sql
--
-- Fixes the live 403 on every league join, WITHOUT handing the client
-- write access to the leaderboard.
--
-- THE SYMPTOM
--
--   POST /rest/v1/leagues  ->  403
--   42501: permission denied for table leagues
--   hint: GRANT INSERT ON public.leagues TO authenticated;
--
-- src/lib/data/leagues.js `_findOrCreateLeague` inserts a `leagues` row
-- straight from the browser when no open bracket exists for the user's
-- tier and week. That call has never worked.
--
-- WHY THE HINT IS WRONG
--
-- Postgres suggests granting INSERT. Do not. `leagues` is locked twice,
-- independently, and both locks look deliberate:
--
--   * `authenticated` holds SELECT only, no INSERT
--   * RLS has exactly one policy, "leagues: read all" (SELECT). There is
--     no INSERT policy at all, so even WITH the grant every insert would
--     still be denied.
--
-- Two separate mechanisms agreeing is a design decision, not an
-- oversight. A `leagues` row defines a competition bracket — tier,
-- week_start, week_end, member_count, is_resolved — and league placement
-- pays out real rewards through claim_league_resolution /
-- distribute_league_rewards. Client INSERT would let anyone mint a
-- private bracket at any tier, in any week, sit in it alone, and collect
-- a first-place payout. That is a cheat vector, so the call site is the
-- bug and the grant is not the fix.
--
-- WHAT THIS REPLACES IT WITH
--
-- One SECURITY DEFINER RPC that does the whole find-or-create-and-join
-- as a server-side transaction, deriving EVERY trust-bearing input from
-- the session rather than the caller:
--
--   * the user is auth.uid(); the email is public.current_user_email()
--     (migration 241 — guest sessions have no JWT email)
--   * the TIER is read from user_profiles server-side. Passing it from
--     the client would let anyone drop straight into Legend.
--   * the WEEK is computed server-side. Passing it would let anyone join
--     a past or future bracket, including a resolved one.
--
-- It also absorbs the league_members insert. That table DOES grant
-- INSERT to authenticated under a `user_id = auth.uid()` policy, which
-- checks only WHO is joining — not which league_id they attach
-- themselves to, nor what weekly_xp they start with. Routing membership
-- through the same RPC closes that gap for the normal path.
--
-- SEMANTIC NOTE
--
-- The client computed the week as the LOCAL Monday (date-fns
-- startOfWeek). This computes it in the database. That is a deliberate
-- tightening: a bracket is shared between users, so two people in
-- different timezones must not be able to create two different
-- "this week" rows for the same competition and fragment it.
--
-- REQUIRES: migration 241 (public.current_user_email). Run 241 first.
--
-- Paste-safe: public.<table>, auth.<fn>(), bare columns in single-table
-- statements, least() instead of a bare angle-bracket comparison, and no
-- short alias.column tokens anywhere.

CREATE OR REPLACE FUNCTION public.ensure_my_league()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_email      TEXT := public.current_user_email();
  v_tier       TEXT;
  v_week_start DATE;
  v_week_end   DATE;
  v_league_id  UUID;
  v_member_id  UUID;
  v_league     JSONB;
  v_member     JSONB;
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Tier from the profile, never from the caller.
  SELECT coalesce(league_tier, 'bronze') INTO v_tier
    FROM public.user_profiles
   WHERE id = v_uid;

  v_tier := coalesce(v_tier, 'bronze');
  IF NOT (v_tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend')) THEN
    v_tier := 'bronze';
  END IF;

  -- ISO week, Monday start, computed here.
  v_week_start := (date_trunc('week', CURRENT_DATE))::DATE;
  v_week_end   := v_week_start + 6;

  -- Already placed for this week? Return that placement untouched.
  SELECT id, league_id INTO v_member_id, v_league_id
    FROM public.league_members
   WHERE user_id = v_uid
     AND league_id IN (
       SELECT id FROM public.leagues WHERE week_start = v_week_start
     )
   ORDER BY joined_at DESC
   LIMIT 1;

  IF v_member_id IS NULL THEN
    -- Newest open bracket at this tier and week with room left.
    -- member_count below MAX_LEAGUE_SIZE (30), expressed without a bare
    -- angle bracket: true exactly when member_count is at most 29.
    SELECT id INTO v_league_id
      FROM public.leagues
     WHERE tier = v_tier
       AND week_start = v_week_start
       AND is_resolved = FALSE
       AND member_count = least(member_count, 29)
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_league_id IS NULL THEN
      INSERT INTO public.leagues (tier, week_start, week_end, member_count, is_resolved)
      VALUES (v_tier, v_week_start, v_week_end, 0, FALSE)
      RETURNING id INTO v_league_id;
    END IF;

    -- member_count is maintained by migration 027's trigger, so this
    -- inserts membership only. weekly_xp always starts at zero.
    INSERT INTO public.league_members (league_id, user_id, user_email, weekly_xp)
    VALUES (v_league_id, v_uid, v_email, 0)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_member_id;

    -- Concurrent join from another tab won the unique constraint.
    IF v_member_id IS NULL THEN
      SELECT id INTO v_member_id
        FROM public.league_members
       WHERE league_id = v_league_id
         AND user_id = v_uid
       LIMIT 1;
    END IF;
  END IF;

  SELECT to_jsonb(leagues) INTO v_league
    FROM public.leagues
   WHERE id = v_league_id;

  SELECT to_jsonb(league_members) INTO v_member
    FROM public.league_members
   WHERE id = v_member_id;

  RETURN jsonb_build_object('league', v_league, 'member', v_member);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_my_league() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_league() TO authenticated;

NOTIFY pgrst, 'reload schema';
