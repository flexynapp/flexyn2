-- 118_regimen_reviews.sql
--
-- Star-rating + review system for public regimens. The single biggest
-- trust signal for "should I copy this regimen?" — without it the
-- store is just a list of fork counts and the user has no idea whether
-- a popular regimen is also a GOOD one.
--
-- Schema
--   regimen_reviews — one row per (regimen, reviewer). Reviewers can
--                     update their own row (changed your mind on a
--                     program) but never delete — the count integrity
--                     matters more than the right to delete.
--   regimen_review_aggregates — VIEW returning (regimen_id, avg_rating,
--                               review_count) for cheap read-time joins.
--
-- Guard
--   Reviews can only be submitted by users who have ADOPTED (cloned)
--   the regimen. Enforced via the insert trigger so a malicious client
--   can't drive-by review a regimen they never tried.

CREATE TABLE IF NOT EXISTS public.regimen_reviews (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  regimen_id   UUID         NOT NULL REFERENCES public.regimens(id) ON DELETE CASCADE,
  reviewer_id  UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_email TEXT       NOT NULL,
  rating       INTEGER      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (regimen_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_regimen_reviews_regimen
  ON public.regimen_reviews(regimen_id, created_at DESC);

ALTER TABLE public.regimen_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read reviews — the whole point is they're
-- public trust signals.
DROP POLICY IF EXISTS "regimen_reviews: public read" ON public.regimen_reviews;
CREATE POLICY "regimen_reviews: public read"
  ON public.regimen_reviews FOR SELECT
  TO authenticated
  USING (true);

-- Reviewers can insert their own row.
DROP POLICY IF EXISTS "regimen_reviews: own insert" ON public.regimen_reviews;
CREATE POLICY "regimen_reviews: own insert"
  ON public.regimen_reviews FOR INSERT
  TO authenticated
  WITH CHECK (reviewer_id = auth.uid());

-- Reviewers can update their own row (revise rating / comment).
DROP POLICY IF EXISTS "regimen_reviews: own update" ON public.regimen_reviews;
CREATE POLICY "regimen_reviews: own update"
  ON public.regimen_reviews FOR UPDATE
  TO authenticated
  USING (reviewer_id = auth.uid());

-- No DELETE policy — once a review exists, it stays. Update-to-1-star
-- is the canonical "I changed my mind" path.
GRANT SELECT, INSERT, UPDATE ON public.regimen_reviews TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Adoption guard: a reviewer can only submit if they have CLONED the
-- regimen they're reviewing. Prevents drive-by review bombing without
-- locking out genuine users.
--
-- "Cloned" = the user owns a regimen whose parent_regimen_id points
-- to the target. We tolerate the column not existing on pre-fork-count
-- hosts (early schemas had parent_id) by checking both.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_review_adoption()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner BOOLEAN;
  v_cloned BOOLEAN;
BEGIN
  -- Author of the regimen always allowed (mostly a no-op since you'd
  -- never review your own; defensive).
  SELECT (created_by = NEW.reviewer_email) INTO v_owner
    FROM public.regimens WHERE id = NEW.regimen_id;
  IF v_owner THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.regimens
     WHERE created_by = NEW.reviewer_email
       AND (parent_regimen_id = NEW.regimen_id
            OR parent_id      = NEW.regimen_id)
  ) INTO v_cloned;

  IF NOT v_cloned THEN
    RAISE EXCEPTION 'review_requires_adoption'
      USING ERRCODE = '42501',
            HINT    = 'Copy this regimen to your own list before reviewing.';
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN undefined_column THEN
    -- Pre-fork host: skip the guard rather than block all reviews.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_review_adoption ON public.regimen_reviews;
CREATE TRIGGER trg_enforce_review_adoption
  BEFORE INSERT ON public.regimen_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_review_adoption();

-- Stamp updated_at on UPDATE so the client can show "edited X ago".
CREATE OR REPLACE FUNCTION public.bump_regimen_review_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_regimen_review_updated_at ON public.regimen_reviews;
CREATE TRIGGER trg_bump_regimen_review_updated_at
  BEFORE UPDATE ON public.regimen_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_regimen_review_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- Aggregate view — cheap read-time join for the regimen card. Returns
-- one row per regimen with avg_rating + review_count. NULL/0 when no
-- reviews exist (the join is LEFT in the client).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.regimen_review_aggregates AS
  SELECT
    regimen_id,
    ROUND(AVG(rating)::numeric, 2)::float AS avg_rating,
    COUNT(*)::int                          AS review_count
  FROM public.regimen_reviews
  GROUP BY regimen_id;

GRANT SELECT ON public.regimen_review_aggregates TO authenticated;

NOTIFY pgrst, 'reload schema';
