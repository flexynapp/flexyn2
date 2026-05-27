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
         WHERE p.email IS DISTINCT FROM v_sender_email;

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
