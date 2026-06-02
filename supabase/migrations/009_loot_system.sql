-- Migration 009: Loot capsule, inventory, and marketplace system
-- Run this in the Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- Flex Coins column on user_profiles
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS flex_coins INTEGER DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_inventory
-- Stores every item a user has ever received (stickers, capsule prizes, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  item_name     TEXT NOT NULL,
  item_emoji    TEXT NOT NULL DEFAULT '',
  item_rarity   TEXT NOT NULL DEFAULT 'common',
  item_type     TEXT NOT NULL DEFAULT 'sticker',
  acquired_via  TEXT NOT NULL DEFAULT 'capsule',
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_listed     BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_inventory' AND policyname = 'inventory: users can view own items'
  ) THEN
    CREATE POLICY "inventory: users can view own items"
      ON user_inventory FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_inventory' AND policyname = 'inventory: users can insert own items'
  ) THEN
    CREATE POLICY "inventory: users can insert own items"
      ON user_inventory FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_inventory' AND policyname = 'inventory: users can update own items'
  ) THEN
    CREATE POLICY "inventory: users can update own items"
      ON user_inventory FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_inventory' AND policyname = 'inventory: users can delete own items'
  ) THEN
    CREATE POLICY "inventory: users can delete own items"
      ON user_inventory FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_capsules
-- Tracks capsules granted to users (e.g. from levelling up).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_capsules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  capsule_type  TEXT NOT NULL DEFAULT 'standard',
  earned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at     TIMESTAMPTZ,
  is_opened     BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE user_capsules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_capsules' AND policyname = 'capsules: users can view own capsules'
  ) THEN
    CREATE POLICY "capsules: users can view own capsules"
      ON user_capsules FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_capsules' AND policyname = 'capsules: users can insert own capsules'
  ) THEN
    CREATE POLICY "capsules: users can insert own capsules"
      ON user_capsules FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_capsules' AND policyname = 'capsules: users can update own capsules'
  ) THEN
    CREATE POLICY "capsules: users can update own capsules"
      ON user_capsules FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_capsules' AND policyname = 'capsules: users can delete own capsules'
  ) THEN
    CREATE POLICY "capsules: users can delete own capsules"
      ON user_capsules FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- marketplace_listings
-- Public listing board for item sales and trades.
-- SELECT is open to all authenticated users (browsing).
-- INSERT/UPDATE/DELETE restricted to the listing owner.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id   UUID NOT NULL,
  seller_email     TEXT NOT NULL,
  seller_username  TEXT NOT NULL DEFAULT '',
  inventory_id     UUID NOT NULL,
  item_id          TEXT NOT NULL,
  item_name        TEXT NOT NULL,
  item_emoji       TEXT NOT NULL DEFAULT '',
  item_rarity      TEXT NOT NULL DEFAULT 'common',
  listing_type     TEXT NOT NULL CHECK (listing_type IN ('sale', 'trade')),
  asking_price     INTEGER,
  trade_for_rarity TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE marketplace_listings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can browse active listings
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_listings' AND policyname = 'marketplace: authenticated users can view listings'
  ) THEN
    CREATE POLICY "marketplace: authenticated users can view listings"
      ON marketplace_listings FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_listings' AND policyname = 'marketplace: sellers can create listings'
  ) THEN
    CREATE POLICY "marketplace: sellers can create listings"
      ON marketplace_listings FOR INSERT
      TO authenticated
      WITH CHECK (seller_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_listings' AND policyname = 'marketplace: sellers can update own listings'
  ) THEN
    CREATE POLICY "marketplace: sellers can update own listings"
      ON marketplace_listings FOR UPDATE
      TO authenticated
      USING (seller_user_id = auth.uid())
      WITH CHECK (seller_user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'marketplace_listings' AND policyname = 'marketplace: sellers can delete own listings'
  ) THEN
    CREATE POLICY "marketplace: sellers can delete own listings"
      ON marketplace_listings FOR DELETE
      TO authenticated
      USING (seller_user_id = auth.uid());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for common query patterns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_inventory_user_email   ON user_inventory (user_email);
CREATE INDEX IF NOT EXISTS idx_user_inventory_user_id      ON user_inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_user_capsules_user_email    ON user_capsules (user_email);
CREATE INDEX IF NOT EXISTS idx_user_capsules_user_id       ON user_capsules (user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_status          ON marketplace_listings (status);
CREATE INDEX IF NOT EXISTS idx_marketplace_seller_email    ON marketplace_listings (seller_email);

-- ─────────────────────────────────────────────────────────────────────────────
-- Item catalog concept (client-side; no DB table required)
-- ─────────────────────────────────────────────────────────────────────────────
/*
  The loot item catalog is maintained in src/lib/lootCatalog.js.
  Each item has: id, type ('sticker'|'capsule'), rarity, name, description, emoji, baseCoins.

  Rarities and their approximate drop rates from a Standard Capsule:
    common     60.0%
    uncommon   28.0%
    rare       10.0%
    epic        1.8%
    legendary   0.2%
    animated    0.0% (elite capsule only: 1.0%)

  Sticker catalog (19 items):
    Common    (5): 💪 Flex, 🔥 On Fire, ⭐ Star, 👍 Solid, 🎯 Bullseye
    Uncommon  (5): 👑 Crown, 🚀 Launch, 💎 Diamond, ⚡ Zap, 🏆 Trophy
    Rare      (3): 🐉 Dragon, 🦅 Eagle, 🌊 Wave
    Epic      (3): 🌌 Galaxy, 🔮 Crystal Orb, 🦁 Lion
    Legendary (2): 🌟 Radiance, 💫 Comet
    Animated  (1): ✨ Sparkle

  Capsule types (3):
    📦 Standard (common)  — Earned every level
    🎁 Premium (uncommon) — Earned at level multiples of 5
    💠 Elite   (epic)     — Earned at level multiples of 10
*/

NOTIFY pgrst, 'reload schema';
