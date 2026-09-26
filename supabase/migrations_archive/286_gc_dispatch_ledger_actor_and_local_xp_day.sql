-- 286_gc_dispatch_ledger_actor_and_local_xp_day.sql
--
-- Three fixes from the #51-75 acceptance review. The first one is the reason
-- this migration exists; the other two are small and adjacent.
--
-- ── 1. STORAGE GC HAS NEVER RUN. NOT ONCE. ───────────────────────────────
--
-- `kick_storage_gc` called `extensions.http_post(...)`. That function does
-- not exist. pg_net is registered with `extensions` as its extension
-- namespace, but it publishes its API into a schema called `net` — so the
-- real function is `net.http_post`, and the call raised
--   42883: function extensions.http_post(...) does not exist
-- every single time.
--
-- It was invisible because the call sits inside
--   BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END;
-- A WARNING is not a failure: pg_cron recorded `succeeded` on all 2,710
-- runs, the queue kept growing, and no counter anywhere moved. The two
-- blobs queued on 2026-07-27 still read `attempts = 0` nine days later,
-- which is the tell — the Edge Function increments that, so zero means the
-- request never arrived, not that it arrived and failed.
--
-- Worth recording how nearly this got misdiagnosed. The function is ALSO
-- deployed with `verify_jwt: true` while this caller sends only
-- `X-Storage-GC-Secret` and no `Authorization` header, and probing the
-- endpoint proves the gateway rejects exactly that shape:
--   POST /storage-gc → 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}   (gateway)
--   POST /send-push  → 401 {"error":"unauthorized"}                 (the function)
-- That is a real defect and it is fixed too (redeployed verify_jwt:false,
-- matching send-push and generateWeeklyDebriefs, which authenticate the
-- same way). But it was NOT why nothing happened — a request that is never
-- sent cannot be rejected. Both had to be fixed; only one was the cause.
-- CLAUDE.md's push post-mortem says to read the INSTALLED function body
-- rather than the migration that created it. That is what found this.
--
-- The exception handler is also removed. Every early return above it is
-- already explicit (no secrets → return, empty queue → return), so the only
-- way to reach the dispatch is "configured, with work pending". A failure
-- there is exactly the thing we want pg_cron to record as a failure. The
-- swallow is what bought nine days of silence.
--
-- ── 2. The coin ledger's `actor` says `postgres` for every row ────────────
-- ── 3. Per-action XP caps roll over at UTC midnight, not the user's ───────
--
-- Idempotent. Safe to re-run.


-- ══ 1. Storage GC dispatch ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kick_storage_gc()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
  v_url     TEXT;
  v_secret  TEXT;
  v_pending INTEGER := 0;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets
     WHERE name = 'storage_gc_url'
     LIMIT 1;
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'storage_gc_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL; v_secret := NULL;
  END;

  -- Deliberately no GUC fallback. current_setting('app.storage_gc_url')
  -- can never be populated on managed Supabase — ALTER DATABASE ... SET is
  -- blocked, which is the whole reason migration 038 moved these into the
  -- Vault. The old fallback could only ever return NULL, and its presence
  -- implied a second working configuration path that does not exist.
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_pending
    FROM public.storage_cleanup_queue
   WHERE processed_at IS NULL;

  IF v_pending = 0 THEN
    RETURN;
  END IF;

  -- net.http_post, NOT extensions.http_post. See the head comment.
  -- No exception handler: reaching this line means configured + work
  -- pending, so a failure here must surface as a failed cron run.
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'X-Storage-GC-Secret', v_secret
    ),
    body    := jsonb_build_object('limit', 200)
  );
END;
$function$;


-- ══ 2. Coin ledger — record WHO, not the definer ═════════════════════════
--
-- `actor` was set from current_user. Inside a SECURITY DEFINER function
-- current_user is the function OWNER, so all 120 rows read `postgres` or
-- `migration` and none has ever read `authenticated` — including the 97
-- that came from real user activity. The one column you would reach for in
-- a "who minted these coins" investigation was answering a different
-- question entirely.
--
-- session_user is the role the client actually authenticated as, which is
-- what was wanted. auth.uid() is recorded alongside it in user_id already,
-- so role-level attribution is the missing half.
--
-- Existing rows cannot be corrected; that information was never captured.

CREATE OR REPLACE FUNCTION public.flex_coin_ledger_and_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_delta       INTEGER;
  v_credited    INTEGER;
  v_headroom    INTEGER;
  v_clamped     BOOLEAN := false;
  v_source      TEXT;
  v_actor       TEXT := session_user;
  v_daily_cap   CONSTANT INTEGER := 50000;
BEGIN
  IF NEW.flex_coins IS NOT DISTINCT FROM OLD.flex_coins THEN
    RETURN NEW;
  END IF;

  v_delta := COALESCE(NEW.flex_coins, 0) - COALESCE(OLD.flex_coins, 0);

  IF v_delta > 0 THEN
    SELECT COALESCE(SUM(delta), 0) INTO v_credited
      FROM public.flex_coin_ledger
     WHERE user_id = NEW.id
       AND delta > 0
       AND created_at > now() - interval '24 hours';

    v_headroom := GREATEST(0, v_daily_cap - v_credited);
    IF v_delta > v_headroom THEN
      v_clamped := true;
      v_delta   := v_headroom;
      NEW.flex_coins := COALESCE(OLD.flex_coins, 0) + v_delta;
    END IF;

    IF v_delta = 0 THEN
      INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source, clamped)
      VALUES (NEW.id, 0, COALESCE(OLD.flex_coins, 0), v_actor, NULL, true);
      RETURN NEW;
    END IF;
  END IF;

  v_source := substring(
    current_query()
    from '((?:claim|purchase|complete|grant|distribute|gift|sweep|perform|resolve|create|increment|sync|reset)_[a-z_]+)'
  );

  INSERT INTO public.flex_coin_ledger (user_id, delta, balance_after, actor, source, clamped)
  VALUES (NEW.id, v_delta, COALESCE(NEW.flex_coins, 0), v_actor, v_source, v_clamped);

  RETURN NEW;
END;
$function$;

-- The trigger name is load-bearing: BEFORE triggers fire in alphabetical
-- order, and `zzz_` puts this one last so it records the value that
-- survived user_profiles_block_privileged_updates_tr. Re-attach under the
-- same name rather than a tidier one.
DROP TRIGGER IF EXISTS zzz_flex_coin_ledger_tr ON public.user_profiles;
CREATE TRIGGER zzz_flex_coin_ledger_tr
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.flex_coin_ledger_and_cap();


-- ══ 3. Per-action XP caps use the USER'S day ═════════════════════════════
--
-- The bucket was (now() AT TIME ZONE 'utc')::date. For a lifter at UTC-7
-- that resets every cap at 5pm local — mid-evening — so an evening session
-- and the next morning's land in different buckets and each gets a full
-- allowance. The ceiling was weakest exactly where the Americas train.
--
-- public.user_local_now() already exists for this (migration 276 uses it
-- for scheduled-workout reminders, migration 035 for streak reminders).
-- The table shape is unchanged; only what fills `day` moves.
--
-- One-time boundary effect on deploy: a user whose local date differs from
-- the UTC date right now gets a fresh bucket for the remainder of their
-- day. That is a single day of extra headroom on an anti-abuse cap, which
-- is the harmless direction.
--
-- Note the global 50,000/24h ceiling in increment_user_xp is a ROLLING
-- window and is deliberately left alone — the two ceilings are independent
-- and the rolling one needs no timezone at all.

CREATE OR REPLACE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid    := auth.uid();
  v_day    date;
  v_before integer;
  v_cap    integer;
  v_credit integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN; END IF;

  -- The lifter's own calendar day, not UTC's.
  v_day := (public.user_local_now(v_uid))::date;
  IF v_day IS NULL THEN
    v_day := (now() AT TIME ZONE 'utc')::date;
  END IF;

  v_cap := CASE p_action_type
    WHEN 'workout_completed' THEN 4000
    WHEN 'cardio_completed'  THEN 2400
    WHEN 'comeback_bonus'    THEN 200
    WHEN 'water_logged'      THEN 24
    WHEN 'meal_logged'       THEN 30
    WHEN 'recipe_created'    THEN 75
    WHEN 'regimen_created'   THEN 200
    WHEN 'goal_completed'    THEN 500
    ELSE 1000
  END;

  SELECT COALESCE(amount, 0) INTO v_before
    FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = p_action_type;
  v_before := COALESCE(v_before, 0);
  v_credit := LEAST(p_xp, GREATEST(0, v_cap - v_before));
  IF v_credit <= 0 THEN RETURN; END IF;

  INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
  VALUES (v_uid, v_day, p_action_type, v_credit)
  ON CONFLICT (user_id, day, action_type)
  DO UPDATE SET amount = public.action_xp_ledger.amount + v_credit;

  PERFORM public.increment_user_xp(v_uid, v_credit);
END;
$function$;

NOTIFY pgrst, 'reload schema';
