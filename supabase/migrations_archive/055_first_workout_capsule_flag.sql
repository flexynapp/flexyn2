-- 055_first_workout_capsule_flag.sql
--
-- Adds the idempotency flag for the day-1 loot drop introduced
-- alongside the welcome-capsule discoverability work.
--
-- When a user logs their first workout EVER, the client grants a
-- premium capsule + 75 Flex Coins (see src/lib/data/capsules.js
-- `grantForFirstWorkout`). Without a server-side flag, a user could
-- in theory retrigger the grant by clearing localStorage / replaying
-- the mutation — this column is the canonical "have we already given
-- you this gift" record.
--
-- The client tolerates the column being missing (it relies on db.js's
-- PGRST204 strip-and-retry, so legacy hosts where this migration
-- hasn't applied still get the grant — they just can't enforce the
-- one-time idempotency). Applying this migration closes that loophole.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS first_workout_capsule_granted BOOLEAN NOT NULL DEFAULT FALSE;

-- No new RLS / policies needed — user_profiles row policies already
-- gate read/write to the owning user. The column inherits those.

COMMENT ON COLUMN public.user_profiles.first_workout_capsule_granted IS
  'TRUE once the user has been granted the first-workout premium capsule reward. Idempotency flag for src/lib/data/capsules.js grantForFirstWorkout.';
