-- 210_block_tables_blocked_id.sql
--
-- Last of the id-column foundations. user_blocks and story_blocks each record
-- the blocker by blocker_id but the blocked user only by blocked_email — no
-- blocked_id. That's the remaining email-only join key in the block/story
-- paths. Both tables are currently empty, so this is a pure column+trigger add
-- (no backfill needed).
--
-- One shared trigger fn (both tables have the same blocked_id/blocked_email
-- shape) resolves blocked_id from blocked_email on write, SECURITY DEFINER to
-- see the blocked user's row past own-row RLS, only when NULL — same pattern as
-- migs 208/209.

ALTER TABLE public.user_blocks  ADD COLUMN IF NOT EXISTS blocked_id uuid;
ALTER TABLE public.story_blocks ADD COLUMN IF NOT EXISTS blocked_id uuid;

CREATE OR REPLACE FUNCTION public.populate_blocked_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.blocked_id IS NULL AND NEW.blocked_email IS NOT NULL THEN
    SELECT id INTO NEW.blocked_id FROM public.user_profiles
     WHERE lower(email) = lower(NEW.blocked_email) LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_blocks_populate_blocked_id_tr ON public.user_blocks;
CREATE TRIGGER user_blocks_populate_blocked_id_tr
  BEFORE INSERT OR UPDATE ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.populate_blocked_id();

DROP TRIGGER IF EXISTS story_blocks_populate_blocked_id_tr ON public.story_blocks;
CREATE TRIGGER story_blocks_populate_blocked_id_tr
  BEFORE INSERT OR UPDATE ON public.story_blocks
  FOR EACH ROW EXECUTE FUNCTION public.populate_blocked_id();
