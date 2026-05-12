-- 033_push_subscriptions.sql
--
-- Web Push notification subscriptions. Each row corresponds to one
-- (user, device) pair — a single user can have multiple subscriptions
-- if they install the PWA on multiple devices (phone + laptop, etc.)
-- and we want a push to reach all of them.
--
-- Schema follows the Web Push protocol's PushSubscription.toJSON() shape:
--   endpoint    — the URL the push service expects POSTs at
--   p256dh_key  — the client's public ECDH key (base64url)
--   auth_key    — the auth secret used to encrypt payloads (base64url)
--
-- Plus our own metadata (user_id, created/last-seen timestamps,
-- user_agent for debugging which device a subscription corresponds to).
--
-- A delivery sender (Supabase Edge Function — see
-- supabase/functions/send-push/) reads these rows and POSTs encrypted
-- payloads to each endpoint. Endpoints that return 410 Gone should be
-- deleted (the user uninstalled the app or revoked permission).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email   TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  p256dh_key   TEXT NOT NULL,
  auth_key     TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Endpoint URLs are unique per push service per device. Re-subscribing
  -- on the same device yields the same endpoint, so we upsert by endpoint.
  CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions(user_id, last_seen_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscriptions (used by the Settings panel
-- to show "Push enabled on this device" state).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'push_subscriptions' AND policyname = 'push: read own') THEN
    CREATE POLICY "push: read own"
      ON public.push_subscriptions FOR SELECT
      TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- Users can delete their own subscriptions (opt-out / revoke).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'push_subscriptions' AND policyname = 'push: delete own') THEN
    CREATE POLICY "push: delete own"
      ON public.push_subscriptions FOR DELETE
      TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- NO direct INSERT or UPDATE policy — opt-in goes through the RPC below
-- so the server controls the (user_id, user_email) fields and we never
-- trust client-supplied identity.

-- ── Idempotent subscription upsert ───────────────────────────────────────────
-- The Web Push API gives the SAME endpoint on re-subscribe from the same
-- device. We upsert by endpoint: if a subscription with this endpoint
-- already exists, refresh its keys + last_seen_at; otherwise insert.
-- The user_id is always set from auth.uid() so the client can't subscribe
-- on behalf of someone else.
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint   TEXT,
  p_p256dh_key TEXT,
  p_auth_key   TEXT,
  p_user_agent TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := auth.email();
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_p256dh_key IS NULL OR p_auth_key IS NULL THEN
    RAISE EXCEPTION 'endpoint, p256dh_key, auth_key all required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions
    (user_id, user_email, endpoint, p256dh_key, auth_key, user_agent)
  VALUES
    (v_uid, v_email, p_endpoint, p_p256dh_key, p_auth_key, p_user_agent)
  ON CONFLICT (endpoint) DO UPDATE SET
    user_id      = EXCLUDED.user_id,
    user_email   = EXCLUDED.user_email,
    p256dh_key   = EXCLUDED.p256dh_key,
    auth_key     = EXCLUDED.auth_key,
    user_agent   = EXCLUDED.user_agent,
    last_seen_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
