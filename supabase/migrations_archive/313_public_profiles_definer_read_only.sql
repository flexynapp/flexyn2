-- 313_public_profiles_definer_read_only.sql
--
-- Cross-user profile reads have returned NOTHING since migration 183, for
-- every user, and it has been invisible.
--
-- 182 created public_profiles as THE cross-user read surface — the same
-- columns as user_profiles minus email. 183 then dropped the open
-- `USING (true)` SELECT policy on the base table, on the stated assumption
-- that the view would be the way through. Its header says so, and even
-- names the symptom if the assumption failed: "would make cross-user reads
-- (feeds, leaderboards, search) return empty."
--
-- The view was created with security_invoker=true, so it enforces the
-- CALLER's RLS on user_profiles — and the only SELECT policy left there is
-- "Users can read their own profile". The bypass bypassed nothing.
--
-- Measured before writing this, as a real authenticated user:
--     SET LOCAL request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
--     SELECT count(*) FROM public.public_profiles;   -- 1, of 38 profiles
--
-- Why nobody noticed: hub posts carry an author_name snapshot and
-- resolveAuthor() prefers the live record but falls back to it, so feeds
-- render correctly from stale data. Leaderboards go through SECURITY
-- DEFINER RPCs and were never affected. What has actually been broken is
-- user search, @mention autocomplete, and other people's equipped titles
-- and frames — all failing to a generic handle rather than to an error.

ALTER VIEW public.public_profiles SET (security_invoker = false);

-- Owner-rights AND writable is a hole, so close the write half in the same
-- change. The view is auto-updatable (single table, no aggregates) and
-- `authenticated` held INSERT/UPDATE/DELETE/TRUNCATE on it. Once the view
-- runs as its owner, a write through it walks past "Users can update their
-- own profile" — which would let any signed-in user rewrite another
-- account's username, bio, avatar, city or privacy flags.
--
-- The privileged columns are safe either way: xp, level, coins and lifetime
-- totals are guarded by TRIGGERS on user_profiles
-- (user_profiles_block_privileged_updates_tr, _guard_lifetime_xp_tr,
-- zzz_flex_coin_ledger_tr), and a trigger fires whoever the caller is. It
-- is the ROW-OWNERSHIP check that is a policy, and policies are exactly
-- what a definer view steps around.
--
-- Nothing in the client writes through this view — every profile write goes
-- to user_profiles via db.updateMe() or an RPC. Verified by grep before
-- revoking.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_profiles FROM authenticated;

-- anon holds nothing on this view today and must keep holding nothing:
-- with owner rights the view would otherwise hand every profile to a
-- signed-out caller. Belt and braces against a future blanket GRANT.
REVOKE ALL ON public.public_profiles FROM anon;

NOTIFY pgrst, 'reload schema';
