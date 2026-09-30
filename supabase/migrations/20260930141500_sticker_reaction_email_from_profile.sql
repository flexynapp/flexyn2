-- The database, not the app, writes post_sticker_reactions.user_email.
--
-- Other people's emails are about to stop being readable on this table
-- (column-level SELECT). The app places a reaction with an upsert, and
-- Postgres requires SELECT on every column an ON CONFLICT DO UPDATE sets
-- from EXCLUDED, so an upsert that still sends user_email would be refused.
-- The app now leaves the column out, and this trigger fills it from the
-- reactor's profile. Whatever a client sends is replaced, so the column
-- also stops being something a client can forge.

CREATE OR REPLACE FUNCTION public.pin_sticker_reaction_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  NEW.user_email := COALESCE(
    (SELECT email FROM public.user_profiles WHERE id = NEW.user_id),
    NULLIF(NEW.user_email, ''),
    '');
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pin_sticker_reaction_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS post_sticker_reactions_pin_email ON public.post_sticker_reactions;
CREATE TRIGGER post_sticker_reactions_pin_email
  BEFORE INSERT OR UPDATE ON public.post_sticker_reactions
  FOR EACH ROW EXECUTE FUNCTION public.pin_sticker_reaction_email();

-- Probe, run as a real signed-in user and rolled back: a reaction placed
-- the way the app now places it (no email, upsert on post_id,user_id) is
-- stored with the reactor's own email, a forged one is replaced, and the
-- second upsert updates the same row.
DO $probe$
DECLARE
  v_me    uuid := gen_random_uuid();
  v_me_em text;
  v_post  uuid;
  v_em    text;
  v_emoji text;
  v_n     int;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_me, 'probe_m_' || v_me || '@probe.invalid', 'authenticated', 'authenticated');
  INSERT INTO public.user_profiles (id, email)
  VALUES (v_me, 'probe_m_' || v_me || '@probe.invalid')
  ON CONFLICT (id) DO NOTHING;
  SELECT email INTO v_me_em FROM public.user_profiles WHERE id = v_me;

  INSERT INTO public.user_inventory (user_id, user_email, item_id, item_name, item_emoji, item_type)
  VALUES (v_me, v_me_em, 'probe_sticker', 'Probe', 'P', 'sticker');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me, 'role', 'authenticated', 'email', v_me_em)::text, true);
  EXECUTE 'SET LOCAL role authenticated';

  INSERT INTO public.hub_posts (created_by, user_id, body, privacy)
  VALUES (v_me_em, v_me, 'probe', 'public') RETURNING id INTO v_post;

  -- The app's shape: no user_email.
  INSERT INTO public.post_sticker_reactions (post_id, user_id, user_name, item_id, item_name, item_emoji)
  VALUES (v_post, v_me, 'probe', 'probe_sticker', 'Probe', 'P')
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET user_name = EXCLUDED.user_name, item_id = EXCLUDED.item_id,
        item_name = EXCLUDED.item_name, item_emoji = EXCLUDED.item_emoji;

  -- An old client sending a forged address.
  INSERT INTO public.post_sticker_reactions (post_id, user_id, user_email, user_name, item_id, item_name, item_emoji)
  VALUES (v_post, v_me, 'victim@else.invalid', 'probe', 'probe_sticker', 'Probe', 'Q')
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET user_email = EXCLUDED.user_email, item_emoji = EXCLUDED.item_emoji;

  EXECUTE 'RESET role';
  SELECT count(*), max(user_email), max(item_emoji) INTO v_n, v_em, v_emoji
    FROM public.post_sticker_reactions WHERE post_id = v_post;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'probe: expected one reaction, got %', v_n;
  END IF;
  IF lower(v_em) IS DISTINCT FROM lower(v_me_em) THEN
    RAISE EXCEPTION 'probe: reaction email is %, not the reactor''s', v_em;
  END IF;

  RAISE EXCEPTION 'probe_ok';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe_ok' THEN RAISE; END IF;
END;
$probe$;
