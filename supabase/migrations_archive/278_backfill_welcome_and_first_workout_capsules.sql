-- 278_backfill_welcome_and_first_workout_capsules.sql
--
-- One-time backfill for the two grants migration 277 repaired.
--
-- Both grants had been failing with 42501 since the economy lockdown removed
-- the client INSERT policy on user_capsules, and both call sites swallow the
-- error, so the reward silently never arrived.
--
-- The welcome capsule will NOT self-heal now that 277 is in place. It is
-- fired by LevelUpManager only on the "first time on this device" branch,
-- which is gated on a localStorage key that gets written BEFORE the grant
-- runs — and unconditionally. So every affected user has already burned
-- their one-shot: the branch never runs again on that device, and they would
-- never receive it. Hence this file.
--
-- Rules, deliberately the same ones the RPCs apply, so the backfill can't
-- grant anything the live code wouldn't have:
--
--   welcome        → one standard capsule for any user with ZERO capsules.
--                    There is no `source` column on user_capsules, so a user
--                    who has since earned capsules from another path can't
--                    be distinguished from one who got their welcome. This
--                    rule therefore under-grants rather than over-grants,
--                    which is the right direction for minting currency.
--
--   first workout  → one premium capsule + 75 coins for any user who has a
--                    workout logged but whose first_workout_capsule_granted
--                    flag is still false.
--
-- Both statements are idempotent: re-running matches nobody, because the
-- predicate is the state the first run produced. Verified by running each
-- twice inside a rolled-back transaction.
--
-- On the database this was written against: 15 users owed a welcome capsule,
-- 0 owed a first-workout capsule. The first-workout half is a no-op here and
-- exists for any environment where users logged a first workout AFTER the
-- lockdown landed. (The only two users with workout logs here both have the
-- flag already set — their grant landed back when the client insert still
-- worked, which also dates the breakage.)

-- ─── Welcome capsule ─────────────────────────────────────────────────────────
INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
SELECT id,
       CASE WHEN email IS NULL OR email = ''
            THEN 'guest_' || id || '@flexyn.guest'
            ELSE email END,
       'standard'
FROM public.user_profiles
WHERE id NOT IN (SELECT user_id FROM public.user_capsules WHERE user_id IS NOT NULL);

-- ─── First-workout capsule ───────────────────────────────────────────────────
-- Capsule first, then coins + flag. The flag is what makes the second run a
-- no-op, so it must move only after the capsule row exists.
INSERT INTO public.user_capsules (user_id, user_email, capsule_type)
SELECT id,
       CASE WHEN email IS NULL OR email = ''
            THEN 'guest_' || id || '@flexyn.guest'
            ELSE email END,
       'premium'
FROM public.user_profiles
WHERE COALESCE(first_workout_capsule_granted, FALSE) = FALSE
  AND id IN (SELECT user_id FROM public.workout_logs WHERE user_id IS NOT NULL);

UPDATE public.user_profiles
   SET flex_coins = COALESCE(flex_coins, 0) + 75,
       first_workout_capsule_granted = TRUE
 WHERE COALESCE(first_workout_capsule_granted, FALSE) = FALSE
   AND id IN (SELECT user_id FROM public.workout_logs WHERE user_id IS NOT NULL);
