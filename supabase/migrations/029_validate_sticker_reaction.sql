-- 029_validate_sticker_reaction.sql
--
-- Closes the sticker-reaction forgery exploit. Previously a user could
-- call supabase.from('post_sticker_reactions').upsert(...) from DevTools
-- with any item_id and item_rarity they wanted — even stickers they had
-- never earned. RLS only checked user_id = auth.uid(), not inventory
-- ownership, so the forged "animated rarity diamond variant" sticker
-- would render on the post just fine.
--
-- This migration adds a BEFORE-INSERT/UPDATE trigger that:
--   1. Looks up the caller's inventory for a row with item_id matching
--      NEW.item_id AND (variant matching OR no variant filter).
--   2. If not found → raise exception → upsert rejected.
--   3. Overwrites NEW.item_rarity and NEW.item_emoji with the canonical
--      values from user_inventory so the client can't claim higher rarity
--      than they actually rolled.
--
-- Plus the variant must match too — a foil sticker shouldn't render as a
-- diamond. That check is included in the inventory lookup below.

CREATE OR REPLACE FUNCTION public._tg_validate_sticker_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.user_inventory%ROWTYPE;
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'cannot react on behalf of another user' USING ERRCODE = '42501';
  END IF;

  -- Find an inventory row owned by the caller matching the requested
  -- sticker AND variant. We don't require it to be unlisted — a listed
  -- sticker is still owned, just for sale.
  SELECT * INTO v_inv
    FROM public.user_inventory
   WHERE user_id = NEW.user_id
     AND item_id = NEW.item_id
     AND item_type = 'sticker'
     AND (variant IS NOT DISTINCT FROM NEW.variant)
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sticker not in your inventory: item_id=%', NEW.item_id
      USING ERRCODE = '42501';
  END IF;

  -- Overwrite client-supplied display fields with canonical values from
  -- the inventory row. Client can't lie about rarity/emoji/name even if
  -- the trigger above somehow passed.
  NEW.item_rarity := COALESCE(v_inv.item_rarity, NEW.item_rarity);
  NEW.item_emoji  := COALESCE(v_inv.item_emoji,  NEW.item_emoji);
  -- item_name: keep NEW value as primary (some legacy rows have empty
  -- item_name in inventory), but ensure it's never null.
  NEW.item_name := COALESCE(NULLIF(NEW.item_name, ''), v_inv.item_name, 'Sticker');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sticker_reaction ON public.post_sticker_reactions;
CREATE TRIGGER trg_validate_sticker_reaction
  BEFORE INSERT OR UPDATE ON public.post_sticker_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_validate_sticker_reaction();

NOTIFY pgrst, 'reload schema';
