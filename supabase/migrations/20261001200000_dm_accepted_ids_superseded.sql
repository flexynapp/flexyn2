-- Intentionally empty. Keep this file.
--
-- The DM accepted_ids migration was first pushed under this version and ran
-- on PR #309's preview database, which recorded it. It was then renumbered to
-- 20261002030000_dm_accepted_ids.sql, because production had already applied
-- a newer migration and silently skips anything older than its newest one.
-- A preview whose recorded versions are missing from this folder refuses to
-- migrate ("Remote migration versions not found in local migrations
-- directory"), so this placeholder keeps the version present. Production
-- skips it as too old, and a fresh database runs it as a no-op.

SELECT 1;
