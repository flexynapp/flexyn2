-- Migration 294: body stats were TEXT columns with client-only validation
--
-- weight_lbs, weight_kg, height_inches and height_cm are all `text`. The
-- 70–700 lb / 48–90 in bounds live in SettingsPanel and the 50–800 / 36–96
-- clamps live in Onboarding — nothing on the server constrained them, and a
-- text column cannot be constrained numerically without a cast. A crafted
-- PostgREST request could store any string at all.
--
-- Impact was limited rather than severe, which is why this is last: the path
-- that could be abused is bodyweight-exercise tonnage, and
-- increment_user_volume already clamps its input server-side, so an inflated
-- bodyweight lands against that clamp. The realistic damage was garbage in
-- your own profile corrupting your own charts. Correctness, not exploit.
--
-- ── the backfill audit that had to come first ────────────────────────────
--
-- Measured on production before writing this:
--   weight_lbs     25 non-null, 0 empty, 0 non-numeric, range 115–265
--   height_inches  24 non-null, 0 empty, 0 non-numeric, range 61–84
--   weight_kg      23 non-null, 0 empty, 0 non-numeric, range 52–120
--   height_cm      24 non-null, 0 empty, 0 non-numeric, range 155–213
--
-- No view or rule depends on any of them (checked pg_depend/pg_rewrite), so
-- ALTER TYPE is not blocked. No trigger on user_profiles reads them.
--
-- ── why all four ────────────────────────────────────────────────────────
--
-- Onboarding writes all four in the same statement. Converting only the
-- imperial pair would leave the metric mirrors as unconstrained text and
-- split one concept across two representations, which is worse than either
-- state applied uniformly.
--
-- ── why these bounds ────────────────────────────────────────────────────
--
-- The CHECKs are sanity bounds, NOT product validation. Two client paths
-- disagree already — Onboarding clamps weight to 50–800 lb and height to
-- 36–96 in, Settings validates 70–700 and 48–90 — so a constraint matching
-- Settings would reject values Onboarding legitimately produces. The DB's
-- job here is to reject nonsense (negative, zero, 99999), not to arbitrate
-- between two product rules. Both client ranges sit comfortably inside.
-- NULL stays allowed: these are optional fields and 24 of 49 rows have none.
--
-- ── the cast fails loudly ───────────────────────────────────────────────
--
-- The pre-check raises rather than nulling unparseable values. A row could
-- in principle be written between the audit above and this migration
-- running; silently discarding someone's body stats to make a migration
-- succeed is the exact failure mode this audit kept finding elsewhere. If it
-- raises, nothing has changed — inspect the offending rows and re-run.
--
-- Idempotent: the type change is a no-op once applied (the pre-check and
-- ALTER both short-circuit on a non-text column), and the constraints are
-- dropped before being re-added.

-- ── 1. refuse to run if anything would be lost ──────────────────────────
DO $precheck$
DECLARE v_bad integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='user_profiles'
       AND column_name='weight_lbs' AND data_type='text'
  ) THEN
    SELECT count(*) INTO v_bad FROM public.user_profiles
     WHERE (weight_lbs    IS NOT NULL AND btrim(weight_lbs)    <> '' AND btrim(weight_lbs)    !~ '^[0-9]+(\.[0-9]+)?$')
        OR (weight_kg     IS NOT NULL AND btrim(weight_kg)     <> '' AND btrim(weight_kg)     !~ '^[0-9]+(\.[0-9]+)?$')
        OR (height_inches IS NOT NULL AND btrim(height_inches) <> '' AND btrim(height_inches) !~ '^[0-9]+(\.[0-9]+)?$')
        OR (height_cm     IS NOT NULL AND btrim(height_cm)     <> '' AND btrim(height_cm)     !~ '^[0-9]+(\.[0-9]+)?$');
    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'migration 294 aborted: % user_profiles row(s) hold non-numeric body stats. Nothing changed. Inspect them, then re-run.', v_bad;
    END IF;
  END IF;
END
$precheck$;

-- ── 2. text → numeric ───────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ALTER COLUMN weight_lbs    TYPE numeric USING NULLIF(btrim(weight_lbs), '')::numeric,
  ALTER COLUMN weight_kg     TYPE numeric USING NULLIF(btrim(weight_kg), '')::numeric,
  ALTER COLUMN height_inches TYPE numeric USING NULLIF(btrim(height_inches), '')::numeric,
  ALTER COLUMN height_cm     TYPE numeric USING NULLIF(btrim(height_cm), '')::numeric;

-- ── 3. sanity bounds ────────────────────────────────────────────────────
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_weight_lbs_sane;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_weight_kg_sane;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_height_inches_sane;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_height_cm_sane;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_weight_lbs_sane
    CHECK (weight_lbs    IS NULL OR (weight_lbs    > 0 AND weight_lbs    <= 1500)),
  ADD CONSTRAINT user_profiles_weight_kg_sane
    CHECK (weight_kg     IS NULL OR (weight_kg     > 0 AND weight_kg     <= 700)),
  ADD CONSTRAINT user_profiles_height_inches_sane
    CHECK (height_inches IS NULL OR (height_inches > 0 AND height_inches <= 108)),
  ADD CONSTRAINT user_profiles_height_cm_sane
    CHECK (height_cm     IS NULL OR (height_cm     > 0 AND height_cm     <= 275));
