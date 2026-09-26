-- supabase/migrations/188_xp_daily_rate_limit_and_audit_ledger.sql
--
-- Closes the last remaining XP-farming vector and adds an audit trail.
--
-- Existing defenses (do NOT remove):
--   • mig 042 — increment_user_xp credits auth.uid() only (ignores the
--     client-supplied p_user_id) and caps a SINGLE grant at 100k.
--   • mig 142 — user_profiles privileged columns (total_xp / current_level /
--     flex_coins / …) are immutable to direct PostgREST writes, so the RPC
--     is the ONLY path that can change XP.
--
-- Remaining hole: a script can still CALL increment_user_xp in a loop —
-- each call ≤100k, but unbounded over time — to farm XP and break the
-- leaderboard. This migration adds a rolling 24-hour per-user cap enforced
-- server-side inside the RPC, plus an append-only ledger that both drives
-- the cap and serves as a tamper-proof transaction log.
--
-- Cap sizing — chosen so it NEVER affects a real user. The largest possible
-- legitimate day (several workouts + daily quests + league + crew fuel +
-- achievement bonuses) tops out in the low thousands of XP; 50,000 per
-- rolling 24h is ~10x that headroom. It throttles a farmer to, at most, a
-- very-dedicated-legit-user's pace — removing the leaderboard-breaking
-- exploit with effectively zero false-positive risk. When the cap is hit we
-- GRACEFULLY withhold (grant 0, no error) so any edge case degrades silently
-- instead of throwing. Tune v_daily_cap below if real usage ever warrants it.
--
-- Idempotent; safe to re-run.

-- ── 1. Append-only XP grant ledger (audit trail + rate-limit source) ────────
CREATE TABLE IF NOT EXISTS public.xp_grant_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid        NOT NULL,
  amount     integer     NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xp_grant_log_user_time
  ON public.xp_grant_log (user_id, granted_at);

-- Lock the ledger down: RLS on, no policies, and revoke the PostgREST roles
-- entirely. Only SECURITY DEFINER functions (running as the function owner)
-- write to it; clients can neither read their grant history nor tamper with it.
ALTER TABLE public.xp_grant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xp_grant_log FROM anon, authenticated;

-- ── 2. increment_user_xp — add the rolling 24h daily cap + ledger write ─────
-- Body is mig 042's verbatim, with the cap/ledger block inserted before the
-- atomic increment, and the clamped amount (v_grant) used everywhere p_xp
-- was used. Recipient auth.uid() enforcement and per-call 100k cap unchanged.
CREATE OR REPLACE FUNCTION public.increment_user_xp(p_user_id uuid, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID    := auth.uid();
  v_total_xp   INTEGER;
  v_level      INTEGER := 1;
  v_cumulative INTEGER := 0;
  v_xp_needed  INTEGER;
  v_mult       NUMERIC;
  v_today      INTEGER;
  v_grant      INTEGER;
  v_daily_cap  CONSTANT INTEGER := 50000;  -- per rolling 24h, per user
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  -- p_user_id is intentionally ignored (legacy noise) — always credit caller.

  IF p_xp IS NULL OR p_xp <= 0 THEN
    RETURN;
  END IF;
  -- Per-call sanity cap (mig 042): blocks the "increment by 9999999" exploit.
  IF p_xp > 100000 THEN
    RAISE EXCEPTION 'xp out of range' USING ERRCODE = '22023';
  END IF;

  -- Rolling 24h per-user cap. Sum what the caller already earned in the last
  -- 24 hours and clamp this grant to whatever headroom remains. Throttles
  -- loop-farming without ever touching a legitimate day's total.
  SELECT COALESCE(SUM(amount), 0) INTO v_today
    FROM public.xp_grant_log
    WHERE user_id = v_uid
      AND granted_at > now() - interval '24 hours';

  v_grant := LEAST(p_xp, GREATEST(0, v_daily_cap - v_today));
  IF v_grant <= 0 THEN
    RETURN;  -- daily cap reached — withhold gracefully, no error
  END IF;

  -- Record the grant in the tamper-proof audit ledger (also drives the cap).
  INSERT INTO public.xp_grant_log (user_id, amount)
    VALUES (v_uid, v_grant);

  -- Atomic XP increment — ALWAYS the caller, ALWAYS the clamped amount.
  UPDATE public.user_profiles
    SET total_xp   = COALESCE(total_xp, 0) + v_grant,
        updated_at = now()
    WHERE id = v_uid
    RETURNING total_xp INTO v_total_xp;

  IF NOT FOUND THEN RETURN; END IF;

  -- Recompute current_level (matches xpSystem.js client logic).
  FOR i IN 1..99 LOOP
    IF i <= 10 THEN v_mult := 1.10;
    ELSIF i <= 30 THEN v_mult := 1.13;
    ELSIF i <= 60 THEN v_mult := 1.16;
    ELSE                v_mult := 1.20;
    END IF;
    v_xp_needed := FLOOR(250 * POWER(v_mult, i - 1));
    IF v_cumulative + v_xp_needed > v_total_xp THEN
      v_level := i;
      EXIT;
    END IF;
    v_cumulative := v_cumulative + v_xp_needed;
    v_level := i + 1;
  END LOOP;

  UPDATE public.user_profiles
    SET current_level = v_level
    WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_user_xp(uuid, integer) TO authenticated;

-- ── 3. (Optional follow-up, not scheduled here) prune old ledger rows ───────
-- The 24h-window query stays fast via idx_xp_grant_log_user_time regardless
-- of table size, but the ledger grows ~one row per XP action. A daily cron
-- can keep it small without affecting the cap (which only reads the last 24h):
--   DELETE FROM public.xp_grant_log WHERE granted_at < now() - interval '32 days';
