-- 281_admin_purge_user_data.sql
--
-- The server half of real account deletion. Pairs with the delete-account
-- Edge Function; neither is useful without the other.
--
-- ── Why the old approach could not work ───────────────────────────────────
--
-- `_invokeDeleteAccount` in src/api/db.js is a CLIENT-side cascade over a
-- hand-maintained array of table names. It cannot delete `auth.users` —
-- no client can — so the auth identity survived every "deletion" and a
-- magic link to the same address walked straight back into the account.
-- Its last step sets profile columns to NULL and stamps `account_reset_at`:
-- a reset wearing a deletion's UI. Apple 5.1.1(v) requires real deletion and
-- GDPR Art. 17 requires erasure, and this app stores weight, body photos,
-- injuries, mood, sleep and cycle logs.
--
-- The hand-maintained list had also drifted by 54 tables. That drift is not
-- carelessness, it is structural: the list has to be updated by hand on every
-- migration that adds a user-owned table, and nothing fails when it isn't.
--
-- ── What this does instead ────────────────────────────────────────────────
--
-- Almost all of the work is already declared in the schema and nobody was
-- using it. Measured against production:
--
--   104 FKs to auth.users are ON DELETE CASCADE  -> free, automatic
--    14 are ON DELETE SET NULL                   -> row survives, actor cleared
--     3 are ON DELETE NO ACTION                  -> BLOCK the delete
--     1 is  ON DELETE RESTRICT                   -> BLOCKS the delete
--
-- So `auth.admin.deleteUser()` does the bulk of the erasure by itself, and
-- correctly — including journal_entries, weekly_debriefs, status_notes,
-- meal_plans, roll_call_responses, user_trophies, story_highlights, routines,
-- step_logs, nutrition_recipes and custom_quotes, every one of which the old
-- hand list missed.
--
-- What it does NOT handle is the other 18 constraints plus the tables that
-- key a user by email and carry no FK at all. That is this function's job,
-- and it must run BEFORE the auth delete or the delete fails with 23503.
--
--   1. Blocking references, NULLed (not deleted — these are "who won" /
--      "who claimed" pointers, and the row belongs to someone else):
--        bounties.claimed_by_id, duels.winner_id,
--        pending_duel_invites.claimed_by_id  (all NO ACTION)
--        gym_businesses.owner_id             (RESTRICT)
--      Nulling gym_businesses.owner_id is the deliberately correct move,
--      not a compromise: deleting the gym would destroy a shared floor its
--      other members depend on, and an ownerless gym is already the
--      documented state for an unclaimed community gym (mig 137). It simply
--      returns to the verification queue for a real owner to claim.
--
--   2. Public regimens other people have copied, tombstoned rather than
--      destroyed. `regimens.user_id` is ON DELETE CASCADE, so the auth
--      delete would hard-delete every template this user published — and
--      `original_template_id` on the clones carries no FK, so each copier
--      would silently keep a dangling pointer. The old client purge had a
--      tombstone branch for exactly this; it has to move server-side or the
--      cascade simply outruns it. Detaching sets `user_id` to NULL, which is
--      what takes the row out of the cascade's path, and rewrites
--      `created_by` to an RFC 2606 `.invalid` sentinel that can never be a
--      real address. Same anonymise-don't-destroy reasoning as crews and
--      gym_businesses above: uncopied and private regimens are still deleted
--      outright, because nobody else depends on them.
--
--   3. PII that SET NULL would otherwise preserve. Fourteen constraints let
--      the row live on with a NULL actor, which is right for crews,
--      equipment submissions and gym records — those are shared artefacts.
--      It is wrong for free-text the user wrote about themselves, so
--      bug_reports and hub_reports rows are deleted outright rather than
--      anonymised. Both frequently contain identifying detail in the body.
--
--   4. Email-keyed rows with no FK to auth.users. These cascade from
--      nothing and are invisible to any uuid-based sweep. Discovered at
--      runtime from information_schema rather than listed, so a table added
--      by a future migration is covered the day it lands. This is the part
--      that stops the drift returning.
--
-- ── Paste safety ──────────────────────────────────────────────────────────
--
-- Every statement is single-table with bare column names, and the dynamic
-- SQL goes through format(%I) rather than string concatenation, so there are
-- no `alias.column` tokens for the clipboard pipeline to mangle.
--
-- ── Access ────────────────────────────────────────────────────────────────
--
-- service_role ONLY. A new function is EXECUTE-able by PUBLIC until revoked
-- and every public-schema function is a PostgREST endpoint, so without the
-- REVOKE below any caller — including anon — could POST to
-- /rest/v1/rpc/admin_purge_user_data with someone else's uuid and wipe their
-- account while running SECURITY DEFINER. That is the single most dangerous
-- function in this project; treat the REVOKE as part of its definition.
-- (Same lesson as fire_scheduled_workout_reminders in mig 276.)
--
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(
  p_user_id uuid,
  p_email   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tbl      text;
  v_col      text;
  v_deleted  bigint;
  v_swept    jsonb := '{}'::jsonb;
  v_errors   jsonb := '[]'::jsonb;
  v_email    text  := lower(trim(coalesce(p_email, '')));
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_purge_user_data requires a user id'
      USING ERRCODE = '22004';
  END IF;

  -- 1. Clear the four references that would otherwise block the auth delete.
  --    Each is a single-table UPDATE on a bare column.
  UPDATE public.bounties             SET claimed_by_id = NULL WHERE claimed_by_id = p_user_id;
  UPDATE public.duels                SET winner_id     = NULL WHERE winner_id     = p_user_id;
  UPDATE public.pending_duel_invites SET claimed_by_id = NULL WHERE claimed_by_id = p_user_id;
  UPDATE public.gym_businesses       SET owner_id      = NULL WHERE owner_id      = p_user_id;

  -- 2. Tombstone the published regimens other people have copied, BEFORE
  --    anything downstream can delete them. Order is load-bearing twice
  --    over: the auth delete would cascade them away, and step 4's email
  --    sweep matches `regimens.created_by`, so both would beat the tombstone
  --    if it ran later. Detaching user_id is what removes the row from the
  --    cascade; rewriting created_by is what removes it from the sweep.
  UPDATE public.regimens
     SET user_id     = NULL,
         created_by  = 'deleted-account@flexyn.invalid',
         is_public   = false,
         description = '',
         name        = '[Deleted account] ' || left(coalesce(name, 'Regimen'), 80)
   WHERE created_by = p_email
     AND is_public
     AND coalesce(copy_count, 0) > 0;

  -- 3. Free text the user wrote about themselves, which ON DELETE SET NULL
  --    would keep. Anonymising the author is not erasure when the body is
  --    the identifying part.
  DELETE FROM public.bug_reports WHERE reporter_user_id = p_user_id;
  DELETE FROM public.hub_reports WHERE reporter_user_id = p_user_id;

  -- 4. Email-keyed rows with no foreign key to auth.users. Discovered, not
  --    listed. Restricted to text-typed columns so a uuid column that
  --    happens to be named created_by is never compared against an address.
  IF v_email <> '' THEN
    FOR v_tbl, v_col IN
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('text', 'character varying')
         AND column_name IN (
               'user_email', 'created_by', 'author_email', 'seller_email',
               'host_email', 'viewer_email', 'blocker_email', 'blocked_email',
               'muter_email', 'muted_email', 'reporter_email',
               'follower_email', 'followee_email', 'sender_email',
               'recipient_email', 'claimed_by_email', 'owner_email'
             )
         -- Shared catalogs and grant/audit rows that are not the user's to
         -- take with them. admin_users is a role table; food_items is a
         -- shared food database other users read.
         AND table_name NOT IN ('admin_users', 'food_items')
       ORDER BY table_name, column_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE lower(%I) = $1', v_tbl, v_col)
          USING v_email;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        IF v_deleted > 0 THEN
          v_swept := v_swept || jsonb_build_object(v_tbl || '.' || v_col, v_deleted);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- One awkward table must not abort the purge — the caller deletes
        -- the auth user next, and a half-purge that still removes the
        -- identity is far better than an abort that removes nothing. The
        -- failure is reported rather than swallowed.
        v_errors := v_errors || jsonb_build_object(
          'target', v_tbl || '.' || v_col,
          'error',  SQLERRM,
          'code',   SQLSTATE
        );
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok',     jsonb_array_length(v_errors) = 0,
    'swept',  v_swept,
    'errors', v_errors
  );
END;
$function$;

-- Load-bearing. See the header note — without these three lines this is an
-- unauthenticated "delete any account" endpoint.
REVOKE EXECUTE ON FUNCTION public.admin_purge_user_data(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_purge_user_data(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_purge_user_data(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_purge_user_data(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
