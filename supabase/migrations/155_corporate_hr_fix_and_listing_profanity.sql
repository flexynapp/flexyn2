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
