-- 268_training_spaces_equipment.sql
--
-- Phase 1 of the equipment picker — see docs/gym-equipment-picker-prompt.md.
--
-- Users asked to record the SPECIFIC implement they're using inside an
-- active workout: their gym's Hammer Strength row vs the Cybex one, or
-- their own Bowflex 552s at home. This is the data layer. No UI yet.
--
-- ── Why "training space" and not "gym" ───────────────────────────────
--
-- The obvious model is gym_businesses → equipment. It does not work:
--
--   • gym_businesses requires latitude/longitude NOT NULL and a
--     flexyn_code, and INSERT is gated behind approve_gym_verification
--     (SECURITY DEFINER, mig 135) with NO client insert path. A user
--     cannot create a row for their garage, and we are not weakening
--     gym verification so they can.
--   • gym_members and gym_checkins both FK hard to gym_businesses(id).
--
-- So the owning entity is training_spaces, which is EITHER a pointer at
-- a verified gym (kind='gym', shared with that gym's members) OR a
-- private space owned by one user (kind='home'). A user may have
-- several: home, their commercial gym, a travel gym.
--
-- ── Catalog is global, membership is per-space ───────────────────────
--
-- equipment_models is one row per real product, shared by every space
-- that has one — so photos and names dedupe, and search works. Safe
-- because gym_businesses and gym_members are both already
-- `FOR SELECT TO authenticated USING (TRUE)` (mig 135), so a global
-- readable catalog adds no new exposure.
--
-- ── User-submitted content posture ───────────────────────────────────
--
-- Members can add models and photos, so this carries the same
-- moderation surface as gym_feed_posts. Mirrors mig 158: profanity
-- trigger via is_text_clean on every free-text column, a report
-- counter, and approval gating on anything that becomes globally
-- visible. Seeded rows are approved; user submissions are not, and an
-- unapproved model is visible only inside the space that added it.
--
-- No manufacturer imagery is stored or referenced here. Brand/model are
-- TEXT (nominative use). Photos are user-owned uploads in the existing
-- public `uploads` bucket. See docs/gym-equipment-picker-research.md §3.
--
-- Alias-free + idempotent throughout.

-- ── 1. training_spaces ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_spaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('gym', 'home')),
  -- Set when kind='gym'. NULL for home spaces.
  gym_id      UUID REFERENCES public.gym_businesses(id) ON DELETE CASCADE,
  -- User's own label ("Garage", "Work gym"). For kind='gym' the UI
  -- prefers gym_businesses.name and treats this as an override.
  name        TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- kind and gym_id must agree.
  CONSTRAINT training_spaces_kind_gym_ck CHECK (
    (kind = 'gym'  AND gym_id IS NOT NULL) OR
    (kind = 'home' AND gym_id IS NULL)
  )
);

-- One space per (user, gym) — joining the same gym twice is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS training_spaces_owner_gym_uidx
  ON public.training_spaces (owner_id, gym_id)
  WHERE gym_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_spaces_owner_idx
  ON public.training_spaces (owner_id);

ALTER TABLE public.training_spaces ENABLE ROW LEVEL SECURITY;

-- A space is readable by its owner, and — for gym spaces — by anyone
-- else who belongs to that gym, so members can see the shared floor.
DROP POLICY IF EXISTS "training_spaces: read own or gym" ON public.training_spaces;
CREATE POLICY "training_spaces: read own or gym"
  ON public.training_spaces FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR (gym_id IS NOT NULL
        AND public.is_gym_member_or_owner(gym_id, (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS "training_spaces: insert own" ON public.training_spaces;
CREATE POLICY "training_spaces: insert own"
  ON public.training_spaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

-- WITH CHECK pins owner_id so a space can't be handed to another user
-- (the mig 158 item-4 class of bug).
DROP POLICY IF EXISTS "training_spaces: update own" ON public.training_spaces;
CREATE POLICY "training_spaces: update own"
  ON public.training_spaces FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "training_spaces: delete own" ON public.training_spaces;
CREATE POLICY "training_spaces: delete own"
  ON public.training_spaces FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_spaces TO authenticated;


-- ── 2. equipment_models — the global catalog ─────────────────────────
CREATE TABLE IF NOT EXISTS public.equipment_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Slugs from src/lib/equipmentCatalog.js. Deliberately NOT enums —
  -- adding a brand or implement type should be a client-only change.
  brand_slug      TEXT NOT NULL DEFAULT 'unknown',
  implement_type  TEXT NOT NULL,
  product_line    TEXT,
  model_name      TEXT,
  -- Seeded rows ship with the app and are trusted; user submissions
  -- start unapproved and are visible only in the space that added them.
  is_seeded       BOOLEAN NOT NULL DEFAULT FALSE,
  approved        BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reported        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe the catalog. COALESCE because product_line / model_name are
-- nullable and NULLs don't collide in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS equipment_models_identity_uidx
  ON public.equipment_models (
    brand_slug, implement_type,
    COALESCE(product_line, ''), COALESCE(model_name, '')
  );

CREATE INDEX IF NOT EXISTS equipment_models_type_idx
  ON public.equipment_models (implement_type)
  WHERE approved = TRUE;

ALTER TABLE public.equipment_models ENABLE ROW LEVEL SECURITY;

-- NOTE: the SELECT policy for this table lives in §3a, after
-- space_equipment exists — it references that table, and CREATE POLICY
-- resolves table names eagerly.

-- Submissions land unapproved and attributed. Both are pinned in
-- WITH CHECK so a client can't self-approve into the global catalog.
DROP POLICY IF EXISTS "equipment_models: submit" ON public.equipment_models;
CREATE POLICY "equipment_models: submit"
  ON public.equipment_models FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = (SELECT auth.uid())
    AND approved  = FALSE
    AND is_seeded = FALSE
  );

-- No client UPDATE or DELETE. Approval and moderation are admin/
-- service_role only — an UPDATE policy here would reopen self-approval.
GRANT SELECT, INSERT ON public.equipment_models TO authenticated;


-- ── 3. space_equipment — what a given space actually has ─────────────
CREATE TABLE IF NOT EXISTS public.space_equipment (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id          UUID NOT NULL REFERENCES public.training_spaces(id) ON DELETE CASCADE,
  model_id          UUID REFERENCES public.equipment_models(id) ON DELETE SET NULL,
  -- Denormalized so a space can hold "a leg press, brand unknown" with
  -- no catalog row at all. Always populated.
  implement_type    TEXT NOT NULL,
  -- User's own name for it ("the good bench", "corner squat rack").
  label_override    TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  photo_url         TEXT,
  -- Gym owner has confirmed this is really on their floor.
  verified_by_owner BOOLEAN NOT NULL DEFAULT FALSE,
  added_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A space lists a given catalog model once. Partial so multiple
-- "unknown brand" entries of the same type are still allowed.
CREATE UNIQUE INDEX IF NOT EXISTS space_equipment_space_model_uidx
  ON public.space_equipment (space_id, model_id)
  WHERE model_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS space_equipment_space_type_idx
  ON public.space_equipment (space_id, implement_type);

ALTER TABLE public.space_equipment ENABLE ROW LEVEL SECURITY;

-- Readable by anyone who can read the parent space.
DROP POLICY IF EXISTS "space_equipment: read via space" ON public.space_equipment;
CREATE POLICY "space_equipment: read via space"
  ON public.space_equipment FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.training_spaces
       WHERE public.training_spaces.id = public.space_equipment.space_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR (public.training_spaces.gym_id IS NOT NULL
               AND public.is_gym_member_or_owner(
                     public.training_spaces.gym_id, (SELECT auth.uid())))
         )
    )
  );

-- Same reach for adding: your own space, or a gym you belong to.
DROP POLICY IF EXISTS "space_equipment: add via space" ON public.space_equipment;
CREATE POLICY "space_equipment: add via space"
  ON public.space_equipment FOR INSERT TO authenticated
  WITH CHECK (
    added_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.training_spaces
       WHERE public.training_spaces.id = public.space_equipment.space_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR (public.training_spaces.gym_id IS NOT NULL
               AND public.is_gym_member_or_owner(
                     public.training_spaces.gym_id, (SELECT auth.uid())))
         )
    )
  );

-- Editing is narrower than adding: the person who added it, the space
-- owner, or the gym's owner. A rank-and-file member cannot rewrite
-- another member's entry.
DROP POLICY IF EXISTS "space_equipment: edit own or owner" ON public.space_equipment;
CREATE POLICY "space_equipment: edit own or owner"
  ON public.space_equipment FOR UPDATE TO authenticated
  USING (
    added_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.training_spaces
       WHERE public.training_spaces.id = public.space_equipment.space_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.gym_businesses
              WHERE public.gym_businesses.id = public.training_spaces.gym_id
                AND public.gym_businesses.owner_id = (SELECT auth.uid())
           )
         )
    )
  )
  WITH CHECK (
    added_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.training_spaces
       WHERE public.training_spaces.id = public.space_equipment.space_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.gym_businesses
              WHERE public.gym_businesses.id = public.training_spaces.gym_id
                AND public.gym_businesses.owner_id = (SELECT auth.uid())
           )
         )
    )
  );

DROP POLICY IF EXISTS "space_equipment: delete own or owner" ON public.space_equipment;
CREATE POLICY "space_equipment: delete own or owner"
  ON public.space_equipment FOR DELETE TO authenticated
  USING (
    added_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.training_spaces
       WHERE public.training_spaces.id = public.space_equipment.space_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.gym_businesses
              WHERE public.gym_businesses.id = public.training_spaces.gym_id
                AND public.gym_businesses.owner_id = (SELECT auth.uid())
           )
         )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_equipment TO authenticated;


-- ── 3a. equipment_models SELECT policy ───────────────────────────────
-- Deferred from §2 because it references space_equipment.
--
-- Approved rows are the shared catalog. An unapproved row stays visible
-- to whoever submitted it and to anyone in a space that already has it
-- — otherwise a member's own addition would vanish from their own
-- picker the moment they saved it.
DROP POLICY IF EXISTS "equipment_models: read approved" ON public.equipment_models;
CREATE POLICY "equipment_models: read approved"
  ON public.equipment_models FOR SELECT TO authenticated
  USING (
    approved = TRUE
    OR submitted_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.space_equipment
        JOIN public.training_spaces
          ON public.training_spaces.id = public.space_equipment.space_id
       WHERE public.space_equipment.model_id = public.equipment_models.id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR (public.training_spaces.gym_id IS NOT NULL
               AND public.is_gym_member_or_owner(
                     public.training_spaces.gym_id, (SELECT auth.uid())))
         )
    )
  );


-- ── 4. equipment_photos ──────────────────────────────────────────────
-- User-owned uploads, one row per photo. Kept separate from
-- space_equipment.photo_url (the chosen primary) so a machine can
-- accumulate shots from several members without contention.
CREATE TABLE IF NOT EXISTS public.equipment_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES public.space_equipment(id) ON DELETE CASCADE,
  model_id     UUID REFERENCES public.equipment_models(id) ON DELETE SET NULL,
  url          TEXT NOT NULL,
  uploaded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  reported     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS equipment_photos_equipment_idx
  ON public.equipment_photos (equipment_id);

CREATE INDEX IF NOT EXISTS equipment_photos_model_idx
  ON public.equipment_photos (model_id)
  WHERE model_id IS NOT NULL;

ALTER TABLE public.equipment_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_photos: read via equipment" ON public.equipment_photos;
CREATE POLICY "equipment_photos: read via equipment"
  ON public.equipment_photos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.space_equipment
        JOIN public.training_spaces
          ON public.training_spaces.id = public.space_equipment.space_id
       WHERE public.space_equipment.id = public.equipment_photos.equipment_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR (public.training_spaces.gym_id IS NOT NULL
               AND public.is_gym_member_or_owner(
                     public.training_spaces.gym_id, (SELECT auth.uid())))
         )
    )
  );

DROP POLICY IF EXISTS "equipment_photos: upload via equipment" ON public.equipment_photos;
CREATE POLICY "equipment_photos: upload via equipment"
  ON public.equipment_photos FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
        FROM public.space_equipment
        JOIN public.training_spaces
          ON public.training_spaces.id = public.space_equipment.space_id
       WHERE public.space_equipment.id = public.equipment_photos.equipment_id
         AND (
           public.training_spaces.owner_id = (SELECT auth.uid())
           OR (public.training_spaces.gym_id IS NOT NULL
               AND public.is_gym_member_or_owner(
                     public.training_spaces.gym_id, (SELECT auth.uid())))
         )
    )
  );

-- Only the uploader can remove their own photo. Moderator removal goes
-- through service_role, same as the rest of the report pipeline.
DROP POLICY IF EXISTS "equipment_photos: delete own" ON public.equipment_photos;
CREATE POLICY "equipment_photos: delete own"
  ON public.equipment_photos FOR DELETE TO authenticated
  USING (uploaded_by = (SELECT auth.uid()));

GRANT SELECT, INSERT, DELETE ON public.equipment_photos TO authenticated;


-- ── 5. Profanity gates on every user-supplied free-text column ───────
-- Mirrors mig 158 §5. Falls back to a no-op when is_text_clean isn't
-- installed (legacy hosts running a pre-mig-102 subset).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_text_clean') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_equipment_text_profanity()
      RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
      BEGIN
        IF TG_TABLE_NAME = 'equipment_models' THEN
          IF NOT public.is_text_clean(
                   COALESCE(NEW.product_line, '') || ' ' ||
                   COALESCE(NEW.model_name, ''), FALSE) THEN
            RAISE EXCEPTION 'equipment_profanity'
              USING ERRCODE = '23514',
                    HINT    = 'Equipment name contains prohibited content.';
          END IF;
        ELSIF TG_TABLE_NAME = 'space_equipment' THEN
          IF NEW.label_override IS NOT NULL AND NEW.label_override <> ''
             AND NOT public.is_text_clean(NEW.label_override, FALSE) THEN
            RAISE EXCEPTION 'equipment_profanity'
              USING ERRCODE = '23514',
                    HINT    = 'Equipment label contains prohibited content.';
          END IF;
        ELSIF TG_TABLE_NAME = 'training_spaces' THEN
          IF NEW.name IS NOT NULL AND NEW.name <> ''
             AND NOT public.is_text_clean(NEW.name, FALSE) THEN
            RAISE EXCEPTION 'equipment_profanity'
              USING ERRCODE = '23514',
                    HINT    = 'Space name contains prohibited content.';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    DROP TRIGGER IF EXISTS equipment_models_profanity     ON public.equipment_models;
    CREATE TRIGGER equipment_models_profanity
      BEFORE INSERT OR UPDATE ON public.equipment_models
      FOR EACH ROW EXECUTE FUNCTION public.enforce_equipment_text_profanity();

    DROP TRIGGER IF EXISTS space_equipment_profanity      ON public.space_equipment;
    CREATE TRIGGER space_equipment_profanity
      BEFORE INSERT OR UPDATE ON public.space_equipment
      FOR EACH ROW EXECUTE FUNCTION public.enforce_equipment_text_profanity();

    DROP TRIGGER IF EXISTS training_spaces_profanity      ON public.training_spaces;
    CREATE TRIGGER training_spaces_profanity
      BEFORE INSERT OR UPDATE ON public.training_spaces
      FOR EACH ROW EXECUTE FUNCTION public.enforce_equipment_text_profanity();

  END IF;
END $$;


-- ── 6. updated_at maintenance ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_equipment_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS training_spaces_touch  ON public.training_spaces;
CREATE TRIGGER training_spaces_touch
  BEFORE UPDATE ON public.training_spaces
  FOR EACH ROW EXECUTE FUNCTION public.touch_equipment_updated_at();

DROP TRIGGER IF EXISTS space_equipment_touch  ON public.space_equipment;
CREATE TRIGGER space_equipment_touch
  BEFORE UPDATE ON public.space_equipment
  FOR EACH ROW EXECUTE FUNCTION public.touch_equipment_updated_at();


-- ── 7. Grants for the service role ───────────────────────────────────
-- Mig 085's ALTER DEFAULT PRIVILEGES should cover new public tables,
-- but these are explicit so a partial-deploy window can't leave the
-- moderation/approval path without access.
GRANT ALL ON public.training_spaces   TO service_role;
GRANT ALL ON public.equipment_models  TO service_role;
GRANT ALL ON public.space_equipment   TO service_role;
GRANT ALL ON public.equipment_photos  TO service_role;

-- search_path hardening, matching mig 204's posture for every function
-- this migration defines. The profanity function is created inside a
-- conditional DO block, so guard the ALTER the same way.
ALTER FUNCTION public.touch_equipment_updated_at() SET search_path TO 'public', 'pg_catalog';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname = 'enforce_equipment_text_profanity') THEN
    EXECUTE 'ALTER FUNCTION public.enforce_equipment_text_profanity() '
         || 'SET search_path TO ''public'', ''pg_catalog''';
  END IF;
END $$;
