-- 352_nutrition_recipes_hide_author_email.sql
--
-- Publishing a recipe exposed the author's email address to every other user.
--
-- Migration 227 added a SELECT policy letting any authenticated user read a
-- PUBLISHED recipe, and its own comment states the intent:
--
--     author_username — display name snapshot at publish time, so Discover
--     never has to expose user_email (privacy) or join.
--
-- The snapshot column was added. Nothing ever stopped the email coming back
-- with it. RLS is ROW-level, so a policy that grants the row grants every
-- column of it, and the client read `select('*')`.
--
-- Proven against production before writing this, as a genuinely different
-- authenticated user (probe identity asserted, RLS confirmed enabled, rolled
-- back): a published recipe owned by user A returned A's real email address to
-- user B. Anonymous guest accounts are `authenticated` too, so there was no
-- barrier to harvesting the email of everyone who shares a recipe.
--
-- Nothing has leaked yet — `is_public` is TRUE on 0 of 1 rows and always has
-- been. This lands before the feature is used, not after.
--
-- The fix is column privileges, because that is the only layer that actually
-- stops it. Scoping the client's SELECT list is necessary (it ships alongside
-- this) but it is not a boundary: anyone holding the anon key can ask
-- PostgREST for `select=user_email&is_public=eq.true` directly.
--
-- ORDER MATTERS, and it is the reason for the shape below. Postgres treats a
-- table-level grant as covering every column, and a column-level REVOKE
-- against a table-level grant is a no-op that only emits a warning. So the
-- table-level SELECT has to be revoked first, then re-granted column by
-- column. INSERT / UPDATE / DELETE are untouched: writing `user_email` still
-- works, only reading it back does not.
--
-- Deploy note: run this AFTER the matching client build is live. The client
-- previously selected `*`; against these grants that would 42501 on every
-- recipe read.

REVOKE SELECT ON public.nutrition_recipes FROM authenticated;

GRANT SELECT (
  id,
  user_id,
  name,
  servings,
  ingredients,
  totals,
  created_at,
  updated_at,
  directions,
  micros,
  is_public,
  author_username,
  published_at,
  image_url
) ON public.nutrition_recipes TO authenticated;

-- service_role keeps the whole table — the delete-account sweep and any future
-- server-side job still need the email column. (It was never in scope of the
-- REVOKE above, which names `authenticated`; this is belt and braces.)
GRANT SELECT ON public.nutrition_recipes TO service_role;

-- `anon` holds SELECT here from Supabase's default privileges — mig 123 never
-- granted it. It is not a live hole: both policies are TO authenticated, so
-- anon matches none and RLS returns 0 rows (measured, with a published row
-- seeded and rolled back). But a grant held back only by the scoping of every
-- CURRENT policy is a trap for the next person who adds one — the hub feed
-- shipped exactly that shape and needed mig 303 to fix it. anon has no reason
-- to read this table at all.
REVOKE SELECT ON public.nutrition_recipes FROM anon;

-- ── Planned meals must survive the recipe they were planned from ────────
--
-- meal_plans stores recipe_id with no FK, deliberately (mig 123), so deleting
-- a recipe cannot delete someone's plan. But the row carried nothing else, so
-- the surviving plan rendered as a bare "—": the plan outlived the recipe and
-- kept none of it. The client now writes a food_snapshot alongside the id.
--
-- This backfills the rows planned before that change. Per-serving figures,
-- matching what the client writes, and only where the recipe still exists and
-- no snapshot is already stored.
-- The CTE renames every column it carries, so the UPDATE below references
-- bare identifiers only — no `alias.column` tokens, which is the form the
-- clipboard pipeline mangles into a 42601 (see CLAUDE.md, Workflow §7).
WITH src AS (
  SELECT id       AS rid,
         name     AS rname,
         totals   AS rtotals,
         servings AS rservings
    FROM public.nutrition_recipes
)
UPDATE public.meal_plans
   SET food_snapshot = jsonb_build_object(
         'name',      rname,
         'calories',  round(COALESCE((rtotals->>'calories')::numeric,  0) / GREATEST(rservings, 1)),
         'protein_g', round(COALESCE((rtotals->>'protein_g')::numeric, 0) / GREATEST(rservings, 1), 1),
         'carbs_g',   round(COALESCE((rtotals->>'carbs_g')::numeric,   0) / GREATEST(rservings, 1), 1),
         'fat_g',     round(COALESCE((rtotals->>'fat_g')::numeric,     0) / GREATEST(rservings, 1), 1),
         'fiber_g',   round(COALESCE((rtotals->>'fiber_g')::numeric,   0) / GREATEST(rservings, 1), 1)
       )
  FROM src
 WHERE recipe_id = rid
   AND food_snapshot IS NULL;

NOTIFY pgrst, 'reload schema';
