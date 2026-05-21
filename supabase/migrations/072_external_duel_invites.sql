-- 072_external_duel_invites.sql
--
-- "Challenge a friend who isn't on Flexyn yet" — the viral wedge for
-- the Duels system. An existing user creates a pending_duel_invite,
-- gets a shareable URL token, and sends it via DM / SMS / Insta /
-- whatever. The recipient opens the link, sees a polished landing
-- page with the challenger's name + avatar + duel type, signs up if
-- they're not already on Flexyn, and accepts. The accept call
-- atomically creates a real `duels` row between the two users and
-- marks the invite claimed.
--
-- Why a separate table from `duels`:
--   • Real duels need both opponent UUIDs to exist. The whole point
--     of this surface is to allow inviting someone who has NO UUID
--     yet. We can't pre-create the duel row.
--   • The token is the auth credential for the landing page (anon
--     read), so it must live somewhere that doesn't expose the
--     duels social graph.
--   • Once claimed, the invite is "consumed" — we keep the row for
--     audit + analytics but mark it claimed and store the resulting
--     duel_id for traceability.
--
-- Auth model:
--   • create_pending_duel_invite — caller is the challenger. SECURITY
--     DEFINER, validates auth.uid().
--   • get_pending_duel_invite_public — ANON readable by token. Only
--     exposes display fields (challenger name/avatar, duel type) —
--     no internal IDs, no PII beyond the username the challenger
--     already chose to make public.
--   • claim_pending_duel_invite — authenticated caller. SECURITY
--     DEFINER, validates not-already-claimed + not-expired +
--     caller != challenger. Creates the duel + marks claimed in
--     one transaction.

-- ── Table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pending_duel_invites (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_token            TEXT NOT NULL UNIQUE,
  challenger_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenger_username    TEXT,
  challenger_avatar_url  TEXT,
  duel_type              TEXT NOT NULL DEFAULT 'open'
                            CHECK (duel_type IN ('open', 'mirror', 'exercise')),
  session_template       JSONB,
  target_exercise_id     TEXT,
  window_hours           INT NOT NULL DEFAULT 24
                            CHECK (window_hours BETWEEN 1 AND 168),
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  claimed_by_id          UUID REFERENCES auth.users(id),
  claimed_at             TIMESTAMPTZ,
  resulting_duel_id      UUID REFERENCES public.duels(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_token       ON public.pending_duel_invites(claim_token);
CREATE INDEX IF NOT EXISTS idx_pending_duel_invites_challenger  ON public.pending_duel_invites(challenger_id, created_at DESC);

ALTER TABLE public.pending_duel_invites ENABLE ROW LEVEL SECURITY;

-- The challenger sees their own invites (to list them on the Duels
-- page → "Sent invites" section). Nobody else has direct table
-- access — the landing page reads via the SECURITY DEFINER RPC below
-- which exposes only the safe display fields.
DROP POLICY IF EXISTS "pending_duel_invites: read own" ON public.pending_duel_invites;
CREATE POLICY "pending_duel_invites: read own"
  ON public.pending_duel_invites FOR SELECT
  TO authenticated
  USING (challenger_id = auth.uid());

-- Writes go exclusively through the RPCs. No direct INSERT / UPDATE
-- policy — the SECURITY DEFINER functions bypass RLS for legitimate
-- writes.


-- ── create_pending_duel_invite ──────────────────────────────────────────
-- Generates a URL-safe token + persists the invite row. Returns the
-- token so the client can build the shareable URL. The challenger's
-- display fields are snapshotted at create time so the landing page
-- renders consistently even if the challenger later changes their
-- username / avatar.

CREATE OR REPLACE FUNCTION public.create_pending_duel_invite(
  p_duel_type           TEXT DEFAULT 'open',
  p_session_template    JSONB DEFAULT NULL,
  p_target_exercise_id  TEXT DEFAULT NULL,
  p_window_hours        INT DEFAULT 24
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_username  TEXT;
  v_avatar    TEXT;
  v_token     TEXT;
  v_invite_id UUID;
  v_expires   TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_duel_type NOT IN ('open', 'mirror', 'exercise') THEN
    RAISE EXCEPTION 'invalid duel_type' USING ERRCODE = '22023';
  END IF;
  IF p_window_hours IS NULL OR p_window_hours < 1 OR p_window_hours > 168 THEN
    RAISE EXCEPTION 'window_hours must be between 1 and 168' USING ERRCODE = '22023';
  END IF;

  SELECT username, avatar_url
    INTO v_username, v_avatar
    FROM public.user_profiles
   WHERE id = v_uid;

  -- URL-safe random token. 32 hex chars = 128 bits of entropy — more
  -- than enough to prevent token guessing.
  v_token   := encode(gen_random_bytes(16), 'hex');
  v_expires := NOW() + (p_window_hours || ' hours')::INTERVAL + INTERVAL '7 days';

  INSERT INTO public.pending_duel_invites
    (claim_token, challenger_id, challenger_username, challenger_avatar_url,
     duel_type, session_template, target_exercise_id, window_hours, expires_at)
  VALUES
    (v_token, v_uid, v_username, v_avatar,
     p_duel_type, p_session_template, p_target_exercise_id, p_window_hours, v_expires)
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'id',          v_invite_id,
    'token',       v_token,
    'expires_at',  v_expires,
    'duel_type',   p_duel_type,
    'window_hours', p_window_hours
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_duel_invite(TEXT, JSONB, TEXT, INT) TO authenticated;


-- ── get_pending_duel_invite_public ──────────────────────────────────────
-- Anon-readable lookup by token. Returns ONLY safe display fields —
-- no internal IDs except the invite's own id (needed for the claim
-- call), no challenger UUID, no email. This is what the landing page
-- calls to show "Sarah challenged you to a duel" BEFORE the recipient
-- signs in.

CREATE OR REPLACE FUNCTION public.get_pending_duel_invite_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.pending_duel_invites%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_invite
    FROM public.pending_duel_invites
   WHERE claim_token = p_token;

  IF v_invite.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',                    v_invite.id,
    'challenger_username',   v_invite.challenger_username,
    'challenger_avatar_url', v_invite.challenger_avatar_url,
    'duel_type',             v_invite.duel_type,
    'window_hours',          v_invite.window_hours,
    'expires_at',            v_invite.expires_at,
    'is_claimed',            v_invite.claimed_by_id IS NOT NULL,
    'is_expired',            v_invite.expires_at < NOW()
  );
END;
$$;

REVOKE ALL  ON FUNCTION public.get_pending_duel_invite_public(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_duel_invite_public(TEXT) TO anon, authenticated;


-- ── claim_pending_duel_invite ───────────────────────────────────────────
-- Authenticated user accepts the invite. Atomically:
--   1. Locks the invite row (FOR UPDATE) + verifies not claimed,
--      not expired, caller != challenger.
--   2. Creates the real `duels` row between challenger + caller.
--   3. Marks the invite claimed_by_id / claimed_at / resulting_duel_id.
-- Returns { duel_id }.

CREATE OR REPLACE FUNCTION public.claim_pending_duel_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_invite   public.pending_duel_invites%ROWTYPE;
  v_duel_id  UUID;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'token required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invite
    FROM public.pending_duel_invites
   WHERE claim_token = p_token
   FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_invite.claimed_by_id IS NOT NULL THEN
    -- Idempotent return: if THIS caller already claimed it, return
    -- the resulting duel id so retries land cleanly.
    IF v_invite.claimed_by_id = v_uid AND v_invite.resulting_duel_id IS NOT NULL THEN
      RETURN jsonb_build_object('duel_id', v_invite.resulting_duel_id, 'already_claimed_by_you', TRUE);
    END IF;
    RAISE EXCEPTION 'invite_already_claimed' USING ERRCODE = '22023';
  END IF;
  IF v_invite.expires_at < NOW() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = '22023';
  END IF;
  IF v_invite.challenger_id = v_uid THEN
    RAISE EXCEPTION 'cannot_claim_own_invite' USING ERRCODE = '22023';
  END IF;

  v_expires := NOW() + (v_invite.window_hours || ' hours')::INTERVAL;

  INSERT INTO public.duels
    (challenger_id, opponent_id, type, status, session_template,
     target_exercise_id, window_hours, expires_at)
  VALUES
    (v_invite.challenger_id, v_uid, v_invite.duel_type, 'active',
     v_invite.session_template, v_invite.target_exercise_id,
     v_invite.window_hours, v_expires)
  RETURNING id INTO v_duel_id;

  UPDATE public.pending_duel_invites
     SET claimed_by_id     = v_uid,
         claimed_at        = NOW(),
         resulting_duel_id = v_duel_id
   WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'duel_id',                v_duel_id,
    'already_claimed_by_you', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pending_duel_invite(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
