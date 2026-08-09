-- 322_listing_guard_trigger_can_see_its_caller.sql
--
-- Migration 320's guard trigger never guarded anything. One word.
--
-- `marketplace_listings_guard_write()` is the defence-in-depth half of 320:
-- the client's UPDATE is revoked, and this trigger pins the trust-bearing
-- columns anyway "for the day a future migration re-adds an UPDATE policy".
-- It decides whether to pin by asking who is calling:
--
--     IF current_user IN ('postgres', 'service_role') THEN RETURN NEW; END IF;
--
-- and it was declared SECURITY DEFINER. Inside a SECURITY DEFINER function,
-- `current_user` IS THE OWNER — that is what the flag means. The function is
-- owned by postgres, so that condition is true for every caller, including a
-- seller posting straight to PostgREST. The trigger returned NEW unmodified,
-- always, and pinned nothing.
--
-- Measured rather than reasoned, called as role `authenticated`:
--
--     SECURITY DEFINER fn -> current_user=postgres    session_user=postgres
--     plain (invoker) fn  -> current_user=authenticated session_user=postgres
--
-- The fix is to drop the flag. That is also why the function this was
-- modelled on — `user_profiles_block_privileged_updates`, migrations 142/173,
-- the same current_user check, live since then across 22 SECURITY DEFINER
-- writers — is NOT SECURITY DEFINER. An invoker-rights trigger function needs
-- no privileges of its own: it only reads OLD and assigns NEW. And it still
-- sees `postgres` when the statement runs inside a SECURITY DEFINER RPC,
-- because it inherits that execution context — which is exactly how
-- purchase_listing, purchase_bundle, cancel_marketplace_listing and
-- set_listing_bundle keep writing.
--
-- Nothing was exposed by this in production. The REVOKE in 320 is what
-- actually stops a client UPDATE, and it works — verified live after 320
-- landed: a seller setting is_featured on their own listing gets
-- `permission denied for table marketplace_listings`, from the missing GRANT,
-- not from the trigger. So this is the backup layer being restored, not a
-- live hole being closed. It matters the day someone re-adds an UPDATE grant
-- or policy, which is the one scenario the trigger exists for.
--
-- Found by get_advisors, not by testing the feature — the feature behaved
-- perfectly throughout, exactly as the scheduled-workouts note in CLAUDE.md
-- warns. It surfaced as `anon_security_definer_function_executable`, since a
-- SECURITY DEFINER function in the public schema is EXECUTE-able by PUBLIC
-- until revoked. Dropping the flag clears that lint too; a `RETURNS trigger`
-- function cannot be called directly anyway, so there was no exploit in it,
-- only a signal pointing at the real bug.
--
-- Body is otherwise byte-identical to 320's.

CREATE OR REPLACE FUNCTION public.marketplace_listings_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  NEW.seller_user_id   := OLD.seller_user_id;
  NEW.seller_email     := OLD.seller_email;
  NEW.seller_username  := OLD.seller_username;
  NEW.inventory_id     := OLD.inventory_id;
  NEW.item_id          := OLD.item_id;
  NEW.item_name        := OLD.item_name;
  NEW.item_emoji       := OLD.item_emoji;
  NEW.item_rarity      := OLD.item_rarity;
  NEW.listing_type     := OLD.listing_type;
  NEW.asking_price     := OLD.asking_price;
  NEW.trade_for_rarity := OLD.trade_for_rarity;
  NEW.status           := OLD.status;
  NEW.created_at       := OLD.created_at;
  NEW.available_from   := OLD.available_from;
  NEW.available_until  := OLD.available_until;
  NEW.bundle_id        := OLD.bundle_id;
  NEW.is_featured      := OLD.is_featured;
  NEW.featured_until   := OLD.featured_until;

  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE keeps the existing trigger binding, so the trigger does
-- not need recreating — but re-assert it so a partial apply cannot leave the
-- table with the corrected function and no trigger on it.
DROP TRIGGER IF EXISTS marketplace_listings_guard_write_tr
  ON public.marketplace_listings;
CREATE TRIGGER marketplace_listings_guard_write_tr
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listings_guard_write();
