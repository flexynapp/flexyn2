-- 261_xp_level_source_of_truth_and_column_guard.sql
--
-- Fixes the two critical findings in docs/xp-audit-2026-07-29.md.
--
-- ── F1: the capped XP path was optional ──────────────────────────────────
--
-- `authenticated` holds column-level UPDATE on total_xp, current_level and
-- flex_coins. The RLS policy on user_profiles is auth.uid() = id, which
-- restricts which ROW may be updated and says nothing about which COLUMN —
-- RLS has no column dimension. So one PATCH against PostgREST set any of
-- them to any value, skipping the per-action caps in migration 198, the
-- 50,000/24h ceiling in increment_user_xp, the xp_grant_log audit trail and
-- the coin hardening from 197-207. Four of eight ranked users already had
-- XP that never passed through the capped RPC.
--
-- Fixed with a trigger rather than by revoking the grant. Revoking a
-- column privilege does not work while a table-wide UPDATE grant exists —
-- the table grant would have to be dropped and then re-granted column by
-- column across ~80 columns, and missing one silently breaks a feature.
-- The trigger names the three protected columns explicitly instead.
--
-- It keys off current_user, not session_user: PostgREST does SET ROLE
-- authenticated for direct table access, so current_user is 'authenticated'
-- there, while inside a SECURITY DEFINER function owned by postgres
-- current_user is 'postgres'. So grant_action_xp, increment_user_xp,
-- grant_level_up_rewards and every other definer RPC keep working, and only
-- the direct client write is refused.
--
-- ── F2: the server computed levels with the old, broken curve ────────────
--
-- increment_user_xp carried FLOOR(250 * POWER(mult, i-1)) with per-band
-- multipliers re-based from level 1 — the exact discontinuity the client
-- curve was rebalanced to remove. The two disagreed by +2 levels at 559 XP
-- and +29 at 120,000. current_level is read by the duel, gym-rival, hero
-- and theme surfaces, so one user showed two different levels on two
-- screens, and grant_level_up_rewards paid on the old curve while the UI
-- celebrated the new one.
--
-- The fix is not to port the JS curve into PL/pgSQL a second time — that
-- duplication is what drifted. RuneLite's Experience.java builds its table
-- once in a static block and every lookup is an index; this does the same.
-- xp_level_thresholds is generated FROM src/lib/xpSystem.js and is the only
-- place the curve exists in the database. increment_user_xp now does one
-- indexed lookup. src/lib/__tests__/xpLevelThresholds.test.js re-derives the
-- table from the JS curve and fails if this migration drifts from it.
--
-- Paste-safety: no dotted alias.column or record .id tokens (CLAUDE.md §7).

-- ── Canonical curve ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xp_level_thresholds (
  level             INTEGER PRIMARY KEY,
  total_xp_required BIGINT NOT NULL
);

COMMENT ON TABLE public.xp_level_thresholds IS
  'Cumulative XP to reach each level. Generated from src/lib/xpSystem.js — the single source of truth for the curve. Do not hand-edit; regenerate and verify with xpLevelThresholds.test.js.';

-- Idempotent: re-running replaces the curve wholesale rather than appending.
INSERT INTO public.xp_level_thresholds (level, total_xp_required) VALUES
  (1,0),(2,100),(3,211),(4,334),(5,470),(6,621),(7,789),(8,976),(9,1183),(10,1413),
  (11,1668),(12,1951),(13,2259),(14,2593),(15,2955),(16,3348),(17,3774),(18,4237),(19,4739),(20,5284),
  (21,5875),(22,6516),(23,7212),(24,7967),(25,8787),(26,9676),(27,10641),(28,11688),(29,12824),(30,14057),
  (31,15394),(32,16845),(33,18369),(34,19969),(35,21649),(36,23413),(37,25265),(38,27210),(39,29252),(40,31396),
  (41,33647),(42,36011),(43,38493),(44,41099),(45,43836),(46,46709),(47,49726),(48,52894),(49,56220),(50,59713),
  (51,63380),(52,67231),(53,71274),(54,75520),(55,79978),(56,84659),(57,89574),(58,94735),(59,100154),(60,105844),
  (61,111818),(62,118091),(63,124615),(64,131400),(65,138456),(66,145794),(67,153426),(68,161363),(69,169618),(70,178203),
  (71,187132),(72,196418),(73,206075),(74,216118),(75,226563),(76,237426),(77,248724),(78,260473),(79,272692),(80,285400),
  (81,298617),(82,312362),(83,326520),(84,341102),(85,356122),(86,371593),(87,387528),(88,403941),(89,420846),(90,438258),
  (91,456193),(92,474666),(93,493693),(94,513291),(95,533477),(96,554268),(97,575683),(98,597740),(99,620459),(100,643860)
ON CONFLICT (level) DO UPDATE SET total_xp_required = EXCLUDED.total_xp_required;

CREATE INDEX IF NOT EXISTS idx_xp_level_thresholds_required
  ON public.xp_level_thresholds (total_xp_required);

REVOKE ALL ON public.xp_level_thresholds FROM PUBLIC;
REVOKE ALL ON public.xp_level_thresholds FROM anon;
GRANT SELECT ON public.xp_level_thresholds TO authenticated;

-- ── F2: level derivation by lookup, not re-derivation ────────────────────
CREATE OR REPLACE FUNCTION public.increment_user_xp(p_user_id uuid, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $increment_user_xp$
DECLARE
  v_uid       UUID := auth.uid();
  v_total_xp  BIGINT;
  v_level     INTEGER := 1;
  v_today     INTEGER;
  v_grant     INTEGER;
  v_daily_cap CONSTANT INTEGER := 50000;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN; END IF;
  IF p_xp > 100000 THEN
    RAISE EXCEPTION 'xp out of range' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_today
    FROM public.xp_grant_log
    WHERE user_id = v_uid
      AND granted_at > now() - interval '24 hours';

  v_grant := LEAST(p_xp, GREATEST(0, v_daily_cap - v_today));
  IF v_grant <= 0 THEN RETURN; END IF;

  INSERT INTO public.xp_grant_log (user_id, amount) VALUES (v_uid, v_grant);

  UPDATE public.user_profiles
    SET total_xp   = COALESCE(total_xp, 0) + v_grant,
        updated_at = now()
    WHERE id = v_uid
    RETURNING total_xp INTO v_total_xp;

  IF NOT FOUND THEN RETURN; END IF;

  -- One indexed lookup against the canonical table. Was a 99-iteration loop
  -- re-deriving a curve that had already drifted from the client's.
  SELECT COALESCE(MAX(level), 1) INTO v_level
    FROM public.xp_level_thresholds
    WHERE total_xp_required <= v_total_xp;

  UPDATE public.user_profiles SET current_level = v_level WHERE id = v_uid;
END;
$increment_user_xp$;

REVOKE ALL ON FUNCTION public.increment_user_xp(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_user_xp(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.increment_user_xp(uuid, integer) FROM authenticated;

-- ── Backfill: every existing current_level was computed on the old curve ──
UPDATE public.user_profiles
SET current_level = COALESCE((
  SELECT MAX(level) FROM public.xp_level_thresholds
  WHERE total_xp_required <= COALESCE(total_xp, 0)
), 1)
WHERE COALESCE(current_level, 1) IS DISTINCT FROM COALESCE((
  SELECT MAX(level) FROM public.xp_level_thresholds
  WHERE total_xp_required <= COALESCE(total_xp, 0)
), 1);

-- ── F1: refuse direct client writes to the economy columns ───────────────
CREATE OR REPLACE FUNCTION public.guard_profile_economy_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $guard_profile_economy_columns$
BEGIN
  -- current_user is 'authenticated' only for a direct PostgREST write.
  -- Inside a SECURITY DEFINER RPC owned by postgres it is 'postgres', and
  -- service_role connections are 'service_role', so server paths pass through.
  IF current_user = 'authenticated' THEN
    IF NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
      RAISE EXCEPTION 'total_xp is server-managed; use grant_action_xp'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.flex_coins IS DISTINCT FROM OLD.flex_coins THEN
      RAISE EXCEPTION 'flex_coins is server-managed; use the coin RPCs'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.current_level IS DISTINCT FROM OLD.current_level THEN
      RAISE EXCEPTION 'current_level is derived from total_xp'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard_profile_economy_columns$;

DROP TRIGGER IF EXISTS trg_guard_profile_economy_columns ON public.user_profiles;
CREATE TRIGGER trg_guard_profile_economy_columns
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_economy_columns();

NOTIFY pgrst, 'reload schema';
