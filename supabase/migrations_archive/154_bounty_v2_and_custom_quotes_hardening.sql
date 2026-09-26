-- 154_bounty_v2_and_custom_quotes_hardening.sql
--
-- Wave-50 follow-up to mig 152 (bounty economy integrity) + mig 153
-- (custom quotes). Three bounty-economy holes + two custom-quote holes
-- found by the parallel QA audit:
--
--   1. complete_bounty_claim now enforces the claim's deadline (mig 152
--      verified target hit + own-log ownership but NOT timely
--      completion — a stale claim could still pay out before the
--      hourly expiry cron sweeps it).
--   2. complete_bounty_claim's `weekly_volume` metric now sums volume
--      across the user's last 7 days of workout_logs, NOT the proof
--      log alone. The proof log was carried over from session_volume
--      semantics — a 7-day-volume bounty target of 50,000 lbs was
--      satisfied by any single log hitting 50k, defeating the metric.
--   3. bounties INSERT policy refuses self-targets and zero/negative
--      target_value, closing the obvious sybil-free mint path
--      (User A inserts a self-bounty with target 0.001 + tier reward
--      and immediately claims + completes). Sybil-pair mints remain
--      possible — those need anti-abuse heuristics out of scope here.
--   4. custom_quotes: 20-cap is now enforced server-side via a BEFORE
--      INSERT trigger. Mig 153 enforced it only on the client + data
--      layer; a fast tap could race two inserts, or a direct POST
--      could bypass entirely.
--   5. custom_quotes: profanity trigger on text + author. Per the
--      established pattern (mig 050 username, 054 bio, 073 status_notes,
--      102 hub content) every user-prose surface gets is_text_clean /
--      is_bio_clean trigger enforcement. Mig 153 shipped without it.
--
-- All paste-safe: scalar variables only, no `alias.column` 2-char
-- tokens, no `%ROWTYPE` + dotted record access. Idempotent —
-- CREATE OR REPLACE / DROP IF EXISTS guards throughout.


-- ── 1+2. complete_bounty_claim hardening ───────────────────────────────
-- Same signature as mig 152, so CREATE OR REPLACE swaps cleanly. The
-- only changes from 152 are:
--   • SELECT bounty_claims.deadline + IF deadline < NOW() THEN reject
--   • weekly_volume branch sums over the user's last-7-days logs
CREATE OR REPLACE FUNCTION public.complete_bounty_claim(
  p_claim_id       UUID,
  p_workout_log_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_claim_status TEXT;
  v_claim_dl     TIMESTAMPTZ;
  v_bounty_id    UUID;
  v_metric       TEXT;
  v_exercise     TEXT;
  v_target       NUMERIC;
  v_reward       INT;
  v_log_owner    UUID;
  v_exercises    JSONB;
  v_achieved     NUMERIC := 0;
  v_ex           JSONB;
  v_set          JSONB;
  v_w            NUMERIC;
  v_r            NUMERIC;
  v_week_logs    JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_workout_log_id IS NULL THEN
    RAISE EXCEPTION 'workout_log_required' USING ERRCODE = '22023';
  END IF;

  SELECT status, bounty_id, deadline
    INTO v_claim_status, v_bounty_id, v_claim_dl
    FROM public.bounty_claims
   WHERE id = p_claim_id AND claimant_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_not_found'  USING ERRCODE = '22023'; END IF;
  IF v_claim_status <> 'active' THEN RAISE EXCEPTION 'claim_not_active' USING ERRCODE = '22023'; END IF;
  -- NEW: reject expired claims server-side. The hourly expiry cron
  -- eventually flips these to 'expired', but until then a tampered
  -- client could call this RPC and harvest the reward late.
  IF v_claim_dl < NOW() THEN RAISE EXCEPTION 'claim_expired' USING ERRCODE = '22023'; END IF;

  SELECT metric::text, exercise_name, target_value, reward
    INTO v_metric, v_exercise, v_target, v_reward
    FROM public.bounties WHERE id = v_bounty_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'bounty_not_found' USING ERRCODE = '22023'; END IF;

  SELECT user_id, exercises INTO v_log_owner, v_exercises
    FROM public.workout_logs WHERE id = p_workout_log_id;
  IF NOT FOUND OR v_log_owner <> v_user_id THEN
    RAISE EXCEPTION 'invalid_workout_log' USING ERRCODE = '42501';
  END IF;

  -- Re-derive achieved metric.
  IF v_metric = 'session_volume' THEN
    v_achieved := public._duel_calc_volume(v_exercises);

  ELSIF v_metric = 'weekly_volume' THEN
    -- NEW: sum volume across the user's last 7 days of workout logs,
    -- not just the proof log. Previously this branch incorrectly
    -- treated weekly_volume identically to session_volume.
    v_achieved := 0;
    FOR v_week_logs IN
      SELECT exercises FROM public.workout_logs
       WHERE user_id = v_user_id
         AND created_at >= NOW() - INTERVAL '7 days'
    LOOP
      v_achieved := v_achieved + public._duel_calc_volume(v_week_logs);
    END LOOP;

  ELSIF v_metric IN ('single_lift_weight', 'single_lift_reps')
        AND v_exercise IS NOT NULL
        AND jsonb_typeof(v_exercises) = 'array' THEN
    FOR v_ex IN SELECT * FROM jsonb_array_elements(v_exercises) LOOP
      IF lower(COALESCE(v_ex->>'name', '')) = lower(v_exercise)
         AND jsonb_typeof(v_ex->'sets') = 'array' THEN
        FOR v_set IN SELECT * FROM jsonb_array_elements(v_ex->'sets') LOOP
          v_w := COALESCE((v_set->>'weight')::NUMERIC, 0);
          v_r := COALESCE((v_set->>'reps')::NUMERIC, 0);
          IF v_metric = 'single_lift_weight' AND v_w > v_achieved THEN v_achieved := v_w; END IF;
          IF v_metric = 'single_lift_reps'   AND v_r > v_achieved THEN v_achieved := v_r; END IF;
        END LOOP;
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'unsupported_metric' USING ERRCODE = '22023';
  END IF;

  IF v_achieved < v_target THEN
    RAISE EXCEPTION 'target_not_met' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bounty_claims
     SET status = 'completed', completed_at = NOW(), workout_log_id = p_workout_log_id
   WHERE id = p_claim_id;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins + v_reward
   WHERE id = v_user_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.complete_bounty_claim(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_bounty_claim(UUID, UUID) TO authenticated;


-- ── 3. Tighter bounties INSERT policy ──────────────────────────────────
-- Replaces the mig 152 policy. Adds the obvious abuse refusals:
--   • target_user_id <> auth.uid()  — no self-targeting (self-target +
--     self-claim is a one-account mint loop on the +reward, -fee delta).
--   • target_value > 0              — a 0.001 target is a free completion.
--   • expires_at > now()            — no backdated bounties.
DROP POLICY IF EXISTS "bounties_insert" ON public.bounties;
CREATE POLICY "bounties_insert"
  ON public.bounties FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND target_user_id IS DISTINCT FROM auth.uid()
    AND target_value > 0
    AND expires_at > now()
    AND (
      (difficulty = 'easy'   AND entry_fee = 10 AND reward = 60)  OR
      (difficulty = 'medium' AND entry_fee = 15 AND reward = 100) OR
      (difficulty = 'hard'   AND entry_fee = 20 AND reward = 175)
    )
  );


-- ── 4. custom_quotes 20-cap trigger ───────────────────────────────────
-- Server-enforced ceiling. Mig 153 enforced it only client-side, so a
-- direct PostgREST POST or a same-tick double-tap could bypass.
CREATE OR REPLACE FUNCTION public.enforce_custom_quotes_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.custom_quotes
   WHERE user_id = NEW.user_id;
  IF v_count >= 20 THEN
    RAISE EXCEPTION 'custom_quotes_limit'
      USING ERRCODE = '23514',
            HINT    = 'Maximum 20 custom quotes per user. Delete one before adding another.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_quotes_cap ON public.custom_quotes;
CREATE TRIGGER trg_custom_quotes_cap
  BEFORE INSERT ON public.custom_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_custom_quotes_cap();


-- ── 5. custom_quotes profanity trigger ────────────────────────────────
-- Reuses is_bio_clean (same moderation bar as bio / status notes).
-- Checks both the quote text and the (optional) author attribution.
-- Falls back to no-op if is_bio_clean isn't installed yet (legacy hosts).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_bio_clean') THEN
    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_custom_quote_profanity()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF NEW.text IS NOT NULL AND NEW.text <> '' AND NOT public.is_bio_clean(NEW.text) THEN
          RAISE EXCEPTION 'custom_quote_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Quote text contains prohibited content. Edit it and try again.';
        END IF;
        IF NEW.author IS NOT NULL AND NEW.author <> '' AND NOT public.is_bio_clean(NEW.author) THEN
          RAISE EXCEPTION 'custom_quote_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Author name contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_custom_quote_profanity ON public.custom_quotes';
    EXECUTE 'CREATE TRIGGER trg_custom_quote_profanity
               BEFORE INSERT OR UPDATE OF text, author ON public.custom_quotes
               FOR EACH ROW
               EXECUTE FUNCTION public.enforce_custom_quote_profanity()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
