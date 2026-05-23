-- 119_marketplace_sold_counts.sql
--
-- "Sold X times" counter for marketplace listings. Aggregate by item_id
-- (the catalog id from src/lib/lootCatalog.js) so a popular sticker's
-- count survives across re-listings — every seller sells the same
-- 'stk_fire'; the buyer cares how many TOTAL of that item have
-- changed hands, not just from this specific listing.
--
-- Pattern: small denormalized counter table + AFTER UPDATE trigger
-- that bumps when a listing transitions to status='completed'.
--
-- Why a table not a view: marketplace_listings has cancelled +
-- completed + active rows; a view that re-aggregates on every read
-- would scan the entire table. A counter table is one tiny row per
-- item_id, read in O(1).

CREATE TABLE IF NOT EXISTS public.item_sold_counts (
  item_id     TEXT         PRIMARY KEY,
  sold_count  INTEGER      NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.item_sold_counts ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read counts — they're a public trust signal
-- shown on every listing card.
DROP POLICY IF EXISTS "item_sold_counts: public read" ON public.item_sold_counts;
CREATE POLICY "item_sold_counts: public read"
  ON public.item_sold_counts FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.item_sold_counts TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Trigger: bump the counter when a listing transitions to 'completed'.
-- Idempotent on retries because we only fire on the status transition
-- (not on every UPDATE).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_item_sold_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.item_id IS NOT NULL THEN
    INSERT INTO public.item_sold_counts (item_id, sold_count)
    VALUES (NEW.item_id, 1)
    ON CONFLICT (item_id)
    DO UPDATE SET
      sold_count = public.item_sold_counts.sold_count + 1,
      updated_at = now();
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let counter maintenance block the underlying purchase.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_item_sold_count ON public.marketplace_listings;
CREATE TRIGGER trg_bump_item_sold_count
  AFTER UPDATE OF status ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_item_sold_count();

-- Backfill: seed the counter from existing completed listings so the
-- counts don't lie for items that sold before this migration landed.
INSERT INTO public.item_sold_counts (item_id, sold_count)
SELECT item_id, COUNT(*)
  FROM public.marketplace_listings
 WHERE status = 'completed'
   AND item_id IS NOT NULL
 GROUP BY item_id
ON CONFLICT (item_id) DO UPDATE SET
  sold_count = EXCLUDED.sold_count,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
