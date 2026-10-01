-- Direct messages: who has accepted a conversation, by user id.
--
-- hub_conversations.accepted_emails is the only record of whether a DM is a
-- request or sits in the inbox, and it holds email addresses. The app reads
-- it to sort the inbox, so every participant has been reading the other
-- person's email off every conversation. This adds the same list as user
-- ids so the app can stop reading the emails, and a later migration can
-- take them away from clients entirely.
--
-- accepted_ids is DERIVED, never written by the app: a trigger recomputes it
-- from accepted_emails on every insert and update, so a client cannot mark
-- someone else as having accepted. accepted_emails stays the record that the
-- server functions (accept_conversation, auto_accept_on_send,
-- dm_pending_send_allowed, the follow trigger) read and write; none of them
-- change here.

ALTER TABLE public.hub_conversations
  ADD COLUMN IF NOT EXISTS accepted_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE OR REPLACE FUNCTION public.sync_conversation_accepted_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.accepted_emails IS NULL OR cardinality(NEW.accepted_emails) = 0 THEN
    NEW.accepted_ids := ARRAY[]::uuid[];
  ELSE
    SELECT coalesce(array_agg(p.id ORDER BY p.id), ARRAY[]::uuid[])
      INTO NEW.accepted_ids
      FROM public.user_profiles p
     WHERE lower(p.email) IN (SELECT lower(e) FROM unnest(NEW.accepted_emails) AS e);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_conversation_accepted_ids() FROM PUBLIC, anon, authenticated;

-- Every insert and every update, not UPDATE OF accepted_emails: a column
-- list would let a client write accepted_ids alone without the trigger
-- firing.
DROP TRIGGER IF EXISTS trg_sync_conversation_accepted_ids ON public.hub_conversations;
CREATE TRIGGER trg_sync_conversation_accepted_ids
  BEFORE INSERT OR UPDATE ON public.hub_conversations
  FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_accepted_ids();

-- Backfill. The trigger does the work.
UPDATE public.hub_conversations SET accepted_emails = accepted_emails;

-- Probe, rolled back: the ids follow the emails, a forged id list is
-- overwritten, and a signed-in participant can read the new column.
DO $probe$
DECLARE
  v_me     uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_me_em  text;
  v_ot_em  text;
  v_conv   uuid;
  v_ids    uuid[];
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_me,    'probe_d_' || v_me    || '@probe.invalid', 'authenticated', 'authenticated'),
    (v_other, 'probe_d_' || v_other || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email, username) VALUES
    (v_me,    'probe_d_' || v_me    || '@probe.invalid', 'probe_d_' || left(v_me::text, 8)),
    (v_other, 'probe_d_' || v_other || '@probe.invalid', 'probe_d_' || left(v_other::text, 8))
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;
  SELECT email INTO v_ot_em FROM public.user_profiles WHERE id = v_other;

  -- A request from me: only I have accepted. The forged list names the
  -- other person and must not survive.
  INSERT INTO public.hub_conversations
    (created_by, user_id, participant_emails, participant_key, accepted_emails, accepted_ids)
  VALUES
    (v_me_em, v_me, ARRAY[v_me_em, v_ot_em], 'probe|' || v_me, ARRAY[upper(v_me_em)], ARRAY[v_other])
  RETURNING id, accepted_ids INTO v_conv, v_ids;
  IF v_ids IS DISTINCT FROM ARRAY[v_me] THEN
    RAISE EXCEPTION 'probe: insert gave accepted_ids %', v_ids;
  END IF;

  -- Writing only accepted_ids is recomputed too.
  UPDATE public.hub_conversations SET accepted_ids = ARRAY[v_me, v_other]
   WHERE id = v_conv RETURNING accepted_ids INTO v_ids;
  IF v_ids IS DISTINCT FROM ARRAY[v_me] THEN
    RAISE EXCEPTION 'probe: forged update kept %', v_ids;
  END IF;

  -- The other person accepts.
  UPDATE public.hub_conversations SET accepted_emails = array_append(accepted_emails, v_ot_em)
   WHERE id = v_conv RETURNING accepted_ids INTO v_ids;
  IF cardinality(v_ids) <> 2 OR NOT (v_me = ANY(v_ids) AND v_other = ANY(v_ids)) THEN
    RAISE EXCEPTION 'probe: accept gave %', v_ids;
  END IF;

  -- A participant reads it the way the app will.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated', 'email', v_ot_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';
  SELECT accepted_ids INTO v_ids FROM public.hub_conversations WHERE id = v_conv;
  IF cardinality(coalesce(v_ids, ARRAY[]::uuid[])) <> 2 THEN
    RAISE EXCEPTION 'probe: participant read %', v_ids;
  END IF;
  EXECUTE 'RESET role';

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END
$probe$;
