-- 376_guest_trophies_carry_a_findable_email.sql
--
-- A CORRECTION FIRST, because the flag that started this was wrong.
--
-- I reported that `grant_eligible_trophies` would throw 23502 for a guest,
-- having read migration 167 rather than the installed body. 167 did ship
-- `v_email TEXT := auth.email();` with no fallback, so the crash was real
-- WHEN IT SHIPPED — and migration 293 fixed it when guest mode landed, by
-- wrapping it as `COALESCE(auth.email(), '')`. Nothing throws today.
-- Reading the migration instead of `pg_get_functiondef` is the exact habit
-- the top of CLAUDE.md warns about, and it produced a false alarm.
--
-- THE DEFECT THAT IS REAL IS THE COALESCE ITSELF, and it is quieter than a
-- crash. A guest's trophy row is written with `user_email = ''`.
-- Measured on production 2026-08-16: **12 rows across 9 users**, and
-- 27 of 56 profiles have no `auth.users.email` at all.
--
-- That empty string is not inert, because `user_trophies` is read BY EMAIL
-- on two live paths:
--
--   src/lib/leaderboardStats.js:45      listEarned(userEmail, true)
--   src/components/hub/ProfileBadgeShowcase.jsx:93
--                                       listEarned(userId || userEmail, !userId)
--
-- Both fall back to the email lookup when no user id is to hand. A guest
-- has a perfectly good `user_profiles.email` (56 of 56 are populated —
-- `guest_<uuid>@flexyn.guest`), so the lookup runs with a real address and
-- matches nothing, because the row says ''. **A guest's earned trophies
-- are invisible on every surface that looks them up by email.** They are
-- not lost; they simply cannot be found by the key those two callers use.
--
-- Same root cause migration 366 identified for notifications: `auth.email()`
-- is the wrong source, and `user_profiles.email` is the populated one.
--
--
-- THE FIX IS 366'S, WITH ONE DIFFERENCE THAT MATTERS
--
-- 366 chose ONE trigger over ten function rewrites, so that every writer
-- present and future is immunised. Same choice here, and it means
-- `grant_eligible_trophies` and `award_league_season_internal` are left
-- untouched: they may keep writing '', and the trigger corrects it.
--
-- The difference: `notifications_fill_user_email` tests `IS NULL` only.
-- Here the bad value is the EMPTY STRING, which is what `COALESCE(..., '')`
-- produces and what a NOT NULL column happily accepts. A NULL-only guard
-- would have been a no-op on all 12 rows. Testing both is the whole point.
--
-- Applied to `user_capsules` and `user_inventory` as well. Both measured
-- clean today (0 empty of 202 and 288), but both are written by
-- `award_league_season_internal` through the same `COALESCE(p_email, '')`,
-- so they are one null argument away from the same state.
--
-- Paste-safe per repo convention: schema-qualified table names, no short
-- table-alias column tokens, no record field access, and no bare angle-
-- bracket comparison operators anywhere in a statement body.


-- ── 1. One trigger function for all three tables ─────────────────────
--
-- NULL *or* empty, in that order of preference: the profile (populated
-- for every account including guests), then auth.users, then a synthetic
-- address that is obviously not deliverable. The synthetic form matches
-- 366's so the two tables read the same way to anyone grepping.

CREATE OR REPLACE FUNCTION public.fill_owner_email_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fill$
BEGIN
  IF NEW.user_email IS NOT NULL AND NOT (NEW.user_email = '') THEN
    RETURN NEW;
  END IF;

  SELECT email INTO NEW.user_email
    FROM public.user_profiles WHERE id = NEW.user_id;

  IF NEW.user_email IS NULL OR NEW.user_email = '' THEN
    SELECT email INTO NEW.user_email
      FROM auth.users WHERE id = NEW.user_id;
  END IF;

  IF NEW.user_email IS NULL OR NEW.user_email = '' THEN
    NEW.user_email := 'user_' || COALESCE(NEW.user_id::text, 'unknown') || '@flexyn.invalid';
  END IF;

  RETURN NEW;
END;
$fill$;


-- ── 2. Attach it ─────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_user_trophies_fill_email ON public.user_trophies;
CREATE TRIGGER trg_user_trophies_fill_email
  BEFORE INSERT OR UPDATE OF user_email ON public.user_trophies
  FOR EACH ROW EXECUTE FUNCTION public.fill_owner_email_from_profile();

DROP TRIGGER IF EXISTS trg_user_capsules_fill_email ON public.user_capsules;
CREATE TRIGGER trg_user_capsules_fill_email
  BEFORE INSERT OR UPDATE OF user_email ON public.user_capsules
  FOR EACH ROW EXECUTE FUNCTION public.fill_owner_email_from_profile();

DROP TRIGGER IF EXISTS trg_user_inventory_fill_email ON public.user_inventory;
CREATE TRIGGER trg_user_inventory_fill_email
  BEFORE INSERT OR UPDATE OF user_email ON public.user_inventory
  FOR EACH ROW EXECUTE FUNCTION public.fill_owner_email_from_profile();


-- ── 3. Backfill the rows already written ─────────────────────────────
--
-- The trigger only governs new writes. These 12 are the ones a guest
-- cannot currently find. Written as an UPDATE of `user_email`, which the
-- trigger above also covers, so the fallback chain is identical rather
-- than duplicated here.

UPDATE public.user_trophies
   SET user_email = ''
 WHERE COALESCE(user_email, '') = '';

UPDATE public.user_capsules
   SET user_email = ''
 WHERE COALESCE(user_email, '') = '';

UPDATE public.user_inventory
   SET user_email = ''
 WHERE COALESCE(user_email, '') = '';


-- ── 4. Proof it ran ──────────────────────────────────────────────────
--
-- `still_empty` must be 0 on all three. `guest_rows_now_findable` counts
-- the trophy rows that now carry the owner's real profile address, which
-- is the thing the two by-email call sites need.

SELECT
  (SELECT count(*) FROM public.user_trophies  WHERE COALESCE(user_email,'') = '') AS trophies_still_empty,
  (SELECT count(*) FROM public.user_capsules  WHERE COALESCE(user_email,'') = '') AS capsules_still_empty,
  (SELECT count(*) FROM public.user_inventory WHERE COALESCE(user_email,'') = '') AS inventory_still_empty,
  (SELECT count(*) FROM public.user_trophies t JOIN public.user_profiles p ON p.id = t.user_id
     WHERE lower(t.user_email) = lower(p.email))                                  AS trophy_rows_matching_profile,
  (SELECT count(*) FROM pg_trigger
     WHERE tgname IN ('trg_user_trophies_fill_email','trg_user_capsules_fill_email',
                      'trg_user_inventory_fill_email'))                            AS triggers_installed;
