-- ── 324 · gym_businesses.member_count stops drifting ────────────────
--
-- Camp Quannapowitt read 2 members against 1 real gym_members row, and
-- the counter is not cosmetic: it is on every map pin, in the gym list,
-- in the "N members" line on the hub, and it decides whether the Flexyn
-- Code renders at all after mig 275's page merge.
--
-- The cause is an RLS asymmetry between joining and leaving, and it is
-- silent in both directions.
--
--   JOINING goes through join_gym_by_code / set_home_gym_from_osm /
--   set_home_gym_custom. All three are SECURITY DEFINER, so the INSERT
--   into gym_members — and therefore trg_gym_members_count — runs as the
--   function owner, and the counter goes up.
--
--   LEAVING is a direct client DELETE (leaveGym in gymBusinesses.js),
--   allowed by gym_members' own RLS. The trigger then runs as
--   `authenticated`, and gym_businesses' only UPDATE policy is
--   `owner_id = auth.uid()`. A member who is not the owner updates ZERO
--   rows. No error, no warning — the DELETE succeeds, the count stays.
--
-- Verified against production as a real authenticated non-owner:
-- `UPDATE public.gym_businesses SET member_count = 99` returned without
-- error and left the value at 2. MCP and the SQL editor run as postgres
-- and bypass RLS entirely, so this only shows up when you attempt it as
-- the role that actually does it.
--
-- It is worse on a community gym, where owner_id is NULL by design
-- (mig 275): `owner_id = auth.uid()` is never true, so NOBODY can bring
-- that counter down, ever.
--
-- Three changes, in order of what each one buys:
--
--   1. The sync trigger becomes SECURITY DEFINER, so maintaining the
--      counter no longer depends on who happens to be leaving.
--   2. It DERIVES the count from the rows instead of applying ±1. An
--      increment can only ever be as correct as every increment before
--      it; a count(*) is right regardless of history, so any drift —
--      including drift from a cause nobody diagnosed — heals on the next
--      join or leave rather than compounding.
--   3. A BEFORE UPDATE guard on gym_businesses recomputes member_count
--      whenever an UPDATE tries to change it. Owners may update their own
--      gym row, and nothing stops a hand-written PATCH from setting
--      member_count to 900 on a pin the whole map can see.
--
-- Then a one-shot reconcile for the rows that are already wrong.
--
-- Note for whoever re-seeds demo gyms: mig 137 inserted them WITH a
-- member_count. The guard will now recompute that to the real row count
-- (zero, for a gym nobody joined). Seed gym_members rows if a demo gym
-- needs to look populated.

-- ── 1 + 2 · derive the count, and be allowed to write it ────────────
CREATE OR REPLACE FUNCTION public.gym_members_count_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_old UUID := NULL;
  v_new UUID := NULL;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := OLD.gym_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := NEW.gym_id; END IF;

  IF v_old IS NOT NULL THEN
    UPDATE public.gym_businesses
       SET member_count = (SELECT count(*) FROM public.gym_members WHERE gym_id = v_old)
     WHERE id = v_old;
  END IF;

  -- Only when the membership moved to a DIFFERENT gym; on a plain
  -- INSERT v_old is NULL, so this is the branch that runs.
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    UPDATE public.gym_businesses
       SET member_count = (SELECT count(*) FROM public.gym_members WHERE gym_id = v_new)
     WHERE id = v_new;
  END IF;

  RETURN NULL;  -- AFTER trigger: the return value is discarded
END;
$$;

REVOKE ALL ON FUNCTION public.gym_members_count_sync() FROM PUBLIC;

-- UPDATE OF gym_id is new. A membership repointed at another gym used to
-- leave both counters wrong — the old gym too high and the new one too
-- low — because the old trigger only fired on INSERT and DELETE.
DROP TRIGGER IF EXISTS trg_gym_members_count ON public.gym_members;
CREATE TRIGGER trg_gym_members_count
  AFTER INSERT OR UPDATE OF gym_id OR DELETE ON public.gym_members
  FOR EACH ROW EXECUTE FUNCTION public.gym_members_count_sync();

-- ── 3 · the counter is derived, not authored ────────────────────────
-- SECURITY DEFINER because mig 301 scoped gym_members reads to your own
-- rows or a gym you belong to: an owner who never joined their own gym
-- cannot count its members, and would recompute the number to zero.
CREATE OR REPLACE FUNCTION public.gym_member_count_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.member_count IS DISTINCT FROM OLD.member_count THEN
    NEW.member_count := (SELECT count(*) FROM public.gym_members WHERE gym_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.gym_member_count_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_gym_member_count_guard ON public.gym_businesses;
CREATE TRIGGER trg_gym_member_count_guard
  BEFORE UPDATE OF member_count ON public.gym_businesses
  FOR EACH ROW EXECUTE FUNCTION public.gym_member_count_guard();

-- ── Reconcile what is already wrong ─────────────────────────────────
-- CTE-renamed join key rather than a correlated alias.column, per the
-- paste-safety rule in CLAUDE.md.
WITH real_counts AS (
  SELECT gym_id AS g_id, count(*)::int AS n
    FROM public.gym_members
   GROUP BY gym_id
)
UPDATE public.gym_businesses
   SET member_count = COALESCE((SELECT n FROM real_counts WHERE g_id = id), 0)
 WHERE member_count IS DISTINCT FROM COALESCE((SELECT n FROM real_counts WHERE g_id = id), 0);
