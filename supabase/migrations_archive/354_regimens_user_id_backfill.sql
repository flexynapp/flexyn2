-- 354_regimens_user_id_backfill.sql
--
-- Two regimens rows carry a NULL user_id. Give them one.
--
-- WHY THIS MATTERS, AND WHY IT IS SMALL
--
-- Every owner-scoped policy on the email-keyed tables is a pair:
--
--     created_by = current_user_email()  OR  auth.uid() = user_id
--
-- The email half is the base44 legacy (mig 001); the uid half is what
-- makes the row survive the owner's email changing. `current_user_email()`
-- reads auth.email() from the JWT FIRST and only falls back to
-- user_profiles.email when that is empty — so on a real account the live
-- provider address wins, and nothing anywhere rewrites `created_by` when
-- it moves. There is exactly one trigger on auth.users
-- (`on_auth_user_created`) and it is INSERT-only.
--
-- So a row with a NULL user_id is held by ONE key, and that key is the
-- one that can change out from under it. Measured 2026-08-12 across the
-- ten email-keyed tables: 274 of 276 rows carry user_id. These are the
-- other two.
--
--   095313f6-…  sjoudrie@gmail.com       2026-05-22
--   a079d87d-…  keganbergeron@gmail.com  2026-07-28
--
-- Both owners are real (non-anonymous) accounts, so neither row is
-- swept by the guest cron in mig 306. Both are genuinely stranded.
--
-- NOT A LIVE BUG — do not "fix" the write path.
--
-- `makeEntity().create` injects both keys (`src/api/db.js:158`), and the
-- surrounding rows prove it works: 2026-07-26 and 2026-08-02 both carry
-- user_id, and every row since 2026-07-28 does too. These two are
-- isolated historical misses, most likely from the strip-and-retry in
-- db.js dropping the column on a 42703 before it existed. A code change
-- here would be fixing something that already works.
--
-- The join is on user_profiles.email rather than auth.users.email
-- because a guest's auth email is NULL while the profile placeholder is
-- not — this statement is guest-safe even though today's two rows are
-- not guests. Rows whose created_by matches no profile at all are left
-- alone: a NULL is honest about an owner we cannot identify, where a
-- guessed uid would not be.

-- Written without a join alias on purpose. The natural form here is
--   UPDATE public.regimens r SET user_id = p.id FROM public.user_profiles p
-- and `r.user_id` / `p.id` are exactly the short alias.column and record
-- .id tokens the clipboard pipeline mangles into `42601 syntax error at
-- "<"`. Fully-qualified `public.regimens.created_by` survives the trip.

UPDATE public.regimens
   SET user_id = (
         SELECT id
           FROM public.user_profiles
          WHERE lower(email) = lower(public.regimens.created_by)
          LIMIT 1)
 WHERE user_id IS NULL
   AND EXISTS (
         SELECT 1
           FROM public.user_profiles
          WHERE lower(email) = lower(public.regimens.created_by));

-- Prove it ran. The SQL editor hides RAISE NOTICE, so the migration ends
-- in a SELECT: expect remaining_null = 0 and total unchanged at 33.
SELECT count(*)                        AS total_regimens,
       count(user_id)                  AS with_user_id,
       count(*) - count(user_id)       AS remaining_null
  FROM public.regimens;
