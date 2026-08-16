-- 368_crew_applications.sql
--
-- Private crews are visible and joining one is an application a moderator or
-- leader accepts (kegan, 2026-08-16).
--
-- WHAT ALREADY WORKS — AND A WRONG CONCLUSION, RECORDED BECAUSE IT WAS CHEAP
-- TO REACH AND EXPENSIVE TO SHIP
--
-- The first draft of this migration added a `request_to_join_crew` RPC on the
-- reasoning that there was no way to create an application at all: no function
-- matching `request_to_join%` exists, and `crew_join_requests` carries no
-- INSERT policy — only a read. Both facts are true and the conclusion was
-- wrong.
--
-- **`join_crew_atomic` already files the application.** For a crew that is not
-- public and has no live invite it INSERTs into `crew_join_requests` with
-- `ON CONFLICT (crew_id, user_id) DO UPDATE`, resets a prior decision, and
-- returns `status = 'requested'` (or `'pending'` if one is already open).
-- It is SECURITY DEFINER, so the missing INSERT policy is not a gap — RLS
-- never applies to it. `CrewDiscovery.jsx` already calls it and already has
-- copy for both outcomes.
--
-- Shipping the new RPC would have produced two implementations of one rule,
-- which is the exact failure the weekly-review section of CLAUDE.md documents.
-- The lesson is the one that file states first: read the installed artefact.
-- A name search plus a policy check is not a search for behaviour.
--
-- WHAT IS ACTUALLY MISSING, AND IS WHAT THIS MIGRATION DOES
--
--   1. **Moderators cannot review.** `list_crew_join_requests` and
--      `decide_crew_join_request` both gate on `is_admin = TRUE` — the legacy
--      boolean that predates migration 357's rank vocabulary. A moderator is
--      rank 2 and carries `is_admin = FALSE`, so they can neither see the
--      queue nor decide it. Both now gate on `crew_rank() >= 2`.
--      `CrewJoinRequests.jsx` mounted only for `RANK.LEADER` and is changed to
--      match in the same commit.
--   2. **Nobody is told.** `join_crew_atomic` files the request silently, so
--      an application lands in a queue no one has a reason to open, and the
--      applicant never learns the outcome. That is the likeliest reason
--      `crew_join_requests` holds 0 rows in production despite a working door.
--      Reviewers are now notified on arrival and the applicant on decision.
--
-- Everything else in `decide_` is preserved: the capacity check under lock,
-- the already-in-a-crew check, and the idempotent re-decide.
--
-- Not done, and deliberately: `crew_join_requests.message` has no writer.
-- `join_crew_atomic` takes no message argument and no surface collects one.
-- Adding a note to an application is a product change, not a gate fix, so the
-- column stays unwritten rather than being half-wired here.

-- == Notify the reviewers when an application arrives =======================

CREATE OR REPLACE FUNCTION public.notify_crew_join_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name TEXT;
BEGIN
  -- Only a fresh or reopened application, not an approve/reject write.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_name FROM public.crews WHERE id = NEW.crew_id;

  -- user_email is supplied explicitly from user_profiles: notifications.user_email
  -- is NOT NULL and auth.users.email is NULL for every guest, so sourcing it
  -- the usual way would abort the join for a guest reviewer. 366's fill-trigger
  -- covers this too; not depending on it keeps the two independent of apply order.
  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  SELECT user_id,
         (SELECT email FROM public.user_profiles WHERE id = user_id),
         'crew_join_request',
         'Someone wants to join ' || COALESCE(v_name, 'your crew'),
         'Review the request from the crew roster.',
         '📋', '/hub',
         jsonb_build_object('crew_id', NEW.crew_id, 'applicant_id', NEW.user_id)
    FROM public.crew_members
   WHERE crew_id = NEW.crew_id
     AND public.crew_rank(crew_id, user_id) >= 2;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_crew_join_request ON public.crew_join_requests;

CREATE TRIGGER trg_notify_crew_join_request
  AFTER INSERT OR UPDATE OF status ON public.crew_join_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_crew_join_request();

-- == Review: moderators too, not leaders only ===============================

CREATE OR REPLACE FUNCTION public.list_crew_join_requests(p_crew_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_rank     INTEGER;
  v_out      JSONB;
  v_id       UUID;
  v_msg      TEXT;
  v_at       TIMESTAMPTZ;
  v_username TEXT;
  v_full     TEXT;
  v_avatar   TEXT;
  v_level    INTEGER;
BEGIN
  IF v_uid IS NULL OR p_crew_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Was `is_admin = TRUE`, i.e. rank 3 only. Moderators are rank 2 and carry
  -- is_admin = FALSE, so they could not see the queue they are meant to work.
  v_rank := public.crew_rank(p_crew_id, v_uid);
  IF v_rank IS NULL OR v_rank < 2 THEN
    -- Deliberately an empty list, not an exception: the original returned []
    -- so a non-reviewer has no error to probe crew membership with. Keep it.
    RETURN '[]'::jsonb;
  END IF;

  -- Shape preserved exactly — CrewJoinRequests.jsx reads user_id, username,
  -- full_name, avatar_url and created_at. `message` is additive.
  --
  -- Built with a loop of single-table statements rather than a join, because
  -- a join needs `alias.column` tokens and those are exactly what the paste
  -- pipeline mangles into `42601 syntax error at "<"`. See the workflow rule
  -- in CLAUDE.md — this file is handed over as text to be pasted.
  v_out := '[]'::jsonb;

  FOR v_id, v_msg, v_at IN
    SELECT user_id, message, created_at
      FROM public.crew_join_requests
     WHERE crew_id = p_crew_id AND status = 'pending'
     ORDER BY created_at ASC
  LOOP
    SELECT username, full_name, avatar_url, current_level
      INTO v_username, v_full, v_avatar, v_level
      FROM public.user_profiles
     WHERE id = v_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'user_id',       v_id,
      'username',      v_username,
      'full_name',     v_full,
      'avatar_url',    v_avatar,
      'current_level', v_level,
      'message',       v_msg,
      'created_at',    v_at));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.list_crew_join_requests(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_crew_join_requests(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_crew_join_request(p_crew_id UUID, p_user_id UUID, p_approve BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_rank      INTEGER;
  v_cap       INTEGER;
  v_count     INTEGER;
  v_elsewhere INTEGER;
  v_state     TEXT;
  v_name      TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'crew_id and user_id required' USING ERRCODE = '22023';
  END IF;

  -- Was `is_admin = TRUE`, which is rank 3 only. Moderators are rank 2 and
  -- carry is_admin = FALSE, so they could not decide.
  v_rank := public.crew_rank(p_crew_id, v_uid);
  IF v_rank IS NULL OR v_rank < 2 THEN
    RAISE EXCEPTION 'only a crew moderator or leader can decide join requests'
      USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_state
    FROM public.crew_join_requests
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  IF v_state IS NULL THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_state = 'pending') THEN
    RETURN jsonb_build_object('ok', TRUE, 'status', v_state, 'changed', FALSE);
  END IF;

  SELECT name INTO v_name FROM public.crews WHERE id = p_crew_id;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.crew_join_requests
       SET status = 'rejected', decided_by = v_uid, decided_at = now()
     WHERE crew_id = p_crew_id AND user_id = p_user_id;

    INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
    VALUES (p_user_id,
            (SELECT email FROM public.user_profiles WHERE id = p_user_id),
            'crew_join_request',
            'Your request to join ' || COALESCE(v_name, 'a crew') || ' was declined',
            'You can apply again, or find another crew.', '📋', '/hub',
            jsonb_build_object('crew_id', p_crew_id, 'decision', 'rejected'));

    RETURN jsonb_build_object('ok', TRUE, 'status', 'rejected', 'changed', TRUE);
  END IF;

  SELECT COUNT(*) INTO v_elsewhere
    FROM public.crew_members
   WHERE user_id = p_user_id AND NOT (crew_id = p_crew_id);

  IF NOT (v_elsewhere = 0) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'already_in_crew');
  END IF;

  SELECT COALESCE(max_capacity, 16) INTO v_cap
    FROM public.crews WHERE id = p_crew_id FOR UPDATE;

  SELECT COUNT(*) INTO v_count
    FROM public.crew_members WHERE crew_id = p_crew_id;

  IF v_count = GREATEST(v_count, v_cap) THEN
    RAISE EXCEPTION 'crew_full' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin, role)
  VALUES (p_crew_id, p_user_id, FALSE, 'member')
  ON CONFLICT DO NOTHING;

  UPDATE public.crew_join_requests
     SET status = 'approved', decided_by = v_uid, decided_at = now()
   WHERE crew_id = p_crew_id AND user_id = p_user_id;

  INSERT INTO public.notifications (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES (p_user_id,
          (SELECT email FROM public.user_profiles WHERE id = p_user_id),
          'crew_join_request',
          'You''re in — welcome to ' || COALESCE(v_name, 'the crew'),
          'Your request was accepted. Open the crew to meet the roster.',
          '🎉', '/hub',
          jsonb_build_object('crew_id', p_crew_id, 'decision', 'approved'));

  RETURN jsonb_build_object('ok', TRUE, 'status', 'approved', 'changed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_crew_join_request(UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_crew_join_request(UUID, UUID, BOOLEAN) TO authenticated;
