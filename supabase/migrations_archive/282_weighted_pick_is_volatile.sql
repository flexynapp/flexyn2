-- 282_weighted_pick_is_volatile.sql
--
-- SEPARATE FROM 281 ON PURPOSE. 281 is "themes stop dropping", which is
-- what was asked for. This is a loot-wide bug found while verifying it,
-- and it changes what everyone's capsules award — so it gets its own file
-- and its own decision. 281 is complete and correct without this one.
--
-- ── THE BUG ────────────────────────────────────────────────────────────
-- `_weighted_pick` calls random() but is declared IMMUTABLE. IMMUTABLE is
-- a promise to the planner that the same arguments always produce the same
-- answer, which licenses constant-folding at PLAN time. Every caller
-- passes literal arrays, so the planner evaluates the call once, bakes the
-- result into the cached plan, and plpgsql reuses that plan for the rest
-- of the session.
--
-- The roll therefore FREEZES. Measured against production, 2026-08-04:
--
--   30 sequential calls to _roll_capsule_shape('elite') → 'theme' × 30
--   3000 calls to _weighted_pick(title/frame/sticker, .20/.17/.63)
--     → sticker × 2999, title × 1
--       (the single outlier is the custom-plan phase before plpgsql
--        switches to a generic plan and the constant sets for good)
--
--   The same weights through a VOLATILE copy, same session, same loop:
--     sticker 62.9%  title 19.7%  frame 17.4%   ← the intended table
--
-- So a user opening a run of capsules on one pooled backend can get the
-- same category — and via `_roll_capsule_rarity`, which picks the same
-- way, the same RARITY — over and over. Aggregate inventory looks roughly
-- sane only because separate sessions freeze on different values.
--
-- It also explains a distribution that should have been impossible:
-- themes are the RAREST of the three non-sticker categories in every tier
-- (0.03 / 0.08 / 0.18 against titles' 0.05 / 0.12 / 0.20), yet
-- user_inventory holds more themes (62) than titles (49) or frames (33).
-- Sessions frozen on 'theme' emptied whole runs of capsules into one
-- category.
--
-- ── THE FIX ────────────────────────────────────────────────────────────
-- One word. VOLATILE tells the planner it must call the function per
-- execution, which is the truth about anything built on random(). Nothing
-- else about the function changes; the body below is byte-for-byte the
-- installed one.
--
-- Worth knowing for the next helper: this is not a Postgres quirk to work
-- around, it is the volatility contract working exactly as documented. Any
-- function whose result depends on random(), now(), or a table read must
-- be VOLATILE (or at most STABLE), and a plpgsql assignment from a
-- constant-argument call is precisely where a wrong label stops being
-- theoretical.
--
-- ── AFTER RUNNING ──────────────────────────────────────────────────────
-- Existing plans are invalidated by the redefinition, so it takes effect
-- on the next call — no restart, no pooler bounce. Nothing is backfilled:
-- items already granted under a frozen roll stay in people's bags, which
-- is the right call. Taking back a legitimately-received drop to correct
-- our own odds bug costs more trust than the duplicates do.

CREATE OR REPLACE FUNCTION public._weighted_pick(keys text[], weights numeric[])
RETURNS text
LANGUAGE plpgsql
VOLATILE                          -- was IMMUTABLE; the body calls random()
SET search_path TO 'public', 'pg_catalog'
AS $_weighted_pick$
DECLARE v_sum NUMERIC := 0; v_roll NUMERIC; v_cum NUMERIC := 0; v_i INT;
BEGIN
  IF keys IS NULL OR array_length(keys,1) IS NULL THEN RETURN NULL; END IF;
  FOR v_i IN 1..array_length(weights,1) LOOP v_sum := v_sum + weights[v_i]; END LOOP;
  IF v_sum <= 0 THEN RETURN keys[1]; END IF;
  v_roll := random() * v_sum;
  FOR v_i IN 1..array_length(keys,1) LOOP
    v_cum := v_cum + weights[v_i];
    IF v_roll < v_cum THEN RETURN keys[v_i]; END IF;
  END LOOP;
  RETURN keys[array_length(keys,1)];
END;
$_weighted_pick$;

-- Verify after running — 200 sequential calls should spread roughly
-- 63 / 20 / 17, not land on one value:
--
--   CREATE TEMP TABLE _c(cat text);
--   DO $$ BEGIN FOR i IN 1..200 LOOP
--     INSERT INTO _c VALUES (public._weighted_pick(
--       ARRAY['title','frame','sticker']::TEXT[],
--       ARRAY[0.20,0.17,0.63]::NUMERIC[]));
--   END LOOP; END $$;
--   SELECT cat, count(*) FROM _c GROUP BY cat;
--   DROP TABLE _c;
