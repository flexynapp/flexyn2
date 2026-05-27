-- ─────────────────────────────────────────────────────────────────────
-- _deploy_144_to_157.sql — ONE-SHOT DEPLOY BUNDLE (covers 144–157)
--
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- Supersedes _deploy_144_to_155.sql: it is that bundle PLUS the two
-- newer migrations (156 HR-actor dedup, 157 profanity + notify hardening).
--
-- Every statement is idempotent (CREATE OR REPLACE / IF NOT EXISTS /
-- DROP … IF EXISTS), so re-running is safe even if you already pasted an
-- earlier bundle or ran 152/153 individually.
--
-- Paste-safe per CLAUDE.md: no executable `alias.column` 2-char tokens
-- and no `%ROWTYPE` + dotted record access. (157's friend-post notifier
-- was rewritten from a JOIN to two single-table SELECT…INTO reads for
-- exactly this reason.)
-- ─────────────────────────────────────────────────────────────────────



-- ====================================================================
-- ==== SECTION A: migrations 144–155 (from _deploy_144_to_155.sql) ====
-- ====================================================================
-- ─────────────────────────────────────────────────────────────────────
-- _deploy_144_to_155.sql — ONE-SHOT DEPLOY BUNDLE (10 migrations)
--
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- Covers every pending migration since the last bundle (147–148):
--
--   ✅ 144_bio_and_dm_polls.sql                          (bio col + DM polls)
--   ✅ 149_gym_checkins.sql                              (gym QR check-in)
--   ✅ 149_live_activity_rail_email_column.sql           (rail tap → profile fix)
--   ✅ 150_gym_approval_geo_optional.sql                 (coord-less gym approval)
--   ✅ 150_gym_consistency_leaderboard.sql               (effort-based leaderboard)
--   ✅ 151_signature_trophy.sql                          (pinned profile trophy)
--   ✅ 152_bounty_economy_integrity.sql                  (bounty exploit close v1)
--   ✅ 153_custom_quotes.sql                             (user-authored quotes)
--   ✅ 154_bounty_v2_and_custom_quotes_hardening.sql     (bounty v2 + quotes triggers)
--   ✅ 155_corporate_hr_fix_and_listing_profanity.sql    (HR analytics + profanity)
--
-- All statements idempotent (CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS).
-- All paste-safe per CLAUDE.md: no `alias.column` 2-char tokens, no
-- `%ROWTYPE` + dotted record access. Mig 144's policy bodies are
-- rewritten with CTE-renamed join keys; mig 150_gym_approval_geo_optional
-- uses scalar SELECT…INTO variables (instead of %ROWTYPE).
--
-- Re-running is safe — if you've already pasted _deploy_149_to_151.sql,
-- this bundle's mig 149-151 sections are no-ops.
-- ─────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════
-- ── 144_bio_and_dm_polls.sql (paste-safe rewrite) ──
-- ═══════════════════════════════════════════════════════════════════

-- Bio column (already on most hosts).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- DM polls + votes.
CREATE TABLE IF NOT EXISTS public.dm_polls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES public.hub_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.hub_conversations(id) ON DELETE CASCADE,
  creator_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question        TEXT NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at         TIMESTAMPTZ,
  UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS dm_polls_conversation_idx ON public.dm_polls (conversation_id);
CREATE INDEX IF NOT EXISTS dm_polls_creator_idx      ON public.dm_polls (creator_id);

CREATE TABLE IF NOT EXISTS public.dm_poll_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID NOT NULL REFERENCES public.dm_polls(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id  TEXT NOT NULL,
  voted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS dm_poll_votes_poll_idx ON public.dm_poll_votes (poll_id);

ALTER TABLE public.dm_polls      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_poll_votes ENABLE ROW LEVEL SECURITY;

-- Policies rewritten paste-safe: a CTE renames the conversation lookup
-- key (conv_emails / conv_uids) so the body has no `c.id` / `c.participant_*`
-- 2-char alias.column tokens.
DROP POLICY IF EXISTS "dm_polls: participant read" ON public.dm_polls;
CREATE POLICY "dm_polls: participant read"
  ON public.dm_polls FOR SELECT TO authenticated
  USING (
    EXISTS (
      WITH conv AS (
        SELECT participant_emails AS conv_emails, participant_ids AS conv_uids
          FROM public.hub_conversations
         WHERE id = dm_polls.conversation_id
      )
      SELECT 1 FROM conv
       WHERE auth.email() = ANY(conv_emails)
          OR auth.uid()   = ANY(conv_uids)
    )
  );

DROP POLICY IF EXISTS "dm_polls: creator insert" ON public.dm_polls;
CREATE POLICY "dm_polls: creator insert"
  ON public.dm_polls FOR INSERT TO authenticated
  WITH CHECK (creator_id = auth.uid());

DROP POLICY IF EXISTS "dm_poll_votes: participant read" ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: participant read"
  ON public.dm_poll_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      WITH conv AS (
        SELECT participant_emails AS conv_emails, participant_ids AS conv_uids
          FROM public.hub_conversations
         WHERE id IN (
           SELECT conversation_id FROM public.dm_polls
            WHERE id = dm_poll_votes.poll_id
         )
      )
      SELECT 1 FROM conv
       WHERE auth.email() = ANY(conv_emails)
          OR auth.uid()   = ANY(conv_uids)
    )
  );

DROP POLICY IF EXISTS "dm_poll_votes: own insert" ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own insert"
  ON public.dm_poll_votes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "dm_poll_votes: own update" ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own update"
  ON public.dm_poll_votes FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "dm_poll_votes: own delete" ON public.dm_poll_votes;
CREATE POLICY "dm_poll_votes: own delete"
  ON public.dm_poll_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT ON public.dm_polls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_poll_votes TO authenticated;

-- cast_dm_poll_vote RPC — rewritten with CTE-renamed participant lookup
-- so there are no `c.id` / `p.id` 2-char paste-risk tokens in the body.
CREATE OR REPLACE FUNCTION public.cast_dm_poll_vote(
  p_poll_id   UUID,
  p_option_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_emails TEXT[];
  v_uids   UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_poll_id IS NULL OR p_option_id IS NULL THEN
    RAISE EXCEPTION 'poll_id and option_id required' USING ERRCODE = '22023';
  END IF;

  SELECT participant_emails, participant_ids
    INTO v_emails, v_uids
    FROM public.hub_conversations
   WHERE id = (SELECT conversation_id FROM public.dm_polls WHERE id = p_poll_id);

  IF v_emails IS NULL OR NOT (auth.email() = ANY(v_emails) OR v_uid = ANY(v_uids)) THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.dm_poll_votes (poll_id, user_id, option_id)
  VALUES (p_poll_id, v_uid, p_option_id)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now();
END;
$$;

REVOKE ALL    ON FUNCTION public.cast_dm_poll_vote(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_dm_poll_vote(UUID, TEXT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 149_gym_checkins.sql ──
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gym_checkins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, gym_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS gym_checkins_user_date_idx
  ON public.gym_checkins (user_id, checkin_date DESC);

ALTER TABLE public.gym_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_checkins: owner select" ON public.gym_checkins;
CREATE POLICY "gym_checkins: owner select"
  ON public.gym_checkins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.gym_checkins TO authenticated;

CREATE OR REPLACE FUNCTION public.check_in_to_gym(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_gym_id UUID;
  v_name   TEXT;
  v_today  DATE := (now() AT TIME ZONE 'UTC')::date;
  v_rows   INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_REQUIRED');
  END IF;

  SELECT id, name INTO v_gym_id, v_name
    FROM public.gym_businesses
   WHERE flexyn_code = upper(btrim(p_code)) AND is_active = TRUE;

  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'GYM_NOT_FOUND');
  END IF;

  INSERT INTO public.gym_checkins (user_id, gym_id, checkin_date)
    VALUES (v_uid, v_gym_id, v_today)
    ON CONFLICT (user_id, gym_id, checkin_date) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',       true,
    'gym_id',   v_gym_id,
    'gym_name', v_name,
    'already',  v_rows = 0
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.check_in_to_gym(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_to_gym(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_gym_checkin_today()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gym_checkins
     WHERE user_id = auth.uid()
       AND checkin_date = (now() AT TIME ZONE 'UTC')::date
  );
$$;

REVOKE ALL    ON FUNCTION public.has_gym_checkin_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_gym_checkin_today() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 149_live_activity_rail_email_column.sql (paste-safe) ──
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_followees()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  avatar_url   TEXT,
  active_until TIMESTAMPTZ,
  email        TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

  RETURN QUERY
    WITH following AS (
      SELECT followee_email AS f_email
        FROM public.hub_follows
       WHERE follower_email = v_email
    )
    SELECT id, username, avatar_url, active_until, email
      FROM public.user_profiles
      JOIN following ON f_email = email
     WHERE active_until > now()
     ORDER BY active_until DESC
     LIMIT 50;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_active_followees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_followees() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 150_gym_approval_geo_optional.sql (paste-safe) ──
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_businesses'
                AND column_name='latitude' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE public.gym_businesses ALTER COLUMN latitude  DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='gym_businesses'
                AND column_name='longitude' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE public.gym_businesses ALTER COLUMN longitude DROP NOT NULL';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT (username IN ('kegan', 'sean', 'admin')) INTO v_is_admin
    FROM public.user_profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT status, owner_id, business_name, street_address, city, state_code,
         postal_code, country_code, latitude, longitude, phone, website_url
    INTO v_status, v_owner_id, v_business_name, v_street, v_city, v_state,
         v_postal, v_country, v_lat, v_lng, v_phone, v_website
    FROM public.gym_verification_queue
   WHERE id = p_verif_id;

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

  UPDATE public.gym_verification_queue
     SET status = 'approved'
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════
-- ── 150_gym_consistency_leaderboard.sql ──
-- ═══════════════════════════════════════════════════════════════════

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
#variable_conflict use_column
BEGIN
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


-- ═══════════════════════════════════════════════════════════════════
-- ── 151_signature_trophy.sql ──
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signature_trophy TEXT DEFAULT NULL;


-- ═══════════════════════════════════════════════════════════════════
-- ── 152_bounty_economy_integrity.sql (superseded by 154; included for
-- ── deploy-order completeness; idempotent CREATE OR REPLACE) ──
-- ═══════════════════════════════════════════════════════════════════

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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  SELECT status, bounty_id INTO v_claim_status, v_bounty_id
    FROM public.bounty_claims
   WHERE id = p_claim_id AND claimant_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'  USING ERRCODE = '22023'; END IF;
  IF v_claim_status <> 'active' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '22023'; END IF;

  SELECT metric::text, exercise_name, target_value, reward
    INTO v_metric, v_exercise, v_target, v_reward
    FROM public.bounties WHERE id = v_bounty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found' USING ERRCODE = '22023'; END IF;

  SELECT user_id, exercises INTO v_log_owner, v_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF NOT FOUND OR v_log_owner <> v_user_id THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;

  IF v_metric IN ('session_volume', 'weekly_volume') THEN
    v_achieved := public._duel_calc_volume(v_exercises);
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

-- mig 152's bounty insert policy. Superseded by mig 154's stricter
-- version below; included here so a re-run leaves you in a known
-- intermediate state before 154 tightens it.
DROP POLICY IF EXISTS "bounties_insert" ON public.bounties;
CREATE POLICY "bounties_insert"
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL AND (
      (difficulty = 'easy'   AND entry_fee = 10 AND reward = 60)  OR
      (difficulty = 'medium' AND entry_fee = 15 AND reward = 100) OR
      (difficulty = 'hard'   AND entry_fee = 20 AND reward = 175)
    )
  );


-- ═══════════════════════════════════════════════════════════════════
-- ── 153_custom_quotes.sql ──
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.custom_quotes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  author     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_quotes_user_idx
  ON public.custom_quotes (user_id, created_at);

ALTER TABLE public.custom_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_quotes: owner all" ON public.custom_quotes;
CREATE POLICY "custom_quotes: owner all"
  ON public.custom_quotes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.custom_quotes TO authenticated;


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

-- ====================================================================
-- ==== SECTION B: migration 156 (HR actor dedup) =====================
-- ====================================================================
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

-- ====================================================================
-- ==== SECTION C: migration 157 (profanity + notify hardening) =======
-- ====================================================================
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
