-- ─────────────────────────────────────────────────────────────────────
-- _deploy_pending.sql — ONE-SHOT DEPLOY BUNDLE
--
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- Migrations 124-140 stitched together. Every statement is
-- idempotent so re-running is safe.
--
-- After this lands:
--   ✅ Coin gifting (124)
--   ✅ Weekly/Monthly leaderboards (125)
--   ✅ Emoji reactions on posts (126)
--   ✅ Per-category notification snooze (127)
--   ✅ Cycle tracking (128)
--   ✅ Onboarding fitness assessment (129)
--   ✅ Gym businesses ecosystem (135)
--   ✅ Owner notif on member join + admin-check upgrade (136)
--   ✅ 25-gym demo seed across major US metros (137)
--   ✅ Gym social feed — reactions, comments, pinned posts (138)
--   ✅ Gym event RSVPs (139)
--   ✅ Gym "About" fields — hours, amenities, photo gallery (140)
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

-- ═══════════════════════════════════════════════════════════════════
-- ── 135_gym_businesses.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 135_gym_businesses.sql
--
-- Gym Business Accounts foundation.
--
-- Architecture overview:
--   • user_profiles.account_type = 'user' | 'gym_owner' (defaults user)
--   • gym_businesses        — one row per verified physical location,
--                             owns a Flexyn Code, has geo-coords
--   • gym_verification_queue — pending business submissions awaiting
--                             admin review (status: pending/approved/rejected)
--   • gym_members           — junction: which users belong to which gyms
--                             (a user can be in N gyms — "My Gyms")
--   • gym_events            — events posted by gym owner or members
--   • gym_feed_posts        — local feed (separate from global hub_posts
--                             so RLS can scope visibility to members only)
--
-- Geo strategy: simple lat/lng columns + bounding-box queries for the
-- national map. PostGIS would be overkill for v1; bbox + a btree index
-- on (lat, lng) handles US-wide → street-level zoom efficiently.

-- ── 1. Account type on user_profiles ─────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'user'
    CHECK (account_type IN ('user', 'gym_owner'));

-- ── 2. Verification queue ────────────────────────────────────────────
-- Business owners submit details here BEFORE a gym_businesses row
-- exists. Flexyn admins review + approve, which atomically creates
-- the gym_businesses row + flips the owner's account_type if needed.

CREATE TABLE IF NOT EXISTS public.gym_verification_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email       TEXT NOT NULL,
  -- Submitted business details. Free-form during v1; structured
  -- validation will tighten later as we see what real submissions
  -- look like.
  business_name     TEXT NOT NULL,
  street_address    TEXT,
  city              TEXT,
  state_code        TEXT,           -- 2-char US state code (extensible)
  postal_code       TEXT,
  country_code      TEXT DEFAULT 'US',
  phone             TEXT,
  website_url       TEXT,
  proof_url         TEXT,           -- uploaded business license / lease
  -- Geo (provided by owner from the signup form OR geocoded later)
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  -- Review state
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_verification_owner_idx
  ON public.gym_verification_queue (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gym_verification_status_idx
  ON public.gym_verification_queue (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.gym_verification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_verif: read own"     ON public.gym_verification_queue;
DROP POLICY IF EXISTS "gym_verif: insert own"   ON public.gym_verification_queue;
DROP POLICY IF EXISTS "gym_verif: admin read"   ON public.gym_verification_queue;

CREATE POLICY "gym_verif: read own"
  ON public.gym_verification_queue FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "gym_verif: insert own"
  ON public.gym_verification_queue FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Admin reads are via service_role / admin RPCs only — no public
-- READ policy for arbitrary users.

GRANT SELECT, INSERT ON public.gym_verification_queue TO authenticated;

-- ── 3. gym_businesses — verified physical gyms ───────────────────────
CREATE TABLE IF NOT EXISTS public.gym_businesses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  verification_id   UUID UNIQUE REFERENCES public.gym_verification_queue(id),
  -- Business identity
  name              TEXT NOT NULL,
  description       TEXT,
  logo_url          TEXT,
  cover_url         TEXT,
  -- Location
  street_address    TEXT,
  city              TEXT,
  state_code        TEXT,
  postal_code       TEXT,
  country_code      TEXT DEFAULT 'US',
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  -- The Flexyn Code (8 chars, unambiguous alphabet: A-Z minus I/O,
  -- 2-9 minus 0/1). 32-char alphabet × 8 positions = ~10^12 possible
  -- codes, so collisions during random generation are negligible until
  -- the millions of gyms range.
  flexyn_code       TEXT NOT NULL UNIQUE
                      CHECK (flexyn_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  -- Counters denormalized for cheap leaderboard / hub renders
  member_count      INTEGER NOT NULL DEFAULT 0,
  -- Contact
  phone             TEXT,
  website_url       TEXT,
  -- Lifecycle
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bounding-box queries hit a composite btree index. Lat-first because
-- US latitude spans ~25-50° (narrow) while longitude spans ~-125 to
-- -65° (wider); the leading column gets better selectivity per band.
CREATE INDEX IF NOT EXISTS gym_businesses_geo_idx
  ON public.gym_businesses (latitude, longitude)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS gym_businesses_owner_idx
  ON public.gym_businesses (owner_id);

CREATE INDEX IF NOT EXISTS gym_businesses_code_idx
  ON public.gym_businesses (flexyn_code);

ALTER TABLE public.gym_businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_businesses: read all"        ON public.gym_businesses;
DROP POLICY IF EXISTS "gym_businesses: owner update"    ON public.gym_businesses;

-- Anyone authenticated can SEE gyms — needed for the map + discovery.
-- The sensitive fields (owner_id, phone) are still readable but the
-- client should not surface them on non-owner views.
CREATE POLICY "gym_businesses: read all"
  ON public.gym_businesses FOR SELECT
  TO authenticated USING (TRUE);

CREATE POLICY "gym_businesses: owner update"
  ON public.gym_businesses FOR UPDATE
  TO authenticated USING (owner_id = auth.uid());

-- INSERT is gated through the approval RPC (SECURITY DEFINER) — no
-- direct client insert path.

GRANT SELECT, UPDATE ON public.gym_businesses TO authenticated;

-- ── 4. gym_members — user-gym junction ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id      UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT NOT NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gym_id, user_id)
);

CREATE INDEX IF NOT EXISTS gym_members_user_idx
  ON public.gym_members (user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS gym_members_gym_idx
  ON public.gym_members (gym_id, joined_at DESC);

ALTER TABLE public.gym_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_members: read all"     ON public.gym_members;
DROP POLICY IF EXISTS "gym_members: join own"     ON public.gym_members;
DROP POLICY IF EXISTS "gym_members: leave own"    ON public.gym_members;

CREATE POLICY "gym_members: read all"
  ON public.gym_members FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "gym_members: join own"
  ON public.gym_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "gym_members: leave own"
  ON public.gym_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_members TO authenticated;

-- Member-count trigger keeps the denormalized counter in sync.
CREATE OR REPLACE FUNCTION public.gym_members_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_businesses
       SET member_count = COALESCE(member_count, 0) + 1
     WHERE id = NEW.gym_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_businesses
       SET member_count = GREATEST(0, COALESCE(member_count, 0) - 1)
     WHERE id = OLD.gym_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_members_count ON public.gym_members;
CREATE TRIGGER trg_gym_members_count
  AFTER INSERT OR DELETE ON public.gym_members
  FOR EACH ROW EXECUTE FUNCTION public.gym_members_count_sync();

-- ── 5. gym_events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  location_note TEXT,                  -- e.g. "Squat rack 3"
  rsvp_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_events_gym_idx
  ON public.gym_events (gym_id, starts_at DESC);

ALTER TABLE public.gym_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_events: members read"   ON public.gym_events;
DROP POLICY IF EXISTS "gym_events: owner write"    ON public.gym_events;
DROP POLICY IF EXISTS "gym_events: member create"  ON public.gym_events;

-- Members + owner can read.
CREATE POLICY "gym_events: members read"
  ON public.gym_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_events.gym_id AND gm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_events.gym_id AND gb.owner_id = auth.uid()
    )
  );

-- Members can create (v1; later restrict to owner if spammy).
CREATE POLICY "gym_events: member create"
  ON public.gym_events FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_events.gym_id AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_events: owner write"
  ON public.gym_events FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_events.gym_id AND gb.owner_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_events TO authenticated;

-- ── 6. gym_feed_posts — local community feed ─────────────────────────
-- Separate from global hub_posts so RLS can scope visibility to gym
-- members. Mirrors the hub_posts shape for client-side reuse.

CREATE TABLE IF NOT EXISTS public.gym_feed_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       UUID NOT NULL REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_email TEXT NOT NULL,
  body         TEXT NOT NULL,
  media_url    TEXT,
  like_count   INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_feed_posts_gym_idx
  ON public.gym_feed_posts (gym_id, created_at DESC);

ALTER TABLE public.gym_feed_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed: members read"   ON public.gym_feed_posts;
DROP POLICY IF EXISTS "gym_feed: members write"  ON public.gym_feed_posts;
DROP POLICY IF EXISTS "gym_feed: author delete"  ON public.gym_feed_posts;

CREATE POLICY "gym_feed: members read"
  ON public.gym_feed_posts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_feed_posts.gym_id AND gm.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.gym_businesses gb
       WHERE gb.id = gym_feed_posts.gym_id AND gb.owner_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed: members write"
  ON public.gym_feed_posts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_members gm
       WHERE gm.gym_id = gym_feed_posts.gym_id AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed: author delete"
  ON public.gym_feed_posts FOR DELETE TO authenticated
  USING (author_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_posts TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────────────

-- ── generate_flexyn_code ─────────────────────────────────────────────
-- Returns an unused 8-char code from the safe alphabet (no 0/1/I/O).
-- Loops until uniqueness; collisions essentially never happen at
-- realistic gym counts but the guard is here for correctness.

CREATE OR REPLACE FUNCTION public.generate_flexyn_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_n        INT;
  v_i        INT;
BEGIN
  FOR v_i IN 1..50 LOOP
    v_code := '';
    FOR v_n IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.gym_businesses WHERE flexyn_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'could not generate unique flexyn code after 50 tries';
END;
$$;

REVOKE ALL ON FUNCTION public.generate_flexyn_code() FROM PUBLIC;

-- ── submit_gym_verification ──────────────────────────────────────────
-- Owner submits their business for review. Sets account_type to
-- 'gym_owner' eagerly so the UI can branch correctly even before
-- approval (the user's identity is "pending business" until approved).

CREATE OR REPLACE FUNCTION public.submit_gym_verification(
  p_business_name TEXT,
  p_street_address TEXT,
  p_city           TEXT,
  p_state_code     TEXT,
  p_postal_code    TEXT,
  p_country_code   TEXT DEFAULT 'US',
  p_phone          TEXT DEFAULT NULL,
  p_website_url    TEXT DEFAULT NULL,
  p_proof_url      TEXT DEFAULT NULL,
  p_latitude       DOUBLE PRECISION DEFAULT NULL,
  p_longitude      DOUBLE PRECISION DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_business_name IS NULL OR length(trim(p_business_name)) < 2 THEN
    RAISE EXCEPTION 'business_name required' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_verification_queue (
    owner_id, owner_email, business_name, street_address, city, state_code,
    postal_code, country_code, phone, website_url, proof_url, latitude, longitude
  )
  VALUES (
    v_uid, v_email, p_business_name, p_street_address, p_city, p_state_code,
    p_postal_code, p_country_code, p_phone, p_website_url, p_proof_url,
    p_latitude, p_longitude
  )
  RETURNING id INTO v_id;

  -- Eager-flip account type so the UI knows this user is a pending owner.
  UPDATE public.user_profiles
     SET account_type = 'gym_owner'
   WHERE id = v_uid AND account_type = 'user';

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_gym_verification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_gym_verification(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

-- ── approve_gym_verification ─────────────────────────────────────────
-- Admin-only. Creates the gym_businesses row, generates the code,
-- flips the verification row to approved.
--
-- The admin gate is on the caller's username matching the
-- ADMIN_USERNAMES list (mirrors src/lib/adminRoles.js). For v1 we
-- check via a small inline list; future: dedicated admin_users table.

CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_admin_check  BOOLEAN;
  v_verif        public.gym_verification_queue%ROWTYPE;
  v_code         TEXT;
  v_gym_id       UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  -- Admin check via app_admins.is_admin (set by the team manually)
  SELECT (username IN ('kegan', 'sean', 'admin')) INTO v_admin_check
    FROM public.user_profiles WHERE id = v_uid;
  IF NOT COALESCE(v_admin_check, FALSE) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_verif FROM public.gym_verification_queue WHERE id = p_verif_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_verif.status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_verif.status USING ERRCODE = '22023';
  END IF;
  IF v_verif.latitude IS NULL OR v_verif.longitude IS NULL THEN
    RAISE EXCEPTION 'geo coords required before approval' USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_verif.owner_id, v_verif.id, v_verif.business_name, v_verif.street_address,
    v_verif.city, v_verif.state_code, v_verif.postal_code, v_verif.country_code,
    v_verif.latitude, v_verif.longitude, v_code,
    v_verif.phone, v_verif.website_url
  )
  RETURNING id INTO v_gym_id;

  UPDATE public.gym_verification_queue
     SET status = 'approved', reviewed_at = now(), reviewed_by = v_uid
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;

-- ── join_gym_by_code ─────────────────────────────────────────────────
-- User scans/types a code → joins the gym. Idempotent — a second
-- join attempt by the same user returns the existing membership.

CREATE OR REPLACE FUNCTION public.join_gym_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_gym_id UUID;
  v_member_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR length(p_code) <> 8 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;

  SELECT id INTO v_gym_id FROM public.gym_businesses
   WHERE flexyn_code = upper(trim(p_code)) AND is_active = TRUE;
  IF v_gym_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'CODE_NOT_FOUND');
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym_id, v_uid, v_email)
  ON CONFLICT (gym_id, user_id) DO NOTHING
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object('ok', TRUE, 'gymId', v_gym_id,
                            'memberId', v_member_id,
                            'alreadyMember', v_member_id IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.join_gym_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_gym_by_code(TEXT) TO authenticated;

-- ── get_gyms_in_bbox ─────────────────────────────────────────────────
-- Map query — returns active gyms inside the given bounding box.
-- Capped at 500 to keep nationwide-zoom payloads sane.

CREATE OR REPLACE FUNCTION public.get_gyms_in_bbox(
  p_min_lat DOUBLE PRECISION,
  p_max_lat DOUBLE PRECISION,
  p_min_lng DOUBLE PRECISION,
  p_max_lng DOUBLE PRECISION,
  p_limit   INT DEFAULT 500
) RETURNS TABLE (
  id           UUID,
  name         TEXT,
  city         TEXT,
  state_code   TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  member_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, name, city, state_code, latitude, longitude, member_count
    FROM public.gym_businesses
   WHERE is_active = TRUE
     AND latitude  BETWEEN p_min_lat AND p_max_lat
     AND longitude BETWEEN p_min_lng AND p_max_lng
   ORDER BY member_count DESC, name ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.get_gyms_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gyms_in_bbox(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INT) TO authenticated;

-- ── get_gym_leaderboard ──────────────────────────────────────────────
-- Returns members of a gym ranked by their stat — defaults to total
-- volume lifted. Mode: 'volume' | 'xp' | 'streak'.

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
DECLARE
  v_mode TEXT := COALESCE(p_mode, 'volume');
BEGIN
  IF v_mode NOT IN ('volume', 'xp', 'streak') THEN
    RAISE EXCEPTION 'invalid mode' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH ranked AS (
      SELECT
        p.id          AS user_id,
        p.username,
        p.avatar_url,
        CASE v_mode
          WHEN 'volume' THEN COALESCE(p.total_volume_lbs, 0)::NUMERIC
          WHEN 'xp'     THEN COALESCE(p.total_xp,         0)::NUMERIC
          WHEN 'streak' THEN COALESCE(p.workout_streak,   0)::NUMERIC
        END AS value
      FROM public.gym_members gm
      JOIN public.user_profiles p ON p.id = gm.user_id
      WHERE gm.gym_id = p_gym_id
    )
    SELECT user_id, username, avatar_url, value,
           RANK() OVER (ORDER BY value DESC)::INT AS rank
      FROM ranked
     WHERE value > 0
     ORDER BY value DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_leaderboard(UUID, TEXT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 136_gym_member_notifications.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 136_gym_member_notifications.sql
--
-- Notify the gym owner when someone joins their gym. Trigger fires
-- AFTER INSERT on gym_members, looks up the owner, inserts a
-- notification row scoped to that owner. The existing push-fanout
-- trigger on `notifications` does the rest (in-app + push).
--
-- Throttled to avoid spam when a new gym goes viral: skip if the
-- owner already received a gym_member_joined notif in the last 10
-- minutes for the same gym. We aggregate batches under a single
-- "+N more joined today" feel via the count in the body — clients
-- can collapse repeats later if needed.

CREATE OR REPLACE FUNCTION public.notify_gym_owner_on_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id    UUID;
  v_owner_email TEXT;
  v_gym_name    TEXT;
  v_joiner_name TEXT;
  v_recent_count INT;
  v_total_members INT;
BEGIN
  -- Skip if the joiner IS the owner (e.g. owner test-joining their
  -- own gym shouldn't ping themselves).
  SELECT gb.owner_id, u.email, gb.name, gb.member_count
    INTO v_owner_id, v_owner_email, v_gym_name, v_total_members
    FROM public.gym_businesses gb
    JOIN auth.users u ON u.id = gb.owner_id
   WHERE gb.id = NEW.gym_id;

  IF v_owner_id IS NULL OR v_owner_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Throttle: at most one notif per gym per 10 minutes.
  SELECT COUNT(*) INTO v_recent_count
    FROM public.notifications
   WHERE user_id = v_owner_id
     AND type = 'gym_member_joined'
     AND (metadata ->> 'gymId') = NEW.gym_id::text
     AND created_at > now() - INTERVAL '10 minutes';
  IF v_recent_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Resolve a friendly display name for the joiner.
  SELECT COALESCE(username, NULLIF(split_part(email, '@', 1), ''))
    INTO v_joiner_name
    FROM public.user_profiles
   WHERE id = NEW.user_id;

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (v_owner_id,
     v_owner_email,
     'gym_member_joined',
     'New gym member',
     COALESCE('@' || NULLIF(v_joiner_name, '') || ' joined ' || v_gym_name,
              'A new member joined ' || v_gym_name),
     '🏋',
     '/gym/' || NEW.gym_id::text,
     jsonb_build_object(
       'gymId',       NEW.gym_id,
       'joinerId',    NEW.user_id,
       'joinerName',  v_joiner_name,
       'memberCount', v_total_members
     ));

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_gym_owner_on_join() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_notify_gym_owner_on_join ON public.gym_members;
CREATE TRIGGER trg_notify_gym_owner_on_join
  AFTER INSERT ON public.gym_members
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_gym_owner_on_join();

-- Map the new notification type to its category for per-category
-- on/off + snooze + quiet-hours respect. Treat as 'social' since
-- it's a person-driven engagement event (mirrors friend_follow).
--
-- The notification_type_category function already exists from
-- migration 083 — we patch it via CREATE OR REPLACE to add the
-- new mapping. Function body is preserved exactly except for the
-- new WHEN branch.
CREATE OR REPLACE FUNCTION public.notification_type_category(p_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    -- Streak / login retention
    WHEN p_type IN ('streak_break', 'streak_rescued', 'login_streak') THEN 'streak'
    -- Quests / daily missions
    WHEN p_type IN ('quest_complete', 'quest_expiring', 'quest_streak') THEN 'quests'
    -- League / leaderboard
    WHEN p_type IN ('league_promoted', 'league_demoted', 'league_held',
                    'league_started', 'league_ending') THEN 'league'
    -- Achievements / milestones
    WHEN p_type IN ('achievement_unlocked', 'milestone_hit', 'pr_celebrated',
                    'first_workout', 'first_regimen', 'first_goal',
                    'capsule_milestone') THEN 'achievements'
    -- Competitive (duel / bounty / nemesis / crew war)
    WHEN p_type IN ('duel_invite', 'duel_result', 'duel_ending',
                    'bounty_claim', 'bounty_beaten', 'bounty_expiring',
                    'crew_war_started', 'crew_war_resolved',
                    'nemesis_assigned', 'nemesis_overthrown',
                    'gauntlet_unlocked', 'gauntlet_complete',
                    'weekly_gauntlet_started',
                    'crew_challenge_created', 'crew_challenge_complete') THEN 'competitive'
    -- Social (follows / posts / DMs / story reactions / coin gifts / gym joins)
    WHEN p_type IN ('friend_follow', 'friend_post', 'comment_reply',
                    'post_reaction', 'sticker_reaction', 'trade_offer',
                    'dm_received', 'memory_resurfaced',
                    'story_reaction', 'coin_gift',
                    'gym_member_joined') THEN 'social'
    -- Engagement / win-back
    WHEN p_type IN ('welcome_back', 'comeback_protocol', 'referral_credited') THEN 'engagement'
    ELSE NULL
  END;
$$;

-- ── Patch approve_gym_verification to use is_app_admin (mig 103) ─
-- The v1 version of this RPC (in mig 135) had a hardcoded username
-- list. Switch to the canonical is_app_admin(uid) function so admin
-- changes only need to land in ONE place.
CREATE OR REPLACE FUNCTION public.approve_gym_verification(p_verif_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_verif  public.gym_verification_queue%ROWTYPE;
  v_code   TEXT;
  v_gym_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_app_admin(v_uid) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_verif FROM public.gym_verification_queue WHERE id = p_verif_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verification record not found' USING ERRCODE = '22023';
  END IF;
  IF v_verif.status <> 'pending' THEN
    RAISE EXCEPTION 'already %', v_verif.status USING ERRCODE = '22023';
  END IF;
  IF v_verif.latitude IS NULL OR v_verif.longitude IS NULL THEN
    RAISE EXCEPTION 'geo coords required before approval' USING ERRCODE = '22023';
  END IF;

  v_code := public.generate_flexyn_code();

  INSERT INTO public.gym_businesses (
    owner_id, verification_id, name, street_address, city, state_code,
    postal_code, country_code, latitude, longitude, flexyn_code,
    phone, website_url
  )
  VALUES (
    v_verif.owner_id, v_verif.id, v_verif.business_name, v_verif.street_address,
    v_verif.city, v_verif.state_code, v_verif.postal_code, v_verif.country_code,
    v_verif.latitude, v_verif.longitude, v_code,
    v_verif.phone, v_verif.website_url
  )
  RETURNING id INTO v_gym_id;

  UPDATE public.gym_verification_queue
     SET status = 'approved', reviewed_at = now(), reviewed_by = v_uid
   WHERE id = p_verif_id;

  RETURN v_gym_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_gym_verification(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_gym_verification(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 137_gym_demo_seed_and_polish.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 137_gym_demo_seed_and_polish.sql
--
-- "Make sure the map shows something" — seeds 25 demonstration gyms
-- across the major US metros so the national map renders alive from
-- the moment the migrations land, instead of staring at a blank
-- continent waiting for real owners to sign up.
--
-- Also flips `gym_businesses.owner_id` to NULLABLE so these demo
-- rows can exist without an auth.users row backing them. Real gyms
-- (created via approve_gym_verification) ALWAYS get a real owner
-- from the verification queue — that path is unchanged.
--
-- Idempotent: every INSERT uses ON CONFLICT (flexyn_code) DO NOTHING
-- so re-running this migration (or pasting the deploy bundle twice)
-- is a no-op. The codes are hardcoded for determinism — re-runs hit
-- the same codes every time.
--
-- To CLEAN UP demos later (e.g. once enough real gyms exist), run:
--   DELETE FROM gym_businesses WHERE owner_id IS NULL AND name LIKE 'Demo:%';

-- ── Schema patch: allow owner-less demo gyms ─────────────────────────
ALTER TABLE public.gym_businesses
  ALTER COLUMN owner_id DROP NOT NULL;

-- ── Seed: 25 gyms across major US metros ────────────────────────────
-- Each name carries the "Demo:" prefix so they're easy to identify
-- visually + easy to bulk-delete. Member counts seeded to a small
-- positive number so they don't all sort last on the leaderboard.

INSERT INTO public.gym_businesses (
  name, city, state_code, country_code, latitude, longitude,
  flexyn_code, description, member_count
) VALUES
  ('Demo: Iron House Tribeca',      'New York',      'NY', 'US', 40.7195, -74.0089, 'NYC2DEMO',  'Demo gym in Tribeca.',          47),
  ('Demo: Brooklyn Strength Society','Brooklyn',     'NY', 'US', 40.6892, -73.9442, 'BKN3DEMO',  'Demo gym in Williamsburg.',     34),
  ('Demo: Venice Beach Fitness',    'Los Angeles',   'CA', 'US', 33.9850, -118.4695,'LAX4DEMO',  'Demo gym near the boardwalk.',  82),
  ('Demo: Hollywood Iron Club',     'Los Angeles',   'CA', 'US', 34.0928, -118.3287,'HLY5DEMO',  'Demo gym in Hollywood.',        51),
  ('Demo: SoMa Strength',           'San Francisco', 'CA', 'US', 37.7785, -122.4056,'SF67DEMO',  'Demo gym in SoMa.',             29),
  ('Demo: Mission Crossfit',        'San Francisco', 'CA', 'US', 37.7599, -122.4148,'SF8MDEMO',  'Demo gym in the Mission.',      62),
  ('Demo: Wicker Park Athletics',   'Chicago',       'IL', 'US', 41.9090, -87.6769, 'CHI9DEMO',  'Demo gym in Wicker Park.',      41),
  ('Demo: Loop Lifters Club',       'Chicago',       'IL', 'US', 41.8825, -87.6233, 'LPL2DEMO',  'Demo gym in The Loop.',         38),
  ('Demo: Cambridge Strength Lab',  'Cambridge',     'MA', 'US', 42.3736, -71.1097, 'CMB3DEMO',  'Demo gym near Harvard.',        24),
  ('Demo: Back Bay Barbell',        'Boston',        'MA', 'US', 42.3505, -71.0743, 'BBB4DEMO',  'Demo gym in Back Bay.',         55),
  ('Demo: Wynwood Fitness',         'Miami',         'FL', 'US', 25.8010, -80.1990, 'WYN5DEMO',  'Demo gym in Wynwood.',          73),
  ('Demo: South Beach Strength',    'Miami Beach',   'FL', 'US', 25.7826, -80.1340, 'SOB6DEMO',  'Demo gym on South Beach.',      89),
  ('Demo: Capitol Hill Iron',       'Seattle',       'WA', 'US', 47.6253, -122.3222,'CAP7DEMO',  'Demo gym on Cap Hill.',         33),
  ('Demo: Pioneer Square Athletics','Seattle',       'WA', 'US', 47.6010, -122.3346,'PIO8DEMO',  'Demo gym downtown.',            27),
  ('Demo: South Congress Strength', 'Austin',        'TX', 'US', 30.2502, -97.7491, 'ATX9DEMO',  'Demo gym on SoCo.',             45),
  ('Demo: East Austin Athletics',   'Austin',        'TX', 'US', 30.2622, -97.7137, 'EAA2DEMO',  'Demo gym in East Austin.',      52),
  ('Demo: Highlands Iron Co.',      'Denver',        'CO', 'US', 39.7670, -105.0173,'DEN3DEMO',  'Demo gym in the Highlands.',    36),
  ('Demo: RiNo Strength',           'Denver',        'CO', 'US', 39.7669, -104.9839,'RIN4DEMO',  'Demo gym in RiNo.',             44),
  ('Demo: Old Fourth Ward Athletics','Atlanta',      'GA', 'US', 33.7666, -84.3658, 'ATL5DEMO',  'Demo gym in O4W.',              31),
  ('Demo: Westside Iron Club',      'Atlanta',       'GA', 'US', 33.7790, -84.4106, 'WST6DEMO',  'Demo gym on the Westside.',     58),
  ('Demo: Pearl District Athletics','Portland',      'OR', 'US', 45.5273, -122.6817,'PDX7DEMO',  'Demo gym in the Pearl.',        42),
  ('Demo: Deep Ellum Iron Club',    'Dallas',        'TX', 'US', 32.7846, -96.7842, 'DAL8DEMO',  'Demo gym in Deep Ellum.',       66),
  ('Demo: Heights Strength Society','Houston',       'TX', 'US', 29.7989, -95.4030, 'HOU9DEMO',  'Demo gym in The Heights.',      49),
  ('Demo: Fishtown Athletics',      'Philadelphia',  'PA', 'US', 39.9719, -75.1308, 'PHL2DEMO',  'Demo gym in Fishtown.',         37),
  ('Demo: East Nashville Iron Co.', 'Nashville',     'TN', 'US', 36.1779, -86.7385, 'BNA3DEMO',  'Demo gym in East Nashville.',   54)
ON CONFLICT (flexyn_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 138_gym_feed_social.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 138_gym_feed_social.sql
--
-- "Social home page" for each gym. The gym_feed_posts table already
-- exists from mig 135 (member-only RLS, body + media_url, denormalized
-- like_count + comment_count). This migration fills out the social
-- layer:
--   • gym_feed_post_reactions  — emoji reactions (any emoji, multiple
--                                  per user)
--   • gym_feed_comments        — inline comments with parent_id for
--                                  nested replies (flat for v1, schema
--                                  ready for threading later)
--   • gym_feed_posts.is_pinned + pinned_at — owner can pin ONE post
--                                  to the top of the feed
--   • gym_feed_posts.reaction_count — denormalized counter for the
--                                  card UI; kept in sync by trigger
--
-- All tables inherit member-only visibility through the parent feed
-- post's RLS via existence checks.

-- ── New columns on the existing feed table ───────────────────────────
ALTER TABLE public.gym_feed_posts
  ADD COLUMN IF NOT EXISTS is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reaction_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edited_at       TIMESTAMPTZ;

-- One pinned post per gym at a time — enforced by a partial unique
-- index. The owner-pin RPC below auto-unpins the previous pinned
-- post before pinning a new one, so this constraint should never
-- actually trip; it's belt + braces.
CREATE UNIQUE INDEX IF NOT EXISTS gym_feed_one_pinned_per_gym
  ON public.gym_feed_posts (gym_id)
  WHERE is_pinned = TRUE;

-- ── gym_feed_post_reactions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_feed_post_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES public.gym_feed_posts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL CHECK (char_length(emoji) <= 10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS gym_feed_rxn_post_idx
  ON public.gym_feed_post_reactions (post_id);

ALTER TABLE public.gym_feed_post_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed_rxn: members read"  ON public.gym_feed_post_reactions;
DROP POLICY IF EXISTS "gym_feed_rxn: own write"     ON public.gym_feed_post_reactions;
DROP POLICY IF EXISTS "gym_feed_rxn: own delete"    ON public.gym_feed_post_reactions;

-- Read gated through the parent post's member-only visibility.
CREATE POLICY "gym_feed_rxn: members read"
  ON public.gym_feed_post_reactions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_post_reactions.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_rxn: own write"
  ON public.gym_feed_post_reactions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "gym_feed_rxn: own delete"
  ON public.gym_feed_post_reactions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_post_reactions TO authenticated;

-- Counter sync trigger — keeps gym_feed_posts.reaction_count fresh
-- without a separate refresh job.
CREATE OR REPLACE FUNCTION public.gym_feed_rxn_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_feed_posts
       SET reaction_count = COALESCE(reaction_count, 0) + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_feed_posts
       SET reaction_count = GREATEST(0, COALESCE(reaction_count, 0) - 1)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_feed_rxn_count ON public.gym_feed_post_reactions;
CREATE TRIGGER trg_gym_feed_rxn_count
  AFTER INSERT OR DELETE ON public.gym_feed_post_reactions
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_rxn_count_sync();

-- ── gym_feed_comments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gym_feed_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES public.gym_feed_posts(id) ON DELETE CASCADE,
  parent_id     UUID REFERENCES public.gym_feed_comments(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_email  TEXT NOT NULL,
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gym_feed_comments_post_idx
  ON public.gym_feed_comments (post_id, created_at);

ALTER TABLE public.gym_feed_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gym_feed_comments: members read"  ON public.gym_feed_comments;
DROP POLICY IF EXISTS "gym_feed_comments: members write" ON public.gym_feed_comments;
DROP POLICY IF EXISTS "gym_feed_comments: author delete" ON public.gym_feed_comments;

CREATE POLICY "gym_feed_comments: members read"
  ON public.gym_feed_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_comments.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_comments: members write"
  ON public.gym_feed_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.gym_feed_posts gfp
        JOIN public.gym_members gm ON gm.gym_id = gfp.gym_id
       WHERE gfp.id = gym_feed_comments.post_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "gym_feed_comments: author delete"
  ON public.gym_feed_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.gym_feed_comments TO authenticated;

-- Counter sync for gym_feed_posts.comment_count.
CREATE OR REPLACE FUNCTION public.gym_feed_comment_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.gym_feed_posts
       SET comment_count = COALESCE(comment_count, 0) + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.gym_feed_posts
       SET comment_count = GREATEST(0, COALESCE(comment_count, 0) - 1)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_feed_comment_count ON public.gym_feed_comments;
CREATE TRIGGER trg_gym_feed_comment_count
  AFTER INSERT OR DELETE ON public.gym_feed_comments
  FOR EACH ROW EXECUTE FUNCTION public.gym_feed_comment_count_sync();

-- ── Pin / unpin RPC (owner-only) ────────────────────────────────────
-- Owners can pin ONE post per gym at a time. Pinning a new post
-- auto-unpins whatever was pinned before, so the unique index never
-- trips. The "pin only your own gym's posts" gate is enforced via
-- the owner_id check on the joined gym row.

CREATE OR REPLACE FUNCTION public.toggle_pin_gym_post(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_post   public.gym_feed_posts%ROWTYPE;
  v_owner  UUID;
  v_was    BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_post FROM public.gym_feed_posts WHERE id = p_post_id;
  IF v_post.id IS NULL THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id INTO v_owner FROM public.gym_businesses WHERE id = v_post.gym_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'owner only' USING ERRCODE = '42501';
  END IF;

  v_was := v_post.is_pinned;

  -- If we're about to pin and another post is already pinned in
  -- this gym, unpin it first so the unique-pin index stays happy.
  IF NOT v_was THEN
    UPDATE public.gym_feed_posts
       SET is_pinned = FALSE, pinned_at = NULL
     WHERE gym_id = v_post.gym_id AND is_pinned = TRUE;
  END IF;

  UPDATE public.gym_feed_posts
     SET is_pinned = NOT v_was,
         pinned_at = CASE WHEN NOT v_was THEN now() ELSE NULL END
   WHERE id = p_post_id;

  RETURN NOT v_was;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_pin_gym_post(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_pin_gym_post(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 139_gym_event_rsvps.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 139_gym_event_rsvps.sql
--
-- Event RSVPs. Three statuses: 'going' | 'maybe' | 'cant'. One row
-- per (event, user) — toggling the same status removes the RSVP,
-- switching status updates in place. Counter on gym_events.rsvp_count
-- already exists (mig 135); a trigger keeps it as "going" count
-- specifically (the headline number members see on the event card).

CREATE TABLE IF NOT EXISTS public.gym_event_rsvps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.gym_events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'cant')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS gym_event_rsvps_event_idx
  ON public.gym_event_rsvps (event_id);

ALTER TABLE public.gym_event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvp: members read"   ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own write"      ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own update"     ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own delete"     ON public.gym_event_rsvps;

CREATE POLICY "rsvp: members read"
  ON public.gym_event_rsvps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_events ge
        JOIN public.gym_members gm ON gm.gym_id = ge.gym_id
       WHERE ge.id = gym_event_rsvps.event_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "rsvp: own write"
  ON public.gym_event_rsvps FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "rsvp: own update"
  ON public.gym_event_rsvps FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "rsvp: own delete"
  ON public.gym_event_rsvps FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_event_rsvps TO authenticated;

-- Counter sync — track "going" specifically; "maybe" and "cant" stay
-- in the row but don't bump the headline number on event cards.
CREATE OR REPLACE FUNCTION public.gym_event_rsvp_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = COALESCE(rsvp_count, 0) + 1
       WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'going' AND NEW.status <> 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = GREATEST(0, COALESCE(rsvp_count, 0) - 1)
       WHERE id = NEW.event_id;
    ELSIF OLD.status <> 'going' AND NEW.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = COALESCE(rsvp_count, 0) + 1
       WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = GREATEST(0, COALESCE(rsvp_count, 0) - 1)
       WHERE id = OLD.event_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_event_rsvp_count ON public.gym_event_rsvps;
CREATE TRIGGER trg_gym_event_rsvp_count
  AFTER INSERT OR UPDATE OR DELETE ON public.gym_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.gym_event_rsvp_count_sync();

-- Batch reader — returns every RSVP for a set of events. Used by the
-- events tab to render each card's count + the caller's own status.
CREATE OR REPLACE FUNCTION public.get_gym_event_rsvps_bulk(p_event_ids UUID[])
RETURNS TABLE (event_id UUID, user_id UUID, status TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT event_id, user_id, status
    FROM public.gym_event_rsvps
   WHERE event_id = ANY(p_event_ids);
$$;

REVOKE ALL ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- ── 140_gym_about_fields.sql ──
-- ═══════════════════════════════════════════════════════════════════
-- 140_gym_about_fields.sql
--
-- "About" surface for a gym: weekly hours, amenity list, and a small
-- photo gallery beyond the single cover image.
--
-- All three are stored as JSON / arrays on gym_businesses so we don't
-- need separate tables — each gym has at most ~20 amenities and ~10
-- gallery photos in practice. Owner-only writes via the existing
-- "gym_businesses: owner update" RLS policy from mig 135; no new
-- policies needed.
--
-- Shapes:
--   hours      JSONB  — { mon: { open, close }, tue: { ... }, ... }
--                       Day keys: mon, tue, wed, thu, fri, sat, sun
--                       Times: "06:00" / "22:00" 24h strings (or null
--                       for "closed"). `{}` = "hours not set yet."
--   amenities  TEXT[] — slugs from a controlled vocabulary in the UI:
--                       parking, showers, sauna, lockers, cardio_zone,
--                       free_weights, classes, personal_training, etc.
--   photo_urls TEXT[] — public URLs in the avatars bucket. Cap 10 in
--                       the client; nothing to enforce server-side
--                       until that becomes a problem.

ALTER TABLE public.gym_businesses
  ADD COLUMN IF NOT EXISTS hours      JSONB    NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS amenities  TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[]   NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
