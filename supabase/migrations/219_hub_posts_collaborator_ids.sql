-- 219_hub_posts_collaborator_ids.sql
--
-- The composer's co-author picker stored selected collaborators as
-- hub_posts.collaborator_emails (mig 111), which forced HubComposer to
-- read other users' emails off users.list() / the public_profiles view to
-- resolve the picked user. This adds a collaborator_ids uuid[] twin so the
-- composer can pick + store by user_id and never touch the view email.
--
-- A BEFORE INSERT/UPDATE trigger keeps the two arrays in sync in BOTH
-- directions (fills whichever is empty from the other), so:
--   * new id-only writes from the updated composer keep collaborator_emails
--     populated — HubPostCard still renders its co-author count off that
--     column with NO client change,
--   * any legacy email-only write still gets collaborator_ids filled.
-- Order within the arrays isn't significant (the UI only shows a count and
-- resolves membership), so array_agg without an explicit ORDER BY is fine.
--
-- Existing rows are backfilled by touching every post that has emails but
-- no ids. Paste-safe: NEW. refs + bare single-table columns only.

ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.sync_post_collaborator_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids    uuid[];
  v_emails text[];
BEGIN
  -- emails → ids
  IF (NEW.collaborator_ids IS NULL OR array_length(NEW.collaborator_ids, 1) IS NULL)
     AND NEW.collaborator_emails IS NOT NULL
     AND array_length(NEW.collaborator_emails, 1) IS NOT NULL THEN
    SELECT array_agg(id) INTO v_ids
      FROM public.user_profiles
     WHERE lower(email) = ANY (SELECT lower(e) FROM unnest(NEW.collaborator_emails) AS e);
    NEW.collaborator_ids := COALESCE(v_ids, '{}');
  END IF;

  -- ids → emails
  IF (NEW.collaborator_emails IS NULL OR array_length(NEW.collaborator_emails, 1) IS NULL)
     AND NEW.collaborator_ids IS NOT NULL
     AND array_length(NEW.collaborator_ids, 1) IS NOT NULL THEN
    SELECT array_agg(email) INTO v_emails
      FROM public.user_profiles
     WHERE id = ANY (NEW.collaborator_ids);
    NEW.collaborator_emails := COALESCE(v_emails, '{}');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_post_collaborator_ids_tr ON public.hub_posts;
CREATE TRIGGER sync_post_collaborator_ids_tr
  BEFORE INSERT OR UPDATE ON public.hub_posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_collaborator_ids();

-- Backfill existing rows (touch each post that has emails but no ids).
UPDATE public.hub_posts
SET collaborator_emails = collaborator_emails
WHERE collaborator_emails IS NOT NULL
  AND array_length(collaborator_emails, 1) IS NOT NULL
  AND (collaborator_ids IS NULL OR array_length(collaborator_ids, 1) IS NULL);
