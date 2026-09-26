-- 270_training_spaces_membership_gate.sql
--
-- SECURITY FIX for migration 268. Closes a path that let any
-- authenticated user put arbitrary content on any gym's floor.
--
-- ── The hole ─────────────────────────────────────────────────────────
--
-- 268's INSERT policy on training_spaces checked only that the row was
-- self-owned:
--
--     WITH CHECK (owner_id = (SELECT auth.uid()))
--
-- Nothing tied a `kind='gym'` space to the gym it names. So any signed-in
-- user could:
--
--   1. INSERT a training_space with kind='gym' and ANY gym_id — they are
--      not a member, they just have to know the id, and gym_businesses
--      is world-readable to authenticated users (mig 135), so ids are
--      not secret.
--   2. INSERT into space_equipment against it. That policy DOES check
--      membership, but it is satisfied by `training_spaces.owner_id =
--      auth.uid()` — and the attacker owns the space they just made.
--   3. Their row now appears on the gym's floor, because listGymFloor()
--      unions every training_space carrying that gym_id, which is the
--      design (a gym's floor is the union of its members' spaces).
--
-- label_override is free text. It goes through the profanity trigger,
-- but that stops slurs, not spam or misinformation about what a gym
-- owns. Confirmed against production: a real non-member successfully
-- wrote "INJECTED BY A NON-MEMBER" onto a real gym's floor, in a
-- transaction that was rolled back.
--
-- ── The fix ──────────────────────────────────────────────────────────
--
-- A gym-kind space now requires membership (or ownership) of that gym.
-- Home spaces are unaffected — they have no gym_id and no one else can
-- see them.
--
-- The same gate goes on UPDATE's WITH CHECK. Without it the hole
-- reopens one step later: create a legitimate home space, then UPDATE it
-- to kind='gym' with someone else's gym_id.
--
-- Legitimate callers are unaffected. Both places that create a gym space
-- (the member picker and the owner's editor in GymEdit) are reached only
-- from a gym the user belongs to.
--
-- Alias-free + idempotent.

DROP POLICY IF EXISTS "training_spaces: insert own" ON public.training_spaces;
CREATE POLICY "training_spaces: insert own"
  ON public.training_spaces FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      -- Private to one user; nothing to gate against.
      kind = 'home'
      -- Shared surface: prove you belong to the gym you're naming.
      OR (kind = 'gym'
          AND gym_id IS NOT NULL
          AND public.is_gym_member_or_owner(gym_id, (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS "training_spaces: update own" ON public.training_spaces;
CREATE POLICY "training_spaces: update own"
  ON public.training_spaces FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    -- owner_id pinned so a space can't be handed to another user
    -- (mig 158 item-4 class of bug), AND the same membership gate as
    -- INSERT so a home space can't be converted into a foothold on a
    -- gym the user has no relationship with.
    owner_id = (SELECT auth.uid())
    AND (
      kind = 'home'
      OR (kind = 'gym'
          AND gym_id IS NOT NULL
          AND public.is_gym_member_or_owner(gym_id, (SELECT auth.uid())))
    )
  );

-- Clean up anything that got in before the gate existed. Empty today —
-- the feature has no production rows yet — but this migration must be
-- correct whenever it actually runs.
DELETE FROM public.training_spaces
 WHERE kind = 'gym'
   AND gym_id IS NOT NULL
   AND NOT public.is_gym_member_or_owner(gym_id, owner_id);
