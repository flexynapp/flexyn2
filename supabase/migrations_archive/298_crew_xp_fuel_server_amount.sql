-- 298_crew_xp_fuel_server_amount.sql
--
-- Closes the last client-priced XP grant in the app.
--
-- FINDING (XP hardening pass, 2026-08-05). Every other XP path in the
-- app funnels through grant_action_xp, which applies a per-action daily
-- ceiling and then hands off to the globally-capped increment_user_xp
-- (migrations 198 / 262 / 286). claim_crew_xp_fuel does not. It calls
-- increment_user_xp DIRECTLY as SECURITY DEFINER, with an amount the
-- CLIENT supplies, clamped only to 1..1000:
--
--     PERFORM public.increment_user_xp(v_uid, LEAST(COALESCE(p_xp,25), 1000));
--
-- Three things compound into a farm:
--
--   1. The amount is the caller's. The UI sends 25 (or whatever integer
--      it reads out of the message body); a crafted client sends 1000.
--   2. The claimable object is free to mint. crew_messages_insert (mig
--      048) is `sender_id = auth.uid() AND is_crew_member(crew_id)` —
--      it does not constrain message_type, so any member can insert
--      message_type='xp_fuel' rows as fast as they like. A crew of one,
--      which anyone can create, is a private faucet.
--   3. Nothing is capped per day, because this path never reaches
--      grant_action_xp. The only ceiling left is the global 50,000 /
--      rolling 24h — i.e. tapping a chat button is worth more per day
--      than twelve maximum-effort workouts.
--
-- FIX, in the shape migration 249 already used for crew-war XP: the
-- server decides the number and the client's is ignored.
--
--   • claim_crew_xp_fuel ignores p_xp entirely (signature kept so old
--     bundles keep working) and grants a server constant.
--   • The grant goes through grant_action_xp, so it lands in
--     action_xp_ledger under its own action type and gets a daily cap
--     like every other fixed grant.
--   • You cannot claim fuel you sent yourself, which is what made the
--     one-member crew a faucet rather than a social mechanic.
--   • The RPC now returns what was ACTUALLY credited, so a capped claim
--     can't report "+25 XP" while granting nothing.
--
-- grant_action_xp changes return type (void → integer, the credited
-- amount), which CREATE OR REPLACE cannot do — hence the DROP. Body is
-- migration 286's, unchanged apart from the new action type and the
-- return. Re-granting EXECUTE is part of the same statement block.
--
-- Paste-safety: scalar SELECT ... INTO only, no dotted alias.column and
-- no record-field access (CLAUDE.md §7).

-- ── 1. grant_action_xp: report what it credited, and classify fuel ────
DROP FUNCTION IF EXISTS public.grant_action_xp(text, integer);

CREATE FUNCTION public.grant_action_xp(p_action_type text, p_xp integer)
RETURNS integer
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
  IF p_xp IS NULL OR p_xp <= 0 THEN RETURN 0; END IF;

  -- The lifter's own calendar day, not UTC's (migration 286).
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
    -- NEW. Tapping a button in crew chat: four claims a day. Sized like
    -- water (24) and meals (30) — a participation nudge, not a training
    -- substitute. Before this row it fell to the 1000 fallback, and
    -- before reaching grant_action_xp at all it had no daily cap.
    WHEN 'crew_xp_fuel'      THEN 100
    ELSE 1000
  END;

  SELECT COALESCE(amount, 0) INTO v_before
    FROM public.action_xp_ledger
   WHERE user_id = v_uid AND day = v_day AND action_type = p_action_type;
  v_before := COALESCE(v_before, 0);
  v_credit := LEAST(p_xp, GREATEST(0, v_cap - v_before));
  IF v_credit <= 0 THEN RETURN 0; END IF;

  INSERT INTO public.action_xp_ledger (user_id, day, action_type, amount)
  VALUES (v_uid, v_day, p_action_type, v_credit)
  ON CONFLICT (user_id, day, action_type)
  DO UPDATE SET amount = public.action_xp_ledger.amount + v_credit;

  PERFORM public.increment_user_xp(v_uid, v_credit);
  RETURN v_credit;
END;
$function$;

REVOKE ALL    ON FUNCTION public.grant_action_xp(text, integer) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.grant_action_xp(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_action_xp(text, integer) TO authenticated;

-- ── 2. claim_crew_xp_fuel: the server prices it ───────────────────────
CREATE OR REPLACE FUNCTION public.claim_crew_xp_fuel(p_message_id uuid, p_xp integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fuel$
DECLARE
  -- The value of one fuel claim. Deliberately a constant in SQL: it is
  -- the number that lands in a user's total_xp, so it does not belong in
  -- a JSON message body that the sender's browser wrote.
  c_fuel_xp CONSTANT integer := 25;

  v_uid      uuid := auth.uid();
  v_crew_id  uuid;
  v_msg_type text;
  v_sender   uuid;
  v_member   integer;
  v_credit   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_message_id IS NULL THEN
    RAISE EXCEPTION 'message_id required' USING ERRCODE = '22023';
  END IF;

  SELECT crew_id, message_type, sender_id
    INTO v_crew_id, v_msg_type, v_sender
    FROM public.crew_messages
   WHERE id = p_message_id;

  IF v_crew_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_not_found');
  END IF;
  IF v_msg_type IS DISTINCT FROM 'xp_fuel' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fuel_message');
  END IF;

  -- Fuel is something you give the crew. Claiming your own turns a
  -- one-member crew into a private XP printer, which is exactly how the
  -- unbounded version was farmable.
  IF v_sender = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'own_fuel');
  END IF;

  SELECT COUNT(*)::int
    INTO v_member
    FROM public.crew_members
   WHERE crew_id = v_crew_id
     AND user_id = v_uid;
  IF v_member = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_crew_member');
  END IF;

  -- One claim per member per message. Written BEFORE the grant so a
  -- unique violation can never coexist with a second payout.
  BEGIN
    INSERT INTO public.crew_xp_claims (message_id, user_id, xp_amount)
    VALUES (p_message_id, v_uid, c_fuel_xp);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_claimed');
  END;

  -- p_xp is accepted and IGNORED — old bundles still pass one.
  v_credit := public.grant_action_xp('crew_xp_fuel', c_fuel_xp);

  -- Record what was actually paid. The claim row is written first (so the
  -- one-per-member guard can never race the grant), which means a claim
  -- made after the daily cap is reached would otherwise sit in the ledger
  -- claiming 25 XP that was never credited.
  UPDATE public.crew_xp_claims
     SET xp_amount = v_credit
   WHERE message_id = p_message_id
     AND user_id    = v_uid;

  RETURN jsonb_build_object(
    'ok',        true,
    'xp_amount', v_credit,
    'capped',    v_credit < c_fuel_xp
  );
END;
$fuel$;

REVOKE ALL    ON FUNCTION public.claim_crew_xp_fuel(uuid, integer) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.claim_crew_xp_fuel(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_crew_xp_fuel(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
