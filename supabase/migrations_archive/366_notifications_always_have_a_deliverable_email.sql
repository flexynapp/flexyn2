-- 366_notifications_always_have_a_deliverable_email.sql
--
-- Ten notification RPCs raise 23502 whenever their target is an anonymous
-- guest, and the exception rolls back whatever the caller was doing.
--
-- THE SHAPE, FOUND IN ALL TEN
--
--   SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
--   INSERT INTO public.notifications (user_id, user_email, ...) VALUES (..., v_email, ...);
--
-- `auth.users.email` is NULL for every signInAnonymously() account and
-- `notifications.user_email` is NOT NULL. Measured 2026-08-16:
--
--   auth.users.email      29 of 56 populated  (0 of 27 guests)
--   user_profiles.email   56 of 56 populated  (27 of 27 guests)
--
-- So the wrong table was being asked. `user_profiles` has an email for
-- everybody; `auth.users` does not.
--
-- The affected functions, all confirmed by reading the installed bodies
-- rather than the migrations that created them:
--
--   create_notification_for            notify_league_resolution_for
--   notify_friend_follow_for           notify_league_resolution_internal
--   notify_friend_post_for             notify_gym_rival_assigned_for
--   _notify_duel_result_inner          notify_gym_rival_overthrown_for
--   gym_rival_decline                  gym_rival_settle_week  (x2 inserts)
--
-- (gym_rival_roll was the eleventh and was fixed directly in 365, which is
-- how this class was found at all.)
--
-- WHY THIS IS URGENT RATHER THAN THEORETICAL
--
-- 21 of the rows in `league_members` belong to emailless guests, and
-- `resolve_league_bracket_internal` calls `notify_league_resolution_internal`
-- from inside its per-member loop, under the `roll_weekly_leagues` cron. One
-- guest with a promote/demote/hold outcome therefore aborts the entire weekly
-- league rollover — for every user, not just that bracket.
--
-- It has not fired yet only because `qualified` has been 0 in every league so
-- far, so the notify branch has never been reached. CLAUDE.md records that a
-- member of the current week already has two active days, i.e. the first
-- qualification in the app's history is imminent. This is a fuse, not a
-- hypothetical.
--
-- THE FIX: ONE TRIGGER, NOT TEN REWRITES
--
-- Following migration 264's precedent — it applied a ledger ceiling as a
-- TRIGGER rather than restating 22 SECURITY DEFINER functions — this fills
-- `user_email` from `user_profiles` whenever an insert leaves it NULL. That
-- immunises all ten functions above and, more importantly, every notify RPC
-- written from here on: the next person to copy the `FROM auth.users` pattern
-- gets a working notification instead of a production incident.
--
-- `user_email` is denormalised for delivery, not identity (see CLAUDE.md), and
-- the push fan-out does not read it — verified: notify_push_fanout_batch's
-- body does not mention the column. So filling it from the profile is exactly
-- the value the column is meant to carry.
--
-- Deliberately NOT done here: rewriting the ten functions to read
-- user_profiles. That is the tidier change and it is also ten chances to
-- introduce a typo in SECURITY DEFINER code that already works; the trigger is
-- one object, covers the same ground, and cannot be bypassed by a future
-- caller. Fix the individual bodies opportunistically when each is next
-- touched for another reason.

CREATE OR REPLACE FUNCTION public.notifications_fill_user_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only ever fills a hole. A caller that supplies an address keeps it.
  IF NEW.user_email IS NULL THEN
    SELECT email INTO NEW.user_email
      FROM public.user_profiles
     WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_fill_user_email ON public.notifications;

CREATE TRIGGER trg_notifications_fill_user_email
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_fill_user_email();
