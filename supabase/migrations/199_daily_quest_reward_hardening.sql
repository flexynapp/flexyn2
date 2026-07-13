-- 199_daily_quest_reward_hardening.sql
--
-- CRITICAL: user_daily_quests was fully client-managed. The client inserts
-- quest rows directly (quests.js ensureTodaysQuests) with client-set
-- coin_reward, quest_date, target, progress, completed_at — and
-- claim_quest_atomic credits the row's coin_reward. So a crafted client
-- could:
--   • insert a quest with coin_reward = 999999, completed_at = now(), then
--     claim it → mint arbitrary flex_coins;
--   • roll the DEVICE CLOCK forward so quest_date becomes a future day,
--     minting a fresh claimable quest set per fake day (coin farm);
--   • reset claimed_at (or delete + re-insert) to re-claim the same quest.
--
-- Fix is server-side and TRANSPARENT to the honest client — the guard
-- forces exactly the values the legit flow already sends (coin_reward by
-- difficulty, quest_date = the real day, fresh progress/claim state), so
-- no client change is needed. It only blocks the tampered variants.

-- ── Guard trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_daily_quests_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_server_today DATE := (now() AT TIME ZONE 'utc')::date;
BEGIN
  -- SECURITY DEFINER RPCs (claim_quest_atomic, any server job) run as the
  -- owner and bypass the guard.
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    -- quest_date must be the real day (±1 for timezone spread) — blocks
    -- clock-rolling to mint future quest sets.
    IF NEW.quest_date IS NULL
       OR NEW.quest_date < v_server_today - 1
       OR NEW.quest_date > v_server_today + 1 THEN
      RAISE EXCEPTION 'quest_date out of range' USING ERRCODE = '22023';
    END IF;
    -- coin_reward is server-defined by difficulty; never trust the client.
    NEW.coin_reward := CASE NEW.difficulty
      WHEN 'easy'   THEN 15
      WHEN 'medium' THEN 40
      WHEN 'hard'   THEN 100
      ELSE 0
    END;
    -- fresh quests start unearned + unclaimed
    NEW.progress     := 0;
    NEW.completed_at := NULL;
    NEW.claimed_at   := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: reward + identity are immutable; claimed_at is RPC-only (so a
  -- claimed quest can't be un-claimed and claimed again). progress /
  -- completed_at stay client-writable for the normal recordAction flow.
  IF NEW.coin_reward IS DISTINCT FROM OLD.coin_reward
     OR NEW.quest_date IS DISTINCT FROM OLD.quest_date
     OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
     OR NEW.quest_id   IS DISTINCT FROM OLD.quest_id THEN
    RAISE EXCEPTION 'quest reward/identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
    RAISE EXCEPTION 'claimed_at is RPC-only (use claim_quest_atomic)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_daily_quests_guard_tr ON public.user_daily_quests;
CREATE TRIGGER user_daily_quests_guard_tr
  BEFORE INSERT OR UPDATE ON public.user_daily_quests
  FOR EACH ROW EXECUTE FUNCTION public.user_daily_quests_guard();

-- ── Bound to exactly 3 quests/day (one per difficulty) ─────────────────
-- The existing UNIQUE (user_id, quest_date, quest_id) stops the same quest
-- twice, but not a bulk insert of many distinct quest_ids. One-per-
-- difficulty caps the day at easy+medium+hard. (Verified 0 existing
-- violations before adding.)
CREATE UNIQUE INDEX IF NOT EXISTS user_daily_quests_one_per_difficulty
  ON public.user_daily_quests (user_id, quest_date, difficulty);

-- ── No client deletes → block delete + re-insert re-claim ──────────────
REVOKE DELETE ON public.user_daily_quests FROM authenticated;
