-- 344_meal_plans_one_per_slot.sql
--
-- One meal plan per (user, date, meal slot).
--
-- WHY
-- ---
-- `meal_plans` had a PRIMARY KEY on `id` and a NON-unique index on
-- (user_id, plan_date), and nothing else. Its only writer,
-- `mealPlans.upsert()`, called
--
--     .upsert(row, { onConflict: 'id' })
--
-- with no `id` on any fresh save. Postgres generated a new id, nothing
-- conflicted, and the "upsert" INSERTed — so every save into an
-- already-filled slot appended another row instead of replacing it.
--
-- The grid keys its cells `${plan_date}-${meal_type}` and builds that map
-- with `m.set(key, p)` (last write wins), so only ONE row per slot was ever
-- reachable in the UI. The rest stayed invisible while still counting toward
-- the grocery-list CTA and still being walked by `buildGroceryList`.
--
-- Measured on production 2026-08-11, before the cleanup:
--     8 plan rows, 2 distinct slots, worst slot holding 6,
--     6 rows unreachable in the UI.
--
-- HISTORICAL DEDUPE — ALREADY APPLIED, DELIBERATELY NOT REPEATED HERE
-- -------------------------------------------------------------------
-- Collapsing those duplicates DELETED 6 production rows, so it was run by
-- hand on 2026-08-11 after review rather than shipped as a migration. It is
-- not restated in this file on purpose: a `DELETE` that runs on every fresh
-- database is a footgun, and there is nothing to collapse on one. The query
-- used, kept for the record:
--
--     WITH ranked AS (
--       SELECT id, row_number() OVER (
--                PARTITION BY user_id, plan_date, meal_type
--                ORDER BY created_at DESC, id DESC) AS rn
--       FROM public.meal_plans)
--     DELETE FROM public.meal_plans WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--
-- Keeping the NEWEST per slot matches what the grid had been showing all
-- along. It also cleared all 3 rows whose `food_snapshot->>'log_id'` pointed
-- at a deleted `nutrition_logs` row, incidentally rather than by design.
--
-- If you ever apply this migration to a database that DOES hold duplicates,
-- the index creation will fail with 23505 — run the query above first.
--
-- The client-side fix (`findSlot` resolving the slot's existing id before
-- upserting, commit 0d4b4290) is what stops NEW duplicates, and it works
-- whether or not this migration has run — the frontend auto-deploys from
-- main while SQL is applied by hand, so it must not depend on the ordering.
-- This index closes the race that the client alone cannot.

CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_user_date_slot_uniq
  ON public.meal_plans (user_id, plan_date, meal_type);

-- Proof it ran (RAISE NOTICE is invisible in the Supabase SQL editor):
SELECT count(*)                                             AS plan_rows,
       count(DISTINCT (user_id, plan_date, meal_type))       AS distinct_slots,
       (SELECT count(*) FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename  = 'meal_plans'
           AND indexname  = 'meal_plans_user_date_slot_uniq') AS uniq_index_present
FROM public.meal_plans;
