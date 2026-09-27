-- Store the ten micronutrients the Log Meal form already collects.
--
-- The form, the barcode scanner, the meal planner and recipes all send
-- sugar_g, cholesterol_mg, four minerals and four vitamins. nutrition_logs
-- never had columns for them (archived migration 006 declared them and was
-- never applied), so until 2026-09-27 db.js silently stripped them from
-- every save, and since then src/lib/data/nutrition.js dropped them by name
-- (NOT_STORED). Kegan chose to store them.
--
-- The names match what every reader already uses (MineralsVitaminsBox,
-- MacroNutrientBox, the re-log path), so nothing on the read side changes.
--
-- Nullable with NO DEFAULT, deliberately. A default would be written onto
-- every existing row, and 118 of this table's rows are water: they would
-- all start claiming "0 mg of iron", and the tiles that stay hidden until a
-- nutrient has data behind them would light up with zeros. NULL means "not
-- recorded", which is the truth for every row that exists today.
--
-- Additive only: no existing column, row or policy changes. RLS on
-- nutrition_logs is row level, so the new columns are covered by the
-- policies already there.

ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS sugar_g         numeric,
  ADD COLUMN IF NOT EXISTS cholesterol_mg  numeric,
  ADD COLUMN IF NOT EXISTS iron_mg         numeric,
  ADD COLUMN IF NOT EXISTS magnesium_mg    numeric,
  ADD COLUMN IF NOT EXISTS calcium_mg      numeric,
  ADD COLUMN IF NOT EXISTS potassium_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_a_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_c_mg    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_d_iu    numeric,
  ADD COLUMN IF NOT EXISTS vitamin_b12_mcg numeric;

-- Fail the migration if any column is missing, has the wrong type, carries
-- a default, or holds a value on a row that existed before this ran.
DO $$
DECLARE
  v_cols text[] := ARRAY['sugar_g','cholesterol_mg','iron_mg','magnesium_mg',
                         'calcium_mg','potassium_mg','vitamin_a_iu',
                         'vitamin_c_mg','vitamin_d_iu','vitamin_b12_mcg'];
  v_col  text;
  v_ok   int;
  v_set  bigint;
BEGIN
  FOREACH v_col IN ARRAY v_cols LOOP
    SELECT count(*) INTO v_ok
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'nutrition_logs'
       AND column_name = v_col AND data_type = 'numeric'
       AND is_nullable = 'YES' AND column_default IS NULL;
    IF v_ok <> 1 THEN
      RAISE EXCEPTION 'nutrition_logs.% is missing, not numeric, not nullable, or has a default', v_col;
    END IF;
    EXECUTE format('SELECT count(%I) FROM public.nutrition_logs', v_col) INTO v_set;
    IF v_set <> 0 THEN
      RAISE EXCEPTION 'nutrition_logs.% holds % values on existing rows; expected none', v_col, v_set;
    END IF;
  END LOOP;
END $$;
