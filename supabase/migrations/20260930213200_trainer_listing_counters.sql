-- trainer_listings.sales_count and gross_cents are shown on a trainer's
-- listing, and neither could be trusted:
--
-- * A trainer holds UPDATE on their own row, every column included, so they
--   could set their own sales and earnings to any number.
-- * trainer_listing_stats_sync (the AFTER trigger on trainer_purchases) was
--   SECURITY INVOKER. It runs as the BUYER, whose UPDATE on someone else's
--   listing matches zero rows under the "trainer update own" policy, so a
--   real sale never moved either counter and nothing raised.
--
-- Fix: the sync runs as definer and derives both values from
-- trainer_purchases (count and sum rather than +/-1, so any drift heals on
-- the next sale), and a BEFORE trigger pins both columns for client roles.
-- The feature is flagged off and the table holds no rows today.

CREATE OR REPLACE FUNCTION public.trainer_listing_stats_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_listing uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
BEGIN
  UPDATE public.trainer_listings l
     SET sales_count = s.n,
         gross_cents = s.cents
    FROM (
      SELECT count(*)::int AS n, COALESCE(sum(amount_paid_cents), 0)::bigint AS cents
        FROM public.trainer_purchases
       WHERE listing_id = v_listing
    ) s
   WHERE l.id = v_listing;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.trainer_listing_stats_sync() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trainer_listings_guard_counters()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- current_user is the function owner inside a SECURITY DEFINER caller such
  -- as the sync above, and the client role on a direct PostgREST write.
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.sales_count := 0;
      NEW.gross_cents := 0;
    ELSE
      NEW.sales_count := OLD.sales_count;
      NEW.gross_cents := OLD.gross_cents;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_trainer_listings_guard_counters ON public.trainer_listings;
CREATE TRIGGER trg_trainer_listings_guard_counters
  BEFORE INSERT OR UPDATE ON public.trainer_listings
  FOR EACH ROW EXECUTE FUNCTION public.trainer_listings_guard_counters();

DO $$
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.trainer_listing_stats_sync'::regproc) THEN
    RAISE EXCEPTION 'trainer_listing_stats_sync is still SECURITY INVOKER';
  END IF;
END $$;
