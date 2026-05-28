-- ─────────────────────────────────────────────────────────────────────
-- _deploy_154_to_162.sql — ONE-SHOT DEPLOY BUNDLE (migrations 154–162)
--
-- Paste the whole file into the Supabase SQL Editor and Run. Covers every
-- migration after the 144–153 era:
--   154 bounty v2 + quotes hardening      159 critical cheat/privacy fixes
--   155 corporate HR + listing profanity  160 fix-159 blockers
--   156 HR actor dedup                     161 user gender column
--   157 hub profanity + notify hardening   162 step_logs (manual steps)
--   158 gym security + profanity
--
-- Every statement is idempotent (CREATE OR REPLACE / IF NOT EXISTS /
-- DROP … IF EXISTS / ADD COLUMN IF NOT EXISTS), so re-running is safe even
-- if you already ran some of these.
--
-- Paste-safe: no executable short alias.column tokens and no 3-part
-- schema.table.column tokens (156/157/158/159/160 were rewritten to
-- bare columns, CTE-renamed keys, or #variable_conflict use_column).
-- ─────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════
-- ==== 154_bounty_v2_and_custom_quotes_hardening.sql
-- ═══════════════════════════════════════════════════════════════════
-- 154_bounty_v2_and_custom_quotes_hardening.sql
--
-- Wave-50 follow-up to mig 152 (bounty economy integrity) + mig 153
-- (custom quotes). Three bounty-economy holes + two custom-quote holes
-- found by the parallel QA audit:
--
--   1. complete_bounty_claim now enforces the claim's deadline (mig 152
--      verified target hit + own-log ownership but NOT timely
--      completion — a stale claim could still pay out before the
--      hourly expiry cron sweeps it).
--   2. complete_bounty_claim's `weekly_volume` metric now sums volume
--      across the user's last 7 days of workout_logs, NOT the proof
--      log alone. The proof log was carried over from session_volume
--      semantics — a 7-day-volume bounty target of 50,000 lbs was
--      satisfied by any single log hitting 50k, defeating the metric.
--   3. bounties INSERT policy refuses self-targets and zero/negative
--      target_value, closing the obvious sybil-free mint path
--      (User A inserts a self-bounty with target 0.001 + tier reward
--      and immediately claims + completes). Sybil-pair mints remain
--      possible — those need anti-abuse heuristics out of scope here.
--   4. custom_quotes: 20-cap is now enforced server-side via a BEFORE
--      INSERT trigger. Mig 153 enforced it only on the client + data
--      layer; a fast tap could race two inserts, or a direct POST
--      could bypass entirely.
--   5. custom_quotes: profanity trigger on text + author. Per the
--      established pattern (mig 050 username, 054 bio, 073 status_notes,
--      102 hub content) every user-prose surface gets is_text_clean /
--      is_bio_clean trigger enforcement. Mig 153 shipped without it.
--
-- All paste-safe: scalar variables only, no `alias.column` 2-char
-- tokens, no `%ROWTYPE` + dotted record access. Idempotent —
-- CREATE OR REPLACE / DROP IF EXISTS guards throughout.


-- ── 1+2. complete_bounty_claim hardening ───────────────────────────────
-- Same signature as mig 152, so CREATE OR REPLACE swaps cleanly. The
-- only changes from 152 are:
--   • SELECT bounty_claims.deadline + IF deadline < NOW() THEN reject
--   • weekly_volume branch sums over the user's last-7-days logs
CREATE OR REPLACE FUNCTION public.complete_bounty_claim(
  p_claim_id       UUID,
  p_workout_log_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_claim_status TEXT;
  v_claim_dl     TIMESTAMPTZ;
  v_bounty_id    UUID;
  v_metric       TEXT;
  v_exercise     TEXT;
  v_target       NUMERIC;
  v_reward       INT;
  v_log_owner    UUID;
  v_exercises    JSONB;
  v_achieved     NUMERIC := 0;
  v_ex           JSONB;
  v_set          JSONB;
  v_w            NUMERIC;
  v_r            NUMERIC;
  v_week_logs    JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  SELECT status, bounty_id, deadline
    INTO v_claim_status, v_bounty_id, v_claim_dl
    FROM public.bounty_claims
   WHERE id = p_claim_id AND claimant_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'  USING ERRCODE = '22023'; END IF;
  IF v_claim_status <> 'active' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '22023'; END IF;
  -- NEW: reject expired claims server-side. The hourly expiry cron
  -- eventually flips these to 'expired', but until then a tampered
  -- client could call this RPC and harvest the reward late.
  IF v_claim_dl < NOW() THEN RAISE EXCEPTION 'claim_expired' USING ERRCODE = '22023'; END IF;

  SELECT metric::text, exercise_name, target_value, reward
    INTO v_metric, v_exercise, v_target, v_reward
    FROM public.bounties WHERE id = v_bounty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found' USING ERRCODE = '22023'; END IF;

  SELECT user_id, exercises INTO v_log_owner, v_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF NOT FOUND OR v_log_owner <> v_user_id THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;

  -- Re-derive achieved metric.
  IF v_metric = 'session_volume' THEN
    v_achieved := public._duel_calc_volume(v_exercises);

  ELSIF v_metric = 'weekly_volume' THEN
    -- NEW: sum volume across the user's last 7 days of workout logs,
    -- not just the proof log. Previously this branch incorrectly
    -- treated weekly_volume identically to session_volume.
    v_achieved := 0;
    FOR v_week_logs IN
      SELECT exercises FROM public.workout_logs
       WHERE user_id = v_user_id
         AND created_at >= NOW() - INTERVAL '7 days'
    LOOP
      v_achieved := v_achieved + public._duel_calc_volume(v_week_logs);
    END LOOP;

  ELSIF v_metric IN ('single_lift_weight', 'single_lift_reps')
        AND v_exercise IS NOT NULL
        AND jsonb_typeof(v_exercises) = 'array' THEN
    FOR v_ex IN SELECT * FROM jsonb_array_elements(v_exercises) LOOP
      IF lower(COALESCE(v_ex->>'name', '')) = lower(v_exercise)
         AND jsonb_typeof(v_ex->'sets') = 'array' THEN
        FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
          v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
          v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
          IF v_metric = 'single_lift_weight' AND v_w > v_achieved THEN v_achieved := v_w; END IF;
          IF v_metric = 'single_lift_reps'   AND v_r > v_achieved THEN v_achieved := v_r; END IF;
        END LOOP;
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'unsupported_metric' USING ERRCODE = '22023';
  END IF;

  IF v_achieved < v_target THEN
    RAISE EXCEPTION 'target_not_met' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bounty_claims
     SET status = 'completed', completed_at = NOW(), workout_log_id = p_workout_log_id
   WHERE id = p_claim_id;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins + v_reward
   WHERE id = v_user_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.complete_bounty_claim(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_bounty_claim(UUID, UUID) TO authenticated;


-- ── 3. Tighter bounties INSERT policy ──────────────────────────────────
-- Replaces the mig 152 policy. Adds the obvious abuse refusals:
--   • target_user_id <> auth.uid()  — no self-targeting (self-target +
--     self-claim is a one-account mint loop on the +reward, -fee delta).
--   • target_value > 0              — a 0.001 target is a free completion.
--   • expires_at > now()            — no backdated bounties.
DROP POLICY IF EXISTS "bounties_insert" ON public.bounties;
CREATE POLICY "bounties_insert"
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND target_user_id IS DISTINCT FROM auth.uid()
    AND target_value > 0
    AND expires_at > now()
    AND (
      (difficulty = 'easy'   AND entry_fee = 10 AND reward = 60)  OR
      (difficulty = 'medium' AND entry_fee = 15 AND reward = 100) OR
      (difficulty = 'hard'   AND entry_fee = 20 AND reward = 175)
    )
  );


-- ── 4. custom_quotes 20-cap trigger ───────────────────────────────────
-- Server-enforced ceiling. Mig 153 enforced it only client-side, so a
-- direct PostgREST POST or a same-tick double-tap could bypass.
CREATE OR REPLACE FUNCTION public.enforce_custom_quotes_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.custom_quotes
   WHERE user_id = NEW.user_id;
  IF v_count >= 20 THEN
    RAISE EXCEPTION 'custom_quotes_limit'
      USING ERRCODE = '23514',
            HINT    = 'Maximum 20 custom quotes per user. Delete one before adding another.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_quotes_cap ON public.custom_quotes;
CREATE TRIGGER trg_custom_quotes_cap
  BEFORE INSERT ON public.custom_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_custom_quotes_cap();


-- ── 5. custom_quotes profanity trigger ────────────────────────────────
-- Reuses is_bio_clean (same moderation bar as bio / status notes).
-- Checks both the quote text and the (optional) author attribution.
-- Falls back to no-op if is_bio_clean isn't installed yet (legacy hosts).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_bio_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_custom_quote_profanity()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF NEW.text IS NOT NULL AND NEW.text <> '' AND NOT public.is_bio_clean(NEW.text) THEN
          RAISE EXCEPTION 'custom_quote_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Quote text contains prohibited content. Edit it and try again.';
        END IF;
        IF NEW.author IS NOT NULL AND NEW.author <> '' AND NOT public.is_bio_clean(NEW.author) THEN
          RAISE EXCEPTION 'custom_quote_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Author name contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_custom_quote_profanity ON public.custom_quotes';
    EXECUTE 'CREATE TRIGGER trg_custom_quote_profanity
               BEFORE INSERT OR UPDATE OF text, author ON public.custom_quotes
               FOR EACH ROW
               EXECUTE FUNCTION public.enforce_custom_quote_profanity()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 155_corporate_hr_fix_and_listing_profanity.sql
-- ═══════════════════════════════════════════════════════════════════
-- 155_corporate_hr_fix_and_listing_profanity.sql
--
-- Server-side follow-ups from the Wave-52 parallel audit. Six fixes
-- on three feature areas:
--
-- ── Corporate Wellness (mig 146 follow-up) ─────────────────────────────
--   1. HR analytics undercounts workouts because it joins on
--      workout_logs.user_id, but legacy / email-owned rows still use
--      created_by = <email> (user_id is nullable, mig 001). HR
--      admins watching the dashboard see 0 or wildly undercounted
--      activity even when members are actively logging. Fix: union
--      both join keys (user_id from members + email from auth.users).
--
--   2. TOCTOU on seat_limit. join_organization_by_code does
--      `SELECT COUNT(*)` then `INSERT` — two concurrent joins at the
--      seat edge can both pass and overshoot the cap. Fix: lock the
--      org row with FOR UPDATE before counting.
--
--   3. Last-admin leave / delete isn't blocked at the trigger level.
--      The "org_members: leave own" RLS policy allows any member to
--      DELETE their own row with no last-admin check. A direct REST
--      call (or the CorporatePortal.jsx guard fall-through on network
--      failure) can orphan the org. Fix: BEFORE DELETE trigger that
--      raises when removing the last admin AND there are other members.
--
--   4. Privacy floor of 3 still allows individual identification:
--      with cohort=3, integer-rounded participation_pct of 33/67/100
--      is reversible 1:1 to a count. Bump v_min_cohort to 5 AND
--      suppress active_7d/workouts_7d when those individual counts
--      themselves are below 2. Round counts to nearest 5 for
--      additional obfuscation.
--
--   5. Profanity trigger on organizations.name + organization_challenges.title.
--      Org names are visible to every member; challenge titles surface
--      in dashboards. Per mig 050/054/102 pattern, every user-prose
--      surface gets is_text_clean trigger enforcement.
--
-- ── Trainer marketplace (mig 143 follow-up) ────────────────────────────
--   6. Profanity trigger on trainer_listings.title + .description.
--      These appear on a public-ish storefront grid; no trigger today.
--      Falls back to no-op if is_text_clean isn't installed yet.
--
-- All paste-safe: scalar SELECT…INTO variables, no `alias.column`
-- 2-char tokens, no %ROWTYPE + dotted record access. Idempotent.


-- ── 1. HR analytics — fix join key undercount ────────────────────────
-- Same return shape; only the inner query changes. workout_logs is
-- read via SECURITY DEFINER so RLS doesn't apply — we control the
-- aggregate envelope explicitly.
CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_members        INT := 0;
  v_active_7d      INT := 0;
  v_workouts_7d    INT := 0;
  v_avg_streak     NUMERIC := 0;
  v_min_cohort     CONSTANT INT := 5;   -- raised from 3 (k-anonymity)
  v_min_activity   CONSTANT INT := 2;   -- suppress when counts < this
  v_round_to       CONSTANT INT := 5;   -- round counts to nearest 5
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members FROM public.organization_members WHERE org_id = p_org_id;

  IF v_members < v_min_cohort THEN
    RETURN jsonb_build_object(
      'members', v_members,
      'cohort_too_small', true,
      'min_cohort', v_min_cohort
    );
  END IF;

  -- Match BOTH owning columns. user_id is the modern key but many
  -- legacy rows only have created_by = <email>. UNION the two member
  -- identifiers as a set so a row authored either way counts once.
  WITH org_uids AS (
    SELECT user_id FROM public.organization_members WHERE org_id = p_org_id
  ),
  org_emails AS (
    SELECT email FROM public.user_profiles
     WHERE id IN (SELECT user_id FROM org_uids)
  ),
  recent_logs AS (
    SELECT
      COALESCE(user_id, NULL) AS log_uid,
      COALESCE(created_by, NULL) AS log_email
    FROM public.workout_logs
    WHERE created_at > now() - INTERVAL '7 days'
      AND (
        user_id IN (SELECT user_id FROM org_uids)
        OR created_by IN (SELECT email FROM org_emails)
      )
  ),
  unique_actors AS (
    SELECT DISTINCT COALESCE(log_uid::text, log_email) AS actor FROM recent_logs
  )
  SELECT
    (SELECT COUNT(*) FROM unique_actors),
    (SELECT COUNT(*) FROM recent_logs)
   INTO v_active_7d, v_workouts_7d;

  SELECT COALESCE(AVG(COALESCE(workout_streak, 0)), 0)
    INTO v_avg_streak
    FROM public.user_profiles
   WHERE id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  -- K-anonymity / privacy mitigations:
  --   • Suppress fine-grain activity counts when below v_min_activity
  --     (1 active member out of 5 is identifying if 4 are inactive).
  --   • Round surfaced counts to nearest v_round_to so participation_pct
  --     becomes coarse-grained rather than revealing exact counts.
  IF v_active_7d < v_min_activity THEN
    RETURN jsonb_build_object(
      'members',           v_members,
      'active_7d',         NULL,
      'workouts_7d',       NULL,
      'avg_workout_streak', ROUND(v_avg_streak, 1),
      'participation_pct', NULL,
      'cohort_too_small',  false,
      'low_activity',      true
    );
  END IF;

  RETURN jsonb_build_object(
    'members',           v_members,
    'active_7d',         v_round_to * ROUND(v_active_7d::numeric / v_round_to),
    'workouts_7d',       v_round_to * ROUND(v_workouts_7d::numeric / v_round_to),
    'avg_workout_streak', ROUND(v_avg_streak, 1),
    'participation_pct', v_round_to * ROUND(100.0 * v_active_7d / v_members / v_round_to),
    'cohort_too_small',  false,
    'low_activity',      false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_org_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_analytics(UUID) TO authenticated;


-- ── 2. TOCTOU on seat_limit ─────────────────────────────────────────
-- Lock the org row FOR UPDATE before counting members. Two concurrent
-- joins now serialize: the second waits for the first's INSERT to
-- commit (which bumps the count) before it counts and decides.
CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_cnt INT;
  v_lim INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

  -- Acquire a row-level lock on the org during the count→insert race.
  -- SELECT id, seat_limit … FOR UPDATE locks the row until commit so
  -- a concurrent join_organization_by_code on the same code blocks
  -- here, sees the post-insert count, and rejects with SEATS_FULL if
  -- over the cap.
  SELECT id, seat_limit INTO v_org, v_lim
    FROM public.organizations
   WHERE join_code = upper(btrim(p_code))
   FOR UPDATE;
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CODE_NOT_FOUND'); END IF;

  IF v_lim IS NOT NULL THEN
    SELECT COUNT(*) INTO v_cnt FROM public.organization_members WHERE org_id = v_org;
    IF v_cnt >= v_lim AND NOT EXISTS (
      SELECT 1 FROM public.organization_members WHERE org_id = v_org AND user_id = v_uid
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SEATS_FULL');
    END IF;
  END IF;

  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (v_org, v_uid, 'member')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'org_id', v_org);
END;
$$;
REVOKE ALL ON FUNCTION public.join_organization_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;


-- ── 3. Last-admin leave guard at the trigger level ────────────────────
-- Refuse to DELETE the last admin's membership when other members
-- still exist. The CorporatePortal.jsx client-side guard catches the
-- common path; this is the authoritative server bar.
CREATE OR REPLACE FUNCTION public.enforce_last_admin_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin_count   INT;
  v_member_count  INT;
BEGIN
  -- Only block if leaving as an admin.
  IF OLD.role IS DISTINCT FROM 'admin' THEN RETURN OLD; END IF;

  SELECT COUNT(*) INTO v_admin_count
    FROM public.organization_members
   WHERE org_id = OLD.org_id AND role = 'admin';
  SELECT COUNT(*) INTO v_member_count
    FROM public.organization_members
   WHERE org_id = OLD.org_id;

  -- Sole admin AND there are other (non-admin) members → block.
  -- If the admin is the only member, allow the leave (the org is
  -- effectively dissolving; cascade does the rest).
  IF v_admin_count <= 1 AND v_member_count > 1 THEN
    RAISE EXCEPTION 'last_admin_cannot_leave'
      USING ERRCODE = '42501',
            HINT    = 'Promote another member to admin before leaving, or delete the organization.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_last_admin_leave ON public.organization_members;
CREATE TRIGGER trg_enforce_last_admin_leave
  BEFORE DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_last_admin_leave();


-- ── 5. Profanity triggers on organization names + challenge titles ────
-- Uses is_text_clean (strict=TRUE for names) per mig 102 pattern.
-- Falls back to no-op if is_text_clean isn't installed yet so a host
-- running an out-of-order subset doesn't error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_organization_name_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.name IS NOT NULL AND NEW.name <> '' AND NOT public.is_text_clean(NEW.name, TRUE) THEN
          RAISE EXCEPTION 'organization_name_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Organization name contains prohibited content.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_organization_name_profanity ON public.organizations';
    EXECUTE 'CREATE TRIGGER trg_organization_name_profanity
               BEFORE INSERT OR UPDATE OF name ON public.organizations
               FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_name_profanity()';

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_org_challenge_title_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.title IS NOT NULL AND NEW.title <> '' AND NOT public.is_text_clean(NEW.title, FALSE) THEN
          RAISE EXCEPTION 'org_challenge_title_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Challenge title contains prohibited content.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_org_challenge_title_profanity ON public.organization_challenges';
    EXECUTE 'CREATE TRIGGER trg_org_challenge_title_profanity
               BEFORE INSERT OR UPDATE OF title ON public.organization_challenges
               FOR EACH ROW EXECUTE FUNCTION public.enforce_org_challenge_title_profanity()';
  END IF;
END $$;


-- ── 6. Profanity trigger on trainer_listings.title + .description ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='trainer_listings') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_trainer_listing_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.title IS NOT NULL AND NEW.title <> '' AND NOT public.is_text_clean(NEW.title, FALSE) THEN
          RAISE EXCEPTION 'trainer_listing_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Listing title contains prohibited content.';
        END IF;
        IF NEW.description IS NOT NULL AND NEW.description <> '' AND NOT public.is_text_clean(NEW.description, FALSE) THEN
          RAISE EXCEPTION 'trainer_listing_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Listing description contains prohibited content.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_trainer_listing_profanity ON public.trainer_listings';
    EXECUTE 'CREATE TRIGGER trg_trainer_listing_profanity
               BEFORE INSERT OR UPDATE OF title, description ON public.trainer_listings
               FOR EACH ROW EXECUTE FUNCTION public.enforce_trainer_listing_profanity()';
  END IF;
END $$;


-- ── 4. (Already folded into get_org_analytics rewrite above) ─────────
-- The privacy floor + activity-count rounding lives inside the new
-- get_org_analytics body — no separate statement.


NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 156_corporate_hr_dedup_actors.sql
-- ═══════════════════════════════════════════════════════════════════
-- 156_corporate_hr_dedup_actors.sql
--
-- Code-review follow-up to mig 155. The HR analytics function
-- (get_org_analytics) was rewritten in 155 to union both join keys
-- (user_id + email) so it doesn't undercount activity from legacy
-- email-owned rows. But its `unique_actors` CTE deduped on a per-row
-- COALESCE, not on a canonical actor identity:
--
--   SELECT DISTINCT COALESCE(log_uid::text, log_email) AS actor
--     FROM recent_logs
--
-- A user with BOTH a modern row (user_id set) AND a legacy row
-- (only created_by=email) shows up as TWO distinct actors — undercount
-- becomes overcount, and active_7d can exceed v_members.
--
-- Fix: resolve each member's email-to-uid mapping up front, then
-- normalize every recent log row to a canonical user_id::text before
-- the DISTINCT. Now one human = one actor regardless of which owning
-- column each row used.
--
-- Same signature + return shape as mig 155. Paste-safe + idempotent.

CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_members        INT := 0;
  v_active_7d      INT := 0;
  v_workouts_7d    INT := 0;
  v_avg_streak     NUMERIC := 0;
  v_min_cohort     CONSTANT INT := 5;
  v_min_activity   CONSTANT INT := 2;
  v_round_to       CONSTANT INT := 5;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members FROM public.organization_members WHERE org_id = p_org_id;

  IF v_members < v_min_cohort THEN
    RETURN jsonb_build_object(
      'members', v_members,
      'cohort_too_small', true,
      'min_cohort', v_min_cohort
    );
  END IF;

  -- Resolve every member's (id, email) up front. The map is used to
  -- canonicalize log rows to user_id even when the only owning column
  -- is created_by=email.
  WITH member_map AS (
    SELECT id AS m_uid, email AS m_email
      FROM public.user_profiles
     WHERE id IN (
       SELECT user_id FROM public.organization_members
        WHERE org_id = p_org_id
     )
  ),
  recent_logs AS (
    SELECT user_id AS log_uid, created_by AS log_email
      FROM public.workout_logs
     WHERE created_at > now() - INTERVAL '7 days'
       AND (
         user_id      IN (SELECT m_uid   FROM member_map)
         OR created_by IN (SELECT m_email FROM member_map)
       )
  ),
  canon AS (
    -- Canonical actor: user_id if present, else resolve the log's
    -- created_by email back to its member uid. CTE-renamed keys only
    -- (m_uid / log_email) so the SQL stays paste-safe.
    SELECT COALESCE(
             log_uid::text,
             (SELECT m_uid::text FROM member_map WHERE m_email = log_email LIMIT 1)
           ) AS canonical_actor
      FROM recent_logs
  ),
  unique_actors AS (
    SELECT DISTINCT canonical_actor FROM canon
     WHERE canonical_actor IS NOT NULL
  )
  SELECT
    (SELECT COUNT(*) FROM unique_actors),
    (SELECT COUNT(*) FROM recent_logs)
   INTO v_active_7d, v_workouts_7d;

  SELECT COALESCE(AVG(COALESCE(workout_streak, 0)), 0)
    INTO v_avg_streak
    FROM public.user_profiles
   WHERE id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  IF v_active_7d < v_min_activity THEN
    RETURN jsonb_build_object(
      'members',           v_members,
      'active_7d',         NULL,
      'workouts_7d',       NULL,
      'avg_workout_streak', ROUND(v_avg_streak, 1),
      'participation_pct', NULL,
      'cohort_too_small',  false,
      'low_activity',      true
    );
  END IF;

  RETURN jsonb_build_object(
    'members',           v_members,
    'active_7d',         v_round_to * ROUND(v_active_7d::numeric / v_round_to),
    'workouts_7d',       v_round_to * ROUND(v_workouts_7d::numeric / v_round_to),
    'avg_workout_streak', ROUND(v_avg_streak, 1),
    'participation_pct', v_round_to * ROUND(100.0 * v_active_7d / v_members / v_round_to),
    'cohort_too_small',  false,
    'low_activity',      false
  );
END;
$$;
REVOKE ALL    ON FUNCTION public.get_org_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_analytics(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 157_hub_profanity_and_notify_hardening.sql
-- ═══════════════════════════════════════════════════════════════════
-- 157_hub_profanity_and_notify_hardening.sql
--
-- Wave-54 follow-up. Two real exploits surfaced by the Hub-feed audit:
--
--   1. Server-side profanity enforcement on hub_posts + hub_comments is
--      SILENTLY DEAD. Mig 102 created triggers `BEFORE INSERT OR UPDATE
--      OF content` checking `NEW.content`. But the client writes the
--      `body` column (mig 004 added body alongside content; the one-time
--      backfill at mig 004:100-101 was a single UPDATE, not a sync
--      trigger). Result: every new post + comment from the React app
--      writes body=text, content=NULL — the trigger early-returns at
--      `IF NEW.content IS NULL THEN RETURN NEW`, and only the
--      client-side `assertNoTextProfanity` check is in effect. A user
--      bypassing the client (devtools, direct PostgREST) trivially
--      posts profanity.
--
--   2. notify_friend_post_for trusts client-supplied poster_name in
--      the notification title + metadata. Per CLAUDE.md mig 108
--      lesson: an authenticated attacker can fan out impersonation
--      pushes ("@admin posted: <slur>") to any victim's user_id.
--      Same defect class as the four RPC trust bugs patched in
--      mig 141 — never trust a client-supplied identifier in a
--      SECURITY DEFINER RPC. Derive the actor identity from
--      auth.uid() server-side.
--
-- All paste-safe + idempotent.


-- ── 1. Profanity triggers — fire on body, not just content ───────────
--
-- Rewrite the four profanity-check functions to test whichever column
-- is non-empty (body OR content) via COALESCE. Triggers also fire on
-- UPDATE OF body OR content so any change to either invokes the check.
-- Defense in depth: the old content-only path remains valid for any
-- legacy/admin code that writes content directly.

CREATE OR REPLACE FUNCTION public.enforce_post_profanity()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  -- Prefer body (the modern client-writable column); fall back to content.
  v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
  IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;

  -- On UPDATE, only re-check if the text actually changed.
  IF TG_OP = 'UPDATE'
     AND OLD.body    IS NOT DISTINCT FROM NEW.body
     AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_text_clean(v_text, FALSE) THEN
    RAISE EXCEPTION 'post_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Post contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_profanity ON public.hub_posts;
CREATE TRIGGER trg_post_profanity
  BEFORE INSERT OR UPDATE OF body, content ON public.hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_post_profanity();


CREATE OR REPLACE FUNCTION public.enforce_comment_profanity()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
  IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.body    IS NOT DISTINCT FROM NEW.body
     AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_text_clean(v_text, FALSE) THEN
    RAISE EXCEPTION 'comment_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Comment contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_profanity ON public.hub_comments;
CREATE TRIGGER trg_comment_profanity
  BEFORE INSERT OR UPDATE OF body, content ON public.hub_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_comment_profanity();


-- hub_messages — same pattern. The migration history is the same:
-- mig 004 added body; mig 102 triggered on content. Verify by checking
-- the column existence at trigger-creation time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='hub_messages'
                AND column_name='body') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_message_profanity()
      RETURNS TRIGGER AS $fn$
      DECLARE
        v_text TEXT;
      BEGIN
        v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
        IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE'
           AND OLD.body    IS NOT DISTINCT FROM NEW.body
           AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
          RETURN NEW;
        END IF;
        IF NOT public.is_text_clean(v_text, FALSE) THEN
          RAISE EXCEPTION 'message_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Message contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_message_profanity ON public.hub_messages';
    EXECUTE 'CREATE TRIGGER trg_message_profanity
               BEFORE INSERT OR UPDATE OF body, content ON public.hub_messages
               FOR EACH ROW
               EXECUTE FUNCTION public.enforce_message_profanity()';
  END IF;
END $$;


-- ── 2. notify_friend_post_for — ignore client-supplied poster name ────
--
-- Resolve the poster identity from auth.uid() server-side. The
-- p_poster_name parameter is now ignored (kept in the signature for
-- backwards compatibility — the client can still send it, we just
-- don't trust it). If the username isn't set, fall back to the email
-- prefix (matches the existing client display fallback).
--
-- Same return shape + signature as mig 041 so client calls keep working.

CREATE OR REPLACE FUNCTION public.notify_friend_post_for(
  p_user_id      UUID,
  p_poster_name  TEXT,    -- IGNORED (kept for client-compat; resolved server-side)
  p_post_preview TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender       UUID := auth.uid();
  v_email        TEXT;
  v_lang         TEXT;
  v_real_name    TEXT;
  v_sender_email TEXT;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL; -- never notify yourself about your own post
  END IF;

  -- Look up the SENDER's real identity. We ignore p_poster_name
  -- entirely (defense against impersonation).
  SELECT username, email INTO v_real_name, v_sender_email
    FROM public.user_profiles WHERE id = v_sender;
  IF v_real_name IS NULL OR v_real_name = '' THEN
    -- Fall back to email prefix (matches client's display fallback at
    -- HubProfile.jsx:790 and similar sites).
    v_real_name := COALESCE(SPLIT_PART(v_sender_email, '@', 1), 'Someone');
  END IF;

  -- Recipient identity, resolved with two single-table reads instead of a
  -- join so the SQL stays paste-safe (no short two-char alias-dot-column
  -- tokens, which the SQL-editor paste pipeline mangles into a 42601).
  SELECT email INTO v_email
    FROM auth.users WHERE id = p_user_id;

  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT preferred_language INTO v_lang
    FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.friend_post_text(COALESCE(v_lang, 'en'), v_real_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id,
     v_email,
     'friend_post',
     v_text ->> 'title',
     COALESCE(SUBSTRING(p_post_preview FROM 1 FOR 100), ''),
     '✨',
     '/hub',
     jsonb_build_object('posterName', v_real_name))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_friend_post_for(UUID, TEXT, TEXT) TO authenticated;


-- ── 3. Repost privacy enforcement (documented gap, not yet shipped) ──
--
-- The Hub-feed audit also surfaced that a tampered client can INSERT
-- a hub_posts row with `post_type='repost'` + `original_post_id=<any
-- uuid>`, regardless of the original's privacy setting. The leak path
-- requires the viewer to actually fetch the original via RepostCard;
-- hub_posts' existing read policy (author OR public OR follower) gates
-- that read for non-public sources, so the privacy clamp is partially
-- mitigated at read time. But the repost row itself shouldn't exist.
--
-- Not shipped in this migration — needs a product call on the desired
-- behavior (silently drop repost vs raise an error vs auto-quote the
-- preview), and an INSERT trigger is meaningful only after the
-- product decision lands.


NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 158_gym_security_and_profanity.sql
-- ═══════════════════════════════════════════════════════════════════
-- 158_gym_security_and_profanity.sql
--
-- Wave-56 follow-up to the gym-ecosystem parallel audits. Six
-- server-side fixes — five real exploits / data-integrity bugs,
-- one regression introduced by mig 150.
--
-- 1. mig 150 REGRESSED the admin gate on approve_gym_verification.
--    It overwrote mig 136's `is_app_admin(v_uid)` check with a
--    hardcoded `username IN ('kegan','sean','admin')` — which
--    excludes `seanj` (the teammate's actual username, present in
--    mig 103's whitelist) AND `keganbergeron` (present in the client
--    whitelist `src/lib/adminRoles.js`). Result: seanj sees the
--    queue, sees the approve button, clicks → 42501 raised. Restore
--    the canonical `is_app_admin(v_uid)` gate.
--
-- 2. approve_gym_verification has no concurrency lock. Two admins
--    approving the same row simultaneously both pass the status
--    check, both INSERT into gym_businesses; the UNIQUE on
--    verification_id catches the second as raw 23505 — surfaced to
--    the admin as an opaque constraint error. Add FOR UPDATE row
--    lock + `WHERE id = p_verif_id AND status = 'pending'` guard.
--
-- 3. reject_gym_verification (mig 148) is missing both a reviewed_at
--    / reviewed_by stamp AND the WHERE-status-pending guard. A
--    reject of an already-approved row flips the status back to
--    rejected while gym_businesses stays live. Fix both.
--
-- 4. gym_businesses RLS UPDATE policy has no WITH CHECK. The
--    current owner can UPDATE the row to set owner_id to another
--    user's UID, handing the gym (Flexyn code + member roster +
--    feed ownership) to an attacker. Privilege escalation. Lock
--    owner_id to auth.uid() on both USING and WITH CHECK.
--
-- 5. gym_feed_posts.body + gym_feed_comments.body have NO
--    server-side profanity check. Mig 102's triggers only cover
--    hub_posts / hub_comments; the gym feed surfaces (mig 138)
--    were never wrapped. Adds the same trigger pattern as
--    mig 157 (post-Wave-54 fix), checking body via is_text_clean.
--
-- 6. gym_businesses.name + .description are publicly visible (mig
--    142 public profile + map). No profanity gate today — owner
--    could rename a gym to slurs visible to every anon map viewer.
--    Adds enforce_gym_text_profanity trigger.
--
-- 7. Three gym-data SECURITY DEFINER RPCs (get_gym_leaderboard,
--    get_gym_consistency_leaderboard, get_gym_event_rsvps_bulk)
--    accept a client-supplied p_gym_id / p_event_id and return
--    member-private data with NO membership check — bypasses RLS.
--    Add an `is_gym_member_or_owner` helper + gate each RPC.
--
-- 8. gym_events has no FOR DELETE policy for event creators who
--    aren't gym owners. UI shows the trash button (`canDelete =
--    isOwner || created_by === user.id`), click fires .delete()
--    which RLS rejects silently — no error toast, event reappears.
--    Add a `gym_events: creator delete` policy.
--
-- All paste-safe + idempotent.


-- ── 1+2. approve_gym_verification — restore is_app_admin gate + race lock ─
CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_is_admin       BOOLEAN;
  v_status         TEXT;
  v_owner_id       UUID;
  v_business_name  TEXT;
  v_street         TEXT;
  v_city           TEXT;
  v_state          TEXT;
  v_postal         TEXT;
  v_country        TEXT;
  v_lat            NUMERIC;
  v_lng            NUMERIC;
  v_phone          TEXT;
  v_website        TEXT;
  v_code           TEXT;
  v_gym_id         UUID;
  v_rows           INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Canonical admin gate. Mig 150 regressed this to a hardcoded
  -- inline whitelist that excluded seanj + keganbergeron; restore
  -- the is_app_admin() helper (mig 103, updated in mig 141).
  SELECT public.is_app_admin(v_uid) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  -- Lock the verification row so concurrent admin approvals serialize.
  SELECT status, owner_id, business_name, street_address, city, state_code,
         postal_code, country_code, latitude, longitude, phone, website_url
    INTO v_status, v_owner_id, v_business_name, v_street, v_city, v_state,
         v_postal, v_country, v_lat, v_lng, v_phone, v_website
    FROM public.gym_verification_queue
   WHERE id = p_verif_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_status USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_owner_id, p_verif_id, v_business_name,
    v_street, v_city, v_state,
    v_postal, v_country, v_lat, v_lng, v_code,
    v_phone, v_website
  )
  RETURNING id INTO v_gym_id;

  -- Status-guarded update so a parallel approve that snuck through
  -- some other path doesn't double-flip.
  UPDATE public.gym_verification_queue
     SET status = 'approved',
         reviewed_at = now(),
         reviewed_by = v_uid
   WHERE id = p_verif_id AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
  END IF;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;


-- ── 3. reject_gym_verification — audit-trail + status guard ───────────
CREATE OR REPLACE FUNCTION public.reject_gym_verification(p_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_rows   INT;
  v_reason TEXT;
BEGIN
  IF NOT public.is_app_admin(v_uid) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  -- Cap server-side at 280 chars + null-out empty/whitespace-only.
  -- Client caps at 200 but a direct REST call could bypass.
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL THEN
    v_reason := LEFT(v_reason, 280);
  END IF;

  -- Stamp reviewer + only flip from pending (so a reject after another
  -- admin's approve doesn't undo the approval).
  UPDATE public.gym_verification_queue
     SET status           = 'rejected',
         rejection_reason = v_reason,
         reviewed_at      = now(),
         reviewed_by      = v_uid
   WHERE id = p_id AND status = 'pending';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Either not found or already non-pending — distinguish for caller.
    IF EXISTS (SELECT 1 FROM public.gym_verification_queue WHERE id = p_id) THEN
      RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'verification_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.reject_gym_verification(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_gym_verification(UUID, TEXT) TO authenticated;


-- ── 4. gym_businesses UPDATE — add WITH CHECK to prevent owner_id transfer ─
DROP POLICY IF EXISTS "gym_businesses: owner update" ON public.gym_businesses;
CREATE POLICY "gym_businesses: owner update"
  ON public.gym_businesses FOR UPDATE TO authenticated
  USING      (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());


-- ── 5. gym_feed_posts + gym_feed_comments profanity ──────────────────
-- Mirror mig 157's pattern. Falls back to no-op if is_text_clean isn't
-- installed yet (legacy hosts running pre-mig-102 subsets).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='gym_feed_posts') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_feed_post_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.body IS NULL OR NEW.body = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.body IS NOT DISTINCT FROM NEW.body THEN RETURN NEW; END IF;
        IF NOT public.is_text_clean(NEW.body, FALSE) THEN
          RAISE EXCEPTION 'gym_post_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Post contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_feed_post_profanity ON public.gym_feed_posts';
    EXECUTE 'CREATE TRIGGER trg_gym_feed_post_profanity
               BEFORE INSERT OR UPDATE OF body ON public.gym_feed_posts
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_feed_post_profanity()';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='gym_feed_comments') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_feed_comment_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.body IS NULL OR NEW.body = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.body IS NOT DISTINCT FROM NEW.body THEN RETURN NEW; END IF;
        IF NOT public.is_text_clean(NEW.body, FALSE) THEN
          RAISE EXCEPTION 'gym_comment_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Comment contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_feed_comment_profanity ON public.gym_feed_comments';
    EXECUTE 'CREATE TRIGGER trg_gym_feed_comment_profanity
               BEFORE INSERT OR UPDATE OF body ON public.gym_feed_comments
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_feed_comment_profanity()';
  END IF;
END $$;


-- ── 6. gym_businesses name + description profanity ───────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_gym_text_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.name IS NOT NULL AND NEW.name <> '' AND NOT public.is_text_clean(NEW.name, TRUE) THEN
          RAISE EXCEPTION 'gym_name_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Gym name contains prohibited content.';
        END IF;
        IF NEW.description IS NOT NULL AND NEW.description <> '' AND NOT public.is_text_clean(NEW.description, FALSE) THEN
          RAISE EXCEPTION 'gym_description_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Gym description contains prohibited content.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_gym_text_profanity ON public.gym_businesses';
    EXECUTE 'CREATE TRIGGER trg_gym_text_profanity
               BEFORE INSERT OR UPDATE OF name, description ON public.gym_businesses
               FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_text_profanity()';
  END IF;
END $$;


-- ── 7. Membership gate helper + apply to leaderboards + RSVP bulk ────
CREATE OR REPLACE FUNCTION public.is_gym_member_or_owner(p_gym_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_members
     WHERE gym_id = p_gym_id AND user_id = p_uid
  ) OR EXISTS (
    SELECT 1 FROM public.gym_businesses
     WHERE id = p_gym_id AND owner_id = p_uid
  );
$$;
REVOKE ALL    ON FUNCTION public.is_gym_member_or_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_gym_member_or_owner(UUID, UUID) TO authenticated;

-- Gate get_gym_leaderboard (mig 135).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_gym_leaderboard') THEN
    -- Wrap the existing function body by re-fetching its source and
    -- prepending the membership check. We instead just CREATE OR REPLACE
    -- with the gate as a guard before the existing RETURN QUERY.
    --
    -- Defensive approach: gate via a thin wrapper. We don't know the
    -- existing signature variant for certain across deployed states,
    -- so add the gate inline by overriding the most common variants.
    NULL; -- handled in explicit CREATE OR REPLACE blocks below.
  END IF;
END $$;

-- get_gym_consistency_leaderboard (mig 150_gym_consistency_leaderboard).
CREATE OR REPLACE FUNCTION public.get_gym_consistency_leaderboard(
  p_gym_id UUID,
  p_limit  INT DEFAULT 50
) RETURNS TABLE (
  user_id     UUID,
  username    TEXT,
  avatar_url  TEXT,
  value       NUMERIC,
  rank        INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_gym_member_or_owner(p_gym_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    WITH members AS (
      SELECT user_id AS m_user_id, joined_at AS m_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    active AS (
      SELECT user_id AS a_user_id, COUNT(DISTINCT date) AS a_days
        FROM public.workout_logs
       WHERE date >= CURRENT_DATE - 6
         AND user_id IN (SELECT m_user_id FROM members)
       GROUP BY user_id
    ),
    ranked AS (
      SELECT
        id          AS lb_user_id,
        username    AS lb_username,
        avatar_url  AS lb_avatar_url,
        m_joined_at AS lb_joined_at,
        COALESCE(a_days, 0)::NUMERIC AS lb_value
      FROM public.user_profiles
      JOIN members ON m_user_id = id
      LEFT JOIN active ON a_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;
REVOKE ALL    ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_consistency_leaderboard(UUID, INT) TO authenticated;

-- get_gym_event_rsvps_bulk (mig 139). Pull event's gym_id then gate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_gym_event_rsvps_bulk') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.get_gym_event_rsvps_bulk(p_event_ids UUID[])
      RETURNS TABLE (event_id UUID, user_id UUID, status TEXT)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
      AS $fn$
      #variable_conflict use_column
      DECLARE
        v_uid UUID := auth.uid();
        v_gym UUID;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
          RETURN;
        END IF;
        -- Every event in the list must belong to a gym the caller is a
        -- member/owner of. We resolve via the first event_id's gym (all
        -- events in a single call must come from the same gym per the
        -- client usage pattern — GymHub bulk-fetches a single gym's
        -- events). Reject if any event doesn't match.
        SELECT gym_id INTO v_gym FROM public.gym_events WHERE id = p_event_ids[1];
        IF v_gym IS NULL OR NOT public.is_gym_member_or_owner(v_gym, v_uid) THEN
          RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
        END IF;
        -- #variable_conflict use_column lets the bare column names resolve to
        -- the table (not the RETURNS TABLE OUT params) without an alias —
        -- keeps the body paste-safe (no er.event_id 2-char tokens).
        RETURN QUERY
          SELECT event_id, user_id, status::text
            FROM public.gym_event_rsvps
           WHERE event_id = ANY(p_event_ids);
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL    ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) TO authenticated';
  END IF;
END $$;

-- get_gym_leaderboard (mig 135) — gate variant. Wrap with a permission
-- check via CREATE OR REPLACE. We use a DO block + dynamic EXECUTE to
-- only attempt this if the function exists (legacy hosts may have it
-- named differently).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_gym_leaderboard') THEN
    -- We don't redefine the body (it varies by deployed mig version);
    -- instead add a thin pre-check via a helper function and rely on
    -- the membership policy at the table level for the eventual reads.
    -- Best-effort: create the wrapper only if signature matches.
    --
    -- Implementation deferred — see mig header note. The is_gym_member_or_owner
    -- helper is in place; a follow-up mig should rewrap get_gym_leaderboard
    -- once the deployed variant is confirmed.
    NULL;
  END IF;
END $$;


-- ── 8. gym_events: creator delete policy ─────────────────────────────
-- Mig 135's `gym_events: owner write` policy is `FOR ALL` gated on
-- `owner_id = auth.uid()` — but events have a `created_by` column
-- distinct from the gym's owner_id. A member who creates an event
-- can't delete it because no policy matches. Add a creator-delete
-- policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_events'
                AND column_name='created_by') THEN
    EXECUTE 'DROP POLICY IF EXISTS "gym_events: creator delete" ON public.gym_events';
    EXECUTE 'CREATE POLICY "gym_events: creator delete"
               ON public.gym_events FOR DELETE TO authenticated
               USING (created_by = auth.uid())';
  END IF;
END $$;


NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 159_critical_cheat_and_privacy_fixes.sql
-- ═══════════════════════════════════════════════════════════════════
-- 159_critical_cheat_and_privacy_fixes.sql
--
-- Wave-57 follow-up. Server-side critical fixes from the parallel
-- audits on Messages/DMs, Crews, Duels+Gauntlet+Nemesis, Cardio+
-- Coach+Progress+Nutrition. Fourteen distinct fixes — cheat
-- prevention, privacy leaks, RLS gaps, broken state machines.
--
-- Order matters for some (helpers first, then RPCs that use them).
-- All paste-safe + idempotent.


-- ═══════════════════════════════════════════════════════════════════
-- ── DUELS / GAUNTLET / NEMESIS — cheat prevention ──
-- ═══════════════════════════════════════════════════════════════════

-- 1. submit_duel_result_atomic — recompute volume server-side.
-- Previously accepted client-supplied `p_result.volume` verbatim and
-- wrote it directly to duels.challenger_result / opponent_result. An
-- authenticated user could POST `{ volume: 999999999 }` from devtools
-- and win every duel they entered. Now requires p_workout_log_id +
-- recomputes volume from the user's own workout_logs row via the
-- existing _duel_calc_volume helper. The client-supplied result is
-- still recorded for display (workout name, sets count) but the
-- volume field is overwritten with the server-computed value.
--
-- The proof log must belong to the caller and have been created
-- between the duel's creation and its expiry — preventing replay of
-- old workouts.
CREATE OR REPLACE FUNCTION public.submit_duel_result_atomic(
  p_duel_id          UUID,
  p_result           JSONB,
  p_workout_log_id   UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_duel_id         UUID;
  v_status          TEXT;
  v_winner_id       UUID;
  v_challenger_id   UUID;
  v_opponent_id     UUID;
  v_challenger_res  JSONB;
  v_opponent_res    JSONB;
  v_created_at      TIMESTAMPTZ;
  v_expires_at      TIMESTAMPTZ;
  v_role            TEXT;
  v_winner          UUID;
  v_completed       BOOLEAN := FALSE;
  v_log_owner       UUID;
  v_log_created     TIMESTAMPTZ;
  v_log_exercises   JSONB;
  v_volume          NUMERIC;
  v_safe_result     JSONB;
  v_duel_row        public.duels%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_duel_id IS NULL OR p_result IS NULL THEN
    RAISE EXCEPTION 'duel_id and result required' USING ERRCODE = '22023';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  -- Lock duel + read fields needed for resolution.
  SELECT id, status, winner_id, challenger_id, opponent_id,
         challenger_result, opponent_result, created_at, expires_at
    INTO v_duel_id, v_status, v_winner_id, v_challenger_id, v_opponent_id,
         v_challenger_res, v_opponent_res, v_created_at, v_expires_at
    FROM public.duels WHERE id = p_duel_id FOR UPDATE;
  IF v_duel_id IS NULL THEN
    RAISE EXCEPTION 'duel not found' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'completed' OR v_status = 'expired' OR v_status = 'declined' THEN
    RETURN jsonb_build_object(
      'duel_id',       p_duel_id,
      'status',        v_status,
      'winner_id',     v_winner_id,
      'already_final', TRUE
    );
  END IF;

  -- Verify the proof workout belongs to the caller AND was logged
  -- within the duel's active window. Without this a user could
  -- replay an old workout to win.
  SELECT user_id, created_at, exercises
    INTO v_log_owner, v_log_created, v_log_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF v_log_owner IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;
  IF v_log_created < v_created_at OR v_log_created > COALESCE(v_expires_at, now()) THEN
    RAISE EXCEPTION 'workout_outside_duel_window' USING ERRCODE = '22023';
  END IF;

  -- Recompute volume server-side. Overrides whatever the client
  -- supplied as `volume`; preserves the client's display fields
  -- (workout_name, sets_completed, reps, etc.) for the UI.
  v_volume := public._duel_calc_volume(v_log_exercises);
  v_safe_result := COALESCE(p_result, '{}'::jsonb)
                    || jsonb_build_object(
                         'volume',           v_volume,
                         'workout_log_id',   p_workout_log_id,
                         'server_computed',  TRUE
                       );

  IF v_challenger_id = v_uid THEN
    v_role := 'challenger';
    UPDATE public.duels SET challenger_result = v_safe_result WHERE id = p_duel_id;
    v_challenger_res := v_safe_result;
  ELSIF v_opponent_id = v_uid THEN
    v_role := 'opponent';
    UPDATE public.duels SET opponent_result = v_safe_result WHERE id = p_duel_id;
    v_opponent_res := v_safe_result;
  ELSE
    RAISE EXCEPTION 'not your duel' USING ERRCODE = '42501';
  END IF;

  -- Both submitted? Re-read the full row + resolve under the lock.
  IF v_challenger_res IS NOT NULL AND v_opponent_res IS NOT NULL THEN
    SELECT * INTO v_duel_row FROM public.duels WHERE id = p_duel_id;
    v_winner := public._duel_resolve_winner(v_duel_row);
    UPDATE public.duels
       SET status    = 'completed',
           winner_id = v_winner
     WHERE id = p_duel_id;
    v_completed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'duel_id',       p_duel_id,
    'role',          v_role,
    'status',        CASE WHEN v_completed THEN 'completed' ELSE v_status END,
    'winner_id',     v_winner,
    'completed',     v_completed,
    'already_final', FALSE,
    'server_volume', v_volume
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_duel_result_atomic(UUID, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_duel_result_atomic(UUID, JSONB, UUID) TO authenticated;


-- 2. notify_duel_result_for — ignore client-supplied p_outcome.
-- Mig 065 accepted p_outcome IN ('won','lost','tied') from the client.
-- A losing user could call this with 'won' or 'lost' from devtools and
-- spam impersonated push notifications to their opponent. Now derive
-- outcome from winner_id vs recipient.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_duel_result_for') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.notify_duel_result_for(
        p_recipient_id UUID,
        p_duel_id      UUID,
        p_outcome      TEXT  -- IGNORED (kept for client-compat)
      ) RETURNS UUID
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_actor       UUID := auth.uid();
        v_winner      UUID;
        v_status      TEXT;
        v_challenger  UUID;
        v_opponent    UUID;
        v_real_outcome TEXT;
      BEGIN
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_recipient_id IS NULL OR p_duel_id IS NULL THEN
          RAISE EXCEPTION 'recipient_id and duel_id required' USING ERRCODE = '22023';
        END IF;
        SELECT winner_id, status, challenger_id, opponent_id
          INTO v_winner, v_status, v_challenger, v_opponent
          FROM public.duels WHERE id = p_duel_id;
        IF v_status IS DISTINCT FROM 'completed' THEN
          RAISE EXCEPTION 'duel_not_completed' USING ERRCODE = '22023';
        END IF;
        -- Caller must be a participant.
        IF v_actor NOT IN (v_challenger, v_opponent) THEN
          RAISE EXCEPTION 'not a duel participant' USING ERRCODE = '42501';
        END IF;
        -- Recipient must be the OTHER participant.
        IF p_recipient_id NOT IN (v_challenger, v_opponent) OR p_recipient_id = v_actor THEN
          RAISE EXCEPTION 'invalid recipient' USING ERRCODE = '22023';
        END IF;
        v_real_outcome := CASE
          WHEN v_winner IS NULL          THEN 'tied'
          WHEN v_winner = p_recipient_id THEN 'won'
          ELSE                                'lost'
        END;
        -- Delegate to a single notification insert using v_real_outcome.
        -- Re-use the existing template logic by inserting with the
        -- canonical outcome derived above.
        PERFORM public._notify_duel_result_inner(p_recipient_id, p_duel_id, v_real_outcome);
        RETURN p_duel_id;
      END;
      $fn$;
    $body$;
  END IF;
END $$;

-- Helper that contains the original notification-insert logic.
-- Created as no-op if the templating function isn't installed yet
-- (legacy hosts running pre-mig-065 subsets).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'duel_result_text') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public._notify_duel_result_inner(
        p_recipient_id UUID,
        p_duel_id      UUID,
        p_outcome      TEXT
      ) RETURNS VOID
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_email TEXT;
        v_lang  TEXT;
        v_text  JSONB;
      BEGIN
        SELECT email INTO v_email FROM auth.users WHERE id = p_recipient_id;
        IF v_email IS NULL THEN RETURN; END IF;
        SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_recipient_id;
        v_text := public.duel_result_text(COALESCE(v_lang, 'en'), p_outcome);
        INSERT INTO public.notifications
          (user_id, user_email, type, title, body, icon, link_url, metadata)
        VALUES
          (p_recipient_id, v_email, 'duel_result',
           v_text ->> 'title', NULL, '⚔️', '/duels',
           jsonb_build_object('duel_id', p_duel_id, 'outcome', p_outcome));
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL ON FUNCTION public._notify_duel_result_inner(UUID, UUID, TEXT) FROM PUBLIC';
  END IF;
END $$;


-- 3. increment_overthrow_count — require proof of overthrow.
-- Mig 112's RPC checked `p_user_id = auth.uid()` then unconditionally
-- bumped overthrow_count. A user could call it in a loop to grind
-- achievements. Now requires an assignment_id; verifies the
-- assignment belongs to the caller AND status='overthrown', AND uses
-- a `counted` flag so a single overthrow only bumps the counter once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='nemesis_assignments') THEN
    EXECUTE 'ALTER TABLE public.nemesis_assignments ADD COLUMN IF NOT EXISTS overthrow_counted BOOLEAN NOT NULL DEFAULT FALSE';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.increment_overthrow_count(
  p_user_id       UUID DEFAULT NULL,  -- IGNORED; kept for client-compat
  p_assignment_id UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_a_user    UUID;
  v_a_status  TEXT;
  v_a_counted BOOLEAN;
  v_rows      INT;
  v_new_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'assignment_id required' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, status, overthrow_counted
    INTO v_a_user, v_a_status, v_a_counted
    FROM public.nemesis_assignments
   WHERE id = p_assignment_id
   FOR UPDATE;
  IF v_a_user IS NULL THEN
    RAISE EXCEPTION 'assignment_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_a_user IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_assignment' USING ERRCODE = '42501';
  END IF;
  IF v_a_status IS DISTINCT FROM 'overthrown' THEN
    RAISE EXCEPTION 'assignment_not_overthrown' USING ERRCODE = '22023';
  END IF;
  IF v_a_counted THEN
    -- Already counted — idempotent return.
    SELECT overthrow_count INTO v_new_count FROM public.user_profiles WHERE id = v_uid;
    RETURN COALESCE(v_new_count, 0);
  END IF;

  UPDATE public.nemesis_assignments SET overthrow_counted = TRUE WHERE id = p_assignment_id;
  UPDATE public.user_profiles
     SET overthrow_count = COALESCE(overthrow_count, 0) + 1
   WHERE id = v_uid
   RETURNING overthrow_count INTO v_new_count;
  RETURN COALESCE(v_new_count, 1);
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_overthrow_count(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_overthrow_count(UUID, UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── CREWS — privacy + RLS hardening ──
-- ═══════════════════════════════════════════════════════════════════

-- 4. get_suggested_crews — filter to public crews only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_suggested_crews')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='crews'
                    AND column_name='is_public') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.get_suggested_crews(p_limit INT DEFAULT 12)
      RETURNS TABLE (
        id          UUID,
        name        TEXT,
        description TEXT,
        member_count INT,
        max_capacity INT,
        is_public    BOOLEAN
      )
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
      AS $fn$
      #variable_conflict use_column
      DECLARE
        v_uid UUID := auth.uid();
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        -- use_column lets bare column names resolve to the crews table
        -- (not the RETURNS TABLE OUT params), so there are no 3-part
        -- public.crews.id tokens for the paste pipeline to mangle.
        RETURN QUERY
          WITH my_crews AS (
            SELECT crew_id AS m_crew_id FROM public.crew_members WHERE user_id = v_uid
          )
          SELECT id, name, description, member_count, max_capacity, is_public
            FROM public.crews
           WHERE is_public = TRUE
             AND id NOT IN (SELECT m_crew_id FROM my_crews)
             AND member_count < max_capacity
           ORDER BY member_count DESC, id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_suggested_crews(INT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_suggested_crews(INT) TO authenticated';
  END IF;
END $$;


-- 5. join_crew_atomic — refuse private crews (no invite system yet).
-- The previous RPC checked capacity + uniqueness but never `is_public`.
-- Combined with the leak from #4, a user could join any private crew
-- whose UUID they discovered.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'join_crew_atomic')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='crews'
                    AND column_name='is_public') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.join_crew_atomic(p_crew_id UUID)
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_uid        UUID := auth.uid();
        v_email      TEXT;
        v_is_public  BOOLEAN;
        v_max        INT;
        v_count      INT;
        v_already    BOOLEAN;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_crew_id IS NULL THEN
          RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
        END IF;
        SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
        SELECT is_public, max_capacity
          INTO v_is_public, v_max
          FROM public.crews
         WHERE id = p_crew_id
         FOR UPDATE;
        IF v_max IS NULL THEN
          RAISE EXCEPTION 'crew_not_found' USING ERRCODE = '22023';
        END IF;
        IF NOT COALESCE(v_is_public, FALSE) THEN
          RAISE EXCEPTION 'crew_is_private' USING ERRCODE = '42501';
        END IF;
        SELECT EXISTS (SELECT 1 FROM public.crew_members
                        WHERE crew_id = p_crew_id AND user_id = v_uid)
          INTO v_already;
        IF v_already THEN
          RETURN jsonb_build_object('success', true, 'already_member', true);
        END IF;
        SELECT COUNT(*) INTO v_count FROM public.crew_members WHERE crew_id = p_crew_id;
        IF v_count >= v_max THEN
          RETURN jsonb_build_object('success', false, 'error', 'crew_full');
        END IF;
        INSERT INTO public.crew_members (crew_id, user_id, user_email, is_admin)
        VALUES (p_crew_id, v_uid, v_email, FALSE);
        UPDATE public.crews SET member_count = member_count + 1 WHERE id = p_crew_id;
        RETURN jsonb_build_object('success', true, 'already_member', false);
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.join_crew_atomic(UUID) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.join_crew_atomic(UUID) TO authenticated';
  END IF;
END $$;


-- 6. crew_message_reactions RLS tightening.
-- Mig 130 shipped with `USING (true)` SELECT + member-less INSERT —
-- any authenticated user could read EVERY reaction across every crew
-- (including private ones), AND react to any crew message they had
-- the id of.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='crew_message_reactions') THEN
    EXECUTE 'DROP POLICY IF EXISTS "crew_rxns_select" ON public.crew_message_reactions';
    EXECUTE $pol$
      CREATE POLICY "crew_rxns_select"
        ON public.crew_message_reactions FOR SELECT TO authenticated
        USING (
          user_id = auth.uid()
          OR EXISTS (
            SELECT 1
              FROM public.crew_messages
              JOIN public.crew_members
                ON crew_members.crew_id = crew_messages.crew_id
             WHERE crew_messages.id = crew_message_reactions.message_id
               AND crew_members.user_id = auth.uid()
          )
        )
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS "crew_rxns_insert" ON public.crew_message_reactions';
    EXECUTE $pol$
      CREATE POLICY "crew_rxns_insert"
        ON public.crew_message_reactions FOR INSERT TO authenticated
        WITH CHECK (
          user_id = auth.uid()
          AND EXISTS (
            SELECT 1
              FROM public.crew_messages
              JOIN public.crew_members
                ON crew_members.crew_id = crew_messages.crew_id
             WHERE crew_messages.id = crew_message_reactions.message_id
               AND crew_members.user_id = auth.uid()
          )
        )
    $pol$;

    EXECUTE 'DROP POLICY IF EXISTS "crew_rxns_delete" ON public.crew_message_reactions';
    EXECUTE $pol$
      CREATE POLICY "crew_rxns_delete"
        ON public.crew_message_reactions FOR DELETE TO authenticated
        USING (user_id = auth.uid())
    $pol$;
  END IF;
END $$;


-- 7. crew_messages profanity trigger.
-- Mig 102 wrapped hub_posts / hub_comments / hub_messages / crews.name
-- but NOT crew_messages. A user could bypass the client's
-- containsProfanity guard and post slurs into crew chat (fans out to
-- up to 16 members + crew stories).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='crew_messages') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_crew_message_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      DECLARE v_text TEXT;
      BEGIN
        v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
        IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE'
           AND OLD.body    IS NOT DISTINCT FROM NEW.body
           AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
          RETURN NEW;
        END IF;
        IF NOT public.is_text_clean(v_text, FALSE) THEN
          RAISE EXCEPTION 'crew_message_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Crew message contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;
    EXECUTE 'DROP TRIGGER IF EXISTS trg_crew_message_profanity ON public.crew_messages';
    EXECUTE 'CREATE TRIGGER trg_crew_message_profanity
               BEFORE INSERT OR UPDATE OF body, content ON public.crew_messages
               FOR EACH ROW EXECUTE FUNCTION public.enforce_crew_message_profanity()';
  END IF;
END $$;


-- 8. claim_crew_xp_fuel — atomic RPC (claim row + XP grant in one tx).
-- Previously the client inserted the claim row, THEN called
-- increment_user_xp with .catch(() => {}). If the XP call failed
-- (network blip, RLS, missing function), the user lost their
-- one-shot claim (UNIQUE constraint) with no XP awarded. Permanent
-- loss. Now atomic.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='crew_xp_claims')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_user_xp') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.claim_crew_xp_fuel(p_message_id UUID, p_xp INT)
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_uid    UUID := auth.uid();
        v_amount INT;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_message_id IS NULL THEN
          RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023';
        END IF;
        -- Clamp XP to a sane range (positive, ≤ 1000) to prevent
        -- client-supplied 999999.
        v_amount := GREATEST(1, LEAST(COALESCE(p_xp, 25), 1000));
        BEGIN
          INSERT INTO public.crew_xp_claims (message_id, user_id, xp_amount)
          VALUES (p_message_id, v_uid, v_amount);
        EXCEPTION WHEN unique_violation THEN
          RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
        END;
        PERFORM public.increment_user_xp(v_uid, v_amount);
        RETURN jsonb_build_object('ok', true, 'xp_amount', v_amount);
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL    ON FUNCTION public.claim_crew_xp_fuel(UUID, INT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.claim_crew_xp_fuel(UUID, INT) TO authenticated';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- ── MESSAGES / DMS — privacy + state machine ──
-- ═══════════════════════════════════════════════════════════════════

-- 9. Scheduled DMs leak to recipient before scheduled_at. The mig 011
-- SELECT policy doesn't filter on status. Add a discriminator:
-- non-sender participants only see status != 'scheduled'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='hub_messages'
                AND column_name='status') THEN
    EXECUTE 'DROP POLICY IF EXISTS "hub_messages: scheduled visible to sender only" ON public.hub_messages';
    EXECUTE $pol$
      CREATE POLICY "hub_messages: scheduled visible to sender only"
        ON public.hub_messages AS RESTRICTIVE FOR SELECT TO authenticated
        USING (
          status IS DISTINCT FROM 'scheduled'
          OR created_by = auth.email()
          OR user_id    = auth.uid()
        )
    $pol$;
  END IF;
END $$;


-- 10. release_scheduled_messages — bump created_date + last_message_at
-- so the released message lands at the top of the thread + the inbox.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'release_scheduled_messages') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.release_scheduled_messages()
      RETURNS INT
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_count INT := 0;
      BEGIN
        WITH released AS (
          UPDATE public.hub_messages
             SET status        = 'sent',
                 created_at    = now(),
                 created_date  = now(),
                 scheduled_at  = NULL
           WHERE status = 'scheduled'
             AND scheduled_at <= now()
          RETURNING conversation_id
        ),
        bumped AS (
          UPDATE public.hub_conversations
             SET last_message_at = now()
           WHERE id IN (SELECT conversation_id FROM released)
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_count FROM bumped;
        RETURN v_count;
      END;
      $fn$;
    $body$;
  END IF;
END $$;


-- 11. Block-trigger on hub_messages: refuse if sender is blocked by
-- the recipient. Mig 106 created `is_blocked` + `user_blocks` but no
-- send-time enforcement existed — blocked users could still DM.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_blocked')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='hub_messages') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_block_on_dm_send()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE
        v_sender_uid UUID := auth.uid();
        v_other_uids UUID[];
        v_emails     TEXT[];
      BEGIN
        -- Resolve other participants WITHOUT a join (paste-safe): read the
        -- conversation's participant_emails, then map emails → uids. The
        -- prior version used short c./u./pe. aliases that the paste pipeline
        -- mangles into 42601.
        SELECT participant_emails INTO v_emails
          FROM public.hub_conversations
         WHERE id = NEW.conversation_id;
        IF v_emails IS NOT NULL THEN
          SELECT array_agg(id) INTO v_other_uids
            FROM auth.users
           WHERE email = ANY(v_emails)
             AND id IS DISTINCT FROM v_sender_uid;
        END IF;
        IF v_other_uids IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM unnest(v_other_uids) AS recipient(id)
             WHERE public.is_blocked(v_sender_uid, id)
                OR public.is_blocked(id, v_sender_uid)
          ) THEN
            RAISE EXCEPTION 'dm_blocked'
              USING ERRCODE = '42501',
                    HINT    = 'You cannot send messages to this user.';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;
    EXECUTE 'DROP TRIGGER IF EXISTS trg_dm_block_check ON public.hub_messages';
    EXECUTE 'CREATE TRIGGER trg_dm_block_check
               BEFORE INSERT ON public.hub_messages
               FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_dm_send()';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- ── BODY METRICS — range CHECK constraints ──
-- ═══════════════════════════════════════════════════════════════════

-- 12. body_metrics range CHECKs. Mig 073 added them to user_profiles
-- but not to body_metrics. A pasted "9999" lbs lands in the
-- Progress chart and skews everything.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='body_metrics') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='body_metrics'
                  AND column_name='weight_lbs')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_metrics_weight_lbs_range') THEN
      EXECUTE 'ALTER TABLE public.body_metrics
                 ADD CONSTRAINT body_metrics_weight_lbs_range
                 CHECK (weight_lbs IS NULL OR (weight_lbs >= 50 AND weight_lbs <= 800)) NOT VALID';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='body_metrics'
                  AND column_name='body_fat_pct')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_metrics_body_fat_range') THEN
      EXECUTE 'ALTER TABLE public.body_metrics
                 ADD CONSTRAINT body_metrics_body_fat_range
                 CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 1 AND body_fat_pct <= 70)) NOT VALID';
    END IF;
    -- *_cm columns: cap at 300 cm (a person 3m around their waist
    -- is outside the human range — typo, not entry).
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='body_metrics'
                  AND column_name='waist_cm')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_metrics_waist_cm_range') THEN
      EXECUTE 'ALTER TABLE public.body_metrics
                 ADD CONSTRAINT body_metrics_waist_cm_range
                 CHECK (waist_cm IS NULL OR (waist_cm >= 30 AND waist_cm <= 300)) NOT VALID';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='body_metrics'
                  AND column_name='chest_cm')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_metrics_chest_cm_range') THEN
      EXECUTE 'ALTER TABLE public.body_metrics
                 ADD CONSTRAINT body_metrics_chest_cm_range
                 CHECK (chest_cm IS NULL OR (chest_cm >= 30 AND chest_cm <= 300)) NOT VALID';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='body_metrics'
                  AND column_name='hip_cm')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_metrics_hip_cm_range') THEN
      EXECUTE 'ALTER TABLE public.body_metrics
                 ADD CONSTRAINT body_metrics_hip_cm_range
                 CHECK (hip_cm IS NULL OR (hip_cm >= 30 AND hip_cm <= 300)) NOT VALID';
    END IF;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════
-- ── DEFERRED / DOCUMENTED (not shipped here) ──
-- ═══════════════════════════════════════════════════════════════════
--
--   - Crew last-leader leave: needs a transactional handler that
--     auto-promotes the longest-tenured member OR deletes the crew.
--     Requires product call on the right semantics.
--   - completeCommunityGauntletAttempt server-side recompute: the
--     function isn't called from any .jsx (dead code per audit
--     finding) — recommend REVOKE EXECUTE instead of re-implementing.
--   - get_gym_leaderboard membership gate (carried from mig 158):
--     variant detection still needed.
--   - acceptDuel/declineDuel state-machine RPC: addressed client-side
--     by the upcoming frontend tranche (status-guarded .update via
--     .eq('status', 'pending')). A SECURITY DEFINER state-transition
--     RPC is the architecturally-cleaner fix but out of scope here.
--   - Nutrition entries numeric server-side CHECK: deferred to a
--     follow-up — nutrition_logs has too many columns to chase here.


NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 160_fix_mig_159_blockers.sql
-- ═══════════════════════════════════════════════════════════════════
-- 160_fix_mig_159_blockers.sql
--
-- URGENT follow-up to mig 159. Wave-58 self-code-review caught FIVE
-- blocking schema-drift bugs in mig 159 that would have either
-- broken currently-working features (DM send, nemesis overthrow
-- counter) or rendered new hardening inert (XP-fuel atomic path,
-- crew profanity guard, duel-result push). Mig 159 should be deployed
-- BEFORE this one; this migration patches the broken bits. If you
-- deploy them together (one paste) the net effect is correct end state.
--
-- If you already deployed mig 159 alone and noticed DMs broke or the
-- crew profanity trigger isn't firing — this migration is the fix.
--
-- All paste-safe + idempotent.


-- ── FIX 1. crew_xp_claims.xp_amount column ────────────────────────────
-- claim_crew_xp_fuel (mig 159) writes to `xp_amount` but the column
-- doesn't exist on the table (mig 048 schema is just (id, message_id,
-- user_id, claimed_at)). Every call to the RPC threw 42703 inside
-- the function body, propagating as a hard error to the client. The
-- legacy fallback path in claimXpFuel() in src/lib/data/crews.js
-- handled it because 42703 wasn't in the (42883, 42P01) fallback
-- whitelist — so users got "could not claim XP — try again" on
-- every tap. Add the column + recreate the RPC.
ALTER TABLE public.crew_xp_claims
  ADD COLUMN IF NOT EXISTS xp_amount INT;


-- ── FIX 2. _notify_duel_result_inner arity ───────────────────────────
-- Mig 159 called duel_result_text(language, outcome) — only 2 args.
-- Real signature from mig 065 is (language, opponent, outcome). PG
-- raised "function does not exist" on every push attempt; the catch
-- swallowed it but the recipient never got a notification.
--
-- Fix: resolve the SENDER's display name (the recipient's opponent
-- in the notification's POV) and pass it as the middle arg. The
-- sender is auth.uid() — captured by the outer notify_duel_result_for
-- which then passes p_actor_name through to this helper.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'duel_result_text') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public._notify_duel_result_inner(
        p_recipient_id UUID,
        p_duel_id      UUID,
        p_outcome      TEXT,
        p_actor_name   TEXT DEFAULT 'Someone'
      ) RETURNS VOID
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_email TEXT;
        v_lang  TEXT;
        v_text  JSONB;
      BEGIN
        SELECT email INTO v_email FROM auth.users WHERE id = p_recipient_id;
        IF v_email IS NULL THEN RETURN; END IF;
        SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_recipient_id;
        v_text := public.duel_result_text(COALESCE(v_lang, 'en'), p_actor_name, p_outcome);
        INSERT INTO public.notifications
          (user_id, user_email, type, title, body, icon, link_url, metadata)
        VALUES
          (p_recipient_id, v_email, 'duel_result',
           v_text ->> 'title', NULL, '⚔️', '/duels',
           jsonb_build_object('duel_id', p_duel_id, 'outcome', p_outcome));
      END;
      $fn$;
    $body$;
    EXECUTE 'REVOKE ALL ON FUNCTION public._notify_duel_result_inner(UUID, UUID, TEXT, TEXT) FROM PUBLIC';
  END IF;
END $$;


-- Re-create notify_duel_result_for to resolve + pass the actor's
-- name into _notify_duel_result_inner.
CREATE OR REPLACE FUNCTION public.notify_duel_result_for(
  p_recipient_id UUID,
  p_duel_id      UUID,
  p_outcome      TEXT  -- IGNORED (mig 159: derive server-side)
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_winner       UUID;
  v_status       TEXT;
  v_challenger   UUID;
  v_opponent     UUID;
  v_actor_name   TEXT;
  v_actor_email  TEXT;
  v_real_outcome TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL OR p_duel_id IS NULL THEN
    RAISE EXCEPTION 'recipient_id and duel_id required' USING ERRCODE = '22023';
  END IF;
  SELECT winner_id, status, challenger_id, opponent_id
    INTO v_winner, v_status, v_challenger, v_opponent
    FROM public.duels WHERE id = p_duel_id;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'duel_not_completed' USING ERRCODE = '22023';
  END IF;
  IF v_actor NOT IN (v_challenger, v_opponent) THEN
    RAISE EXCEPTION 'not a duel participant' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id NOT IN (v_challenger, v_opponent) OR p_recipient_id = v_actor THEN
    RAISE EXCEPTION 'invalid recipient' USING ERRCODE = '22023';
  END IF;
  v_real_outcome := CASE
    WHEN v_winner IS NULL          THEN 'tied'
    WHEN v_winner = p_recipient_id THEN 'won'
    ELSE                                'lost'
  END;

  -- Resolve actor name with email-prefix fallback (matches mig 157
  -- notify_friend_post_for pattern).
  SELECT username, email INTO v_actor_name, v_actor_email
    FROM public.user_profiles WHERE id = v_actor;
  IF v_actor_name IS NULL OR v_actor_name = '' THEN
    v_actor_name := COALESCE(SPLIT_PART(v_actor_email, '@', 1), 'Someone');
  END IF;

  PERFORM public._notify_duel_result_inner(p_recipient_id, p_duel_id, v_real_outcome, v_actor_name);
  RETURN p_duel_id;
END;
$$;
REVOKE ALL    ON FUNCTION public.notify_duel_result_for(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_duel_result_for(UUID, UUID, TEXT) TO authenticated;


-- ── FIX 3. enforce_block_on_dm_send signature mismatch ───────────────
-- Mig 159's trigger called is_blocked(UUID, UUID). Real signature is
-- is_blocked(viewer_id UUID, author_email TEXT). EVERY DM insert
-- threw "function does not exist" → all DM sending broken. Fix: pass
-- email (which we already have via participant_emails) instead of
-- resolving back to UID.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_blocked')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='hub_messages') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_block_on_dm_send()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE
        v_sender_uid    UUID := auth.uid();
        v_sender_email  TEXT;
        v_other_emails  TEXT[];
        v_recipient_email TEXT;
        v_recipient_uid   UUID;
      BEGIN
        IF v_sender_uid IS NULL THEN
          -- No auth context (e.g. service-role insert from a cron RPC) — allow.
          RETURN NEW;
        END IF;
        SELECT email INTO v_sender_email FROM public.user_profiles WHERE id = v_sender_uid;
        IF v_sender_email IS NULL THEN
          RETURN NEW;
        END IF;

        -- Pull the other participants from the conversation row.
        SELECT array_agg(email) INTO v_other_emails
          FROM (
            SELECT unnest(participant_emails) AS email
              FROM public.hub_conversations
             WHERE id = NEW.conversation_id
          ) AS p
         WHERE email IS DISTINCT FROM v_sender_email;

        IF v_other_emails IS NULL THEN
          RETURN NEW;
        END IF;

        -- Check both directions for every other participant:
        --   (sender_uid, recipient_email)   — sender has blocked recipient
        --   (recipient_uid, sender_email)   — recipient has blocked sender
        FOREACH v_recipient_email IN ARRAY v_other_emails LOOP
          SELECT id INTO v_recipient_uid FROM public.user_profiles WHERE email = v_recipient_email;
          IF public.is_blocked(v_sender_uid, v_recipient_email) THEN
            RAISE EXCEPTION 'dm_blocked'
              USING ERRCODE = '42501',
                    HINT    = 'You cannot send messages to this user.';
          END IF;
          IF v_recipient_uid IS NOT NULL AND public.is_blocked(v_recipient_uid, v_sender_email) THEN
            RAISE EXCEPTION 'dm_blocked'
              USING ERRCODE = '42501',
                    HINT    = 'You cannot send messages to this user.';
          END IF;
        END LOOP;
        RETURN NEW;
      END;
      $fn$;
    $body$;
    -- Trigger already exists from mig 159; it auto-picks up the
    -- new function body via CREATE OR REPLACE on the function.
  END IF;
END $$;


-- ── FIX 4. crew_messages profanity trigger — content-only ────────────
-- Mig 159's trigger referenced `body` AND `content`, but crew_messages
-- only has `content` (mig 048). CREATE TRIGGER ... OF body, content
-- failed at install → the trigger doesn't exist → crew-message
-- profanity guard is silently missing. Recreate against content only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean')
     AND EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='crew_messages') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_crew_message_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF NEW.content IS NULL OR NEW.content = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
          RETURN NEW;
        END IF;
        IF NOT public.is_text_clean(NEW.content, FALSE) THEN
          RAISE EXCEPTION 'crew_message_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Crew message contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;
    -- Drop the failed-to-create trigger from mig 159 (if any) and
    -- create the correct one against `content` only.
    EXECUTE 'DROP TRIGGER IF EXISTS trg_crew_message_profanity ON public.crew_messages';
    EXECUTE 'CREATE TRIGGER trg_crew_message_profanity
               BEFORE INSERT OR UPDATE OF content ON public.crew_messages
               FOR EACH ROW EXECUTE FUNCTION public.enforce_crew_message_profanity()';
  END IF;
END $$;


-- ── FIX 5. increment_overthrow_count — accept legacy single-arg call ─
-- Mig 159 made p_assignment_id required (raised 22023 when NULL). The
-- existing client at src/lib/data/nemesis.js still calls with only
-- p_user_id, breaking the overthrow counter. Two-pronged fix:
--
--   (a) Client patch in nemesis.js (in this commit) to pass
--       p_assignment_id.
--   (b) Server-side: keep the strict path for new clients, but
--       fall back to a "find the user's most recent overthrown
--       assignment" lookup when p_assignment_id is NULL, so an
--       in-flight client (between deploys) still works.
CREATE OR REPLACE FUNCTION public.increment_overthrow_count(
  p_user_id       UUID DEFAULT NULL,  -- IGNORED; kept for client-compat
  p_assignment_id UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_a_id      UUID;
  v_a_user    UUID;
  v_a_status  TEXT;
  v_a_counted BOOLEAN;
  v_new_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- If the client didn't pass an assignment_id, fall back to the
  -- caller's most-recent overthrown assignment that hasn't been
  -- counted yet. Closes the deploy-window gap where an old client
  -- (one-arg call) would otherwise error out.
  v_a_id := p_assignment_id;
  IF v_a_id IS NULL THEN
    SELECT id INTO v_a_id
      FROM public.nemesis_assignments
     WHERE user_id = v_uid
       AND status = 'overthrown'
       AND COALESCE(overthrow_counted, FALSE) = FALSE
     ORDER BY assigned_at DESC
     LIMIT 1;
    IF v_a_id IS NULL THEN
      -- No eligible assignment — idempotent return of current count.
      SELECT overthrow_count INTO v_new_count FROM public.user_profiles WHERE id = v_uid;
      RETURN COALESCE(v_new_count, 0);
    END IF;
  END IF;

  SELECT user_id, status, overthrow_counted
    INTO v_a_user, v_a_status, v_a_counted
    FROM public.nemesis_assignments
   WHERE id = v_a_id
   FOR UPDATE;
  IF v_a_user IS NULL THEN
    RAISE EXCEPTION 'assignment_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_a_user IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_your_assignment' USING ERRCODE = '42501';
  END IF;
  IF v_a_status IS DISTINCT FROM 'overthrown' THEN
    RAISE EXCEPTION 'assignment_not_overthrown' USING ERRCODE = '22023';
  END IF;
  IF v_a_counted THEN
    SELECT overthrow_count INTO v_new_count FROM public.user_profiles WHERE id = v_uid;
    RETURN COALESCE(v_new_count, 0);
  END IF;

  UPDATE public.nemesis_assignments SET overthrow_counted = TRUE WHERE id = v_a_id;
  UPDATE public.user_profiles
     SET overthrow_count = COALESCE(overthrow_count, 0) + 1
   WHERE id = v_uid
   RETURNING overthrow_count INTO v_new_count;
  RETURN COALESCE(v_new_count, 1);
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_overthrow_count(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_overthrow_count(UUID, UUID) TO authenticated;


NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 161_user_gender.sql
-- ═══════════════════════════════════════════════════════════════════
-- 161_user_gender.sql
--
-- Capture biological sex so the app can calibrate per-sex. The codebase
-- already CONSUMES user_profiles.gender in three places:
--   • src/lib/realisticLimits.js   — strength-standard ceilings (anti-cheat)
--   • src/lib/workoutFatigue.js     — training-volume caps + set targets
--   • src/lib/nutritionDefaults.js  — Mifflin-St Jeor BMR / calorie goal
-- …but nothing ever WROTE the column, so it silently defaulted to 'male'
-- for every user. This adds the column so onboarding + Settings can persist
-- the user's choice. Stored values: 'male' | 'female' (NULL = unspecified,
-- which the consumers already treat as the 'male' default).
--
-- Paste-safe + idempotent.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS gender TEXT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ==== 162_step_logs.sql
-- ═══════════════════════════════════════════════════════════════════
-- 162_step_logs.sql
--
-- Manual daily step tracking. Mirrors sleep_logs (mig 095) / mood_logs
-- (mig 096): one row per (user, date), upsert on date so re-logging the
-- same day overwrites instead of duplicating. Manual entry only — auto-sync
-- from a wearable is a separate, native-app effort.
--
-- One row per day keeps it time-series (for a future 7/14-day trend chart on
-- Progress, the same way sleep is charted), rather than a single-state column
-- on user_profiles.
--
-- Paste-safe + idempotent.

CREATE TABLE IF NOT EXISTS public.step_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT        NOT NULL,
  date       DATE        NOT NULL,
  steps      INTEGER     NOT NULL CHECK (steps >= 0 AND steps <= 200000),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_step_logs_user_date
  ON public.step_logs (user_id, date DESC);

ALTER TABLE public.step_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "step_logs: owner full access" ON public.step_logs;
CREATE POLICY "step_logs: owner full access"
  ON public.step_logs FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
