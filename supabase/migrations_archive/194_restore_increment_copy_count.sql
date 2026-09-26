-- 194_restore_increment_copy_count.sql
--
-- Dead-feature fix from the pre-launch audit (2026-07-12). The client
-- (src/lib/data/regimens.js, src/lib/data/templates.js) calls
-- increment_copy_count(p_table, p_id) whenever someone copies a shared
-- regimen or workout template — the call is `.catch(() => {})`, so when
-- the function is absent it silently no-ops. And it IS absent in prod:
-- a name-vs-pg_proc diff of every client rpc() call turned this up as one
-- of only two missing functions (the other, coalesce_increment, is
-- test-only). Migrations 006 and 042 both define it, but it never landed
-- in prod (042's increment_user_xp DID, so 042 partially applied) — the
-- result is that regimens.copy_count / workout_templates.copy_count never
-- increment, so the "N copies" adoption badge in the Regimen Store and
-- Templates modal is frozen at 0 for every item, forever, and the
-- store's popularity sort is meaningless.
--
-- Re-emitted verbatim from the mig 042 body (auth-gated, table-guarded).
-- Both target columns confirmed present in prod. Paste-safe: bare
-- columns, single-table UPDATEs, no alias.column tokens.

CREATE OR REPLACE FUNCTION public.increment_copy_count(
  p_table TEXT,
  p_id    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_table = 'regimens' THEN
    UPDATE public.regimens
       SET copy_count = COALESCE(copy_count, 0) + 1
     WHERE id = p_id;
  ELSIF p_table = 'workout_templates' THEN
    UPDATE public.workout_templates
       SET copy_count = COALESCE(copy_count, 0) + 1
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'unknown table' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.increment_copy_count(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_copy_count(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
