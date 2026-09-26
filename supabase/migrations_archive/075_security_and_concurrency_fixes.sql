-- 075_security_and_concurrency_fixes.sql
--
-- Three fixes from the cross-app bug audit:
--
-- 1. CRITICAL — perform_prestige (migration 057) is SECURITY DEFINER
--    and accepts an arbitrary p_user_id but never verifies the caller
--    is that user. Postgres grants EXECUTE to PUBLIC by default, so
--    any authenticated user can call perform_prestige(VICTIM_UUID) to
--    reset that user's XP/level and award them coins. Direct griefing
--    + economic damage (forced prestige resets attacking leaderboards).
--    Fix: require auth.uid() = p_user_id.
--
-- 2. HIGH — dm_message_reactions had RLS SELECT `USING (true)`,
--    exposing every emoji reaction on every DM conversation system-wide
--    to every authenticated user. Even though the table only stores
--    (message_id, user_id, emoji) per reaction, the message_id is a
--    foreign key to private chats; the leak reveals who reacted to
--    whom with what. Tighten to: the reacting user themselves OR a
--    participant of the conversation the message lives in.
--
-- 3. HIGH — joinCrew in src/lib/data/crews.js does a client-side
--    capacity probe + insert, which is a TOCTOU race. Two simultaneous
--    joins both pass the `members.length < cap` check and both insert,
--    bypassing the 16-member cap (or whatever max_capacity is set to).
--    Atomic RPC takes a FOR UPDATE lock on the crew row, re-counts
--    members under the lock, and inserts only if there's still room.

-- ── Fix 1: perform_prestige requires self-only call ─────────────────────

CREATE OR REPLACE FUNCTION public.perform_prestige(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile   RECORD;
  v_new_level INT;
  v_coins     INT;
BEGIN
  -- New: enforce self-only call. Without these two checks, any
  -- authenticated user could grief any other user by calling this
  -- RPC against their UUID — the function bypasses RLS, so the
  -- victim's profile would be mutated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT prestige_level, total_xp INTO v_profile
  FROM public.user_profiles
  WHERE id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user not found');
  END IF;

  IF v_profile.prestige_level >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max prestige reached');
  END IF;

  v_new_level := v_profile.prestige_level + 1;
  v_coins := v_new_level * 500;

  UPDATE public.user_profiles
  SET
    prestige_level    = v_new_level,
    total_xp          = 0,
    current_level     = 1,
    prestige_dismissed = FALSE,
    prestiged_at      = array_append(COALESCE(prestiged_at, '{}'), NOW()),
    flex_coins        = COALESCE(flex_coins, 0) + v_coins
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'prestige_level', v_new_level,
    'coins_awarded',  v_coins
  );
END;
$$;

-- Belt-and-braces: explicitly REVOKE then GRANT so the function is
-- only callable by authenticated roles (not anon, not PUBLIC).
REVOKE ALL ON FUNCTION public.perform_prestige(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.perform_prestige(UUID) TO authenticated;


-- ── Fix 2: dm_message_reactions SELECT scoped to participants ───────────

DROP POLICY IF EXISTS "dm_rxns_select" ON public.dm_message_reactions;

CREATE POLICY "dm_rxns_select"
  ON public.dm_message_reactions FOR SELECT
  TO authenticated
  USING (
    -- The reacting user can always see their own reactions.
    user_id = auth.uid()
    -- Or the caller is a participant of the conversation the
    -- reacted-to message belongs to.
    OR EXISTS (
      SELECT 1
        FROM public.hub_messages m
        JOIN public.hub_conversations c ON c.id = m.conversation_id
       WHERE m.id = dm_message_reactions.message_id
         AND (auth.email() = ANY(c.participant_emails)
              OR auth.uid()   = ANY(c.participant_ids))
    )
  );


-- ── Fix 3: atomic join_crew RPC ─────────────────────────────────────────
-- Replaces the client-side capacity probe + insert dance with a single
-- transaction that locks the crew row, counts under the lock, and only
-- inserts if there's still capacity. Idempotent: a second call by the
-- same user returns { already_member: true }. Returns an error code the
-- client can branch on without parsing error strings.

CREATE OR REPLACE FUNCTION public.join_crew_atomic(p_crew_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_crew     public.crews%ROWTYPE;
  v_count    INT;
  v_existing INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_crew_id IS NULL THEN
    RAISE EXCEPTION 'crew_id required' USING ERRCODE = '22023';
  END IF;

  -- Lock the crew row so concurrent joins serialize. FOR UPDATE here
  -- closes the TOCTOU window between read-count + insert.
  SELECT * INTO v_crew
    FROM public.crews
   WHERE id = p_crew_id
   FOR UPDATE;

  IF v_crew.id IS NULL THEN
    RAISE EXCEPTION 'crew not found' USING ERRCODE = '22023';
  END IF;

  -- Already a member? Idempotent return so retries don't error.
  SELECT COUNT(*) INTO v_existing
    FROM public.crew_members
   WHERE crew_id = p_crew_id AND user_id = v_uid;
  IF v_existing > 0 THEN
    RETURN jsonb_build_object(
      'success',        TRUE,
      'already_member', TRUE,
      'crew_id',        p_crew_id
    );
  END IF;

  -- Capacity check under the lock.
  SELECT COUNT(*) INTO v_count
    FROM public.crew_members
   WHERE crew_id = p_crew_id;
  IF v_count >= COALESCE(v_crew.max_capacity, 16) THEN
    RAISE EXCEPTION 'crew_full' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crew_members (crew_id, user_id, is_admin)
  VALUES (p_crew_id, v_uid, FALSE);

  RETURN jsonb_build_object(
    'success',        TRUE,
    'already_member', FALSE,
    'crew_id',        p_crew_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_crew_atomic(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_crew_atomic(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
