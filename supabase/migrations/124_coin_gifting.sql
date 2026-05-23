-- 124_coin_gifting.sql
--
-- Peer-to-peer flex-coin gifting. A user can send coins from their own
-- balance to another user along with an optional message. This is a
-- low-effort social engagement loop that surfaces existing infra
-- (flex_coins on user_profiles, notifications table, push fanout).
--
-- Server-enforced rules:
--   • Sender must have enough coins (rejected with INSUFFICIENT_FUNDS).
--   • Amount must be positive and within 1..10000 per gift (cap is a
--     soft anti-fraud heuristic — the hard cap is the sender's balance).
--   • Self-gifts are no-ops (return NULL).
--   • Atomic — debit + credit + audit row + notification all in one tx.
--   • Audit row in `coin_gifts` is permanent (for fraud review).
--
-- The notification type 'coin_gift' is allowed through the
-- create_notification_for whitelist by this migration (extended via
-- the new allow-list).

-- ── 1. coin_gifts audit table ─────────────────────────────────────────
-- Permanent ledger of every gift. RLS lets sender + recipient read
-- their own rows; never publicly visible.

CREATE TABLE IF NOT EXISTS public.coin_gifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount > 0 AND amount <= 10000),
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coin_gifts_recipient_idx
  ON public.coin_gifts (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coin_gifts_sender_idx
  ON public.coin_gifts (sender_id, created_at DESC);

ALTER TABLE public.coin_gifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coin_gifts: read own"           ON public.coin_gifts;
DROP POLICY IF EXISTS "coin_gifts: no client writes"   ON public.coin_gifts;

CREATE POLICY "coin_gifts: read own"
  ON public.coin_gifts FOR SELECT
  TO authenticated
  USING (auth.uid() IN (sender_id, recipient_id));

-- No client INSERT/UPDATE/DELETE — only the RPC (SECURITY DEFINER) writes.

-- ── 2. gift_flex_coins RPC ────────────────────────────────────────────
-- Atomic debit-and-credit. SECURITY DEFINER bypasses RLS so we can
-- update both users' profiles, but we gate strictly on auth.uid() so a
-- client can only EVER spend from their own balance.

CREATE OR REPLACE FUNCTION public.gift_flex_coins(
  p_recipient_id UUID,
  p_amount       INTEGER,
  p_message      TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $gift_flex_coins$
DECLARE
  v_sender UUID := auth.uid();
  v_sender_balance INTEGER;
  v_sender_username TEXT;
  v_recipient_email TEXT;
  v_recipient_lang  TEXT;
  v_gift_id UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_recipient_id IS NULL THEN
    RAISE EXCEPTION 'recipient_id required' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 10000 THEN
    RAISE EXCEPTION 'amount must be 1..10000' USING ERRCODE = '22023';
  END IF;
  IF p_recipient_id = v_sender THEN
    -- Self-gift no-op. Return a recognizable shape so clients can warn.
    RETURN jsonb_build_object('ok', false, 'error', 'SELF_GIFT');
  END IF;

  -- Lock sender row, check balance.
  SELECT flex_coins, username
    INTO v_sender_balance, v_sender_username
    FROM public.user_profiles
    WHERE id = v_sender
    FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'sender profile missing' USING ERRCODE = '22023';
  END IF;
  IF v_sender_balance < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_FUNDS',
      'balance', v_sender_balance);
  END IF;

  -- Resolve recipient (must exist).
  SELECT u.email, prof.preferred_language
    INTO v_recipient_email, v_recipient_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_recipient_id;
  IF v_recipient_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RECIPIENT_NOT_FOUND');
  END IF;

  -- Debit sender, credit recipient.
  UPDATE public.user_profiles
     SET flex_coins = GREATEST(0, COALESCE(flex_coins, 0) - p_amount)
   WHERE id = v_sender;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + p_amount
   WHERE id = p_recipient_id;

  -- Audit row.
  INSERT INTO public.coin_gifts (sender_id, recipient_id, amount, message)
  VALUES (v_sender, p_recipient_id, p_amount, NULLIF(p_message, ''))
  RETURNING id INTO v_gift_id;

  -- Notify recipient (in-app + push via the existing trigger).
  -- Title/body are English-only here; the client can localize using the
  -- metadata fields. notifications.type is NOT in the
  -- create_notification_for whitelist; that's intentional — we own
  -- the dispatch surface for coin gifts here and refuse to expose a
  -- generic cross-user fan-out for them.
  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_recipient_id,
     v_recipient_email,
     'coin_gift',
     'You received a coin gift!',
     COALESCE('@' || NULLIF(v_sender_username, '') || ' sent you ' || p_amount::text || ' coins',
              'You received ' || p_amount::text || ' coins'),
     '💰',
     '/hub',
     jsonb_build_object(
       'amount',         p_amount,
       'senderId',       v_sender,
       'senderUsername', v_sender_username,
       'giftMessage',    NULLIF(p_message, ''),
       'giftId',         v_gift_id
     ));

  RETURN jsonb_build_object('ok', true, 'giftId', v_gift_id, 'amount', p_amount);
END;
$gift_flex_coins$;

REVOKE ALL ON FUNCTION public.gift_flex_coins(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gift_flex_coins(UUID, INTEGER, TEXT) TO authenticated;
