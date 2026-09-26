-- 281_capsule_drops_no_themes.sql
--
-- Themes are switched off as a reward. Capsules must stop rolling the
-- `theme` category.
--
-- WHY THIS FILE AND NOT JUST THE CLIENT: the client's candidate menu is
-- inert as of migration 267 — the SERVER picks the item, from loot_catalog,
-- inside `_roll_capsule_shape` + `_pick_loot_item`. Hiding themes in the
-- bundle would leave the database still granting them, so a user would
-- keep receiving `user_inventory` rows for an item the app no longer shows.
-- This is the change that actually stops the drops; `THEMES_ENABLED` in
-- src/lib/featureFlags.js only stops the UI advertising them.
--
-- WHAT CHANGES: `theme` leaves the category array, and its weight moves
-- to `sticker` in every tier. Title and frame odds are byte-for-byte what
-- they were, so this is a single-variable change — nobody's chance of a
-- title or a frame moves because themes went away.
--
--   standard: theme 0.03 → sticker 0.88 + 0.03 = 0.91
--   premium:  theme 0.08 → sticker 0.70 + 0.08 = 0.78
--   elite:    theme 0.18 → sticker 0.45 + 0.18 = 0.63
--
-- Rarity is rolled separately (`_roll_capsule_rarity`, unchanged here), so
-- an elite capsule is exactly as likely to land legendary as before — it
-- just can't spend that legendary on a theme.
--
-- WHAT DOES NOT CHANGE, deliberately:
--   • loot_catalog keeps its 28 `theme` rows. Deleting them would break
--     `_pick_loot_item`'s lookup for any theme already granted and strand
--     existing inventory rows with no catalogue entry behind them.
--   • `user_inventory` theme rows are untouched. People keep what they won.
--   • `user_profiles.loot_theme_id` / `preferred_theme` are untouched. The
--     client ignores them while the flag is off; nothing is overwritten, so
--     turning themes back on restores each user's previous pick.
--
-- TO REVERT: put 'theme' back in each array with its original weight and
-- flip THEMES_ENABLED to true. There is no data to restore.
--
-- Mirrors the pre-267 shape in migrations 028 / 255 / 256 — but note those
-- inlined the same weights and 267 hoisted them into this one function,
-- which both `open_capsule_atomic` and `claim_capsule_loot` now call.
-- Verified against the INSTALLED bodies (pg_get_functiondef) before
-- writing this: both call `_roll_capsule_shape`, neither carries its own
-- copy of the table, so this is the only place the weights live.

CREATE OR REPLACE FUNCTION public._roll_capsule_shape(p_capsule_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $_roll_capsule_shape$
DECLARE
  v_type     TEXT := COALESCE(p_capsule_type, 'standard');
  v_category TEXT;
  v_variant  TEXT;
BEGIN
  -- Category roll. 'theme' removed (migration 281) — its weight folded
  -- into 'sticker' so title/frame odds are unchanged.
  IF v_type = 'premium' THEN
    v_category := public._weighted_pick(ARRAY['title','frame','sticker']::TEXT[],
                                        ARRAY[0.12, 0.10, 0.78]::NUMERIC[]);
  ELSIF v_type = 'elite' THEN
    v_category := public._weighted_pick(ARRAY['title','frame','sticker']::TEXT[],
                                        ARRAY[0.20, 0.17, 0.63]::NUMERIC[]);
  ELSE
    v_category := public._weighted_pick(ARRAY['title','frame','sticker']::TEXT[],
                                        ARRAY[0.05, 0.04, 0.91]::NUMERIC[]);
  END IF;

  -- Variant roll (stickers only) — unchanged from 267.
  IF v_category = 'sticker' THEN
    IF v_type = 'premium' THEN
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.90, 0.08, 0.02, 0.00]::NUMERIC[]);
    ELSIF v_type = 'elite' THEN
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.80, 0.14, 0.05, 0.01]::NUMERIC[]);
    ELSE
      v_variant := public._weighted_pick(ARRAY['plain','foil','gold','diamond']::TEXT[],
                                         ARRAY[0.97, 0.03, 0.00, 0.00]::NUMERIC[]);
    END IF;
    IF v_variant = 'plain' THEN v_variant := NULL; END IF;
  ELSE
    v_variant := NULL;
  END IF;

  RETURN jsonb_build_object('category', v_category, 'variant', v_variant);
END;
$_roll_capsule_shape$;

-- CREATE OR REPLACE keeps the existing ACL, but re-assert it anyway: this
-- is SECURITY DEFINER and every public-schema function is a PostgREST
-- endpoint until revoked. Repeating the REVOKEs from 267 means a future
-- restore-from-file of this migration alone can't publish it.
REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM anon;
REVOKE ALL ON FUNCTION public._roll_capsule_shape(text) FROM authenticated;
