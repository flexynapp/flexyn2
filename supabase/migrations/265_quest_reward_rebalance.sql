-- 265_quest_reward_rebalance.sql
--
-- Fixes C3 and C4 from docs/coin-economy-audit-2026-07-29.md. The client half
-- of the change is in src/lib/questCatalog.js and src/lib/data/loginStreak.js
-- in the same commit.
--
-- Two faucets were 78% of all coin income and neither had been touched by the
-- earlier reward work:
--
--   daily quests   4,650 coins/month — 51.1%
--   login streak   2,475 coins/month — 27.2%
--   level-ups      1,175 coins/month — 12.9%  ← all migration 263 rebalanced
--   league           800 coins/month —  8.8%
--
-- So migration 263 cut the smallest faucet and left the two that mattered.
--
-- ── Quests: 15/40/100 → 8/20/50 ──────────────────────────────────────────
--
-- Halved. This trigger is the AUTHORITATIVE copy — migration 199 added it
-- specifically so a crafted client cannot insert a quest with
-- coin_reward = 999999 and claim it. QUEST_DIFFICULTY in questCatalog.js is
-- the display mirror and is updated to match; if the two ever disagree the
-- server wins and the UI lies about the reward.
--
-- Everything else in the guard is unchanged from 199 — the quest_date range
-- check, the immutability rules, the claimed_at gate. Restated in full
-- because CREATE OR REPLACE needs the whole body.
--
-- ── Login streak: milestone-only ─────────────────────────────────────────
--
-- Client-side only (loginStreak.js), no SQL needed — the coin credit goes
-- through increment_flex_coins with a client-computed amount, which is
-- bounded by that RPC's 2,500/call and 25,000/day caps plus the new
-- 50,000/24h ledger ceiling from migration 264. Worth being explicit that
-- this one number IS client-trusted within those bounds; it is a retention
-- reward rather than a competitive stat, and the caps make the blast radius
-- of a tampered value a rounding error rather than an exploit.
--
-- The fallback `min(5 + day × 5, 200)` paid every off-milestone day, so past
-- day 39 it minted 200 coins daily forever — 32,295 over six months, more
-- than every other faucet combined. It now pays milestones only, matching
-- coinsForWorkoutStreakDay which has always worked that way. Milestones
-- themselves are unchanged: day 30 still pays 500, day 100 still 1,500.
--
-- ── Combined effect ──────────────────────────────────────────────────────
--
--   window   | before | after  | reduction
--   month 1  |  9,730 |  5,400 | 1.8x
--   3 months | 33,625 | 13,055 | 2.6x
--   6 months | 69,875 | 24,575 | 2.8x
--
-- And no single faucet dominates any more: quests 43%, level-ups 22%,
-- streak 20%, league 15%. An Elite Capsule now costs ~5.5 days of income
-- instead of ~3, so buying one is a decision.
--
-- NOT a clawback. Quest rows already inserted today keep the coin_reward
-- they were stamped with — the trigger only sets it on INSERT — so today's
-- quests pay the old rate and tomorrow's pay the new one.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

CREATE OR REPLACE FUNCTION public.user_daily_quests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $user_daily_quests_guard$
DECLARE
  v_server_today DATE := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.quest_date IS NULL
       OR NEW.quest_date < v_server_today - 1
       OR NEW.quest_date > v_server_today + 1 THEN
      RAISE EXCEPTION 'quest_date out of range' USING ERRCODE = '22023';
    END IF;
    -- coin_reward is server-defined by difficulty; never trust the client.
    -- Halved from 15/40/100 in migration 265 — keep QUEST_DIFFICULTY in
    -- src/lib/questCatalog.js in lockstep.
    NEW.coin_reward := CASE NEW.difficulty
      WHEN 'easy' THEN 8 WHEN 'medium' THEN 20 WHEN 'hard' THEN 50 ELSE 0 END;
    NEW.progress := 0;
    NEW.completed_at := NULL;
    NEW.claimed_at := NULL;
    RETURN NEW;
  END IF;

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
$user_daily_quests_guard$;

NOTIFY pgrst, 'reload schema';
