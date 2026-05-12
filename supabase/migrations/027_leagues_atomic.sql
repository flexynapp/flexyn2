-- 027_leagues_atomic.sql
--
-- League integrity hardening. Three concurrent-write bugs addressed:
--
-- 1. recordWeeklyXp was read-modify-write on weekly_xp.
--    Two concurrent XP-earning events on the same user (workout completed +
--    quest claimed within the same second) both read the same baseline,
--    both wrote baseline+amount, and one of them was lost.
--    Replaced by an atomic UPDATE statement in increment_league_xp.
--
-- 2. member_count bump on join was read-modify-write.
--    Two users joining the same league at the same time both saw e.g.
--    count=29, both wrote 30. The league ended up with 31 members,
--    exceeding MAX_LEAGUE_SIZE. Replaced by an INSERT trigger that
--    derives member_count from the rows.
--
-- 3. _resolveLeague could fire twice concurrently.
--    Two clients getMyLeague()-ing at the same moment after week_end both
--    passed the `!is_resolved` guard and both ran the resolution, which
--    double-awarded coins + capsules. The claim_league_resolution RPC
--    below uses `UPDATE ... WHERE is_resolved=false RETURNING` so only
--    the first caller gets the lock; subsequent callers see NULL and
--    bail.

-- ── Atomic XP increment ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_league_xp(
  p_league_member_id UUID,
  p_amount INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  -- Restrict to the caller's own membership row.
  UPDATE public.league_members
     SET weekly_xp = COALESCE(weekly_xp, 0) + p_amount
   WHERE id = p_league_member_id
     AND user_id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_league_xp(UUID, INTEGER) TO authenticated;

-- ── Atomic resolution claim ─────────────────────────────────────────────────
-- Returns the league row if THIS caller successfully claimed the resolution,
-- or NULL if another caller already did. The application reads the result
-- and only proceeds with rewards/notifications when the claim succeeded.
CREATE OR REPLACE FUNCTION public.claim_league_resolution(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.leagues%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_league_id IS NULL THEN RETURN NULL; END IF;

  -- Atomic claim: only the FIRST caller flips is_resolved=true and gets
  -- the row back. Concurrent callers see NULL and know to bail.
  UPDATE public.leagues
     SET is_resolved = true
   WHERE id = p_league_id
     AND is_resolved = false
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_league_resolution(UUID) TO authenticated;

-- ── Server-side member_count maintenance ─────────────────────────────────────
-- Trigger keeps the denormalized member_count in sync on every membership
-- insert / delete. Client no longer needs to bump it (and races itself).
CREATE OR REPLACE FUNCTION public._tg_sync_league_member_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.leagues
       SET member_count = COALESCE(member_count, 0) + 1
     WHERE id = NEW.league_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.leagues
       SET member_count = GREATEST(0, COALESCE(member_count, 0) - 1)
     WHERE id = OLD.league_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_league_member_count ON public.league_members;
CREATE TRIGGER trg_league_member_count
  AFTER INSERT OR DELETE ON public.league_members
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_sync_league_member_count();

-- ── Tighten the over-permissive UPDATE policy from migration 016 ────────────
-- The original policy allowed any authenticated user to UPDATE any league
-- row, including flipping is_resolved or member_count maliciously. With
-- the new RPCs handling those writes server-side, the application-side
-- UPDATE path can be locked down.
--
-- We KEEP an UPDATE policy because some code paths still write directly
-- (e.g. emergency manual resolution), but narrow it to server-issued
-- claims only via a NULL-USING policy that admins can attach via roles
-- in the future. For now, we remove the policy entirely — RPCs are the
-- only writer.
DROP POLICY IF EXISTS "leagues: update authenticated" ON public.leagues;

-- league_members: caller can only update their OWN row.
DROP POLICY IF EXISTS "league_members: update own" ON public.league_members;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'league_members' AND policyname = 'league_members: update own'
  ) THEN
    CREATE POLICY "league_members: update own"
      ON public.league_members FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
