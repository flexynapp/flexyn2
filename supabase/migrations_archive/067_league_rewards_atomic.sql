-- 067_league_rewards_atomic.sql
--
-- Atomic, server-side league reward distribution. Fixes a real
-- correctness bug that the audit surfaced:
--
-- _resolveLeague in src/lib/data/leagues.js was doing the entire reward
-- payout client-side:
--   • UPDATE league_members SET rank = ... WHERE id = m.id
--   • UPDATE user_profiles SET league_tier, flex_coins WHERE id = m.user_id
--   • INSERT INTO user_capsules ...
--
-- But user_profiles RLS only allows `auth.uid() = id`, and
-- league_members RLS (post-027) only allows `user_id = auth.uid()`.
-- So when the resolver iterated all OTHER league members, every UPDATE
-- silently no-op'd due to RLS — coins, tier changes, and capsules were
-- only ever applied to the resolver's own row. Other members got
-- nothing despite the notification telling them they'd been promoted /
-- awarded coins.
--
-- This RPC fixes that by running the full distribution server-side as
-- SECURITY DEFINER, bypassing RLS for the legitimate cross-user writes.
-- The tier config (promote/demote counts + reward amounts) is inlined
-- here as a VALUES table — must stay in sync with src/lib/leagueTiers.js
-- (single source of truth on the client, mirrored here for the server).
--
-- ── Idempotency ─────────────────────────────────────────────────────────
-- The function exits early if any league_member.rank is already non-null
-- on this league — that means a previous successful call already
-- distributed. Combined with the existing claim_league_resolution
-- atomic claim (migration 027), this means:
--   1. Two concurrent _resolveLeague calls — only one wins the claim,
--      only that one calls distribute_league_rewards.
--   2. A retry after a network blip during distribution — the second
--      call sees populated ranks and exits cleanly.
--
-- ── Why returns a table ──────────────────────────────────────────────────
-- The caller still wants to dispatch per-recipient notifications via
-- notify_league_resolution_for (migration 040), which renders text in
-- the recipient's preferred_language. Returning (user_id, outcome,
-- new_tier, coins, capsule) per member gives the client what it needs
-- to drive that final notification step.

CREATE OR REPLACE FUNCTION public.distribute_league_rewards(p_league_id UUID)
RETURNS TABLE(
  user_id       UUID,
  user_email    TEXT,
  outcome       TEXT,   -- 'promote' | 'demote' | 'stay'
  from_tier     TEXT,
  new_tier      TEXT,
  coins_awarded INT,
  capsule       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $x$
DECLARE
  v_league         RECORD;
  v_already        INT;
  v_total          INT;
  v_promote        INT;
  v_demote         INT;
  v_reward_coins   INT;
  v_reward_capsule TEXT;
  v_member         RECORD;
  v_rank           INT;
  v_outcome        TEXT;
  v_new_tier       TEXT;
  v_coins          INT;
  v_capsule        TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NULL THEN
    RAISE EXCEPTION 'league_id required' USING ERRCODE = '22023';
  END IF;

  -- Load league.
  SELECT l.id, l.tier, l.week_end, l.is_resolved
    INTO v_league
    FROM public.leagues l
   WHERE l.id = p_league_id;
  IF v_league IS NULL THEN
    RAISE EXCEPTION 'league not found' USING ERRCODE = '22023';
  END IF;

  -- Idempotency guard: if any member already has rank set, this league
  -- has been distributed. Exit cleanly so retries don't double-pay.
  SELECT COUNT(*) INTO v_already
    FROM public.league_members
   WHERE league_id = p_league_id AND rank IS NOT NULL;
  IF v_already > 0 THEN
    RETURN;
  END IF;

  -- Tier config — mirrors src/lib/leagueTiers.js.
  -- Update both files in lockstep if reward amounts change.
  SELECT t.promote, t.demote, t.reward_coins, t.reward_capsule
    INTO v_promote, v_demote, v_reward_coins, v_reward_capsule
    FROM (VALUES
      ('bronze',   10, 0,   50, NULL::TEXT),
      ('silver',   10, 5,  100, NULL),
      ('gold',      7, 5,  200, 'standard'),
      ('platinum',  5, 5,  350, 'premium'),
      ('diamond',   3, 5,  600, 'premium'),
      ('legend',    0, 5, 1000, 'elite')
    ) AS t(tier_id, promote, demote, reward_coins, reward_capsule)
   WHERE t.tier_id = v_league.tier;
  IF v_promote IS NULL THEN
    RAISE EXCEPTION 'unknown tier: %', v_league.tier USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_total
    FROM public.league_members
   WHERE league_id = p_league_id;

  -- Iterate members ranked by weekly_xp DESC (tie-break by joined_at ASC
  -- so the user who's been in the league longer wins ties — same
  -- convention as the existing listLeagueMembers query in the client).
  v_rank := 0;
  FOR v_member IN
    SELECT lm.id, lm.user_id, lm.user_email
      FROM public.league_members lm
     WHERE lm.league_id = p_league_id
     ORDER BY lm.weekly_xp DESC NULLS LAST, lm.joined_at ASC
  LOOP
    v_rank := v_rank + 1;

    -- Mirrors resolveStanding(tierId, rank, totalMembers).
    IF v_promote > 0 AND v_rank <= v_promote THEN
      v_outcome  := 'promote';
      v_new_tier := CASE v_league.tier
        WHEN 'bronze'   THEN 'silver'
        WHEN 'silver'   THEN 'gold'
        WHEN 'gold'     THEN 'platinum'
        WHEN 'platinum' THEN 'diamond'
        WHEN 'diamond'  THEN 'legend'
        ELSE v_league.tier
      END;
      v_coins   := v_reward_coins;
      v_capsule := v_reward_capsule;
    ELSIF v_demote > 0 AND v_rank > (v_total - v_demote) THEN
      v_outcome  := 'demote';
      v_new_tier := CASE v_league.tier
        WHEN 'silver'   THEN 'bronze'
        WHEN 'gold'     THEN 'silver'
        WHEN 'platinum' THEN 'gold'
        WHEN 'diamond'  THEN 'platinum'
        WHEN 'legend'   THEN 'diamond'
        ELSE v_league.tier
      END;
      v_coins   := 0;
      v_capsule := NULL;
    ELSIF v_league.tier = 'legend' AND v_rank <= 3 THEN
      -- Top-of-legend hold: still award the legend reward.
      v_outcome  := 'stay';
      v_new_tier := 'legend';
      v_coins    := v_reward_coins;
      v_capsule  := v_reward_capsule;
    ELSE
      v_outcome  := 'stay';
      v_new_tier := v_league.tier;
      v_coins    := 0;
      v_capsule  := NULL;
    END IF;

    -- Persist final rank on the membership row.
    UPDATE public.league_members SET rank = v_rank WHERE id = v_member.id;

    -- Tier change for promote/demote.
    IF v_outcome IN ('promote', 'demote') THEN
      UPDATE public.user_profiles
         SET league_tier = v_new_tier
       WHERE id = v_member.user_id;
    END IF;

    -- Coin award (atomic).
    IF v_coins > 0 THEN
      UPDATE public.user_profiles
         SET flex_coins = COALESCE(flex_coins, 0) + v_coins
       WHERE id = v_member.user_id;
    END IF;

    -- Capsule grant.
    IF v_capsule IS NOT NULL THEN
      INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
      VALUES (v_member.user_id, v_member.user_email, v_capsule);
    END IF;

    -- Stream the result back for the caller to dispatch notifications.
    user_id       := v_member.user_id;
    user_email    := v_member.user_email;
    outcome       := v_outcome;
    from_tier     := v_league.tier;
    new_tier      := v_new_tier;
    coins_awarded := COALESCE(v_coins, 0);
    capsule       := v_capsule;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$x$;

GRANT EXECUTE ON FUNCTION public.distribute_league_rewards(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
