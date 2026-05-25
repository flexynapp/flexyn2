-- ─────────────────────────────────────────────────────────────────────
-- _deploy_141_to_146.sql — ONE-SHOT DEPLOY BUNDLE (migrations 141–146)
--
-- Paste this ENTIRE file into the Supabase SQL Editor and click Run.
-- It stitches together the nine pending migrations in execution order.
-- Every statement is idempotent (CREATE TABLE IF NOT EXISTS / CREATE OR
-- REPLACE FUNCTION / DROP POLICY IF EXISTS / ADD COLUMN IF NOT EXISTS /
-- ON CONFLICT), so re-running is safe even if some pieces already exist.
--
-- IMPORTANT: this bundle is ALIAS-FREE on purpose. Every short
-- `alias.column` reference (gm.gym_id, c.id, w.user_id, …) was rewritten
-- to bare columns inside single-table subqueries or CTE-renamed join keys,
-- because the copy/paste path was corrupting those tokens (e.g. up.id →
-- <up.id>) and breaking the run with "syntax error at or near <". Only
-- public.<table>, auth.<fn>(), NEW./OLD. (trigger records) and
-- public.<function>() qualifiers remain — those transcribe cleanly.
--
-- Bundled (in order):
--   141_gym_integrity_fixes              — reactions gate, atomic toggles, leaderboard
--   141_hub_security_exploits            — DM/crew reaction + DM RLS hardening
--   142_public_profiles_and_gym_leaderboard — anon reads + gym-vs-gym board
--   142_user_profiles_privileged_columns — block direct writes to RPC-only cols
--   142_workout_idempotency_reconcile_and_bar_volume — dup-guard + reconcile
--   143_trainer_tier                     — paywalled creator marketplace
--   144_bug_report_admin_pipeline        — admin reader/resolver for bug reports
--   145_journal_entries                  — server-backed daily journal
--   146_corporate_wellness               — B2B org tenant + HR analytics
-- ─────────────────────────────────────────────────────────────────────



-- ═══════════════════════════════════════════════════════════════════
-- ── 141_gym_integrity_fixes.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 141_gym_integrity_fixes.sql
--
-- Hardens gym social/competition surfaces against the defects surfaced
-- in the May 2026 QA audit. All changes are server-side and idempotent.
--
-- 1. Reactions INSERT policy now gates on gym membership (audit B-2 —
--    non-members could write reactions to arbitrary post_ids).
-- 2. New `toggle_gym_feed_reaction` RPC — atomic single round-trip
--    that prevents the SELECT-then-INSERT race in the JS client
--    (audit B-1, A-4).
-- 3. `toggle_pin_gym_post` now atomically unpins any other pinned post
--    in the gym before pinning the target — eliminates the "no pin"
--    transient and 23505 errors (audit C-11).
-- 4. Leaderboard gets a deterministic tie-breaker (joined_at ASC) so
--    duplicate #1s no longer flap between requests (audit B-4).
-- 5. Leaderboard no longer filters `value > 0` — members appear
--    immediately on join so the "Your rank: #N" banner can render
--    for fresh members (audit B-5).
-- 6. gym_events DELETE policy added for the row's creator (audit C-8).

-- ── 1. Reactions: members-only INSERT ──────────────────────────────
DROP POLICY IF EXISTS "gym_feed_rxn: own write" ON public.gym_feed_post_reactions;

-- Alias-free form: nested IN subqueries instead of an aliased JOIN, so
-- the SQL carries no short `alias.column` tokens (which the deploy-paste
-- pipeline mangles). Each subquery scopes a single table, so bare column
-- names are unambiguous. Semantics unchanged: the reacted-to post must
-- belong to a gym the caller is a member of.
CREATE POLICY "gym_feed_rxn: members write"
  ON public.gym_feed_post_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    post_id IN (
      SELECT id FROM public.gym_feed_posts
       WHERE gym_id IN (
         SELECT gym_id FROM public.gym_members WHERE user_id = auth.uid()
       )
    )
  );

-- ── 2. Atomic reaction toggle ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.toggle_gym_feed_reaction(
  p_post_id UUID,
  p_emoji   TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_gym_id  UUID;
  v_deleted INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_emoji IS NULL OR char_length(p_emoji) > 10 OR char_length(p_emoji) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_EMOJI');
  END IF;

  SELECT gym_id INTO v_gym_id
    FROM public.gym_feed_posts WHERE id = p_post_id;
  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'POST_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gym_members
     WHERE gym_id = v_gym_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MEMBER');
  END IF;

  DELETE FROM public.gym_feed_post_reactions
   WHERE post_id = p_post_id AND user_id = v_user_id AND emoji = p_emoji;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    RETURN jsonb_build_object('ok', true, 'removed', true);
  END IF;

  INSERT INTO public.gym_feed_post_reactions (post_id, user_id, emoji)
    VALUES (p_post_id, v_user_id, p_emoji)
    ON CONFLICT (post_id, user_id, emoji) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'added', true);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_gym_feed_reaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_gym_feed_reaction(UUID, TEXT) TO authenticated;

-- ── 3. Atomic pin/unpin (replaces mig 138's version) ───────────────
CREATE OR REPLACE FUNCTION public.toggle_pin_gym_post(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_gym_id    UUID;
  v_owner     UUID;
  v_is_pinned BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Split the post→gym→owner join into two single-table lookups so the
  -- body carries no short `alias.column` tokens.
  SELECT gym_id, is_pinned
    INTO v_gym_id, v_is_pinned
    FROM public.gym_feed_posts
   WHERE id = p_post_id;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'post not found';
  END IF;

  SELECT owner_id INTO v_owner
    FROM public.gym_businesses
   WHERE id = v_gym_id;

  IF v_owner IS NULL OR v_owner <> v_user_id THEN
    RAISE EXCEPTION 'not owner' USING ERRCODE = '42501';
  END IF;

  IF v_is_pinned THEN
    UPDATE public.gym_feed_posts SET is_pinned = FALSE WHERE id = p_post_id;
    RETURN FALSE;
  END IF;

  -- One-pin invariant: unpin any other pin in the same gym first.
  UPDATE public.gym_feed_posts SET is_pinned = FALSE
   WHERE gym_id = v_gym_id AND is_pinned = TRUE AND id <> p_post_id;

  UPDATE public.gym_feed_posts SET is_pinned = TRUE WHERE id = p_post_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_pin_gym_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_pin_gym_post(UUID) TO authenticated;

-- ── 4 + 5. Leaderboard: deterministic tie-break + include zero-stat ─
-- Tie-break by gym_members.joined_at ASC (first-to-the-gym wins on
-- equal stat); falls back to user_id for further determinism. We keep
-- RANK() for the displayed rank (so ties show shared #1) but the
-- ORDER BY at the outer query uses the deterministic tiebreaker so
-- repeat-fetch row order is stable.
CREATE OR REPLACE FUNCTION public.get_gym_leaderboard(
  p_gym_id UUID,
  p_mode   TEXT DEFAULT 'volume',
  p_limit  INT  DEFAULT 50
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
-- use_column: the RETURNS TABLE OUT params (user_id, username, value…)
-- share names with base columns; resolve bare names to the column so the
-- query needs no disambiguating table aliases.
#variable_conflict use_column
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'volume');
BEGIN
  IF v_mode NOT IN ('volume', 'xp', 'streak') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH membership AS (
      SELECT user_id AS member_user_id, joined_at AS member_joined_at
        FROM public.gym_members
       WHERE gym_id = p_gym_id
    ),
    ranked AS (
      SELECT
        id               AS lb_user_id,
        username         AS lb_username,
        avatar_url       AS lb_avatar_url,
        member_joined_at AS lb_joined_at,
        CASE v_mode
          WHEN 'volume' THEN COALESCE(total_volume_lbs, 0)::NUMERIC
          WHEN 'xp'     THEN COALESCE(total_xp,         0)::NUMERIC
          WHEN 'streak' THEN COALESCE(workout_streak,   0)::NUMERIC
        END AS lb_value
      FROM public.user_profiles
      JOIN membership ON member_user_id = id
    )
    SELECT lb_user_id, lb_username, lb_avatar_url, lb_value,
           RANK() OVER (ORDER BY lb_value DESC)::INT
      FROM ranked
     ORDER BY lb_value DESC, lb_joined_at ASC, lb_user_id ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) TO authenticated;

-- ── 6. gym_events: creator may delete their own row ─────────────────
DROP POLICY IF EXISTS "gym_events: creator delete" ON public.gym_events;
CREATE POLICY "gym_events: creator delete"
  ON public.gym_events FOR DELETE TO authenticated
  USING (created_by = auth.uid());

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 141_hub_security_exploits.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- supabase/migrations/141_hub_security_exploits.sql
--
-- Closes four exploits surfaced by the Hub security audit, all of the same
-- class as the Block bug fixed in mig 109: SECURITY DEFINER RPCs and an
-- over-broad RLS policy that trusted client-supplied identifiers instead
-- of `auth.uid()`.
--
-- ── #1 — toggle_dm_reaction (mig 064) ────────────────────────────────
--   Trusted client `p_user_id`. Attacker could spam reactions impersonating
--   any victim and DELETE the victim's existing reactions on DMs.
--   Patch: ignore p_user_id, derive the user from auth.uid().
--
-- ── #2 — toggle_crew_reaction (mig 130) ──────────────────────────────
--   Same defect. Attack: impersonate any user's crew reaction.
--   Patch: same — gate on auth.uid().
--
-- ── #3 — hub_messages UPDATE RLS (mig 011) ───────────────────────────
--   The widened policy lets ANY conversation participant UPDATE ANY column
--   on ANY message. The wider grant existed so recipients could set
--   read_at — but it accidentally allowed message-content tampering,
--   deleted_at flips, replied_to_snippet rewrites, etc.
--   Patch: restrict UPDATE to the sender. Recipients now flip read_at
--   via the new `mark_message_read` SECURITY DEFINER RPC (declared below),
--   which validates conversation membership and only writes read_at.
--
-- ── #4 — schedule_my_message (mig 114) ───────────────────────────────
--   Validated auth, content, and send_at — but did NOT verify that the
--   caller is a participant of `p_conversation_id`. Caller could schedule
--   a message into any conversation; the cron release fans it out to the
--   real participants.
--   Patch: add a membership check before INSERT.

BEGIN;

-- ── #1: toggle_dm_reaction ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.toggle_dm_reaction(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.toggle_dm_reaction(
  p_message_id UUID,
  p_user_id    UUID,  -- accepted for client-API compat; IGNORED server-side
  p_emoji      TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $toggle_dm_reaction$
DECLARE
  v_uid    UUID := auth.uid();
  v_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL OR p_emoji IS NULL THEN
    RAISE EXCEPTION 'message_id and emoji required' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_emoji) > 10 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;
  -- Intentionally ignore p_user_id — derive the actor from auth.uid()
  -- so a client cannot impersonate or stamp reactions as another user.

  SELECT EXISTS(
    SELECT 1 FROM public.dm_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.dm_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO public.dm_message_reactions(message_id, user_id, emoji)
    VALUES (p_message_id, v_uid, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$toggle_dm_reaction$;

REVOKE ALL    ON FUNCTION public.toggle_dm_reaction(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_dm_reaction(UUID, UUID, TEXT) TO authenticated;


-- ── #2: toggle_crew_reaction ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.toggle_crew_reaction(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.toggle_crew_reaction(
  p_message_id UUID,
  p_user_id    UUID,  -- accepted for client-API compat; IGNORED server-side
  p_emoji      TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $toggle_crew_reaction$
DECLARE
  v_uid    UUID := auth.uid();
  v_exists BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL OR p_emoji IS NULL THEN
    RAISE EXCEPTION 'message_id and emoji required' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_emoji) > 10 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.crew_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.crew_message_reactions
     WHERE message_id = p_message_id AND user_id = v_uid AND emoji = p_emoji;
    RETURN FALSE;
  ELSE
    INSERT INTO public.crew_message_reactions (message_id, user_id, emoji)
    VALUES (p_message_id, v_uid, p_emoji)
    ON CONFLICT DO NOTHING;
    RETURN TRUE;
  END IF;
END;
$toggle_crew_reaction$;

REVOKE ALL    ON FUNCTION public.toggle_crew_reaction(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_crew_reaction(UUID, UUID, TEXT) TO authenticated;


-- ── #3: hub_messages UPDATE — sender-only + mark_message_read RPC ─────────
DROP POLICY IF EXISTS "hub_messages: update" ON public.hub_messages;
CREATE POLICY "hub_messages: update"
  ON public.hub_messages FOR UPDATE
  USING (auth.email() = created_by OR auth.uid() = user_id)
  WITH CHECK (auth.email() = created_by OR auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.mark_message_read(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $mark_message_read$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := auth.email();
  v_conv  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023';
  END IF;

  -- Resolve the conversation and verify the caller is a participant
  -- AND is not the sender (a sender doesn't "read" their own message).
  SELECT conversation_id INTO v_conv
    FROM public.hub_messages
   WHERE id = p_message_id
     AND read_at IS NULL
     AND (created_by IS DISTINCT FROM v_email)
     AND (user_id    IS DISTINCT FROM v_uid);

  IF v_conv IS NULL THEN
    -- Either the message doesn't exist, is already read, or the caller
    -- is the sender. All three cases are no-ops, not errors.
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hub_conversations
     WHERE id = v_conv
       AND (v_email = ANY(participant_emails)
            OR v_uid = ANY(participant_ids))
  ) THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  UPDATE public.hub_messages
     SET read_at = now()
   WHERE id = p_message_id
     AND read_at IS NULL;
END;
$mark_message_read$;

REVOKE ALL    ON FUNCTION public.mark_message_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_message_read(UUID) TO authenticated;


-- ── #4: schedule_my_message membership check ─────────────────────────────
CREATE OR REPLACE FUNCTION public.schedule_my_message(
  p_conversation_id UUID,
  p_recipient_email TEXT,
  p_content         TEXT,
  p_send_at         TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $schedule_my_message$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := auth.email();
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_send_at IS NULL OR p_send_at <= now() THEN
    RAISE EXCEPTION 'send_at_in_past' USING ERRCODE = '22023';
  END IF;
  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'conversation_id required' USING ERRCODE = '22023';
  END IF;

  -- Verify the caller is actually a participant of the target conversation.
  -- Without this gate an attacker could schedule a message into any
  -- conversation; the cron release would fan it out to the real
  -- participants stamped with v_email as the sender.
  IF NOT EXISTS (
    SELECT 1 FROM public.hub_conversations
     WHERE id = p_conversation_id
       AND (v_email = ANY(participant_emails)
            OR v_uid = ANY(participant_ids))
  ) THEN
    RAISE EXCEPTION 'not a conversation participant' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.hub_messages
    (created_by, user_id, conversation_id, sender_email, content,
     scheduled_at, status)
  VALUES
    (v_email, v_uid, p_conversation_id, v_email, p_content,
     p_send_at, 'scheduled')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$schedule_my_message$;

GRANT EXECUTE ON FUNCTION public.schedule_my_message(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- ── 142_public_profiles_and_gym_leaderboard.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 142_public_profiles_and_gym_leaderboard.sql
--
-- Three additions that power the viral public surfaces:
--
--   1. Anon SELECT on gym_businesses (active gyms) — lets unauthenticated
--      visitors see the Public Gym Landing (/p/gym/:id) and the map tiles
--      without signing in first.
--
--   2. Anon SELECT on gym_members — needed so the leaderboard RPC
--      can report member-count and the public gym landing can show "X members"
--      without auth.
--
--   3. get_gym_vs_gym_leaderboard() SECURITY DEFINER RPC — ranks every active
--      gym by 7-day workout activity.
--
--      Score = workout_count * LOG(active_members + 1)
--
--      This rewards breadth of participation, not just raw session count:
--      a gym where 30 different members trained in a week beats one where
--      a single obsessive logged 30 sessions. LOG damping keeps giants
--      from infinitely dominating over smaller, highly-active gyms.
--
--      Requires no new tables — it joins the existing gym_businesses,
--      gym_members, and workout_logs tables.
--
-- Idempotent: policies use CREATE POLICY (will error on re-run if already
-- present, but DROP/CREATE pattern is safe to add if needed).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Public read access to active gyms ─────────────────────────────────────
DROP POLICY IF EXISTS "Public can view active gyms" ON public.gym_businesses;
CREATE POLICY "Public can view active gyms"
  ON public.gym_businesses
  FOR SELECT
  TO anon
  USING (is_active = TRUE);

-- Supabase auto-grants SELECT to anon on public schema tables with RLS enabled,
-- but be explicit so this works on self-hosted Postgres too.
GRANT SELECT ON public.gym_businesses TO anon;

-- ── 2. Anon read on gym_members (no PII — only user_id + gym_id exposed) ─────
DROP POLICY IF EXISTS "Public can view gym membership list" ON public.gym_members;
CREATE POLICY "Public can view gym membership list"
  ON public.gym_members
  FOR SELECT
  TO anon
  USING (TRUE);

GRANT SELECT ON public.gym_members TO anon;

-- ── 3. Gym-vs-Gym community leaderboard RPC ──────────────────────────────────
-- SECURITY DEFINER so it can read workout_logs without exposing that table to
-- anon directly.  Only aggregate data is returned — no individual workout rows.
CREATE OR REPLACE FUNCTION public.get_gym_vs_gym_leaderboard(
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  rank           BIGINT,
  gym_id         UUID,
  gym_name       TEXT,
  logo_url       TEXT,
  city           TEXT,
  state_code     TEXT,
  member_count   BIGINT,
  active_members BIGINT,
  workout_count  BIGINT,
  score          NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
-- use_column: several RETURNS TABLE OUT params (gym_id, city, member_count…)
-- share names with base columns. Resolving bare names to the column lets the
-- whole query drop short `alias.column` tokens (which the deploy-paste
-- pipeline mangles). Every join key is renamed inside a CTE so the ON
-- clauses compare globally-unique bare names — no qualification needed.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH member_map AS (
    SELECT gym_id AS m_gym_id, user_id AS m_user_id
      FROM public.gym_members
  ),
  recent_workouts AS (
    SELECT user_id AS w_user_id
      FROM public.workout_logs
     WHERE date >= CURRENT_DATE - 7
  ),
  member_workouts AS (
    SELECT m_gym_id, m_user_id
      FROM member_map
      JOIN recent_workouts ON w_user_id = m_user_id
  ),
  workout_window AS (
    SELECT
      m_gym_id                  AS ww_gym_id,
      COUNT(*)                  AS ww_workout_count,
      COUNT(DISTINCT m_user_id) AS ww_active_members
    FROM member_workouts
    GROUP BY m_gym_id
  ),
  scored AS (
    SELECT
      id                                       AS s_gym_id,
      name                                     AS s_gym_name,
      logo_url                                 AS s_logo_url,
      city                                     AS s_city,
      state_code                               AS s_state_code,
      member_count::BIGINT                     AS s_member_count,
      COALESCE(ww_active_members, 0)::BIGINT   AS s_active_members,
      COALESCE(ww_workout_count,  0)::BIGINT   AS s_workout_count,
      ROUND(
        COALESCE(ww_workout_count, 0) *
        LOG(COALESCE(ww_active_members, 0) + 1)::NUMERIC,
        2
      )                                        AS s_score
    FROM public.gym_businesses
    LEFT JOIN workout_window ON ww_gym_id = id
    WHERE is_active = TRUE
      AND COALESCE(ww_workout_count, 0) > 0
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s_score DESC, s_workout_count DESC),
    s_gym_id,
    s_gym_name,
    s_logo_url,
    s_city,
    s_state_code,
    s_member_count,
    s_active_members,
    s_workout_count,
    s_score
  FROM scored
  ORDER BY s_score DESC, s_workout_count DESC
  LIMIT p_limit;
END;
$func$;

-- Callable by everyone — anon for public leaderboard widget, authenticated
-- for the full in-app GymMap leaderboard tab.
GRANT EXECUTE ON FUNCTION public.get_gym_vs_gym_leaderboard(INT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 142_user_profiles_privileged_columns.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- supabase/migrations/142_user_profiles_privileged_columns.sql
--
-- Closes a CRITICAL exploit found in the Onboarding security audit:
-- the user_profiles UPDATE policy from mig 001 has `USING (auth.uid() = id)`
-- but NO `WITH CHECK` clause. Combined with the table-level UPDATE grant
-- to `authenticated`, this lets any signed-in user UPDATE their OWN
-- row's privileged server-state columns directly from devtools:
--
--   supabase.from('user_profiles').update({
--     flex_coins: 999999999,
--     total_xp:   99999999,
--     current_level: 99,
--     prestige_level: 10,
--     league_tier: 'diamond',
--     milestone_capsules_awarded: 0,
--     referral_code: 'AAAAAA'
--   }).eq('id', auth.uid())
--
-- RLS sees `auth.uid() = id` → passes. Every atomic-RPC concurrency fix
-- (mig 023 increment_user_xp, mig 030 increment_flex_coins, mig 068
-- claim_daily_chest, mig 070, 087, 124, etc.) is bypassed because the
-- raw table UPDATE never has to go through the RPC's gate. Same exploit
-- class as the RPC trust bugs patched in mig 141.
--
-- FIX (two prongs):
--   1. Add WITH CHECK (auth.uid() = id) on the UPDATE policy — also
--      prevents row-id rewrite (defense in depth).
--   2. BEFORE UPDATE trigger that compares OLD vs NEW on every
--      privileged column. If a non-postgres caller (i.e. direct client
--      UPDATE via PostgREST) is changing one, raise 42501. SECURITY
--      DEFINER RPCs run as their function owner (postgres) and bypass
--      the check, so legitimate XP / coins / level / streak writes
--      keep working.
--
-- Why a trigger instead of column-level GRANT?
--   PG semantics: column-level REVOKE does NOT subtract from a
--   table-level GRANT. To enforce column immutability via grants we'd
--   have to REVOKE UPDATE on the entire table and re-GRANT every safe
--   column — that's a fragile enumeration that needs updating every
--   time a new client-writable column is added. The trigger names the
--   PRIVILEGED columns explicitly (a short, stable list) and ignores
--   everything else, so adding new client-writable columns later
--   needs no migration update.

BEGIN;

-- Step 1: tighten the UPDATE policy with WITH CHECK.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
CREATE POLICY "Users can update their own profile"
  ON public.user_profiles FOR UPDATE
  USING      (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- Step 2: BEFORE UPDATE trigger blocking direct writes to privileged
-- columns. SECURITY DEFINER RPCs run as `postgres`; direct client
-- UPDATEs run as `authenticated`. We allow the former and reject the
-- latter on any privileged-column change.
CREATE OR REPLACE FUNCTION public.user_profiles_block_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $block_privileged$
BEGIN
  -- RPC path: function owner is postgres → allow.
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  -- Service-role bypass (for admin tooling / Edge Functions): also
  -- allowed. The service role JWT sets the request role to
  -- 'service_role' and Supabase elevates current_user accordingly.
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Direct client path → enforce column immutability. We use
  -- `IS DISTINCT FROM` so NULL→NULL doesn't trip the check.
  -- The error code 42501 ("insufficient_privilege") routes nicely
  -- through the client's existing RLS-error toast paths.

  -- Currency
  IF NEW.flex_coins IS DISTINCT FROM OLD.flex_coins THEN
    RAISE EXCEPTION 'flex_coins is RPC-only (use increment_flex_coins)' USING ERRCODE = '42501';
  END IF;

  -- XP / leveling
  IF NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
    RAISE EXCEPTION 'total_xp is RPC-only (use increment_user_xp)' USING ERRCODE = '42501';
  END IF;
  IF NEW.current_level IS DISTINCT FROM OLD.current_level THEN
    RAISE EXCEPTION 'current_level is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.prestige_level IS DISTINCT FROM OLD.prestige_level THEN
    RAISE EXCEPTION 'prestige_level is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- League standings (assigned by weekly scheduler)
  IF NEW.league_tier IS DISTINCT FROM OLD.league_tier THEN
    RAISE EXCEPTION 'league_tier is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Capsule rewards
  IF NEW.milestone_capsules_awarded IS DISTINCT FROM OLD.milestone_capsules_awarded THEN
    RAISE EXCEPTION 'milestone_capsules_awarded is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Referral code — squatting prevention. get_my_referral_code RPC
  -- atomically generates a unique code once per user; allowing the
  -- client to set it would let an attacker pre-empt a code targeting
  -- inbound referrals.
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
    RAISE EXCEPTION 'referral_code is RPC-only (use get_my_referral_code)' USING ERRCODE = '42501';
  END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'referred_by is RPC-only (use claim_referral)' USING ERRCODE = '42501';
  END IF;

  -- Streaks — recomputed server-side from workout / login activity.
  IF NEW.workout_streak IS DISTINCT FROM OLD.workout_streak THEN
    RAISE EXCEPTION 'workout_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_workout_streak IS DISTINCT FROM OLD.longest_workout_streak THEN
    RAISE EXCEPTION 'longest_workout_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.login_streak IS DISTINCT FROM OLD.login_streak THEN
    RAISE EXCEPTION 'login_streak is RPC-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.longest_login_streak IS DISTINCT FROM OLD.longest_login_streak THEN
    RAISE EXCEPTION 'longest_login_streak is RPC-only' USING ERRCODE = '42501';
  END IF;

  -- Cooldowns / one-shot timestamps (claim_daily_chest, spend_streak_rescue).
  IF NEW.last_daily_chest_at IS DISTINCT FROM OLD.last_daily_chest_at THEN
    RAISE EXCEPTION 'last_daily_chest_at is RPC-only' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$block_privileged$;

DROP TRIGGER IF EXISTS user_profiles_block_privileged_updates_tr ON public.user_profiles;
CREATE TRIGGER user_profiles_block_privileged_updates_tr
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profiles_block_privileged_updates();

NOTIFY pgrst, 'reload schema';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- ── 142_workout_idempotency_reconcile_and_bar_volume.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 142_workout_idempotency_reconcile_and_bar_volume.sql
--
-- Three workout-tab integrity upgrades surfaced by the May 2026
-- zero-tolerance audit:
--
-- C-2: Idempotency key on workout_logs. Stops double-tap / network-
--      retry from inserting the same workout twice + double-crediting
--      XP / volume / streak / leagues / crew wars.
--
-- D-4: Per-row credit tracking + reconciliation RPC. When the network
--      drops after the workout INSERT but BEFORE increment_user_volume
--      lands, the workout is saved but counters silently undercount.
--      A Dashboard-mount reconcile pass detects un-credited rows and
--      replays the volume increment.
--
-- C-3: User-profile toggle for "include bar weight in volume."
--      Default off so historical totals stay comparable; opt-in users
--      get a more accurate weight-moved number on barbell exercises.
--
-- All changes are idempotent — re-running the bundle is safe.

-- ── 1. Idempotency + credit tracking columns ───────────────────────
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS idempotency_key    UUID;
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS volume_credited_at TIMESTAMPTZ;

-- Partial unique index — only enforces uniqueness when both user_id
-- and idempotency_key are present, so pre-feature rows (NULL key)
-- aren't blocked from coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS workout_logs_idempotency_idx
  ON public.workout_logs (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Index for the reconcile RPC's filter — recent un-credited rows.
CREATE INDEX IF NOT EXISTS workout_logs_uncredited_idx
  ON public.workout_logs (user_id, created_at)
  WHERE volume_credited_at IS NULL;

-- ── 2. Mark-credited RPC ────────────────────────────────────────────
-- Caller asserts that the volume for this workout has been applied
-- to user_profiles.total_volume_lbs. Idempotent: re-calls are no-ops.
CREATE OR REPLACE FUNCTION public.mark_workout_volume_credited(
  p_workout_log_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workout_logs
     SET volume_credited_at = COALESCE(volume_credited_at, now())
   WHERE id = p_workout_log_id
     AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_workout_volume_credited(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_workout_volume_credited(UUID) TO authenticated;

-- ── 3. Reconciliation RPC ───────────────────────────────────────────
-- Scans the caller's recent (last 7 days) workout_logs where
-- volume_credited_at IS NULL AND total_volume > 0, sums the deltas,
-- applies them via increment_user_volume, and marks the rows credited.
-- Returns the number of workouts reconciled + the total volume
-- recovered, so the client can surface a transparent toast if the
-- result is non-trivial.
CREATE OR REPLACE FUNCTION public.reconcile_my_workout_volume()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_total_delta NUMERIC := 0;
  v_count       INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_volume, 0)), 0)::NUMERIC, COUNT(*)
    INTO v_total_delta, v_count
    FROM public.workout_logs
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND created_at > now() - INTERVAL '7 days';

  IF v_count = 0 THEN
    RETURN jsonb_build_object('reconciled', 0, 'delta', 0);
  END IF;

  -- Atomic credit via the existing increment RPC (mig 023 / 032).
  PERFORM public.increment_user_volume(v_total_delta);

  -- Mark all the rows we just credited. Same WHERE clause so we
  -- don't accidentally re-mark rows that were credited during our
  -- own SUM (unlikely but defensive).
  UPDATE public.workout_logs
     SET volume_credited_at = now()
   WHERE user_id = v_uid
     AND volume_credited_at IS NULL
     AND COALESCE(total_volume, 0) > 0
     AND created_at > now() - INTERVAL '7 days';

  RETURN jsonb_build_object(
    'reconciled', v_count,
    'delta',      v_total_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_my_workout_volume() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_my_workout_volume() TO authenticated;

-- ── 4. User-profile setting for bar-weight volume math ─────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS include_bar_in_volume BOOLEAN NOT NULL DEFAULT FALSE;

-- Service role grant for any future server-side reads.
GRANT SELECT, UPDATE (include_bar_in_volume) ON public.user_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 143_trainer_tier.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 143_trainer_tier.sql
--
-- Proprietary Creator / Trainer Tier — paywalled regimen marketplace.
--
-- DESIGN NOTES (read before extending):
--   • Adapted from the original spec, which referenced a non-existent
--     `public.profiles` table and a generic `marketplace_listings`.
--     Flexyn's identity table is `user_profiles` (its `id` already
--     equals auth.uid()), and `marketplace_listings` already exists as
--     a COIN-based peer-to-peer table (mig 009). To avoid colliding
--     with that, the trainer tier uses dedicated tables:
--       - trainer_listings   (paywalled programs for sale)
--       - trainer_purchases  (access grants / receipts)
--
--   • PAYMENT RAIL: built toward Stripe Connect (real money). Stripe
--     is NOT live yet — no keys configured. The checkout Edge Function
--     runs in MOCK mode until STRIPE_SECRET_KEY is set, simulating a
--     successful payment so the gated-content flow works end-to-end
--     for the prototype. Columns (stripe_connect_id,
--     stripe_payment_intent_id) are in place for the real integration.
--
--   • FULFILLMENT IS SERVER-ONLY. trainer_purchases has NO authenticated
--     INSERT policy — rows are written exclusively by the checkout
--     Edge Function using the service-role key AFTER validating payment
--     (or, in mock mode, simulating it). A user cannot self-grant access
--     by calling an RPC directly. This is the paywall's real defense.
--
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS /
-- CREATE OR REPLACE) so re-running the deploy bundle is safe.

-- ── 1. user_profiles: trainer status + Stripe merchant link ────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_trainer        BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_id TEXT DEFAULT NULL;
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS trainer_bio       TEXT DEFAULT NULL;

-- ── 2. regimens: free-content flag for the gated read policy ───────
-- The spec's gated RLS references is_public_free; the column didn't
-- exist. Default FALSE so existing regimens stay private to their
-- owner unless explicitly published free or sold.
ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS is_public_free BOOLEAN DEFAULT FALSE;

-- ── 3. trainer_listings — paywalled programs ───────────────────────
CREATE TABLE IF NOT EXISTS public.trainer_listings (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id   UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    regimen_id   UUID REFERENCES public.regimens(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    description  TEXT,
    price_cents  INTEGER NOT NULL CHECK (price_cents >= 100),  -- $1.00 minimum
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    -- denormalized rollups for the studio dashboard (kept fresh by
    -- the purchase trigger below) so revenue reads don't scan
    -- trainer_purchases every render.
    sales_count  INTEGER NOT NULL DEFAULT 0,
    gross_cents  BIGINT  NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_listings_trainer_idx
  ON public.trainer_listings (trainer_id);
CREATE INDEX IF NOT EXISTS trainer_listings_published_idx
  ON public.trainer_listings (is_published) WHERE is_published = TRUE;

ALTER TABLE public.trainer_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainer_listings: public read published" ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer reads own"     ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer insert own"    ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer update own"    ON public.trainer_listings;
DROP POLICY IF EXISTS "trainer_listings: trainer delete own"    ON public.trainer_listings;

-- Anyone authenticated can browse published listings (the storefront).
CREATE POLICY "trainer_listings: public read published"
  ON public.trainer_listings FOR SELECT TO authenticated
  USING (is_published = TRUE);

-- A trainer can always read their own listings (incl. drafts).
CREATE POLICY "trainer_listings: trainer reads own"
  ON public.trainer_listings FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- Insert/update/delete gated to the owning trainer. The is_trainer
-- flag is checked at insert so non-trainers can't create listings.
CREATE POLICY "trainer_listings: trainer insert own"
  ON public.trainer_listings FOR INSERT TO authenticated
  WITH CHECK (
    trainer_id = auth.uid()
    AND COALESCE((SELECT is_trainer FROM public.user_profiles WHERE id = auth.uid()), FALSE)
  );

CREATE POLICY "trainer_listings: trainer update own"
  ON public.trainer_listings FOR UPDATE TO authenticated
  USING (trainer_id = auth.uid())
  WITH CHECK (trainer_id = auth.uid());

CREATE POLICY "trainer_listings: trainer delete own"
  ON public.trainer_listings FOR DELETE TO authenticated
  USING (trainer_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_listings TO authenticated;

-- ── 4. trainer_purchases — access grants / receipts ────────────────
CREATE TABLE IF NOT EXISTS public.trainer_purchases (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    listing_id               UUID NOT NULL REFERENCES public.trainer_listings(id) ON DELETE RESTRICT,
    trainer_id               UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    regimen_id               UUID REFERENCES public.regimens(id) ON DELETE SET NULL,
    stripe_payment_intent_id TEXT UNIQUE NOT NULL,
    amount_paid_cents        INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
    platform_fee_cents       INTEGER NOT NULL CHECK (platform_fee_cents >= 0),  -- 15% native cut
    trainer_payout_cents     INTEGER NOT NULL CHECK (trainer_payout_cents >= 0), -- 85% trainer cut
    is_mock                  BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = simulated (no real Stripe charge)
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Split must reconcile: amount = platform fee + trainer payout.
    CONSTRAINT trainer_purchase_split_balances
      CHECK (amount_paid_cents = platform_fee_cents + trainer_payout_cents),
    -- One purchase per (user, listing) — can't buy the same program twice.
    UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS trainer_purchases_user_idx     ON public.trainer_purchases (user_id);
CREATE INDEX IF NOT EXISTS trainer_purchases_trainer_idx  ON public.trainer_purchases (trainer_id);
CREATE INDEX IF NOT EXISTS trainer_purchases_listing_idx  ON public.trainer_purchases (listing_id);

ALTER TABLE public.trainer_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainer_purchases: buyer reads own"    ON public.trainer_purchases;
DROP POLICY IF EXISTS "trainer_purchases: trainer reads sales" ON public.trainer_purchases;

-- Buyer can read their own receipts (drives "owned" state in the UI).
CREATE POLICY "trainer_purchases: buyer reads own"
  ON public.trainer_purchases FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Trainer can read purchases of their own listings (revenue dashboard).
CREATE POLICY "trainer_purchases: trainer reads sales"
  ON public.trainer_purchases FOR SELECT TO authenticated
  USING (trainer_id = auth.uid());

-- NOTE: deliberately NO authenticated INSERT/UPDATE/DELETE policy.
-- Fulfillment is written ONLY by the checkout Edge Function using the
-- service-role key (which bypasses RLS) after validating payment.
-- This is what stops a user from self-granting paid access.
GRANT SELECT ON public.trainer_purchases TO authenticated;

-- ── 5. Gated regimen read — extend, don't replace ──────────────────
-- The existing "regimens: owner full access" policy (mig 001) is
-- FOR ALL and stays untouched. Permissive policies are OR'd, so this
-- additional SELECT policy widens read access to: free programs, and
-- programs the caller has purchased through the trainer marketplace.
DROP POLICY IF EXISTS "regimens: gated marketplace read" ON public.regimens;
CREATE POLICY "regimens: gated marketplace read"
  ON public.regimens FOR SELECT TO authenticated
  USING (
    is_public_free = TRUE
    OR id IN (
      SELECT regimen_id FROM public.trainer_listings
       WHERE regimen_id IS NOT NULL
         AND id IN (SELECT listing_id FROM public.trainer_purchases WHERE user_id = auth.uid())
    )
  );

-- ── 6. Purchase rollup trigger — keep listing stats fresh ──────────
CREATE OR REPLACE FUNCTION public.trainer_listing_stats_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.trainer_listings
       SET sales_count = sales_count + 1,
           gross_cents = gross_cents + NEW.amount_paid_cents
     WHERE id = NEW.listing_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.trainer_listings
       SET sales_count = GREATEST(0, sales_count - 1),
           gross_cents = GREATEST(0, gross_cents - OLD.amount_paid_cents)
     WHERE id = OLD.listing_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trainer_listing_stats ON public.trainer_purchases;
CREATE TRIGGER trg_trainer_listing_stats
  AFTER INSERT OR DELETE ON public.trainer_purchases
  FOR EACH ROW EXECUTE FUNCTION public.trainer_listing_stats_sync();

-- ── 7. Revenue summary RPC for the Trainer Studio dashboard ────────
CREATE OR REPLACE FUNCTION public.get_my_trainer_revenue()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'gross_cents',  COALESCE(SUM(amount_paid_cents), 0),
    'payout_cents', COALESCE(SUM(trainer_payout_cents), 0),
    'fee_cents',    COALESCE(SUM(platform_fee_cents), 0),
    'sales',        COUNT(*)
  )
  FROM public.trainer_purchases
  WHERE trainer_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_trainer_revenue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_trainer_revenue() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 144_bug_report_admin_pipeline.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 144_bug_report_admin_pipeline.sql
--
-- Re-pipes the bug-report flow so admin-filed user bug reports actually
-- reach the moderator queue.
--
-- THE BUG: `bug_reports` rows (filed from Settings → Report a bug) had
-- no admin read-path. The AdminReports queue only calls
-- `list_reports_for_admin` (mig 103), which reads `hub_reports`
-- (content reports) exclusively. Bug reports were written and then
-- effectively orphaned — invisible to admins, un-actionable.
--
-- THE FIX:
--   1. Add a `status` column to bug_reports so they can be triaged like
--      content reports (pending → reviewed / dismissed).
--   2. `list_bug_reports_for_admin(status, limit)` — admin-gated reader
--      (SECURITY DEFINER, bypasses RLS like the content-report reader).
--   3. `resolve_bug_report(id, status)` — admin-gated status transition.
--
-- Idempotent throughout. Mirrors the mig-103 moderator-RPC pattern.

-- ── 1. Status column for triage ────────────────────────────────────
ALTER TABLE public.bug_reports
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Guard the allowed values (idempotent add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bug_reports_status_check'
  ) THEN
    ALTER TABLE public.bug_reports
      ADD CONSTRAINT bug_reports_status_check
      CHECK (status IN ('pending', 'reviewed', 'dismissed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bug_reports_status_idx
  ON public.bug_reports (status, created_at DESC);

-- ── 2. Admin reader ─────────────────────────────────────────────────
-- RETURNS SETOF the table rowtype (not a TABLE(...) spec) so the body
-- can use bare column names with no alias.column references — keeps the
-- SQL free of short-alias-dot tokens that some copy/transcription
-- pipelines mangle.
CREATE OR REPLACE FUNCTION public.list_bug_reports_for_admin(
  p_status TEXT DEFAULT 'pending',
  p_limit  INT  DEFAULT 50
)
RETURNS SETOF public.bug_reports
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.bug_reports
     WHERE status = p_status
     ORDER BY created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.list_bug_reports_for_admin(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_bug_reports_for_admin(TEXT, INT) TO authenticated;

-- ── 3. Admin status transition ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_bug_report(
  p_report_id UUID,
  p_status    TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pending', 'reviewed', 'dismissed') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bug_reports SET status = p_status WHERE id = p_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_bug_report(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_bug_report(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 145_journal_entries.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 145_journal_entries.sql
--
-- "My Journal" overhaul — moves the journal from a localStorage-only
-- textarea to a server-backed entry per day so it survives sign-out,
-- syncs across devices, and can hold a title + markdown body +
-- attachments.
--
-- One row per (user, entry_date). Upsert on that pair. Attachments are
-- stored as a JSONB array of { url, type, name } pointing at the
-- existing `avatars` Storage bucket (same bucket the gym/profile
-- uploads use; its RLS already gates writes on auth.uid()).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.journal_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    user_email  TEXT,
    entry_date  DATE NOT NULL,
    title       TEXT,
    body        TEXT,                              -- markdown
    attachments JSONB NOT NULL DEFAULT '[]',       -- [{ url, type, name }]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, entry_date)
);

CREATE INDEX IF NOT EXISTS journal_entries_user_date_idx
  ON public.journal_entries (user_id, entry_date DESC);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "journal: owner select" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner insert" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner update" ON public.journal_entries;
DROP POLICY IF EXISTS "journal: owner delete" ON public.journal_entries;

CREATE POLICY "journal: owner select"
  ON public.journal_entries FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "journal: owner insert"
  ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal: owner update"
  ON public.journal_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "journal: owner delete"
  ON public.journal_entries FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════
-- ── 146_corporate_wellness.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 146_corporate_wellness.sql
--
-- Corporate Wellness Portal — a B2B org tenant layered over the
-- existing gamification stack. Companies group employees into an
-- organization, run private org-only challenges, and (for org admins)
-- view a READ-ONLY, privacy-preserving HR analytics dashboard.
--
-- PRIVACY MODEL (the whole pitch): the HR dashboard exposes only
-- AGGREGATES (counts / %, averages) via a SECURITY DEFINER RPC. No
-- per-employee rows are ever returned to an admin, and aggregates are
-- suppressed below a small-cohort floor so a stat can't single out one
-- person.
--
-- Membership checks use SECURITY DEFINER helpers so RLS policies on
-- organization_members don't recurse into themselves.
--
-- Idempotent throughout.

-- ── Tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    join_code   TEXT UNIQUE NOT NULL,
    seat_limit  INTEGER,                          -- nullable; per-seat billing story
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS organization_members_org_idx  ON public.organization_members (org_id);

CREATE TABLE IF NOT EXISTS public.organization_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    metric       TEXT NOT NULL CHECK (metric IN ('workouts', 'active_days', 'volume', 'streak', 'hydration')),
    target_value NUMERIC NOT NULL DEFAULT 0,
    starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at      TIMESTAMPTZ,
    created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_challenges_org_idx ON public.organization_challenges (org_id, created_at DESC);

-- ── Membership helpers (SECURITY DEFINER → no RLS recursion) ────────
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE org_id = p_org_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE org_id = p_org_id AND user_id = auth.uid() AND role = 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID)  TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org: members read"   ON public.organizations;
DROP POLICY IF EXISTS "org: admin update"   ON public.organizations;
DROP POLICY IF EXISTS "org: owner delete"   ON public.organizations;
CREATE POLICY "org: members read" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "org: admin update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(id)) WITH CHECK (public.is_org_admin(id));
CREATE POLICY "org: owner delete" ON public.organizations FOR DELETE TO authenticated
  USING (owner_id = auth.uid());
GRANT SELECT, UPDATE, DELETE ON public.organizations TO authenticated;

DROP POLICY IF EXISTS "org_members: read same org"  ON public.organization_members;
DROP POLICY IF EXISTS "org_members: leave own"      ON public.organization_members;
CREATE POLICY "org_members: read same org" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id));
-- Members can remove themselves; admins manage via RPC. No direct
-- INSERT policy — joining goes through join_organization_by_code.
CREATE POLICY "org_members: leave own" ON public.organization_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT, DELETE ON public.organization_members TO authenticated;

DROP POLICY IF EXISTS "org_challenges: members read" ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin write"  ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin update" ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin delete" ON public.organization_challenges;
CREATE POLICY "org_challenges: members read" ON public.organization_challenges FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "org_challenges: admin write" ON public.organization_challenges FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(org_id) AND created_by = auth.uid());
CREATE POLICY "org_challenges: admin update" ON public.organization_challenges FOR UPDATE TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "org_challenges: admin delete" ON public.organization_challenges FOR DELETE TO authenticated
  USING (public.is_org_admin(org_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_challenges TO authenticated;

-- ── Create org (mints a unique join code, adds creator as admin) ────
CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_code TEXT;
  v_org  UUID;
  v_try  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED'); END IF;

  -- Mint an 8-char code (no ambiguous chars), retry on collision.
  LOOP
    v_try := v_try + 1;
    v_code := upper(translate(substr(encode(gen_random_bytes(8), 'base32'), 1, 8), 'OISBoisb', '01258012'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
    IF v_try > 12 THEN RAISE EXCEPTION 'could not mint code'; END IF;
  END LOOP;

  INSERT INTO public.organizations (name, owner_id, join_code)
    VALUES (btrim(p_name), v_uid, v_code)
    RETURNING id INTO v_org;
  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (v_org, v_uid, 'admin')
    ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'org_id', v_org, 'join_code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.create_organization(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT) TO authenticated;

-- ── Join by code ────────────────────────────────────────────────────
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
    FROM public.organizations WHERE join_code = upper(btrim(p_code));
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

-- ── HR analytics (aggregate-only, admin-gated, privacy floor) ───────
-- Returns ONLY counts / %, never per-employee data. Reads members'
-- workout_logs via SECURITY DEFINER (RLS would otherwise block
-- cross-user reads) but emits aggregates exclusively.
CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_members      INT := 0;
  v_active_7d    INT := 0;
  v_workouts_7d  INT := 0;
  v_avg_streak   NUMERIC := 0;
  v_min_cohort   CONSTANT INT := 3;  -- suppress fine detail below this
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

  SELECT COUNT(DISTINCT user_id), COUNT(*)
    INTO v_active_7d, v_workouts_7d
    FROM public.workout_logs
   WHERE created_at > now() - INTERVAL '7 days'
     AND user_id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  SELECT COALESCE(AVG(COALESCE(workout_streak, 0)), 0)
    INTO v_avg_streak
    FROM public.user_profiles
   WHERE id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  RETURN jsonb_build_object(
    'members',           v_members,
    'active_7d',         v_active_7d,
    'workouts_7d',       v_workouts_7d,
    'avg_workout_streak', ROUND(v_avg_streak, 1),
    'participation_pct', CASE WHEN v_members > 0 THEN ROUND(100.0 * v_active_7d / v_members, 0) ELSE 0 END,
    'cohort_too_small',  false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_org_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_analytics(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

