-- 132_monthly_leagues.sql
--
-- Monthly league track — mirrors the weekly leagues schema but at
-- calendar-month grain. The same tier system applies (bronze → legend).
-- Monthly XP accumulates alongside weekly XP; the rollover resolves at
-- the end of each calendar month (UTC).
--
-- Design: separate tables (monthly_leagues / monthly_league_members)
-- rather than a "grain" column on the existing tables so that weekly
-- and monthly leaderboards can be queried independently without
-- cross-grain joins. The client joins via the same `recordMonthlyXp`
-- helper (mirrors recordWeeklyXp in leagues.js).

CREATE TABLE IF NOT EXISTS public.monthly_leagues (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tier         TEXT        NOT NULL CHECK (tier IN ('bronze','silver','gold','platinum','diamond','legend')),
  month_start  DATE        NOT NULL,   -- first day of the month (e.g. 2026-05-01)
  month_end    DATE        NOT NULL,   -- last day of the month   (e.g. 2026-05-31)
  member_count INTEGER     NOT NULL DEFAULT 0,
  is_resolved  BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monthly_leagues_tier_month
  ON public.monthly_leagues(tier, month_start);

CREATE INDEX IF NOT EXISTS idx_monthly_leagues_open
  ON public.monthly_leagues(tier, month_start, member_count)
  WHERE is_resolved = false;

ALTER TABLE public.monthly_leagues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_leagues: read all" ON public.monthly_leagues;
CREATE POLICY "monthly_leagues: read all"
  ON public.monthly_leagues FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "monthly_leagues: insert authenticated" ON public.monthly_leagues;
CREATE POLICY "monthly_leagues: insert authenticated"
  ON public.monthly_leagues FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "monthly_leagues: update authenticated" ON public.monthly_leagues;
CREATE POLICY "monthly_leagues: update authenticated"
  ON public.monthly_leagues FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.monthly_leagues TO authenticated;

-- ── monthly_league_members ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.monthly_league_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID        NOT NULL REFERENCES public.monthly_leagues(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT        NOT NULL,
  monthly_xp  INTEGER     NOT NULL DEFAULT 0,
  rank        INTEGER,                   -- set on rollover; null while active
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_league_members_user
  ON public.monthly_league_members(user_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_monthly_league_members_league_xp
  ON public.monthly_league_members(league_id, monthly_xp DESC);

ALTER TABLE public.monthly_league_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_lm: read" ON public.monthly_league_members;
CREATE POLICY "monthly_lm: read"
  ON public.monthly_league_members FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "monthly_lm: write" ON public.monthly_league_members;
CREATE POLICY "monthly_lm: write"
  ON public.monthly_league_members FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Service role gets full access for the resolution cron
DROP POLICY IF EXISTS "monthly_lm: service write" ON public.monthly_league_members;
CREATE POLICY "monthly_lm: service write"
  ON public.monthly_league_members FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.monthly_league_members TO authenticated;

-- ── record_monthly_xp RPC ─────────────────────────────────────────────────────
-- Called alongside the weekly recordWeeklyXp. Finds or creates the user's
-- monthly league for the current calendar month (UTC), then increments
-- monthly_xp by p_amount.

CREATE OR REPLACE FUNCTION public.record_monthly_xp(
  p_user_id  UUID,
  p_email    TEXT,
  p_tier     TEXT,
  p_amount   INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $record_monthly_xp$
DECLARE
  v_month_start DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_month_end   DATE := (date_trunc('month', now() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date;
  v_league_id   UUID;
  v_member_id   UUID;
BEGIN
  -- Find open league for this tier+month with capacity (≤200 members for monthly)
  SELECT id INTO v_league_id
    FROM public.monthly_leagues
   WHERE tier        = p_tier
     AND month_start = v_month_start
     AND is_resolved = false
     AND member_count < 200
   ORDER BY created_at DESC
   LIMIT 1;

  -- Create one if none exists
  IF v_league_id IS NULL THEN
    INSERT INTO public.monthly_leagues (tier, month_start, month_end, member_count)
    VALUES (p_tier, v_month_start, v_month_end, 0)
    RETURNING id INTO v_league_id;
  END IF;

  -- Upsert membership
  INSERT INTO public.monthly_league_members (league_id, user_id, user_email, monthly_xp)
  VALUES (v_league_id, p_user_id, p_email, GREATEST(0, p_amount))
  ON CONFLICT (league_id, user_id)
  DO UPDATE SET monthly_xp = public.monthly_league_members.monthly_xp + GREATEST(0, p_amount)
  RETURNING id INTO v_member_id;

  -- Bump member_count only on first join
  IF NOT EXISTS (
    SELECT 1 FROM public.monthly_league_members
     WHERE league_id = v_league_id AND user_id = p_user_id AND id <> v_member_id
  ) THEN
    UPDATE public.monthly_leagues
       SET member_count = member_count + 1
     WHERE id = v_league_id;
  END IF;
END;
$record_monthly_xp$;

REVOKE ALL ON FUNCTION public.record_monthly_xp(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_monthly_xp(UUID, TEXT, TEXT, INTEGER) TO authenticated;

-- ── Monthly rollover cron ─────────────────────────────────────────────────────
-- Runs at 00:05 UTC on the 1st of every month. Resolves the prior month's
-- leagues: ranks members by monthly_xp, applies promotions/demotions,
-- marks the league as resolved. Mirrors the weekly resolution cron structure
-- from migration 016 / leagues.js but uses month-grain tables.
-- Note: the cron only marks leagues resolved; promotion/demotion tier
-- updates happen in the same RPC flow as the weekly league (the client
-- reads the resolved monthly league and shows the final standings).

SELECT cron.schedule(
  'monthly-league-resolve',
  '5 0 1 * *',   -- 00:05 UTC on the 1st of every month
  $$
  UPDATE public.monthly_leagues
     SET is_resolved = true
   WHERE is_resolved = false
     AND month_end < CURRENT_DATE;
  $$
);

NOTIFY pgrst, 'reload schema';
