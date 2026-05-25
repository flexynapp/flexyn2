-- 147_critical_security_and_correctness_fixes.sql
--
-- Five fixes for issues surfaced in the 2026-05-25 overnight audit
-- (see audit-findings/02-rpc-auth-gating.md and 03-migrations-143-146.md).
-- Three are critical (economy mintable / company-wide write blocked /
-- account deletion blocked); the other two are high-severity (privilege
-- escalation / data integrity).
--
-- ALL CHANGES IDEMPOTENT — re-running this migration is safe.
-- Wrapped in DO-blocks with EXISTS guards where ALTER TABLE is involved
-- so it's safe to apply BEFORE migrations 143-146 have been pasted into
-- the SQL Editor (in which case the ALTERs are no-ops until the tables
-- arrive — re-running this file after 143-146 lands will then enforce).
--
-- ─────────────────────────────────────────────────────────────────────
-- FIX 1 (CRITICAL) — grant_flex_coins economy exploit
-- ─────────────────────────────────────────────────────────────────────
-- Before: any authenticated client could call
--   rpc('grant_flex_coins',{p_user_id:'<self>',p_delta:999999999})
-- to mint unlimited coins. Mig 101 GRANT EXECUTE to authenticated.
--
-- After: only postgres (= SECURITY DEFINER callers running as the
-- function owner) can invoke. The single legitimate caller, claim_referral
-- in mig 089, IS a SECURITY DEFINER function, so it bypasses the grant
-- restriction and keeps working.
--
-- Grep confirmed: no src/ code calls grant_flex_coins. claim_referral
-- is the only consumer.

REVOKE EXECUTE ON FUNCTION public.grant_flex_coins(UUID, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_flex_coins(UUID, INTEGER) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 2 (CRITICAL) — record_monthly_xp privilege escalation
-- ─────────────────────────────────────────────────────────────────────
-- Before: takes arbitrary p_user_id + p_amount, granted to authenticated,
-- no auth check. Attacker could pass their own (or any) uid and arbitrary
-- amount to jump the monthly league leaderboard.
--
-- After: derive caller from auth.uid() server-side, ignore p_user_id /
-- p_email if they don't match (raise on mismatch), cap p_amount at 5000
-- per call to mirror mig 042's xp_out_of_range pattern.
--
-- Grep confirmed: no src/ caller. Tightening is safe.

CREATE OR REPLACE FUNCTION public.record_monthly_xp(
  p_user_id  UUID,
  p_email    TEXT,
  p_tier     TEXT,
  p_amount   INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $record_monthly_xp$
DECLARE
  v_uid         UUID := auth.uid();
  v_email       TEXT;
  v_month_start DATE := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_month_end   DATE := (date_trunc('month', now() AT TIME ZONE 'UTC') + INTERVAL '1 month - 1 day')::date;
  v_league_id   UUID;
  v_member_id   UUID;
  v_safe_amount INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Reject mismatched p_user_id. We accept the param for API compatibility
  -- with existing callers, but a mismatch is now a hard error rather than
  -- silent acceptance of an arbitrary target. Pass NULL to default to self.
  IF p_user_id IS NOT NULL AND p_user_id <> v_uid THEN
    RAISE EXCEPTION 'cannot record xp for another user' USING ERRCODE = '42501';
  END IF;

  -- Resolve email server-side; ignore p_email (param kept for compat).
  SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'profile missing' USING ERRCODE = 'P0002';
  END IF;

  -- Validate tier against the same allow-list weekly leagues use.
  IF p_tier IS NULL OR p_tier NOT IN ('bronze','silver','gold','platinum','diamond','master','grandmaster') THEN
    RAISE EXCEPTION 'invalid tier' USING ERRCODE = '22023';
  END IF;

  -- Cap amount at 5_000 per call. Mirrors mig 042's increment_user_xp
  -- defense (which caps at 100_000 but XP and league-XP have different
  -- magnitudes — 5_000 is generous for a single workout).
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;
  v_safe_amount := LEAST(p_amount, 5000);

  -- Find open league for this tier+month with capacity
  SELECT id INTO v_league_id
    FROM public.monthly_leagues
   WHERE tier        = p_tier
     AND month_start = v_month_start
     AND is_resolved = false
     AND member_count < 200
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_league_id IS NULL THEN
    INSERT INTO public.monthly_leagues (tier, month_start, month_end, member_count)
    VALUES (p_tier, v_month_start, v_month_end, 0)
    RETURNING id INTO v_league_id;
  END IF;

  INSERT INTO public.monthly_league_members (league_id, user_id, user_email, monthly_xp)
  VALUES (v_league_id, v_uid, v_email, v_safe_amount)
  ON CONFLICT (league_id, user_id)
  DO UPDATE SET monthly_xp = public.monthly_league_members.monthly_xp + v_safe_amount
  RETURNING id INTO v_member_id;

  -- Bump league member_count if this was the first row for the user.
  IF v_member_id IS NOT NULL THEN
    UPDATE public.monthly_leagues
       SET member_count = (SELECT COUNT(*) FROM public.monthly_league_members WHERE league_id = v_league_id)
     WHERE id = v_league_id;
  END IF;
END;
$record_monthly_xp$;

REVOKE ALL    ON FUNCTION public.record_monthly_xp(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_monthly_xp(UUID, TEXT, TEXT, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 3 (CRITICAL) — create_organization base32 encoding bug
-- ─────────────────────────────────────────────────────────────────────
-- Before: `encode(gen_random_bytes(8), 'base32')` — Postgres encode()
-- only supports 'base64' | 'hex' | 'escape'. Every create_organization
-- call raised `ERROR: unrecognized encoding: "base32"`. No org could
-- ever be created.
--
-- After: build the code from a fixed alphabet that excludes ambiguous
-- chars (no O/0, I/1, L, B/8) by mapping random bytes onto the alphabet
-- index. Deterministic, no encoding surprises.
--
-- DO-block guarded so this CREATE OR REPLACE only fires if mig 146 has
-- already created the organizations table. Otherwise it's a no-op until
-- 146 lands.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT)
      RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      DECLARE
        v_uid     UUID := auth.uid();
        v_code    TEXT;
        v_org     UUID;
        v_try     INT := 0;
        v_alpha   TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 chars, no O/0 I/1 L B
        v_bytes   BYTEA;
        v_idx     INT;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
        END IF;
        IF COALESCE(btrim(p_name), '') = '' THEN
          RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
        END IF;
        IF length(btrim(p_name)) > 80 THEN
          RETURN jsonb_build_object('ok', false, 'error', 'NAME_TOO_LONG');
        END IF;

        -- Mint an 8-char code from a 32-char unambiguous alphabet.
        -- Each byte mod 32 picks a char. With 32^8 = ~1 trillion codes,
        -- collisions are vanishingly unlikely until we have hundreds of
        -- thousands of orgs.
        LOOP
          v_try := v_try + 1;
          v_bytes := gen_random_bytes(8);
          v_code := '';
          FOR v_idx IN 0..7 LOOP
            v_code := v_code || substr(v_alpha, (get_byte(v_bytes, v_idx) % 32) + 1, 1);
          END LOOP;
          EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
          IF v_try > 12 THEN
            RETURN jsonb_build_object('ok', false, 'error', 'CODE_MINT_FAILED');
          END IF;
        END LOOP;

        INSERT INTO public.organizations (name, owner_id, join_code)
          VALUES (btrim(p_name), v_uid, v_code)
          RETURNING id INTO v_org;
        INSERT INTO public.organization_members (org_id, user_id, role)
          VALUES (v_org, v_uid, 'admin')
          ON CONFLICT (org_id, user_id) DO NOTHING;

        RETURN jsonb_build_object('ok', true, 'org_id', v_org, 'join_code', v_code);
      END;
      $fn$;

      REVOKE ALL    ON FUNCTION public.create_organization(TEXT) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.create_organization(TEXT) TO authenticated;
    $body$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 4 (CRITICAL) — trainer cascade deadlock blocking account deletion
-- ─────────────────────────────────────────────────────────────────────
-- Before:
--   trainer_listings.trainer_id  → user_profiles  ON DELETE CASCADE
--   trainer_purchases.listing_id → trainer_listings ON DELETE RESTRICT
--   trainer_purchases.trainer_id → user_profiles  ON DELETE CASCADE
--
-- A trainer with ANY sales cannot delete their account: the CASCADE
-- on trainer_listings collides with the RESTRICT on trainer_purchases,
-- and the parent delete throws.
--
-- ALSO: trainer_purchases.trainer_id CASCADE would wipe every buyer's
-- receipt + access proof if the trainer's profile is purged — data loss
-- + privacy violation.
--
-- After:
--   trainer_listings.trainer_id  → user_profiles  ON DELETE SET NULL (nullable)
--   trainer_purchases.trainer_id → user_profiles  ON DELETE SET NULL (nullable)
--   trainer_purchases.listing_id → trainer_listings ON DELETE SET NULL (nullable)
--
-- Listings become "ownerless" when the trainer leaves but their data
-- is preserved as a receipt ledger. Buyer access still works via
-- listing_id when the listing exists; if the listing is also deleted
-- separately, the buyer at least has the historical receipt.
--
-- DO-block guarded so this is a no-op if 143 hasn't been applied.

-- trainer_listings.trainer_id: CASCADE → SET NULL + nullable
DO $$
DECLARE
  v_cons_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trainer_listings') THEN
    RETURN;
  END IF;

  ALTER TABLE public.trainer_listings ALTER COLUMN trainer_id DROP NOT NULL;

  SELECT conname INTO v_cons_name
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
   WHERE t.relname = 'trainer_listings'
     AND c.contype = 'f'
     AND c.confrelid = 'public.user_profiles'::regclass
     AND 'trainer_id' = ANY (
       SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     )
   LIMIT 1;
  IF v_cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trainer_listings DROP CONSTRAINT %I', v_cons_name);
  END IF;

  ALTER TABLE public.trainer_listings
    ADD CONSTRAINT trainer_listings_trainer_id_fkey
    FOREIGN KEY (trainer_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;
END $$;

-- trainer_purchases.trainer_id: CASCADE → SET NULL + nullable
DO $$
DECLARE
  v_cons_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trainer_purchases') THEN
    RETURN;
  END IF;

  ALTER TABLE public.trainer_purchases ALTER COLUMN trainer_id DROP NOT NULL;

  SELECT conname INTO v_cons_name
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
   WHERE t.relname = 'trainer_purchases'
     AND c.contype = 'f'
     AND c.confrelid = 'public.user_profiles'::regclass
     AND 'trainer_id' = ANY (
       SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
     )
   LIMIT 1;
  IF v_cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trainer_purchases DROP CONSTRAINT %I', v_cons_name);
  END IF;

  ALTER TABLE public.trainer_purchases
    ADD CONSTRAINT trainer_purchases_trainer_id_fkey
    FOREIGN KEY (trainer_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;
END $$;

-- trainer_purchases.listing_id: RESTRICT → SET NULL + nullable
DO $$
DECLARE
  v_cons_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trainer_purchases') THEN
    RETURN;
  END IF;

  ALTER TABLE public.trainer_purchases ALTER COLUMN listing_id DROP NOT NULL;

  SELECT conname INTO v_cons_name
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
   WHERE t.relname = 'trainer_purchases'
     AND c.contype = 'f'
     AND c.confrelid = 'public.trainer_listings'::regclass
   LIMIT 1;
  IF v_cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trainer_purchases DROP CONSTRAINT %I', v_cons_name);
  END IF;

  ALTER TABLE public.trainer_purchases
    ADD CONSTRAINT trainer_purchases_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES public.trainer_listings(id) ON DELETE SET NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 5 (HIGH) — get_my_trainer_revenue inflates with mock rows
-- ─────────────────────────────────────────────────────────────────────
-- Before: sums amount_paid_cents / trainer_payout_cents across ALL
-- purchases including mock (is_mock = TRUE). Trainer dashboard shows
-- simulated revenue as real money.
--
-- After: filter is_mock = FALSE for the canonical money fields and
-- surface mock counts separately for transparency.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='trainer_purchases') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.get_my_trainer_revenue()
      RETURNS JSONB
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      STABLE
      AS $fn$
        SELECT jsonb_build_object(
          'gross_cents',  COALESCE(SUM(amount_paid_cents)    FILTER (WHERE is_mock = FALSE), 0),
          'payout_cents', COALESCE(SUM(trainer_payout_cents) FILTER (WHERE is_mock = FALSE), 0),
          'fee_cents',    COALESCE(SUM(platform_fee_cents)   FILTER (WHERE is_mock = FALSE), 0),
          'sales',                COUNT(*)                    FILTER (WHERE is_mock = FALSE),
          'mock_sales',           COUNT(*)                    FILTER (WHERE is_mock = TRUE)
        )
        FROM public.trainer_purchases
        WHERE trainer_id = auth.uid();
      $fn$;

      REVOKE ALL    ON FUNCTION public.get_my_trainer_revenue() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.get_my_trainer_revenue() TO authenticated;
    $body$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 6 (HIGH) — finalize_capsule_claim trusts client-supplied rarity/variant
-- ─────────────────────────────────────────────────────────────────────
-- Before: function verifies capsule ownership + is_opened state, then
-- inserts the inventory row using client-supplied p_item_rarity /
-- p_variant. After the server roll persists rolled_rarity / rolled_variant
-- on user_capsules (mig 028), an attacker can call finalize with
-- rarity='elite' even if the server rolled 'common'.
--
-- After: read rolled_rarity + rolled_variant directly from user_capsules
-- and use them; ignore the client-supplied p_item_rarity / p_variant
-- (params kept for back-compat).
--
-- Note: p_item_id / p_item_name / p_item_emoji / p_item_type are STILL
-- client-supplied — that's the residual cheat surface per mig 028's
-- design comment ("pick which specific legendary to grant" rather than
-- "pick the rarity tier itself"). Bounded by capsule supply and
-- accepted as v1 hardening.

DO $$
BEGIN
  -- Only apply if rolled_rarity column exists on user_capsules
  -- (added by mig 028). Otherwise the function definition would
  -- break the existing claim flow.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='user_capsules'
       AND column_name = 'rolled_rarity'
  ) THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.finalize_capsule_claim(
        p_capsule_id   UUID,
        p_item_id      TEXT,
        p_item_name    TEXT,
        p_item_emoji   TEXT,
        p_item_rarity  TEXT,
        p_item_type    TEXT,
        p_variant      TEXT DEFAULT NULL
      ) RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_uid          UUID := auth.uid();
        v_email        TEXT;
        v_capsule      public.user_capsules%ROWTYPE;
        v_inventory_id UUID;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_capsule_id IS NULL OR p_item_id IS NULL OR p_item_name IS NULL THEN
          RAISE EXCEPTION 'capsule_id, item_id, item_name required' USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_capsule
          FROM public.user_capsules
         WHERE id = p_capsule_id
           AND user_id = v_uid
         FOR UPDATE;

        IF v_capsule.id IS NULL THEN
          RAISE EXCEPTION 'capsule not found' USING ERRCODE = '22023';
        END IF;
        IF v_capsule.is_opened IS NOT TRUE THEN
          RAISE EXCEPTION 'capsule not yet opened' USING ERRCODE = '22023';
        END IF;
        IF v_capsule.rolled_rarity IS NULL THEN
          RAISE EXCEPTION 'capsule roll missing — call claim_capsule_loot first' USING ERRCODE = '22023';
        END IF;

        SELECT email INTO v_email FROM public.user_profiles WHERE id = v_uid;

        -- USE SERVER ROLL for rarity + variant. Client-supplied
        -- p_item_rarity / p_variant are IGNORED — they're params only
        -- for backward compatibility with existing client code.
        INSERT INTO public.user_inventory
          (user_id, user_email, item_id, item_name, item_emoji, item_rarity,
           item_type, variant, acquired_via)
        VALUES
          (v_uid, v_email, p_item_id, p_item_name, p_item_emoji,
           v_capsule.rolled_rarity,                            -- server-rolled, NOT client
           p_item_type,
           v_capsule.rolled_variant,                           -- server-rolled, NOT client
           'capsule')
        ON CONFLICT (user_id, item_id, variant) DO UPDATE SET
          acquired_at = now()
        RETURNING id INTO v_inventory_id;

        RETURN jsonb_build_object(
          'ok',           true,
          'inventory_id', v_inventory_id,
          'item_id',      p_item_id,
          'item_rarity',  v_capsule.rolled_rarity,
          'item_variant', v_capsule.rolled_variant
        );
      END;
      $fn$;
    $body$;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- FIX 7 (HIGH) — grant_achievement_milestones trusts client count
-- ─────────────────────────────────────────────────────────────────────
-- Before: function takes p_unlocked_count from the client. User with
-- zero unlocks can pass 100 to instantly claim every milestone capsule.
--
-- After: compute the unlocked count server-side from achievements
-- (the table that holds unlocked rows; user_profiles.achievements_unlocked_count
-- is also denormalized but trusted as a tiebreaker). p_unlocked_count
-- kept for API compat but used only as a SANITY CAP — function never
-- grants more than the lower of (server count, p_unlocked_count).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='achievements'
  ) THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.grant_achievement_milestones(p_unlocked_count INT)
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
      DECLARE
        v_uid              UUID := auth.uid();
        v_email            TEXT;
        v_server_count     INT;
        v_safe_count       INT;
        v_already_awarded  INT;
        v_milestone        RECORD;
        v_granted_count    INT := 0;
        v_granted_payload  JSONB := '[]'::jsonb;
      BEGIN
        IF v_uid IS NULL THEN
          RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
        END IF;
        IF p_unlocked_count IS NULL OR p_unlocked_count < 0 THEN
          RAISE EXCEPTION 'invalid unlocked_count' USING ERRCODE = '22023';
        END IF;

        SELECT email, COALESCE(milestone_capsules_awarded, 0)
          INTO v_email, v_already_awarded
          FROM public.user_profiles
         WHERE id = v_uid
         FOR UPDATE;

        IF v_email IS NULL THEN
          RAISE EXCEPTION 'user_profile not found' USING ERRCODE = '22023';
        END IF;

        -- Server-side ground truth: COUNT(*) of this user's achievement rows.
        -- The client-supplied p_unlocked_count is CAPPED at this value, so
        -- passing 100 when the user has 0 unlocks no longer grants anything.
        SELECT COUNT(*)::int INTO v_server_count
          FROM public.achievements
         WHERE created_by = v_email;

        v_safe_count := LEAST(p_unlocked_count, v_server_count);

        -- Same milestone schedule as the original mig 071. MUST stay in
        -- sync with ACHIEVEMENT_MILESTONES in src/lib/data/capsules.js:
        --   (5, standard) (10, standard) (25, premium) (50, premium) (100, elite)
        FOR v_milestone IN
          SELECT * FROM (
            VALUES
              (1, 5,   'standard'),
              (2, 10,  'standard'),
              (3, 25,  'premium'),
              (4, 50,  'premium'),
              (5, 100, 'elite')
          ) AS m(idx, threshold, capsule_type)
         WHERE m.threshold <= v_safe_count    -- safe_count, not the raw client param
           AND m.idx > v_already_awarded
         ORDER BY m.idx
        LOOP
          INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
          VALUES (v_uid, v_email, v_milestone.capsule_type);
          v_granted_count := v_granted_count + 1;
          v_granted_payload := v_granted_payload || jsonb_build_object(
            'threshold', v_milestone.threshold,
            'type',      v_milestone.capsule_type
          );
        END LOOP;

        IF v_granted_count = 0 THEN
          RETURN jsonb_build_object(
            'granted_count', 0,
            'granted',       '[]'::jsonb,
            'awarded_total', v_already_awarded,
            'server_count',  v_server_count
          );
        END IF;

        UPDATE public.user_profiles
           SET milestone_capsules_awarded = v_already_awarded + v_granted_count
         WHERE id = v_uid;

        RETURN jsonb_build_object(
          'granted_count', v_granted_count,
          'granted',       v_granted_payload,
          'awarded_total', v_already_awarded + v_granted_count,
          'server_count',  v_server_count
        );
      END;
      $fn$;

      GRANT EXECUTE ON FUNCTION public.grant_achievement_milestones(INT) TO authenticated;
    $body$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
