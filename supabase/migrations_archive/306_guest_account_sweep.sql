-- 306_guest_account_sweep.sql
--
-- Sweep abandoned guest accounts on a schedule.
--
-- WHY
--
-- `signInAsGuest` (db.js) exists so beta testers can skip magic-link /
-- OAuth friction, and it works: on 2026-08-07 the table held 55 guest
-- profiles against 29 real ones — more than half the user base was
-- throwaway. Nearly all of it was test traffic (rev*, uitest_*, test,
-- testrunner, and a lot of keyboard mash), two of which appeared during
-- the ten minutes it took to audit. A one-off DELETE cleared them, and
-- the count will climb straight back without this.
--
-- IDENTIFYING A GUEST — auth.users.is_anonymous, not the email
--
-- The obvious predicate is `email LIKE '%@flexyn.guest'`, matching the
-- placeholder migration 172's handle_new_user trigger writes. Two
-- reasons this uses `auth.users.is_anonymous` instead:
--
--   1. It is the source of truth. The placeholder is a convenience the
--      trigger happens to write so the email-keyed identity model keeps
--      working; is_anonymous is what Supabase Auth actually records.
--   2. The email form embeds a dotted token inside a string literal,
--      and this project's clipboard pipeline mangles short dotted
--      tokens (see the Workflow section of CLAUDE.md). Mangled inside a
--      predicate, it would not raise 42601 — it would quietly match
--      nothing, and the sweep would report success forever while
--      deleting no rows. A silent no-op is the worst failure available
--      here, so the token is gone rather than escaped.
--
-- Verified equal on live data before switching: is_anonymous counted 29
-- real users, exactly matching the email heuristic's non-guest count.
--
-- WHAT COUNTS AS ABANDONED — the conservative half of this migration
--
-- A guest is swept only when it has done NOTHING a person would do, and
-- has not been seen for the retention window. The predicate EXCEPTs
-- against the tables a real user writes to:
--
--   workout_logs · cardio_logs · nutrition_logs · hub_posts · goals
--   journal_entries · body_metrics · sleep_logs · mood_logs · step_logs
--
-- Three tables are DELIBERATELY ABSENT from that list, and adding them
-- would switch the sweep off. `user_capsules`, `league_members` and
-- `user_daily_quests` all get rows the moment a guest loads the
-- Dashboard — the daily chest grants, the league seats them, quests
-- generate. Every guest has them, engaged or not, so they say nothing.
--
-- Also required: no username, no avatar_url, zero XP. `username IS NULL`
-- is the strongest single signal — setting one takes deliberate effort,
-- so anyone who did is treated as a real person regardless of what else
-- they did or didn't log. `avatar_url IS NULL` is there for a different
-- reason: an avatar means an uploaded blob, and deleting the row would
-- orphan it in the bucket (see the Storage section of CLAUDE.md — SQL
-- deletes cannot reclaim S3 objects). Rather than teach this sweep the
-- storage_cleanup_queue dance, it declines to touch those accounts.
--
-- BLAST RADIUS
--
-- p_limit (default 200) caps one run. If the predicate is ever wrong,
-- the damage is bounded by that number and by the daily cadence rather
-- than by how fast a mistake can run. There is no ORDER BY on the
-- candidate set — the cap is a safety valve, not a fair queue, and the
-- next run picks up whatever it left.
--
-- Deleting from auth.users is enough on its own: 110+ tables cascade off
-- it, user_profiles among them. Four FKs would BLOCK instead of cascade
-- (bounties.claimed_by_id, duels.winner_id, pending_duel_invites
-- .claimed_by_id are NO ACTION; gym_businesses.owner_id is RESTRICT). A
-- guest holding one of those has, by definition, done something real —
-- claimed a bounty, won a duel, been promoted to gym owner — so the
-- EXCEPT list should already have spared it. If one slips through, the
-- DELETE raises 23503 and the whole run rolls back rather than
-- half-deleting; that is the correct failure and the reason this is one
-- statement rather than a loop.
--
-- AUDIT
--
-- guest_sweep_log records every run, including the zero-row ones. An
-- empty log and a log full of zeroes look identical from the outside
-- otherwise — which is exactly how the push fan-out hid a total outage
-- for months (CLAUDE.md, Push notifications). RLS is on with no
-- policies, so only postgres / service_role can read it.

-- ─────────────────────────────────────────────────────────────────────
-- Audit table
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guest_sweep_log (
  id            BIGSERIAL PRIMARY KEY,
  swept_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_count INTEGER     NOT NULL,
  cutoff_days   INTEGER     NOT NULL,
  candidates    INTEGER     NOT NULL
);

ALTER TABLE public.guest_sweep_log ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- sweep_stale_guest_accounts
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_stale_guest_accounts(
  p_older_than_days INTEGER DEFAULT 7,
  p_limit           INTEGER DEFAULT 200
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cutoff     TIMESTAMPTZ;
  v_days       INTEGER;
  v_limit      INTEGER;
  v_ids        UUID[];
  v_candidates INTEGER;
  v_deleted    INTEGER;
BEGIN
  -- Clamp both inputs. A caller passing 0 days would sweep guests
  -- created seconds ago, including one mid-signup.
  v_days   := greatest(coalesce(p_older_than_days, 7), 1);
  v_limit  := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_cutoff := now() - (v_days * INTERVAL '1 day');

  -- Candidate set. Every branch is a single-table SELECT over bare
  -- columns joined with INTERSECT / EXCEPT, rather than correlated
  -- NOT EXISTS subqueries — that keeps the whole statement free of the
  -- short alias.column tokens the paste pipeline mangles into 42601.
  v_ids := ARRAY(
    (
      SELECT id FROM auth.users
       WHERE is_anonymous
         AND created_at < v_cutoff
      INTERSECT
      SELECT id FROM public.user_profiles
       WHERE username   IS NULL
         AND avatar_url IS NULL
         AND coalesce(total_xp, 0) = 0
         AND (last_active_at IS NULL OR last_active_at < v_cutoff)
    )
    EXCEPT SELECT user_id FROM public.workout_logs
    EXCEPT SELECT user_id FROM public.cardio_logs
    EXCEPT SELECT user_id FROM public.nutrition_logs
    EXCEPT SELECT user_id FROM public.hub_posts
    EXCEPT SELECT user_id FROM public.goals
    EXCEPT SELECT user_id FROM public.journal_entries
    EXCEPT SELECT user_id FROM public.body_metrics
    EXCEPT SELECT user_id FROM public.sleep_logs
    EXCEPT SELECT user_id FROM public.mood_logs
    EXCEPT SELECT user_id FROM public.step_logs
    LIMIT v_limit
  );

  v_candidates := coalesce(array_length(v_ids, 1), 0);

  IF v_candidates = 0 THEN
    INSERT INTO public.guest_sweep_log (deleted_count, cutoff_days, candidates)
    VALUES (0, v_days, 0);
    RETURN 0;
  END IF;

  DELETE FROM auth.users WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.guest_sweep_log (deleted_count, cutoff_days, candidates)
  VALUES (v_deleted, v_days, v_candidates);

  RETURN v_deleted;
END;
$$;

-- Every public-schema function is a PostgREST endpoint, and Postgres
-- grants EXECUTE to PUBLIC by default — so REVOKE FROM authenticated
-- alone is a no-op (mig 203). Without the PUBLIC revoke, anon could POST
-- to /rest/v1/rpc/sweep_stale_guest_accounts and run a SECURITY DEFINER
-- delete on demand.
REVOKE ALL ON FUNCTION public.sweep_stale_guest_accounts(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_stale_guest_accounts(INTEGER, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.sweep_stale_guest_accounts(INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_guest_accounts(INTEGER, INTEGER) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- Daily cron. pg_cron runs the job as its owner, so the REVOKEs above
-- do not affect it.
-- ─────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'guest_account_sweep';
  IF v_id IS NOT NULL THEN PERFORM cron.unschedule(v_id); END IF;
  PERFORM cron.schedule(
    'guest_account_sweep',
    '0 4 * * *',
    $cron$ SELECT public.sweep_stale_guest_accounts(7, 200); $cron$
  );
END $$;
