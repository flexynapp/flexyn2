-- 251_crew_treasury_and_perks.sql
--
-- A treasury worth defending: wars and challenges now pay the crew as well
-- as its members, and a leader can spend that balance on something the
-- whole crew keeps.
--
-- WHY
--
-- Every payout so far has landed on individuals. A crew that wins a war
-- hands 250 XP and 100 coins to each member and keeps nothing, so there is
-- no shared pot, nothing collective to save toward, and no reason for a
-- crew to care about a war it is going to lose narrowly rather than badly.
-- 248 gave the crew a level and a standing; this gives it a balance.
--
-- WHERE THE DEPOSIT GOES
--
-- Inside award_crew_progress, which 248 established as the single crediting
-- path and which both resolve_due_crew_wars and
-- sync_my_crew_challenge_progress already call. Putting the deposit there
-- rather than at the two call sites means neither of those functions has to
-- be re-emitted -- they are long, they are correct, and re-pasting them to
-- add one line is how a working payout block acquires a typo.
--
-- The deposit is placed BEFORE the season-stats block on purpose. That
-- block begins with an early RETURN when no season exists, and a deposit
-- written after it would silently stop paying the moment a season lapsed.
--
-- WHAT A PERK IS
--
-- crew_perks is a catalogue table, not a CASE statement, so new perks are an
-- INSERT rather than a migration. Two ship here:
--
--   extra_seat   -- +1 member seat, up to four times, 16 -> 20. The sixteen
--                   cap is the constraint crews actually feel; this is the
--                   only perk with real mechanical value, and it escalates
--                   in price so a crew cannot simply buy its way to 20.
--   crew_banner  -- cosmetic. Deliberately included: a treasury with only
--                   one thing to buy is a countdown, not an economy.
--
-- Costs are paid from the crew balance by a leader, under a row lock, and
-- every movement is written to crew_treasury_ledger with the balance after
-- it. "Who funded this" was already answerable from crew_war_contributions
-- and crew_challenge_contributions; "where did it go" is answerable now too.
--
-- max_capacity is pinned by crews_guard_write (248), so extra_seat can only
-- move it from inside a SECURITY DEFINER function owned by postgres. That is
-- exactly the intended shape: the cap is not client-writable, and buying a
-- seat is a server action with a price attached.
--
-- Paste-safe per repo convention: schema-qualified table names, no
-- short table-alias column tokens, no record field access, and no bare
-- angle-bracket comparison operators anywhere in a statement body
-- (GREATEST / LEAST / NOT (a = b) are used instead).

-- ── 1. The balance, and the guard that protects it ───────────────────
ALTER TABLE public.crews
  ADD COLUMN IF NOT EXISTS treasury_coins integer NOT NULL DEFAULT 0;

-- Re-emitted from 248 with treasury_coins added. A guard that does not know
-- about a column it should be protecting reads as covered while protecting
-- nothing -- and `authenticated` genuinely holds UPDATE on crews, because
-- leaders rename their crew through updateCrewProfile.
CREATE OR REPLACE FUNCTION public.crews_guard_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $crews_guard$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.crew_xp        := 0;
    NEW.crew_level     := 1;
    NEW.trophies       := 0;
    NEW.wars_won       := 0;
    NEW.wars_lost      := 0;
    NEW.wars_drawn     := 0;
    NEW.treasury_coins := 0;
    RETURN NEW;
  END IF;

  NEW.crew_xp        := OLD.crew_xp;
  NEW.crew_level     := OLD.crew_level;
  NEW.trophies       := OLD.trophies;
  NEW.wars_won       := OLD.wars_won;
  NEW.wars_lost      := OLD.wars_lost;
  NEW.wars_drawn     := OLD.wars_drawn;
  NEW.treasury_coins := OLD.treasury_coins;
  NEW.created_by     := OLD.created_by;
  NEW.created_at     := OLD.created_at;
  NEW.max_capacity   := OLD.max_capacity;
  RETURN NEW;
END;
$crews_guard$;

DROP TRIGGER IF EXISTS crews_guard_write_tr ON public.crews;
CREATE TRIGGER crews_guard_write_tr
  BEFORE INSERT OR UPDATE ON public.crews
  FOR EACH ROW
  EXECUTE FUNCTION public.crews_guard_write();

-- ── 2. Every movement, with the balance after it ─────────────────────
CREATE TABLE IF NOT EXISTS public.crew_treasury_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id       uuid        NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  delta         integer     NOT NULL,
  balance_after integer     NOT NULL,
  reason        text        NOT NULL,
  actor_user_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crew_treasury_ledger_crew_idx
  ON public.crew_treasury_ledger (crew_id, created_at DESC);

ALTER TABLE public.crew_treasury_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_treasury_ledger: members read" ON public.crew_treasury_ledger;
CREATE POLICY "crew_treasury_ledger: members read"
  ON public.crew_treasury_ledger FOR SELECT TO authenticated
  USING (public.is_crew_member(crew_id));

GRANT SELECT ON public.crew_treasury_ledger TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_treasury_ledger FROM authenticated, anon;

-- ── 3. The catalogue ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_perks (
  perk_key      text    PRIMARY KEY,
  name          text    NOT NULL,
  description   text    NOT NULL,
  base_cost     integer NOT NULL CHECK (base_cost = GREATEST(base_cost, 1)),
  max_purchases integer NOT NULL DEFAULT 1,
  effect        text    NOT NULL,
  sort_order    integer NOT NULL DEFAULT 100,
  active        boolean NOT NULL DEFAULT TRUE
);

ALTER TABLE public.crew_perks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_perks: read" ON public.crew_perks;
CREATE POLICY "crew_perks: read"
  ON public.crew_perks FOR SELECT TO authenticated USING (active);

GRANT SELECT ON public.crew_perks TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_perks FROM authenticated, anon;

INSERT INTO public.crew_perks
  (perk_key, name, description, base_cost, max_purchases, effect, sort_order)
VALUES
  ('extra_seat', 'Extra seat',
   'Raises your member cap by one, up to twenty. Each seat costs more than the last.',
   500, 4, 'extra_seat', 10),
  ('crew_banner', 'Crew banner',
   'Unlocks a banner treatment on your crew header.',
   800, 1, 'cosmetic', 20)
-- DO NOTHING rather than DO UPDATE ... EXCLUDED.<col>: the qualified-name
-- token mangles in the owner's paste pipeline (42601), which is the same
-- trap 246 and 249 were re-cut to avoid. Re-running this migration is
-- therefore a no-op on the catalogue; editing a perk's copy or price later
-- is a deliberate UPDATE, not a side effect of replaying a migration.
ON CONFLICT (perk_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crew_perk_purchases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id     uuid        NOT NULL REFERENCES public.crews(id)     ON DELETE CASCADE,
  perk_key    text        NOT NULL REFERENCES public.crew_perks(perk_key),
  cost        integer     NOT NULL,
  bought_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crew_perk_purchases_crew_idx
  ON public.crew_perk_purchases (crew_id, perk_key);

ALTER TABLE public.crew_perk_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_perk_purchases: members read" ON public.crew_perk_purchases;
CREATE POLICY "crew_perk_purchases: members read"
  ON public.crew_perk_purchases FOR SELECT TO authenticated
  USING (public.is_crew_member(crew_id));

GRANT SELECT ON public.crew_perk_purchases TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crew_perk_purchases FROM authenticated, anon;

-- ── 4. Deposits, folded into the existing crediting path ─────────────
-- Identical to 248's version apart from the treasury block. Kept as one
-- function so resolve_due_crew_wars and sync_my_crew_challenge_progress
-- do not need re-emitting to start paying the crew.
CREATE OR REPLACE FUNCTION public.award_crew_progress(
  p_crew_id  uuid,
  p_xp       integer,
  p_trophies integer,
  p_points   integer,
  p_result   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $award_crew$
DECLARE
  v_season uuid;
  v_xp     integer;
  v_coins  integer;
  v_after  integer;
BEGIN
  IF p_crew_id IS NULL THEN
    RETURN;
  END IF;

  v_xp := LEAST(50000, GREATEST(0, COALESCE(p_xp, 0)));

  UPDATE public.crews
     SET crew_xp    = crew_xp + v_xp,
         crew_level = public.crew_level_for_xp(crew_xp + v_xp),
         trophies   = GREATEST(0, trophies + COALESCE(p_trophies, 0)),
         wars_won   = wars_won   + CASE WHEN p_result = 'win'   THEN 1 ELSE 0 END,
         wars_lost  = wars_lost  + CASE WHEN p_result = 'loss'  THEN 1 ELSE 0 END,
         wars_drawn = wars_drawn + CASE WHEN p_result = 'draw'  THEN 1 ELSE 0 END
   WHERE id = p_crew_id;

  -- Treasury deposit. A loss still pays, because the crew still trained --
  -- the same reasoning that keeps a loss from costing trophies.
  v_coins := CASE p_result
    WHEN 'win'       THEN 200
    WHEN 'draw'      THEN 80
    WHEN 'loss'      THEN 40
    WHEN 'challenge' THEN 120
    ELSE 0
  END;

  IF NOT (v_coins = 0) THEN
    UPDATE public.crews
       SET treasury_coins = treasury_coins + v_coins
     WHERE id = p_crew_id
     RETURNING treasury_coins INTO v_after;

    INSERT INTO public.crew_treasury_ledger (crew_id, delta, balance_after, reason)
    VALUES (p_crew_id, v_coins, COALESCE(v_after, 0), p_result);
  END IF;

  -- Deliberately last: this block can RETURN early when no season is open,
  -- and a deposit written after it would stop paying the moment one lapsed.
  v_season := public.ensure_crew_season_entry(p_crew_id);
  IF v_season IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.crew_season_stats
     SET points      = points + GREATEST(0, COALESCE(p_points, 0)),
         wars_played = wars_played + CASE WHEN p_result IN ('win','loss','draw') THEN 1 ELSE 0 END,
         wars_won    = wars_won    + CASE WHEN p_result = 'win' THEN 1 ELSE 0 END,
         challenges  = challenges  + CASE WHEN p_result = 'challenge' THEN 1 ELSE 0 END,
         updated_at  = now()
   WHERE season_id = v_season AND crew_id = p_crew_id;
END;
$award_crew$;

REVOKE ALL ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.award_crew_progress(uuid, integer, integer, integer, text) TO service_role;

-- ── 5. What a perk costs right now ───────────────────────────────────
-- Linear escalation: the nth purchase costs base_cost * n. The fourth seat
-- is 2,000 rather than 500, which is roughly ten war wins.
CREATE OR REPLACE FUNCTION public.crew_perk_price(p_base integer, p_owned integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $perk_price$
  SELECT (GREATEST(1, COALESCE(p_base, 1)) * (GREATEST(0, COALESCE(p_owned, 0)) + 1))::integer;
$perk_price$;

REVOKE ALL ON FUNCTION public.crew_perk_price(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crew_perk_price(integer, integer) TO authenticated, service_role;

-- ── 6. Spending it ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_crew_perk(p_crew_id uuid, p_perk_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $buy_perk$
DECLARE
  v_uid     uuid := auth.uid();
  v_admin   integer;
  v_base    integer;
  v_max     integer;
  v_effect  text;
  v_active  boolean;
  v_owned   integer;
  v_price   integer;
  v_balance integer;
  v_after   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_perk_key IS NULL THEN
    RAISE EXCEPTION 'crew_id and perk_key required' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_admin
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid AND is_admin = TRUE;

  IF v_admin = 0 THEN
    RAISE EXCEPTION 'only a crew leader can spend the treasury'
      USING ERRCODE = '42501';
  END IF;

  SELECT base_cost, max_purchases, effect, active
    INTO v_base, v_max, v_effect, v_active
    FROM public.crew_perks
   WHERE perk_key = p_perk_key;

  IF NOT FOUND OR v_active IS NOT TRUE THEN
    RAISE EXCEPTION 'no such perk' USING ERRCODE = '22023';
  END IF;

  -- Lock the crew row: the balance, the purchase count and the seat bump
  -- all have to move together, or two leaders tapping at once buy the same
  -- seat twice out of one balance.
  SELECT treasury_coins INTO v_balance
    FROM public.crews WHERE id = p_crew_id FOR UPDATE;

  SELECT COUNT(*) INTO v_owned
    FROM public.crew_perk_purchases
   WHERE crew_id = p_crew_id AND perk_key = p_perk_key;

  IF v_owned = GREATEST(v_owned, v_max) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'maxed',
                              'owned', v_owned, 'balance', v_balance);
  END IF;

  v_price := public.crew_perk_price(v_base, v_owned);

  IF v_balance = LEAST(v_balance, v_price) AND NOT (v_balance = v_price) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'insufficient',
                              'price', v_price, 'balance', v_balance);
  END IF;

  UPDATE public.crews
     SET treasury_coins = treasury_coins - v_price
   WHERE id = p_crew_id
   RETURNING treasury_coins INTO v_after;

  INSERT INTO public.crew_perk_purchases (crew_id, perk_key, cost, bought_by)
  VALUES (p_crew_id, p_perk_key, v_price, v_uid);

  INSERT INTO public.crew_treasury_ledger
    (crew_id, delta, balance_after, reason, actor_user_id)
  VALUES (p_crew_id, -v_price, v_after, 'perk:' || p_perk_key, v_uid);

  -- Apply the effect. max_capacity is pinned by crews_guard_write for
  -- everyone except postgres and service_role, so this is the only way it
  -- can move -- which is the intended shape rather than a workaround.
  IF v_effect = 'extra_seat' THEN
    UPDATE public.crews
       SET max_capacity = LEAST(20, COALESCE(max_capacity, 16) + 1)
     WHERE id = p_crew_id;
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'perk_key', p_perk_key,
                            'price', v_price, 'balance', v_after,
                            'owned', v_owned + 1);
END;
$buy_perk$;

REVOKE ALL ON FUNCTION public.purchase_crew_perk(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_crew_perk(uuid, text) TO authenticated;

-- ── 7. What the treasury screen reads ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_crew_treasury(p_crew_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $treasury_view$
DECLARE
  v_uid     uuid := auth.uid();
  v_member  integer;
  v_balance integer;
  v_cap     integer;
  v_perks   jsonb;
  v_recent  jsonb;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_member
    FROM public.crew_members WHERE crew_id = p_crew_id AND user_id = v_uid;

  IF v_member = 0 THEN
    RETURN NULL;
  END IF;

  SELECT treasury_coins, COALESCE(max_capacity, 16)
    INTO v_balance, v_cap
    FROM public.crews WHERE id = p_crew_id;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'perk_key',    k_key,
             'name',        k_name,
             'description', k_desc,
             'owned',       k_owned,
             'max',         k_max,
             'price',       public.crew_perk_price(k_base, k_owned),
             'affordable',  COALESCE(v_balance, 0) = GREATEST(COALESCE(v_balance, 0),
                                                              public.crew_perk_price(k_base, k_owned)),
             'maxed',       k_owned = GREATEST(k_owned, k_max)
           ) ORDER BY k_sort
         ), '[]'::jsonb)
    INTO v_perks
    FROM (
      -- Two layers so the owned-count can correlate on k_key. Correlating
      -- against public.crew_perks.perk_key would need a three-part name,
      -- and a bare perk_key inside the subquery would bind to
      -- crew_perk_purchases instead, silently counting every crew's
      -- purchases rather than this one's.
      SELECT k_key, k_name, k_desc, k_base, k_max, k_sort,
             (SELECT COUNT(*) FROM public.crew_perk_purchases
               WHERE crew_id = p_crew_id AND perk_key = k_key) AS k_owned
        FROM (
          SELECT perk_key AS k_key, name AS k_name, description AS k_desc,
                 base_cost AS k_base, max_purchases AS k_max, sort_order AS k_sort
            FROM public.crew_perks
           WHERE active
        ) AS base
    ) AS catalogue;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'delta',         l_delta,
             'balance_after', l_after,
             'reason',        l_reason,
             'created_at',    l_when
           ) ORDER BY l_when DESC
         ), '[]'::jsonb)
    INTO v_recent
    FROM (
      SELECT delta AS l_delta, balance_after AS l_after,
             reason AS l_reason, created_at AS l_when
        FROM public.crew_treasury_ledger
       WHERE crew_id = p_crew_id
       ORDER BY created_at DESC
       LIMIT 12
    ) AS recent;

  RETURN jsonb_build_object(
    'balance',      COALESCE(v_balance, 0),
    'max_capacity', v_cap,
    'perks',        COALESCE(v_perks, '[]'::jsonb),
    'ledger',       COALESCE(v_recent, '[]'::jsonb)
  );
END;
$treasury_view$;

REVOKE ALL ON FUNCTION public.get_crew_treasury(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_crew_treasury(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
