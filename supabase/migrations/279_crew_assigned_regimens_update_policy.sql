-- 279_crew_assigned_regimens_update_policy.sql
--
-- `assignRegimenToCrew` (src/lib/data/crews.js) upserts on
-- (crew_id, regimen_id) with `assigned_by` and `note` as payload. That is a
-- genuine merge — re-assigning a regimen with an updated note is supposed to
-- change the note — so supabase-js's default `resolution=merge-duplicates`
-- is the right request, and PostgREST turns it into
-- `INSERT ... ON CONFLICT DO UPDATE`.
--
-- But the table had SELECT / INSERT / DELETE policies and no UPDATE policy,
-- so the moment a crew already had that regimen assigned the statement
-- failed with `42501 new row violates row-level security policy`. The
-- function throws, so re-assigning surfaced as an error to a crew admin.
--
-- This is NOT the same fix as the four sibling upserts (story_views,
-- story_likes, user_mutes, marketplace_wishlist). Those upsert only their
-- own conflict target — there is nothing to merge — so they were corrected
-- on the client with `ignoreDuplicates: true` (ON CONFLICT DO NOTHING),
-- which needs no UPDATE permission at all. Here the non-key columns carry
-- real intent, and `ignoreDuplicates` would additionally break the caller's
-- `.select().single()`, which would find no row on a conflict.
--
-- The policy deliberately MIRRORS the existing INSERT and DELETE policies —
-- `is_crew_admin(crew_id)` — so it grants no authority that a crew admin
-- does not already have. An admin who may assign a regimen and may remove
-- one may also change the note on one.
--
-- DROP first: Postgres has no CREATE POLICY IF NOT EXISTS, so a re-run of a
-- partially-applied migration fails with 42710 otherwise.

DROP POLICY IF EXISTS "Crew admins can update assigned regimens" ON public.crew_assigned_regimens;

CREATE POLICY "Crew admins can update assigned regimens"
  ON public.crew_assigned_regimens
  FOR UPDATE
  USING (is_crew_admin(crew_id))
  WITH CHECK (is_crew_admin(crew_id));
