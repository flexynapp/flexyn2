-- ─────────────────────────────────────────────────────────────────────
-- _deploy_pending.sql — ONE-SHOT DEPLOY BUNDLE
--
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- It contains migrations 124-129 stitched together, in order. Every
-- statement is idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR
-- REPLACE FUNCTION, etc.) so re-running is safe.
--
-- After this lands:
--   ✅ Coin gifting (124)
--   ✅ Weekly/Monthly leaderboards (125)
--   ✅ Emoji reactions on posts (126)
--   ✅ Per-category notification snooze (127)
--   ✅ Cycle tracking (128)
--   ✅ Onboarding fitness assessment (129)
--
-- The leading underscore keeps this file out of any automated runner
-- (the existing `_audit_schema_drift.sql` follows the same convention).
-- ─────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════
-- ── 124_coin_gifting.sql ──
-- ═══════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════
-- ── 125_period_leaderboard.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 125_period_leaderboard.sql
--
-- Adds get_period_leaderboard(p_board, p_period, p_limit) — top-N
-- users by workout volume / XP / sessions over a time window.
--
-- Context: the existing global leaderboard read `weekly_xp` /
-- `weekly_volume` from `user_profiles`, but those columns don't
-- exist there (only on `league_members.weekly_xp`). The weekly
-- toggle silently degraded to zero everywhere — a latent bug.
-- This RPC restores it and adds a monthly window in one go.
--
-- Aggregation strategy: scan `workout_logs.total_volume` for the
-- period window, group by user, sort by the chosen metric. For
-- 'alltime' we fall back to the denormalized `user_profiles.total_*`
-- columns (faster than scanning every log ever).
--
-- Read-all RLS: anyone authenticated can query the leaderboard.
-- Inner queries run with SECURITY DEFINER so they bypass the
-- per-row visibility rules on workout_logs.

CREATE OR REPLACE FUNCTION public.get_period_leaderboard(
  p_board  TEXT,   -- 'volume' | 'xp' | 'sessions'
  p_period TEXT,   -- 'weekly' | 'monthly' | 'alltime'
  p_limit  INT DEFAULT 100
) RETURNS TABLE (
  user_id    UUID,
  email      TEXT,
  username   TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  value      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $get_period_leaderboard$
DECLARE
  v_uid    UUID := auth.uid();
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_period TEXT := COALESCE(p_period, 'alltime');
  v_board  TEXT := COALESCE(p_board, 'volume');
  v_since  TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_board NOT IN ('volume', 'xp', 'sessions') THEN
    RAISE EXCEPTION 'invalid board' USING ERRCODE = '22023';
  END IF;
  IF v_period NOT IN ('weekly', 'monthly', 'alltime') THEN
    RAISE EXCEPTION 'invalid period' USING ERRCODE = '22023';
  END IF;

  v_since := CASE v_period
    WHEN 'weekly'  THEN date_trunc('week',  now() AT TIME ZONE 'UTC')
    WHEN 'monthly' THEN date_trunc('month', now() AT TIME ZONE 'UTC')
    ELSE NULL
  END;

  IF v_period = 'alltime' AND v_board = 'volume' THEN
    -- Alltime volume: use the denormalized column on user_profiles.
    RETURN QUERY
      SELECT
        p.id          AS user_id,
        p.email,
        p.username,
        p.full_name,
        p.avatar_url,
        COALESCE(p.total_volume_lbs, 0)::NUMERIC AS value
      FROM public.user_profiles p
      WHERE COALESCE(p.total_volume_lbs, 0) > 0
      ORDER BY p.total_volume_lbs DESC
      LIMIT v_limit;
    RETURN;
  END IF;

  IF v_period = 'alltime' AND v_board = 'xp' THEN
    RETURN QUERY
      SELECT
        p.id          AS user_id,
        p.email,
        p.username,
        p.full_name,
        p.avatar_url,
        COALESCE(p.total_xp, 0)::NUMERIC AS value
      FROM public.user_profiles p
      WHERE COALESCE(p.total_xp, 0) > 0
      ORDER BY p.total_xp DESC
      LIMIT v_limit;
    RETURN;
  END IF;

  -- Period-scoped (weekly / monthly) board, OR alltime sessions —
  -- aggregate from workout_logs directly. Sessions is always a
  -- log-count, so we treat alltime-sessions the same path.
  RETURN QUERY
    WITH stats AS (
      SELECT
        wl.user_id,
        SUM(COALESCE(wl.total_volume, 0))::NUMERIC AS w_volume,
        COUNT(*)::INT                              AS w_sessions
      FROM public.workout_logs wl
      WHERE v_since IS NULL OR wl.date >= v_since::date
      GROUP BY wl.user_id
    )
    SELECT
      p.id        AS user_id,
      p.email,
      p.username,
      p.full_name,
      p.avatar_url,
      CASE v_board
        WHEN 'volume'   THEN s.w_volume
        WHEN 'sessions' THEN s.w_sessions::NUMERIC
        WHEN 'xp'       THEN s.w_volume    -- approximate weekly/monthly XP via volume (TODO: derive from xp_logs)
      END AS value
    FROM stats s
    JOIN public.user_profiles p ON p.id = s.user_id
    WHERE CASE v_board
      WHEN 'volume'   THEN s.w_volume > 0
      WHEN 'sessions' THEN s.w_sessions > 0
      WHEN 'xp'       THEN s.w_volume > 0
    END
    ORDER BY CASE v_board
      WHEN 'volume'   THEN s.w_volume
      WHEN 'sessions' THEN s.w_sessions::NUMERIC
      WHEN 'xp'       THEN s.w_volume
    END DESC
    LIMIT v_limit;
END;
$get_period_leaderboard$;

REVOKE ALL ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_period_leaderboard(TEXT, TEXT, INT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- ── 126_emoji_reactions.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 126_emoji_reactions.sql
--
-- Arbitrary-emoji reactions on hub posts. The existing like/dislike
-- system stays untouched — emoji reactions are independent. Users
-- can have at most one emoji reaction per post (separate from their
-- like/dislike, which they can also have).
--
-- The `hub_reactions` table already has an `emoji` column (currently
-- populated with the literal strings 'like' / 'dislike' as a mirror
-- of `reaction_type`). For emoji reactions we use the actual emoji
-- character (🔥, 💪, etc.). A reaction is considered "emoji" when
-- `reaction_type` is NULL (or any non-like/dislike value) — the new
-- RPC inserts rows with reaction_type = NULL so they're easy to
-- distinguish.
--
-- Counter: `hub_posts.emoji_reaction_count` is kept in sync inside
-- the RPC transaction. Like/dislike counters are unaffected.

ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS emoji_reaction_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hub_reactions_emoji_idx
  ON public.hub_reactions (post_id, emoji)
  WHERE reaction_type IS NULL;

-- ── set_post_emoji_reaction RPC ───────────────────────────────────────
-- p_emoji NULL  → clear the user's emoji reaction on this post (if any)
-- p_emoji other → set/replace the user's emoji reaction to the given emoji
-- Returns the new emoji_reaction_count for the post.

CREATE OR REPLACE FUNCTION public.set_post_emoji_reaction(
  p_post_id UUID,
  p_emoji   TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $set_post_emoji_reaction$
DECLARE
  v_email TEXT := auth.email();
  v_uid   UUID := auth.uid();
  v_old_emoji TEXT;
  v_new_count INT;
BEGIN
  IF v_email IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'post_id required' USING ERRCODE = '22023';
  END IF;
  -- Sanity guard — emoji should be 1..8 bytes-ish. Anyone passing a
  -- long string is misusing the API; reject. We intentionally don't
  -- enforce a whitelist of emoji values so users can react with any
  -- glyph their keyboard supports.
  IF p_emoji IS NOT NULL AND char_length(p_emoji) > 8 THEN
    RAISE EXCEPTION 'emoji too long' USING ERRCODE = '22023';
  END IF;
  IF p_emoji IS NOT NULL AND p_emoji IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'reserved emoji value' USING ERRCODE = '22023';
  END IF;

  -- Find the user's current EMOJI reaction (excluding like/dislike).
  SELECT emoji INTO v_old_emoji
    FROM public.hub_reactions
   WHERE post_id = p_post_id
     AND created_by = v_email
     AND reaction_type IS NULL
   LIMIT 1;

  -- No-op when nothing changes.
  IF v_old_emoji IS NOT DISTINCT FROM p_emoji THEN
    SELECT COALESCE(emoji_reaction_count, 0) INTO v_new_count
      FROM public.hub_posts WHERE id = p_post_id;
    RETURN v_new_count;
  END IF;

  -- Remove the old emoji reaction (if any).
  IF v_old_emoji IS NOT NULL THEN
    DELETE FROM public.hub_reactions
     WHERE post_id = p_post_id
       AND created_by = v_email
       AND reaction_type IS NULL;
    UPDATE public.hub_posts
       SET emoji_reaction_count = GREATEST(0, COALESCE(emoji_reaction_count, 0) - 1)
     WHERE id = p_post_id;
  END IF;

  -- Insert the new emoji reaction (or stop, when clearing).
  IF p_emoji IS NOT NULL THEN
    INSERT INTO public.hub_reactions (post_id, created_by, user_id, reaction_type, emoji, user_email)
    VALUES (p_post_id, v_email, v_uid, NULL, p_emoji, v_email);
    UPDATE public.hub_posts
       SET emoji_reaction_count = COALESCE(emoji_reaction_count, 0) + 1
     WHERE id = p_post_id;
  END IF;

  SELECT COALESCE(emoji_reaction_count, 0) INTO v_new_count
    FROM public.hub_posts WHERE id = p_post_id;
  RETURN v_new_count;
END;
$set_post_emoji_reaction$;

REVOKE ALL ON FUNCTION public.set_post_emoji_reaction(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_post_emoji_reaction(UUID, TEXT) TO authenticated;

-- ── get_post_emoji_summary helper ────────────────────────────────────
-- Returns the top emoji + total count for a post. Used by the post
-- card to show "🔥 12" — picks the most-common emoji as the avatar.
-- Always returns a single row (post_id, top_emoji, total_count).

CREATE OR REPLACE FUNCTION public.get_post_emoji_summary(p_post_id UUID)
RETURNS TABLE (top_emoji TEXT, total_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
    WITH counts AS (
      SELECT emoji, COUNT(*)::INT AS n
        FROM public.hub_reactions
       WHERE post_id = p_post_id AND reaction_type IS NULL
       GROUP BY emoji
    )
    SELECT
      (SELECT emoji FROM counts ORDER BY n DESC, emoji LIMIT 1) AS top_emoji,
      COALESCE((SELECT SUM(n)::INT FROM counts), 0)              AS total_count;
END;
$$;

REVOKE ALL ON FUNCTION public.get_post_emoji_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_post_emoji_summary(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 127_notification_snooze.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 127_notification_snooze.sql
--
-- Per-category notification snooze. The existing on/off toggles in
-- notification_prefs are permanent (until the user un-toggles); this
-- adds a temporary "mute for 1 hour" affordance that auto-expires.
--
-- Storage: a single JSONB column on user_profiles, keyed by category
-- name, valued with the ISO timestamp at which the snooze EXPIRES.
-- A category is currently snoozed when its value > now().
--
-- Categories match the per-cat toggles in notification_prefs:
--   streak, quests, league, social, achievements, engagement, competitive

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS notification_snoozes JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.is_category_snoozed(p_user_id UUID, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_until TEXT;
  v_ts    TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_category IS NULL THEN RETURN FALSE; END IF;
  SELECT notification_snoozes ->> p_category INTO v_until
    FROM public.user_profiles WHERE id = p_user_id;
  IF v_until IS NULL OR v_until = '' THEN RETURN FALSE; END IF;
  BEGIN
    v_ts := v_until::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
  RETURN v_ts > now();
END;
$$;

REVOKE ALL ON FUNCTION public.is_category_snoozed(UUID, TEXT) FROM PUBLIC;

-- ── snooze_notification_category RPC ──────────────────────────────────
-- Sets the snooze expiry for the caller's category. Pass 0 minutes
-- (or NULL) to clear. Returns the new expiry (or NULL when cleared).

CREATE OR REPLACE FUNCTION public.snooze_notification_category(
  p_category TEXT,
  p_minutes  INT
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $snooze$
DECLARE
  v_uid    UUID := auth.uid();
  v_until  TIMESTAMPTZ;
  v_snooze JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_category IS NULL THEN
    RAISE EXCEPTION 'category required' USING ERRCODE = '22023';
  END IF;
  -- Soft cap at 24h so a misclick can't permanently mute someone.
  IF p_minutes IS NOT NULL AND (p_minutes < 0 OR p_minutes > 1440) THEN
    RAISE EXCEPTION 'minutes must be 0..1440' USING ERRCODE = '22023';
  END IF;

  IF p_minutes IS NULL OR p_minutes = 0 THEN
    -- Clear.
    UPDATE public.user_profiles
       SET notification_snoozes = COALESCE(notification_snoozes, '{}'::jsonb) - p_category
     WHERE id = v_uid;
    RETURN NULL;
  END IF;

  v_until := now() + (p_minutes || ' minutes')::interval;
  UPDATE public.user_profiles
     SET notification_snoozes = COALESCE(notification_snoozes, '{}'::jsonb)
       || jsonb_build_object(p_category, to_char(v_until, 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   WHERE id = v_uid;
  RETURN v_until;
END;
$snooze$;

REVOKE ALL ON FUNCTION public.snooze_notification_category(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.snooze_notification_category(TEXT, INT) TO authenticated;

-- ── Patch notify_push_fanout to short-circuit on active snooze ───────
-- Same shape as the existing quiet-hours check (mig 098): in-app row
-- still inserts; only the push delivery is suppressed. Sits AFTER the
-- per-category on/off check so a permanent-off still wins, and BEFORE
-- quiet hours so a snooze can suppress even when not in DND.

CREATE OR REPLACE FUNCTION public.notify_push_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url      TEXT;
  v_secret   TEXT;
  v_body     JSONB;
  v_category TEXT;
  v_prefs    JSONB;
  v_quiet    BOOLEAN;
  v_snoozed  BOOLEAN;
BEGIN
  BEGIN
    v_url    := current_setting('app.send_push_url',    true);
    v_secret := current_setting('app.send_push_secret', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN NEW;
  END IF;

  -- Per-category permanent on/off (mig 036 + 083).
  BEGIN
    v_category := public.notification_type_category(NEW.type);
    IF v_category IS NOT NULL THEN
      SELECT notification_prefs INTO v_prefs FROM public.user_profiles WHERE id = NEW.user_id;
      IF v_prefs IS NOT NULL AND v_prefs ? v_category AND (v_prefs ->> v_category) = 'false' THEN
        RETURN NEW;
      END IF;
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
  END;

  -- Per-category temporary snooze (mig 127). Only checked when we
  -- resolved a category above; types without a category are never
  -- snoozable through this path.
  IF v_category IS NOT NULL THEN
    BEGIN
      v_snoozed := public.is_category_snoozed(NEW.user_id, v_category);
      IF v_snoozed THEN RETURN NEW; END IF;
    EXCEPTION WHEN undefined_function THEN NULL;
    WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Quiet hours (mig 098).
  BEGIN
    v_quiet := public.is_in_quiet_hours(NEW.user_id);
    IF v_quiet THEN RETURN NEW; END IF;
  EXCEPTION WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
  END;

  v_body := jsonb_build_object(
    'user_id', NEW.user_id,
    'title',   COALESCE(NEW.title, 'Flexyn'),
    'body',    COALESCE(NEW.body,  ''),
    'icon',    NEW.icon,
    'url',     COALESCE(NEW.link_url, '/'),
    'tag',     NEW.type
  );

  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := v_body,
      headers := jsonb_build_object(
        'Content-Type',         'application/json',
        'X-Send-Push-Secret',   v_secret
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_push_fanout] dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_push_fanout() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 128_cycle_tracking.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 128_cycle_tracking.sql
--
-- Period / cycle tracking. Strictly opt-in (off by default), private
-- to the owner (RLS), no friends/crew sharing. The data lives behind
-- the `cycle_tracking_enabled` flag on user_profiles — clients must
-- check the flag before reading from cycle_logs OR exposing any
-- cycle-related UI.
--
-- Storage shape: one row per period START. Cycle phases (follicular /
-- ovulation / luteal / menstrual) are computed client-side from the
-- two most recent period starts — no need to denormalize phases here
-- (they change every few days and would drift quickly).
--
-- Why no symptoms table or detailed flow log: this is the MVP. A
-- single period-start log is enough to compute the active phase and
-- power the workout-suggestion adapter. Symptoms / flow / mood
-- tracking can come later as add-on tables.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS cycle_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cycle_length_days      INTEGER;  -- user override, NULL = use the 28-day default

CREATE TABLE IF NOT EXISTS public.cycle_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, start_date)
);

CREATE INDEX IF NOT EXISTS cycle_logs_user_idx
  ON public.cycle_logs (user_id, start_date DESC);

ALTER TABLE public.cycle_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycle_logs: read own"   ON public.cycle_logs;
DROP POLICY IF EXISTS "cycle_logs: write own"  ON public.cycle_logs;
DROP POLICY IF EXISTS "cycle_logs: delete own" ON public.cycle_logs;

-- Strict owner-only RLS. No public read; cycle data never leaves the
-- account even when other rows on user_profiles (username, total_xp)
-- do via the global User.list() leaderboard reads.
CREATE POLICY "cycle_logs: read own"
  ON public.cycle_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cycle_logs: write own"
  ON public.cycle_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "cycle_logs: delete own"
  ON public.cycle_logs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.cycle_logs TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 129_fitness_assessment.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 129_fitness_assessment.sql
--
-- 4-question fitness self-assessment captured in onboarding. The
-- starter regimen builder reads these signals to tune sets / reps /
-- exercise selection beyond what fitness_level alone says.
--
-- Storage: a single JSONB blob on user_profiles. Schema (all keys
-- optional; missing = "didn't answer"):
--   {
--     bench_bw:      'yes' | 'no' | 'not_yet' | null,
--     squat_bw15:    'yes' | 'no' | 'not_yet' | null,
--     pullups_10:    'yes' | 'no' | 'not_yet' | null,
--     mile_under10:  'yes' | 'no' | 'not_yet' | null
--   }
--
-- JSONB keeps this extensible — future assessments add keys without
-- a schema migration. The default '{}' so unauthenticated reads
-- (rare for this column) never return NULL.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS fitness_assessment JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
