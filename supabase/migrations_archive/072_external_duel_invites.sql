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
--
-- Paste-safe: every read uses scalar SELECT … INTO v_a, v_b instead
-- of %ROWTYPE + dotted record access (the clipboard pipeline mangles
-- the dotted access into 42601). Idempotent.

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

DROP POLICY IF EXISTS "pending_duel_invites: read own" ON public.pending_duel_invites;
CREATE POLICY "pending_duel_invites: read own"
  ON public.pending_duel_invites FOR SELECT
  TO authenticated
  USING (challenger_id = auth.uid());


-- ── create_pending_duel_invite ──────────────────────────────────────────

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

  -- URL-safe random token. 32 hex chars = 128 bits of entropy.
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
    'id',           v_invite_id,
    'token',        v_token,
    'expires_at',   v_expires,
    'duel_type',    p_duel_type,
    'window_hours', p_window_hours
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_duel_invite(TEXT, JSONB, TEXT, INT) TO authenticated;


-- ── get_pending_duel_invite_public ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_pending_duel_invite_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id              UUID;
  v_username        TEXT;
  v_avatar_url      TEXT;
  v_duel_type       TEXT;
  v_window_hours    INT;
  v_expires_at      TIMESTAMPTZ;
  v_claimed_by_id   UUID;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN
    RETURN NULL;
  END IF;

  SELECT id, challenger_username, challenger_avatar_url, duel_type,
         window_hours, expires_at, claimed_by_id
    INTO v_id, v_username, v_avatar_url, v_duel_type,
         v_window_hours, v_expires_at, v_claimed_by_id
    FROM public.pending_duel_invites
   WHERE claim_token = p_token;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id',                    v_id,
    'challenger_username',   v_username,
    'challenger_avatar_url', v_avatar_url,
    'duel_type',             v_duel_type,
    'window_hours',          v_window_hours,
    'expires_at',            v_expires_at,
    'is_claimed',            v_claimed_by_id IS NOT NULL,
    'is_expired',            v_expires_at < NOW()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.get_pending_duel_invite_public(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_duel_invite_public(TEXT) TO anon, authenticated;


-- ── claim_pending_duel_invite ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_pending_duel_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid                 UUID := auth.uid();
  v_invite_id           UUID;
  v_challenger_id       UUID;
  v_claimed_by_id       UUID;
  v_resulting_duel_id   UUID;
  v_expires_at          TIMESTAMPTZ;
  v_window_hours        INT;
  v_duel_type           TEXT;
  v_session_template    JSONB;
  v_target_exercise_id  TEXT;
  v_duel_id             UUID;
  v_new_expires         TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'token required' USING ERRCODE = '22023';
  END IF;

  SELECT id, challenger_id, claimed_by_id, resulting_duel_id, expires_at,
         window_hours, duel_type, session_template, target_exercise_id
    INTO v_invite_id, v_challenger_id, v_claimed_by_id, v_resulting_duel_id, v_expires_at,
         v_window_hours, v_duel_type, v_session_template, v_target_exercise_id
    FROM public.pending_duel_invites
   WHERE claim_token = p_token
   FOR UPDATE;

  IF v_invite_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_claimed_by_id IS NOT NULL THEN
    -- Idempotent: if THIS caller already claimed it, return the duel id.
    IF v_claimed_by_id = v_uid AND v_resulting_duel_id IS NOT NULL THEN
      RETURN jsonb_build_object('duel_id', v_resulting_duel_id, 'already_claimed_by_you', TRUE);
    END IF;
    RAISE EXCEPTION 'invite_already_claimed' USING ERRCODE = '22023';
  END IF;
  IF v_expires_at < NOW() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = '22023';
  END IF;
  IF v_challenger_id = v_uid THEN
    RAISE EXCEPTION 'cannot_claim_own_invite' USING ERRCODE = '22023';
  END IF;

  v_new_expires := NOW() + (v_window_hours || ' hours')::INTERVAL;

  INSERT INTO public.duels
    (challenger_id, opponent_id, type, status, session_template,
     target_exercise_id, window_hours, expires_at)
  VALUES
    (v_challenger_id, v_uid, v_duel_type, 'active',
     v_session_template, v_target_exercise_id,
     v_window_hours, v_new_expires)
  RETURNING id INTO v_duel_id;

  UPDATE public.pending_duel_invites
     SET claimed_by_id     = v_uid,
         claimed_at        = NOW(),
         resulting_duel_id = v_duel_id
   WHERE id = v_invite_id;

  RETURN jsonb_build_object(
    'duel_id',                v_duel_id,
    'already_claimed_by_you', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pending_duel_invite(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
