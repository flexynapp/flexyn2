-- ── 329 · backfill workout_logs.total_volume ────────────────────────
--
-- The column had never been written by anything, on any row, ever. The
-- Weekly Reviews session found it and fixed the WRITE path (Workout.jsx
-- now persists calculateTotalVolume(exercises) on save, commit ae98c477);
-- this is the other half — the rows already in the table, which stay at
-- zero forever otherwise.
--
-- Every reader of that column was reading a hard zero:
--
--   • get_gym_community_progress sums it, so the "lbs moved" tile on the
--     My Gym hero has always shown 0 for every gym.
--   • dayContext.js already carries a comment noting the column is 0 on
--     the rows that exist, and suppresses the chip.
--   • the weekly review printed "0 lbs" beside a real session.
--
-- THE FORMULA IS COPIED FROM THE CLIENT ON PURPOSE. calculateTotalVolume
-- in src/lib/xpSystem.js is sum(weight x reps) over every set of every
-- exercise, with no filtering on the exercise's `completed` flag and no
-- per-set completion (sets carry only reps and weight). A backfill that
-- computed volume its own way would leave historical rows disagreeing
-- with every row written after it, which is worse than leaving them at
-- zero — the numbers would look plausible and be inconsistent.
--
-- Verified against production before writing: all set values are JSON
-- numbers, and this derivation returns 4995 for the one row that has
-- real volume — the same figure the client-side function produces for
-- it. Of three logs, one derives to 4995 and two are genuinely zero (one
-- has no exercises, one has no weighted sets).
--
-- The type guard is not defensive padding. `(s->>'weight')::numeric`
-- throws on any non-numeric string, which would abort the whole backfill
-- partway; jsonb_typeof lets a malformed set contribute zero instead of
-- taking the statement down. Nothing in production needs it today.
--
-- Idempotent: only touches rows where the stored value differs from the
-- derived one, so a re-run is a no-op. A session with genuinely zero
-- volume — cardio, bodyweight — derives zero and is left alone.

UPDATE public.workout_logs
   SET total_volume = (
     SELECT COALESCE(sum(
       CASE WHEN jsonb_typeof(st->'weight') = 'number'
             AND jsonb_typeof(st->'reps')   = 'number'
            THEN (st->>'weight')::numeric * (st->>'reps')::numeric
            ELSE 0
       END), 0)
       FROM jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) ex,
            jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) st
   )
 WHERE COALESCE(total_volume, 0) IS DISTINCT FROM (
     SELECT COALESCE(sum(
       CASE WHEN jsonb_typeof(st->'weight') = 'number'
             AND jsonb_typeof(st->'reps')   = 'number'
            THEN (st->>'weight')::numeric * (st->>'reps')::numeric
            ELSE 0
       END), 0)
       FROM jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) ex,
            jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) st
   );
