-- Pin search_path on the five public functions that still resolve names
-- through the caller's path (2026-09-27 codebase audit, item 10; the
-- Supabase security advisor lists them as function_search_path_mutable).
--
-- None is SECURITY DEFINER, so this is hygiene rather than a live hole: a
-- caller who could create objects in a schema ahead of public could shadow
-- a table or function these read. ALTER rather than CREATE OR REPLACE, so
-- the bodies are untouched. Anyone redefining one later must keep the SET.
DO $$
DECLARE r record;
BEGIN
  -- By name rather than signature, so a Rival PR that changes an argument
  -- list cannot make this file fail.
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('block_escrowed_inventory_delete', 'crew_match_gap',
                         'gym_rival_assigned_text', 'gym_rival_match_gap',
                         'gym_rival_overthrown_text')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path TO %L', r.fn, 'public');
  END LOOP;
END;
$$;

DO $$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('block_escrowed_inventory_delete', 'crew_match_gap',
                       'gym_rival_assigned_text', 'gym_rival_match_gap',
                       'gym_rival_overthrown_text')
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
                      WHERE c LIKE 'search_path=%');
  IF v_left > 0 THEN
    RAISE EXCEPTION '% function(s) still have a mutable search_path', v_left;
  END IF;
END;
$$;
