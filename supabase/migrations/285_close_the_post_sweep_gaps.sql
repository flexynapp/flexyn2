-- 285_close_the_post_sweep_gaps.sql
--
-- Closes the backend findings from the #26-50 acceptance review, plus the
-- structural cause behind two of them.
--
-- ── THE PATTERN THIS MIGRATION IS REALLY ABOUT ────────────────────────────
--
-- Two separate findings turned out to be the same defect wearing different
-- clothes: 16 foreign keys with no covering index, and 8 RLS policies that
-- call auth.uid() without wrapping it in a subselect. The lists are almost
-- identical — crew_*, the July equipment picker, August's scheduled_workouts.
--
-- Both optimizations were applied once, as a sweep, and every feature added
-- afterwards missed them. Nothing failed; nothing warned. This is the third
-- instance of that shape in this project (migration 213's anon-EXECUTE sweep
-- was the first), which is why the durable half of this change is not the SQL
-- below but the two new checks added to _audit_schema_drift.sql in the same
-- commit. Fixing 24 rows is worth an hour; stopping the class is worth more.
--
-- ── WHAT'S HERE ───────────────────────────────────────────────────────────
--
--   1. 16 FK indexes.
--   2. 8 RLS policies rewritten to wrap auth.uid() in a subselect, so it is
--      evaluated once per query rather than once per row.
--   3. is_blocked() stops trusting a client-supplied viewer id.
--   4. Two redundant grants revoked.
--
-- ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
--
-- The three dm_request_blocks policies. An earlier draft of the review
-- counted 11 unwrapped policies; the real number is 8. Those three already
-- wrap their auth.email() call as
--   ( SELECT lower(COALESCE(auth.email(), '')) )
-- and were false positives of a regex looking for the literal "( SELECT auth."
-- They are already correct and are left alone. The drift-audit check added in
-- this commit uses a pattern that does not repeat that mistake.
--
-- Idempotent. Safe to re-run.


-- ══ 1. Foreign keys with no covering index ═══════════════════════════════
-- Every one of these belongs to a feature that landed after the indexing
-- sweep. Without an index on the referencing column, a DELETE on the parent
-- does a sequential scan here, and these are exactly the tables the
-- delete-account cascade walks.

CREATE INDEX IF NOT EXISTS idx_crew_bans_banned_by                  ON public.crew_bans (banned_by);
CREATE INDEX IF NOT EXISTS idx_crew_bans_user_id                    ON public.crew_bans (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_challenge_contrib_user_id       ON public.crew_challenge_contributions (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_invites_invited_by              ON public.crew_invites (invited_by);
CREATE INDEX IF NOT EXISTS idx_crew_invites_invited_user_id         ON public.crew_invites (invited_user_id);
CREATE INDEX IF NOT EXISTS idx_crew_join_requests_decided_by        ON public.crew_join_requests (decided_by);
CREATE INDEX IF NOT EXISTS idx_crew_join_requests_user_id           ON public.crew_join_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_crew_perk_purchases_bought_by        ON public.crew_perk_purchases (bought_by);
CREATE INDEX IF NOT EXISTS idx_crew_perk_purchases_perk_key         ON public.crew_perk_purchases (perk_key);
CREATE INDEX IF NOT EXISTS idx_crew_season_stats_crew_id            ON public.crew_season_stats (crew_id);
CREATE INDEX IF NOT EXISTS idx_crew_treasury_ledger_actor_user_id   ON public.crew_treasury_ledger (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_equipment_models_submitted_by        ON public.equipment_models (submitted_by);
CREATE INDEX IF NOT EXISTS idx_equipment_photos_uploaded_by         ON public.equipment_photos (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_space_equipment_added_by             ON public.space_equipment (added_by);
CREATE INDEX IF NOT EXISTS idx_space_equipment_model_id             ON public.space_equipment (model_id);
CREATE INDEX IF NOT EXISTS idx_training_spaces_gym_id               ON public.training_spaces (gym_id);


-- ══ 2. RLS initplan — wrap auth.uid() so it runs once, not per row ═══════
-- Postgres can hoist a subselect to an InitPlan; a bare function call in a
-- policy is re-evaluated for every candidate row. On a table with any real
-- volume that is the difference between one call and N.
--
-- DROP + CREATE because Postgres has no CREATE POLICY IF NOT EXISTS, and a
-- retry of a partially-applied migration otherwise fails with 42710.
-- Role targeting is preserved exactly: policies that had no role list stay
-- unrestricted, the rest stay TO authenticated.

DROP POLICY IF EXISTS "crew_challenges: admins insert" ON public.crew_challenges;
CREATE POLICY "crew_challenges: admins insert" ON public.crew_challenges
  FOR INSERT TO authenticated
  WITH CHECK ((created_by = (SELECT auth.uid())) AND is_crew_admin(crew_id));

DROP POLICY IF EXISTS "crew_invites: read" ON public.crew_invites;
CREATE POLICY "crew_invites: read" ON public.crew_invites
  FOR SELECT TO authenticated
  USING ((invited_user_id = (SELECT auth.uid())) OR is_crew_admin(crew_id));

DROP POLICY IF EXISTS "crew_join_requests: read" ON public.crew_join_requests;
CREATE POLICY "crew_join_requests: read" ON public.crew_join_requests
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR is_crew_admin(crew_id));

DROP POLICY IF EXISTS gym_rival_rival_read ON public.gym_rival_assignments;
CREATE POLICY gym_rival_rival_read ON public.gym_rival_assignments
  FOR SELECT
  USING (rival_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users read own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users read own scheduled workouts" ON public.scheduled_workouts
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users update own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users update own scheduled workouts" ON public.scheduled_workouts
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users delete own scheduled workouts" ON public.scheduled_workouts;
CREATE POLICY "Users delete own scheduled workouts" ON public.scheduled_workouts
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "trades: parties can view own offers" ON public.trade_offers;
CREATE POLICY "trades: parties can view own offers" ON public.trade_offers
  FOR SELECT TO authenticated
  USING ((from_user_id = (SELECT auth.uid())) OR (to_user_id = (SELECT auth.uid())));


-- ══ 3. is_blocked() stops trusting its caller ════════════════════════════
--
-- It took p_viewer_id from the caller and answered "has A blocked B" for any
-- A the caller named. It is SECURITY DEFINER and anon can EXECUTE it, so that
-- is a block-graph oracle: pass someone else's uuid and read their block list
-- one probe at a time. Same defect class as migration 108's client-passed
-- email, and as resolve_profile_email before migration 283.
--
-- It CANNOT be fixed by revoking anon. This function is called inside the
-- SELECT policies on hub_posts and hub_comments, and anon holds SELECT on
-- hub_posts because the public /@username profile pages depend on it — a
-- policy helper executes as the QUERYING role, so revoking turns a filtered
-- anon read into "permission denied for function" and blanks those pages.
-- Verified against production before writing this.
--
-- The fix is to keep the signature and ignore the parameter. Every real call
-- site already passes auth.uid(), so behaviour there is unchanged; the oracle
-- closes because the answer no longer depends on what the caller claims to
-- be. anon still gets a clean `false` (auth.uid() is NULL), which is what the
-- policies need.
--
-- p_viewer_id is retained ONLY so the ~2 policy call sites keep working
-- without a coordinated rewrite. It is deliberately unused.
--
-- Rewritten in plpgsql with scalar variables and single-table statements:
-- the original used `b.blocker_email` / `p.email` join aliases, which the
-- clipboard pipeline mangles into `42601 syntax error at "<"`.

CREATE OR REPLACE FUNCTION public.is_blocked(p_viewer_id uuid, p_author_email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_author text := lower(coalesce(p_author_email, ''));
  v_hit    boolean;
BEGIN
  -- Unauthenticated callers are never "blocked by" anyone; the hub policies
  -- rely on this returning false rather than raising.
  IF v_uid IS NULL OR v_author = '' THEN
    RETURN false;
  END IF;

  -- Did the viewer block the author?
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE blocker_id = v_uid
       AND lower(blocked_email) = v_author
  ) INTO v_hit;
  IF v_hit THEN RETURN true; END IF;

  -- Did the author block the viewer? Needs the viewer's own address.
  SELECT lower(email) INTO v_email
    FROM public.user_profiles
   WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE lower(blocker_email) = v_author
       AND lower(blocked_email) = v_email
  ) INTO v_hit;

  RETURN coalesce(v_hit, false);
END;
$function$;

-- Grants unchanged on purpose — anon MUST keep EXECUTE (see the note above).
GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, text) TO anon, authenticated;


-- ══ 4. Redundant grants ══════════════════════════════════════════════════
--
-- Both of these are already inert: the tables have RLS enabled with zero
-- policies, so every client role is denied regardless of the grant. Verified
-- by attacking them — an authenticated INSERT of a legendary into
-- loot_catalog returns 42501 "new row violates row-level security policy",
-- and anon SELECT on _migration_log returns 0 rows.
--
-- Revoking anyway, because "protected by one mechanism" and "protected by
-- two" look identical right up until someone adds a permissive policy to
-- make one query work and silently opens the write path with it.

REVOKE INSERT, UPDATE, DELETE ON public.loot_catalog FROM authenticated;
REVOKE SELECT ON public._migration_log               FROM anon;
REVOKE SELECT ON public.memory_reengagement_log      FROM anon;
REVOKE SELECT ON public.storage_cleanup_queue        FROM anon;
REVOKE SELECT ON public.weekly_gauntlet_notifications FROM anon;

NOTIFY pgrst, 'reload schema';
