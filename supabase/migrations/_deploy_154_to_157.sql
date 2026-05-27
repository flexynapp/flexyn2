-- ─────────────────────────────────────────────────────────────────────
-- _deploy_154_to_157.sql — newest migrations only (154, 155, 156, 157)
-- Idempotent + paste-safe. Run after the 144–153 bundle/blocks.
-- ─────────────────────────────────────────────────────────────────────



-- ═══════════════════════════════════════════════════════════════════
-- ── 154_bounty_v2_and_custom_quotes_hardening.sql ──
-- ═══════════════════════════════════════════════════════════════════

-- complete_bounty_claim — adds deadline check + correct weekly_volume calc.
CREATE OR REPLACE FUNCTION public.complete_bounty_claim(
  p_claim_id       UUID,
  p_workout_log_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  IF v_metric = 'session_volume' THEN
    v_achieved := public._duel_calc_volume(v_exercises);
  ELSIF v_metric = 'weekly_volume' THEN
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

-- mig 154 — tighter bounty insert policy (replaces mig 152's version).
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

-- custom_quotes 20-cap trigger.
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

-- custom_quotes profanity trigger (reuses is_bio_clean; falls back to no-op).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_bio_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_custom_quote_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
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


-- ═══════════════════════════════════════════════════════════════════
-- ── 155_corporate_hr_fix_and_listing_profanity.sql ──
-- ═══════════════════════════════════════════════════════════════════

-- HR analytics: union both join keys (user_id + email) + privacy floor 5
-- + activity rounding.
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

-- TOCTOU seat_limit: FOR UPDATE lock.
CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_cnt INT;
  v_lim INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;

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
REVOKE ALL    ON FUNCTION public.join_organization_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- Last-admin leave trigger.
CREATE OR REPLACE FUNCTION public.enforce_last_admin_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_admin_count   INT;
  v_member_count  INT;
BEGIN
  IF OLD.role IS DISTINCT FROM 'admin' THEN RETURN OLD; END IF;
  SELECT COUNT(*) INTO v_admin_count
    FROM public.organization_members
   WHERE org_id = OLD.org_id AND role = 'admin';
  SELECT COUNT(*) INTO v_member_count
    FROM public.organization_members
   WHERE org_id = OLD.org_id;
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

-- Profanity triggers on org name + challenge title + trainer listings.
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


-- ─────────────────────────────────────────────────────────────────────
-- Final: refresh PostgREST's schema cache so new RPCs / columns /
-- triggers are immediately visible to the client.
-- ─────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 156_corporate_hr_dedup_actors.sql ──
-- ═══════════════════════════════════════════════════════════════════
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
    SELECT public.user_profiles.id    AS m_uid,
           public.user_profiles.email AS m_email
      FROM public.user_profiles
     WHERE public.user_profiles.id IN (
       SELECT user_id FROM public.organization_members
        WHERE org_id = p_org_id
     )
  ),
  recent_logs AS (
    SELECT
      -- Canonical actor: user_id if present, otherwise resolve email→uid.
      -- COALESCE picks the first non-NULL.
      COALESCE(
        public.workout_logs.user_id::text,
        (SELECT m_uid::text FROM member_map
          WHERE m_email = public.workout_logs.created_by
          LIMIT 1)
      ) AS canonical_actor
    FROM public.workout_logs
    WHERE created_at > now() - INTERVAL '7 days'
      AND (
        public.workout_logs.user_id IN (SELECT m_uid FROM member_map)
        OR public.workout_logs.created_by IN (SELECT m_email FROM member_map)
      )
  ),
  unique_actors AS (
    SELECT DISTINCT canonical_actor FROM recent_logs
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
-- ── 157_hub_profanity_and_notify_hardening.sql ──
-- ═══════════════════════════════════════════════════════════════════

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
