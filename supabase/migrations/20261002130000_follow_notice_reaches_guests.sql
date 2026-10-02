-- Following someone never notified them if they were a guest, and could
-- show part of the follower's email.
--
-- notify_friend_follow_for looked the followee's email up in auth.users,
-- which is NULL for every signInAnonymously() account, so the function
-- returned before inserting anything: guests were never told they had a
-- new follower. It then matched the follow by email, the key the app
-- moved off. And when the follower had no username it named them by the
-- part of their email before the @, which is the address the email
-- lockdown exists to hide.
--
-- Now: the follow is matched by follower_id / followee_id (set on all 44
-- rows, measured), the recipient's email comes from user_profiles (the
-- notifications trigger from migration 366 fills it anyway), and a
-- follower without a username is named by full name or "Someone".

CREATE OR REPLACE FUNCTION public.notify_friend_follow_for(p_user_id uuid, p_follower_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender UUID := auth.uid();
  v_email TEXT; v_lang TEXT; v_name TEXT; v_full TEXT; v_text JSONB; v_id UUID;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user_id required' USING ERRCODE='22023'; END IF;
  IF p_user_id = v_sender THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.hub_follows
                  WHERE follower_id = v_sender AND followee_id = p_user_id) THEN
    RAISE EXCEPTION 'no such follow' USING ERRCODE='42501';
  END IF;

  SELECT username, full_name INTO v_name, v_full FROM public.user_profiles WHERE id = v_sender;
  IF v_name IS NOT NULL AND v_name <> '' THEN
    v_name := '@' || v_name;
  ELSIF v_full IS NOT NULL AND btrim(v_full) <> '' THEN
    v_name := btrim(v_full);
  ELSE
    v_name := 'Someone';
  END IF;

  SELECT email, preferred_language INTO v_email, v_lang
    FROM public.user_profiles WHERE id = p_user_id;

  v_text := public.friend_follow_text(COALESCE(v_lang,'en'), v_name);
  INSERT INTO public.notifications (user_id,user_email,type,title,body,icon,link_url,metadata)
  VALUES (p_user_id,v_email,'friend_follow',v_text->>'title',v_text->>'body','👋','/hub',
          jsonb_build_object('followerName',v_name)) RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- Probe: the body no longer reads auth.users or splits an email.
DO $probe$
BEGIN
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'notify_friend_follow_for')
     ~* '(auth\.users|split_part)' THEN
    RAISE EXCEPTION 'probe: notify_friend_follow_for still reads auth email';
  END IF;
END;
$probe$;
