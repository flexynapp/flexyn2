-- 375_plausibility_reaches_gym_rival_and_solo.sql
--
-- Finishes the sweep migrations 360, 361, 362 and 367 started.
--
-- CLAUDE.md classified fifteen of the functions that read workout_logs and
-- named the rest as unclassified. Measured 2026-08-16 against production:
-- there are now THIRTY-ONE, not twenty-four — the Gym Rival work (363-365,
-- 373, 374) added several after that note was written — and sixteen carry
-- no plausibility filter. Five of those sixteen are the documented
-- deliberate ones (generate_weekly_review_for, dispatch_memory_reengagement,
-- get_crew_inactive_members, get_org_analytics, get_trophy_progress).
-- The other eleven had never been looked at. This migration classifies all
-- eleven and fixes the six that fall on the FILTER side of the line.
--
--
-- THE ONE THAT MATTERS: A FORGED WORKOUT WINS A GYM RIVAL WEEK AND IS PAID
-- FOR IT.
--
--   gym_rival_settle_week
--     -> gym_rival_net_rating
--          -> gym_rival_volume_lbs   <-- reads workout_logs, NO filter
--     -> picks v_winner from the higher net rating
--     -> award_xp_internal(v_winner), flex_coins += , loot capsules,
--        and the "You won your Rival week!" notification
--
-- That is competitive AND credited, which is the strongest possible case
-- on the filter side of CLAUDE.md's line, and it was completely open.
-- `gym_rival_volume_lbs` is the root of four readers, so one predicate
-- closes the settlement, the scoreboard (gym_rival_week_state), the
-- matchmaker (gym_rival_user_stats) and the rating itself.
--
--
-- THE SUBTLE ONE: mark_workout_volume_credited SPENDS A ROW IT NEVER
-- CREDITS.
--
-- 361 gave reconcile_my_workout_volume the same predicate on its SELECT
-- and its UPDATE precisely so a flagged row could not be stamped
-- `volume_credited_at` while contributing nothing. But
-- mark_workout_volume_credited is a SECOND, client-callable path to that
-- same stamp and carries no predicate at all. A flagged row stamped here
-- is spent silently: if the flag is later cleared, the volume can never
-- be credited, because the stamp says it already was. Same defect
-- CLAUDE.md names for reconcile, in the function next to it.
--
--
-- WHAT IS DELIBERATELY LEFT UNFILTERED, AND WHY
--
--   gym_rival_void_stale / gym_rival_void_stale_all
--     These ask "did either side log ANYTHING since accepting?" to void a
--     match at 48h. That is a PRESENCE question, not a volume one.
--     Filtering it means an honest heavy session that trips the model
--     stops counting as showing up and voids the user's match. Refusing to
--     count someone as present costs them the week; the flag exists to
--     accumulate a pattern, not to erase attendance.
--
--   sweep_stale_guest_accounts
--     Asks whether an account has ANY data before deleting it. Filtering
--     here could delete an account whose only workout happened to be
--     flagged. The blast radius is the whole account; not filtering costs
--     nothing.
--
--   get_crew_weekly_stats / _crew_member_week_stats
--     The crew's own weekly panel, shown to its own members. Pays nothing
--     and ranks only inside a group you already belong to — the same call
--     already made for get_crew_inactive_members. This is the closest of
--     the three calls, and it is recorded here so the next person inherits
--     the reasoning rather than the silence.
--
-- Paste-safe per repo convention: schema-qualified table names, no short
-- table-alias column tokens, no record field access, and no bare angle-
-- bracket comparison operators anywhere in a statement body.


-- ── 1. The Gym Rival scoring root ────────────────────────────────────
--
-- Body is the INSTALLED definition (373's bodyweight-aware version) with
-- one predicate added, not a reconstruction.

CREATE OR REPLACE FUNCTION public.gym_rival_volume_lbs(
  p_uid  uuid,
  p_from timestamp with time zone,
  p_to   timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE v_bw NUMERIC; v_vol NUMERIC := 0;
BEGIN
  SELECT weight_lbs INTO v_bw FROM public.user_profiles WHERE id = p_uid;
  IF v_bw IS NULL OR v_bw <= 0 THEN v_bw := 0; END IF;

  SELECT COALESCE(SUM(
           (COALESCE(v_bw * public.bodyweight_load_factor(ex->>'name'), 0)
            + COALESCE(NULLIF(s->>'weight','')::numeric, 0))
           * (s->>'reps')::numeric), 0)
    INTO v_vol
    FROM public.workout_logs,
         jsonb_array_elements(COALESCE(exercises, '[]'::jsonb)) AS ex,
         jsonb_array_elements(COALESCE(ex->'sets', '[]'::jsonb)) AS s
   WHERE user_id = p_uid
     AND created_at >= p_from
     AND (p_to IS NULL OR created_at < p_to)
     -- NOT COALESCE(implausible, FALSE), never implausible = FALSE: a row
     -- that predates the backfill is NULL and must read as fine.
     AND NOT COALESCE(implausible, FALSE)
     AND (s->>'reps') ~ '^[0-9]+$'
     AND (s->>'weight' IS NULL OR s->>'weight' = '' OR (s->>'weight') ~ '^[0-9]+(\.[0-9]+)?$');

  RETURN COALESCE(v_vol, 0);
END;
$function$;


-- ── 2. The matchmaker's own session count ────────────────────────────
--
-- gym_rival_user_stats takes its volume from the function above, so that
-- half is fixed already; its cadence count reads workout_logs directly.

-- The RETURNS TABLE signature below is the INSTALLED one, verbatim:
-- (weekly_output, cadence, strength, lifter_age, lifter_level), the
-- default on p_type, `age` read straight off user_profiles, and the
-- trailing RETURN QUERY. Writing this function from memory produced a
-- different column ORDER and a different set of names, which
-- CREATE OR REPLACE would have rejected or, worse, silently reshaped for
-- every caller. Read the installed body; never retype one.
CREATE OR REPLACE FUNCTION public.gym_rival_user_stats(p_uid uuid, p_type text DEFAULT 'gym'::text)
RETURNS TABLE(weekly_output numeric, cadence numeric, strength numeric, lifter_age numeric, lifter_level integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out NUMERIC := 0; v_cad NUMERIC := 0; v_str NUMERIC;
  v_age NUMERIC; v_lvl INTEGER; v_weight NUMERIC; v_best NUMERIC;
BEGIN
  SELECT weight_lbs, age, current_level INTO v_weight, v_age, v_lvl
    FROM public.user_profiles WHERE id = p_uid;

  IF p_type = 'cardio' THEN
    SELECT COALESCE(SUM(distance_meters), 0) / 4.0, COUNT(DISTINCT date)::numeric / 4.0
      INTO v_out, v_cad FROM public.cardio_logs
     WHERE user_id = p_uid AND date >= (now() - interval '28 days')::date;
  ELSE
    v_out := public.gym_rival_volume_lbs(p_uid, now() - interval '28 days', NULL) / 4.0;
    SELECT COUNT(DISTINCT created_at::date)::numeric / 4.0 INTO v_cad
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at >= now() - interval '28 days'
       AND NOT COALESCE(implausible, FALSE);
  END IF;

  IF v_weight IS NOT NULL AND v_weight > 0 THEN
    SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric) INTO v_best
      FROM public.workout_logs
     WHERE user_id = p_uid AND created_at > now() - interval '90 days'
       AND NOT COALESCE(implausible, FALSE);
    IF v_best IS NOT NULL THEN v_str := v_best / v_weight; END IF;
  END IF;

  RETURN QUERY SELECT COALESCE(v_out, 0), COALESCE(v_cad, 0), v_str, v_age, v_lvl;
END;
$function$;


-- ── 3. Solo challenges pay out, so they filter ───────────────────────

CREATE OR REPLACE FUNCTION public.update_solo_challenge_progress(
  p_volume_lbs   numeric DEFAULT 0,
  p_session_count integer DEFAULT 0,
  p_cardio_min   integer DEFAULT 0,
  p_prs_hit      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID := auth.uid();
  v_claim_id   UUID;
  v_chall_id   UUID;
  v_current    NUMERIC;
  v_claimed_at TIMESTAMPTZ;
  v_kind       TEXT;
  v_target     NUMERIC;
  v_derived    NUMERIC;
  v_sessions   INT;
  v_new        NUMERIC;
  v_bumped     INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  FOR v_claim_id, v_chall_id, v_current, v_claimed_at IN
    SELECT id, challenge_id, progress, claimed_at
      FROM public.solo_challenge_claims
     WHERE user_id = v_uid
       AND status  = 'active'
  LOOP
    SELECT kind, target_value
      INTO v_kind, v_target
      FROM public.solo_challenges
     WHERE id = v_chall_id
       AND is_active = TRUE
       AND expires_at > NOW();

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_kind = 'weekly_volume' THEN
      SELECT COALESCE(SUM(total_volume), 0)
        INTO v_derived
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at
         AND NOT COALESCE(implausible, FALSE);
    ELSIF v_kind = 'workout_count' THEN
      SELECT COUNT(*)::numeric
        INTO v_derived
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at
         AND NOT COALESCE(implausible, FALSE);
    ELSIF v_kind = 'cardio_minutes' THEN
      SELECT COALESCE(SUM(COALESCE(duration_min, duration_seconds / 60.0)), 0)
        INTO v_derived
        FROM public.cardio_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at;
    ELSIF v_kind = 'beat_any_pr' THEN
      -- v_sessions is the CLAMP on a client-supplied p_prs_hit, so it has
      -- to exclude flagged rows too: otherwise a forged session raises the
      -- ceiling on how many PRs the client may claim.
      SELECT COUNT(*)::int
        INTO v_sessions
        FROM public.workout_logs
       WHERE user_id = v_uid
         AND created_at >= v_claimed_at
         AND NOT COALESCE(implausible, FALSE);
      v_derived := LEAST(v_current + GREATEST(COALESCE(p_prs_hit, 0), 0), v_sessions);
    ELSE
      v_derived := v_current;
    END IF;

    v_new := LEAST(v_target, GREATEST(v_current, COALESCE(v_derived, 0)));
    IF v_new > v_current THEN
      UPDATE public.solo_challenge_claims
         SET progress = v_new
       WHERE id = v_claim_id;
      v_bumped := v_bumped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('claims_updated', v_bumped);
END;
$function$;


-- ── 4. A flagged row must not be stamped as credited ─────────────────
--
-- Silent no-op rather than a RAISE. The client calls this after
-- reconcile_my_workout_volume as bookkeeping, and reconcile has already
-- correctly declined to credit the row; failing the call would surface an
-- error for something the user cannot act on. Leaving the stamp NULL is
-- what keeps the row creditable if the flag is ever cleared.

CREATE OR REPLACE FUNCTION public.mark_workout_volume_credited(p_workout_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workout_logs
     SET volume_credited_at = COALESCE(volume_credited_at, now())
   WHERE id = p_workout_log_id
     AND user_id = auth.uid()
     AND NOT COALESCE(implausible, FALSE);
END;
$function$;


-- ── 5. Crew Wars matchmaking snapshots ───────────────────────────────
--
-- Lower stakes than the four above: these pay nothing, they decide who a
-- crew is matched against. But the whole point of 356's roster-similarity
-- design is that the pairing is honest, and a forged row makes a crew
-- look stronger and more active than it is. Filtering costs nothing here
-- because a crew that trains normally is unaffected.

CREATE OR REPLACE FUNCTION public.crew_match_cadence(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user  uuid;
  v_email text;
  v_sess  integer;
  v_sum   numeric := 0;
  v_n     integer := 0;
BEGIN
  FOR v_user IN
    SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40
  LOOP
    SELECT lower(email) INTO v_email
      FROM public.user_profiles WHERE id = v_user;

    SELECT COUNT(*) INTO v_sess
      FROM public.workout_logs
     WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
       AND created_at > now() - INTERVAL '28 days'
       AND NOT COALESCE(implausible, FALSE);

    v_sum := v_sum + COALESCE(v_sess, 0);
    v_n   := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN RETURN NULL; END IF;
  RETURN v_sum / v_n;
END;
$function$;


CREATE OR REPLACE FUNCTION public.crew_match_strength(p_crew_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_user   uuid;
  v_email  text;
  v_weight numeric;
  v_best   numeric;
  v_sum    numeric := 0;
  v_n      integer := 0;
BEGIN
  FOR v_user IN
    SELECT user_id FROM public.crew_members WHERE crew_id = p_crew_id LIMIT 40
  LOOP
    SELECT lower(email), weight_lbs INTO v_email, v_weight
      FROM public.user_profiles WHERE id = v_user;

    IF v_weight IS NOT NULL AND v_weight > 0 THEN
      SELECT MAX((public._best_1rm_from_exercises(exercises)->>'e1rm')::numeric)
        INTO v_best
        FROM public.workout_logs
       WHERE (user_id = v_user OR (v_email IS NOT NULL AND lower(created_by) = v_email))
         AND created_at > now() - INTERVAL '90 days'
         AND NOT COALESCE(implausible, FALSE);

      IF v_best IS NOT NULL THEN
        v_sum := v_sum + (v_best / v_weight);
        v_n   := v_n + 1;
      END IF;
    END IF;
  END LOOP;

  IF v_n = 0 THEN RETURN NULL; END IF;
  RETURN v_sum / v_n;
END;
$function$;


-- ── 6. Proof it ran ──────────────────────────────────────────────────
--
-- Counts the functions that read workout_logs and carry the predicate.
-- Six more than before this migration, and the three deliberate
-- abstentions are named in the header rather than left to be rediscovered.

SELECT
  count(*) FILTER (WHERE pg_get_functiondef(p.oid) ILIKE '%workout_logs%')          AS reads_workout_logs,
  count(*) FILTER (WHERE pg_get_functiondef(p.oid) ILIKE '%workout_logs%'
                     AND pg_get_functiondef(p.oid) ILIKE '%implausible%')           AS carries_the_filter,
  count(*) FILTER (WHERE p.proname IN ('gym_rival_volume_lbs','gym_rival_user_stats',
                                       'update_solo_challenge_progress','mark_workout_volume_credited',
                                       'crew_match_cadence','crew_match_strength')
                     AND pg_get_functiondef(p.oid) ILIKE '%implausible%')           AS fixed_here
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';
