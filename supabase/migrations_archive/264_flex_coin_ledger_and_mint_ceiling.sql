-- 264_flex_coin_ledger_and_mint_ceiling.sql
--
-- Fixes C1 and C2 from docs/coin-economy-audit-2026-07-29.md, and drops the
-- redundant trigger migration 261 added for the withdrawn finding F1.
--
-- ── Why a trigger and not 22 rewrites ────────────────────────────────────
--
-- C1: increment_flex_coins (mig 176) caps 2,500/call and 25,000/day against
-- flex_coin_grant_ledger — and governs 802 of the 62,788 coins in
-- circulation, 1.3%. Thirteen other faucets write flex_coins directly.
-- C2: so 98.7% of the currency has no provenance at all.
--
-- The obvious fix is to route every faucet through one shared helper. That
-- means restating 22 SECURITY DEFINER functions totalling ~57,000 characters
-- of live SQL, by hand, where a single transcription slip silently breaks a
-- feature. Not worth it, and this session has already demonstrated that
-- failure mode.
--
-- Every faucet has to write ONE column. That column is the chokepoint, so
-- enforcement and logging go there. A trigger on user_profiles.flex_coins
-- covers 100% of changes — including faucets that don't exist yet — without
-- touching a single faucet.
--
-- ── What this does NOT do ────────────────────────────────────────────────
--
-- The ceiling here is a CIRCUIT BREAKER, not an economy dial. It stops a
-- runaway loop or an abusive client from minting unbounded coins; it does
-- nothing about the fact that a dedicated user legitimately earns ~9,100
-- coins in month one against a shop whose priciest item costs 1,000. That is
-- C3/C4 — the daily-quest total and the login-streak curve are the dials
-- that matter, and they are product decisions, not defects.
--
-- It also cannot distinguish minting from transfer. A marketplace sale or a
-- coin gift moves existing currency rather than creating it, but from the
-- column's point of view both are a positive delta. The ceiling is therefore
-- set generously (50,000 per rolling 24h, matching the XP ceiling) so that
-- no legitimate transfer is affected. A tighter, mint-only cap would need
-- the per-faucet routing this migration deliberately avoids.
--
-- On breach it CLAMPS and flags rather than raising. Raising would break the
-- user's action outright; clamping silently would hide the anomaly. Clamped
-- rows are queryable, so the breach is visible without anyone losing a
-- feature:
--
--   SELECT * FROM public.flex_coin_ledger WHERE clamped ORDER BY created_at DESC;
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

-- ── Drop 261's redundant guard ───────────────────────────────────────────
-- Finding F1 was withdrawn: migration 142's
-- user_profiles_block_privileged_updates already rejects direct client
-- writes to flex_coins / total_xp / current_level across 20 columns, using
-- the same current_user technique. Two triggers enforcing one rule on every
-- profile update is redundant work and a maintenance trap.
DROP TRIGGER IF EXISTS trg_guard_profile_economy_columns ON public.user_profiles;
DROP FUNCTION IF EXISTS public.guard_profile_economy_columns();

-- ── Provenance ledger ────────────────────────────────────────────────────
-- Append-only. One row per change to flex_coins, whatever caused it.
CREATE TABLE IF NOT EXISTS public.flex_coin_ledger (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  source        TEXT,
  clamped       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.flex_coin_ledger IS
  'Append-only provenance for every flex_coins change. Written by the zzz_flex_coin_ledger trigger, so it covers all faucets including future ones. `source` is best-effort — the RPC name extracted from current_query(), NULL when it cannot be determined.';

CREATE INDEX IF NOT EXISTS idx_flex_coin_ledger_user_time
  ON public.flex_coin_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flex_coin_ledger_clamped
  ON public.flex_coin_ledger (created_at DESC) WHERE clamped;

-- Audit data. Nobody in the client needs to read it, and it names other
-- users' balances, so neither role gets access.
REVOKE ALL ON public.flex_coin_ledger FROM PUBLIC;
REVOKE ALL ON public.flex_coin_ledger FROM anon;
REVOKE ALL ON public.flex_coin_ledger FROM authenticated;
REVOKE ALL ON SEQUENCE public.flex_coin_ledger_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.flex_coin_ledger_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.flex_coin_ledger_id_seq FROM authenticated;

ALTER TABLE public.flex_coin_ledger ENABLE ROW LEVEL SECURITY;
-- No policies: with RLS on and no policy, only the owner and service_role
-- (BYPASSRLS) can read. That is the intent.

-- ── Ledger + ceiling, at the chokepoint ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.flex_coin_ledger_and_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $flex_coin_ledger_and_cap$
DECLARE
  v_delta       INTEGER;
  v_credited    INTEGER;
  v_headroom    INTEGER;
  v_clamped     BOOLEAN := false;
  v_source      TEXT;
  v_daily_cap   CONSTANT INTEGER := 50000;
BEGIN
  IF NEW.flex_coins IS NOT DISTINCT FROM OLD.flex_coins THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.flex_coins, 0) - COALESCE(OLD.flex_coins, 0);

  -- Credits are subject to the rolling ceiling. Debits (purchases, gifts
  -- sent, bounty fees) are always allowed — refusing a spend would strand
  -- the user mid-transaction.
  IF v_delta > 0 THEN
    SELECT COALESCE(SUM(delta), 0) INTO v_credited
      FROM public.flex_coin_ledger
     WHERE user_id = NEW.id
       AND delta > 0
       AND created_at > now() - interval '24 hours';

    v_headroom := GREATEST(0, v_daily_cap - v_credited);
    IF v_delta > v_headroom THEN
      v_clamped := true;
      v_delta   := v_headroom;
      NEW.flex_coins := COALESCE(OLD.flex_coins, 0) + v_delta;
    END IF;

    IF v_delta = 0 THEN
      -- Fully clamped. Record the attempt so the breach is visible, then
      -- leave the balance untouched.
      INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source, clamped)
      VALUES (NEW.id, 0, COALESCE(OLD.flex_coins, 0), current_user, NULL, true);
      RETURN NEW;
    END IF;
  END IF;

  -- Best-effort attribution. current_query() is the top-level statement, so
  -- for a PostgREST RPC call — one statement per request — it names the
  -- function. Only an identifier is kept, never the raw query, so no
  -- argument values reach the ledger.
  --
  -- The alternation is a NON-capturing group inside one capturing group.
  -- substring(text from pattern) returns the first capture group when the
  -- pattern has one, so `(claim|purchase|...)_[a-z_]+` records just the
  -- verb — 'claim' rather than 'claim_daily_chest'. Verified both forms
  -- against real query text before settling on this one.
  --
  -- Caveat: a multi-statement batch shares one current_query(), so every
  -- row in that batch is attributed to whichever name appears first. Real
  -- traffic is one RPC per request, so this only affects manual SQL.
  v_source := substring(
    current_query()
    from '((?:claim|purchase|complete|grant|distribute|gift|sweep|perform|resolve|create|increment|sync|reset)_[a-z_]+)'
  );

  INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source, clamped)
  VALUES (NEW.id, v_delta, COALESCE(NEW.flex_coins, 0), current_user, v_source, v_clamped);

  RETURN NEW;
END;
$flex_coin_ledger_and_cap$;

-- Named to sort AFTER user_profiles_block_privileged_updates_tr so a
-- client write that migration 142 rejects never reaches the ledger.
DROP TRIGGER IF EXISTS zzz_flex_coin_ledger_tr ON public.user_profiles;
CREATE TRIGGER zzz_flex_coin_ledger_tr
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.flex_coin_ledger_and_cap();

-- ── Opening balances ─────────────────────────────────────────────────────
-- Seed one reconciliation row per holder so the ledger sums to circulation
-- from day one; without this the first report would show 62,788 coins in
-- circulation and a ledger totalling zero. Inserted straight into the
-- ledger, so no trigger fires and no balance moves.
INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source)
SELECT id, COALESCE(flex_coins, 0), COALESCE(flex_coins, 0), 'migration', 'opening_balance_264'
FROM public.user_profiles
WHERE COALESCE(flex_coins, 0) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.flex_coin_ledger
     WHERE source = 'opening_balance_264'
       AND user_id = public.user_profiles.id
  );

NOTIFY pgrst, 'reload schema';
