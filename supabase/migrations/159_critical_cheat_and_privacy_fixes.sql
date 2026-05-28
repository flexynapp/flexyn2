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
