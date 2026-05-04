-- seed_kegan_loot.sql
-- Seeds ALL loot items into keganbergeron@gmail.com's inventory for testing.
-- Run once in the Supabase SQL editor. Safe to run again — uses ON CONFLICT DO NOTHING.
-- Also grants one of each capsule type and a stack of Flex Coins.

DO $$
DECLARE
  v_user_id   UUID;
  v_email     TEXT := 'keganbergeron@gmail.com';
BEGIN
  -- Look up the user's Supabase auth UUID from user_profiles
  SELECT id INTO v_user_id FROM user_profiles WHERE email = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User % not found in user_profiles', v_email;
  END IF;

  -- ── Stickers (base, no variant) ─────────────────────────────────────────────
  INSERT INTO user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, variant)
  VALUES
    (v_user_id, v_email, 'stk_muscle',  'Flex',         '💪', 'common',    'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_fire',    'On Fire',      '🔥', 'common',    'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_star',    'Star',         '⭐', 'common',    'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_thumbs',  'Solid',        '👍', 'common',    'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_target',  'Bullseye',     '🎯', 'common',    'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_crown',   'Crown',        '👑', 'uncommon',  'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_rocket',  'Launch',       '🚀', 'uncommon',  'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_diamond', 'Diamond',      '💎', 'uncommon',  'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_zap',     'Zap',          '⚡', 'uncommon',  'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_trophy',  'Trophy',       '🏆', 'uncommon',  'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_dragon',  'Dragon',       '🐉', 'rare',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_eagle',   'Eagle',        '🦅', 'rare',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_wave',    'Wave',         '🌊', 'rare',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_galaxy',  'Galaxy',       '🌌', 'epic',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_orb',     'Crystal Orb',  '🔮', 'epic',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_lion',    'Lion',         '🦁', 'epic',      'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_glow',    'Radiance',     '🌟', 'legendary', 'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_comet',   'Comet',        '💫', 'legendary', 'sticker', 'seed', NULL),
    (v_user_id, v_email, 'stk_sparkle', 'Sparkle',      '✨', 'animated',  'sticker', 'seed', NULL)
  ON CONFLICT DO NOTHING;

  -- ── Stickers — Foil variants ─────────────────────────────────────────────────
  INSERT INTO user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, variant)
  VALUES
    (v_user_id, v_email, 'stk_muscle',  'Flex',         '💪', 'common',    'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_fire',    'On Fire',      '🔥', 'common',    'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_crown',   'Crown',        '👑', 'uncommon',  'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_dragon',  'Dragon',       '🐉', 'rare',      'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_galaxy',  'Galaxy',       '🌌', 'epic',      'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_glow',    'Radiance',     '🌟', 'legendary', 'sticker', 'seed', 'foil'),
    (v_user_id, v_email, 'stk_sparkle', 'Sparkle',      '✨', 'animated',  'sticker', 'seed', 'foil')
  ON CONFLICT DO NOTHING;

  -- ── Stickers — Gold variants ─────────────────────────────────────────────────
  INSERT INTO user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, variant)
  VALUES
    (v_user_id, v_email, 'stk_star',    'Star',         '⭐', 'common',    'sticker', 'seed', 'gold'),
    (v_user_id, v_email, 'stk_trophy',  'Trophy',       '🏆', 'uncommon',  'sticker', 'seed', 'gold'),
    (v_user_id, v_email, 'stk_eagle',   'Eagle',        '🦅', 'rare',      'sticker', 'seed', 'gold'),
    (v_user_id, v_email, 'stk_orb',     'Crystal Orb',  '🔮', 'epic',      'sticker', 'seed', 'gold'),
    (v_user_id, v_email, 'stk_comet',   'Comet',        '💫', 'legendary', 'sticker', 'seed', 'gold')
  ON CONFLICT DO NOTHING;

  -- ── Stickers — Diamond variants ──────────────────────────────────────────────
  INSERT INTO user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, variant)
  VALUES
    (v_user_id, v_email, 'stk_lion',    'Lion',         '🦁', 'epic',      'sticker', 'seed', 'diamond'),
    (v_user_id, v_email, 'stk_glow',    'Radiance',     '🌟', 'legendary', 'sticker', 'seed', 'diamond'),
    (v_user_id, v_email, 'stk_sparkle', 'Sparkle',      '✨', 'animated',  'sticker', 'seed', 'diamond')
  ON CONFLICT DO NOTHING;

  -- ── All loot themes ──────────────────────────────────────────────────────────
  INSERT INTO user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, variant)
  VALUES
    (v_user_id, v_email, 'loot_coral',     'Coral Rush',   '🪸', 'common',    'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_mint',      'Mint Frost',   '🌿', 'common',    'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_rose',      'Rose Quartz',  '🌸', 'common',    'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_dusk',      'Dusk Protocol','🌅', 'uncommon',  'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_tidal',     'Tidal Force',  '🌊', 'uncommon',  'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_nebula',    'Nebula',       '🌌', 'rare',      'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_ember',     'Ember Core',   '🔥', 'rare',      'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_aurora',    'Aurora',       '🌠', 'epic',      'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_cyberpunk', 'Cyberpunk',    '🤖', 'epic',      'theme', 'seed', NULL),
    (v_user_id, v_email, 'loot_prism',     'Prismatic',    '💎', 'legendary', 'theme', 'seed', NULL)
  ON CONFLICT DO NOTHING;

  -- ── Capsules (5 of each type) ────────────────────────────────────────────────
  INSERT INTO user_capsules (user_id, user_email, capsule_type, is_opened)
  SELECT v_user_id, v_email, t.capsule_type, false
  FROM (VALUES
    ('standard'),('standard'),('standard'),('standard'),('standard'),
    ('premium'), ('premium'), ('premium'), ('premium'), ('premium'),
    ('elite'),   ('elite'),   ('elite'),   ('elite'),   ('elite')
  ) AS t(capsule_type);

  -- ── Flex Coins — add 10,000 for testing ─────────────────────────────────────
  UPDATE user_profiles
  SET flex_coins = COALESCE(flex_coins, 0) + 10000
  WHERE id = v_user_id;

  RAISE NOTICE 'Seeded all loot for % (user_id: %)', v_email, v_user_id;
END $$;
