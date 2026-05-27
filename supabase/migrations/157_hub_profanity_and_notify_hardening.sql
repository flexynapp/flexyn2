-- 157_hub_profanity_and_notify_hardening.sql
--
-- Wave-54 follow-up. Two real exploits surfaced by the Hub-feed audit:
--
--   1. Server-side profanity enforcement on hub_posts + hub_comments is
--      SILENTLY DEAD. Mig 102 created triggers `BEFORE INSERT OR UPDATE
--      OF content` checking `NEW.content`. But the client writes the
--      `body` column (mig 004 added body alongside content; the one-time
--      backfill at mig 004:100-101 was a single UPDATE, not a sync
--      trigger). Result: every new post + comment from the React app
--      writes body=text, content=NULL — the trigger early-returns at
--      `IF NEW.content IS NULL THEN RETURN NEW`, and only the
--      client-side `assertNoTextProfanity` check is in effect. A user
--      bypassing the client (devtools, direct PostgREST) trivially
--      posts profanity.
--
--   2. notify_friend_post_for trusts client-supplied poster_name in
--      the notification title + metadata. Per CLAUDE.md mig 108
--      lesson: an authenticated attacker can fan out impersonation
--      pushes ("@admin posted: <slur>") to any victim's user_id.
--      Same defect class as the four RPC trust bugs patched in
--      mig 141 — never trust a client-supplied identifier in a
--      SECURITY DEFINER RPC. Derive the actor identity from
--      auth.uid() server-side.
--
-- All paste-safe + idempotent.


-- ── 1. Profanity triggers — fire on body, not just content ───────────
--
-- Rewrite the four profanity-check functions to test whichever column
-- is non-empty (body OR content) via COALESCE. Triggers also fire on
-- UPDATE OF body OR content so any change to either invokes the check.
-- Defense in depth: the old content-only path remains valid for any
-- legacy/admin code that writes content directly.

CREATE OR REPLACE FUNCTION public.enforce_post_profanity()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  -- Prefer body (the modern client-writable column); fall back to content.
  v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
  IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;

  -- On UPDATE, only re-check if the text actually changed.
  IF TG_OP = 'UPDATE'
     AND OLD.body    IS NOT DISTINCT FROM NEW.body
     AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_text_clean(v_text, FALSE) THEN
    RAISE EXCEPTION 'post_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Post contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_profanity ON public.hub_posts;
CREATE TRIGGER trg_post_profanity
  BEFORE INSERT OR UPDATE OF body, content ON public.hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_post_profanity();


CREATE OR REPLACE FUNCTION public.enforce_comment_profanity()
RETURNS TRIGGER AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
  IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.body    IS NOT DISTINCT FROM NEW.body
     AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_text_clean(v_text, FALSE) THEN
    RAISE EXCEPTION 'comment_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Comment contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_profanity ON public.hub_comments;
CREATE TRIGGER trg_comment_profanity
  BEFORE INSERT OR UPDATE OF body, content ON public.hub_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_comment_profanity();


-- hub_messages — same pattern. The migration history is the same:
-- mig 004 added body; mig 102 triggered on content. Verify by checking
-- the column existence at trigger-creation time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='hub_messages'
                AND column_name='body') THEN

    EXECUTE $body$
      CREATE OR REPLACE FUNCTION public.enforce_message_profanity()
      RETURNS TRIGGER AS $fn$
      DECLARE
        v_text TEXT;
      BEGIN
        v_text := COALESCE(NULLIF(NEW.body, ''), NEW.content);
        IF v_text IS NULL OR v_text = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE'
           AND OLD.body    IS NOT DISTINCT FROM NEW.body
           AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
          RETURN NEW;
        END IF;
        IF NOT public.is_text_clean(v_text, FALSE) THEN
          RAISE EXCEPTION 'message_profanity'
            USING ERRCODE = '23514',
                  HINT    = 'Message contains prohibited content. Edit it and try again.';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;
    $body$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_message_profanity ON public.hub_messages';
    EXECUTE 'CREATE TRIGGER trg_message_profanity
               BEFORE INSERT OR UPDATE OF body, content ON public.hub_messages
               FOR EACH ROW
               EXECUTE FUNCTION public.enforce_message_profanity()';
  END IF;
END $$;


-- ── 2. notify_friend_post_for — ignore client-supplied poster name ────
--
-- Resolve the poster identity from auth.uid() server-side. The
-- p_poster_name parameter is now ignored (kept in the signature for
-- backwards compatibility — the client can still send it, we just
-- don't trust it). If the username isn't set, fall back to the email
-- prefix (matches the existing client display fallback).
--
-- Same return shape + signature as mig 041 so client calls keep working.

CREATE OR REPLACE FUNCTION public.notify_friend_post_for(
  p_user_id      UUID,
  p_poster_name  TEXT,    -- IGNORED (kept for client-compat; resolved server-side)
  p_post_preview TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender       UUID := auth.uid();
  v_email        TEXT;
  v_lang         TEXT;
  v_real_name    TEXT;
  v_sender_email TEXT;
  v_text         JSONB;
  v_id           UUID;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_sender THEN
    RETURN NULL; -- never notify yourself about your own post
  END IF;

  -- Look up the SENDER's real identity. We ignore p_poster_name
  -- entirely (defense against impersonation).
  SELECT username, email INTO v_real_name, v_sender_email
    FROM public.user_profiles WHERE id = v_sender;
  IF v_real_name IS NULL OR v_real_name = '' THEN
    -- Fall back to email prefix (matches client's display fallback at
    -- HubProfile.jsx:790 and similar sites).
    v_real_name := COALESCE(SPLIT_PART(v_sender_email, '@', 1), 'Someone');
  END IF;

  SELECT u.email, prof.preferred_language
    INTO v_email, v_lang
    FROM auth.users u
    LEFT JOIN public.user_profiles prof ON prof.id = u.id
   WHERE u.id = p_user_id;

  IF v_email IS NULL THEN
    RETURN NULL;
  END IF;

  v_text := public.friend_post_text(COALESCE(v_lang, 'en'), v_real_name);

  INSERT INTO public.notifications
    (user_id, user_email, type, title, body, icon, link_url, metadata)
  VALUES
    (p_user_id,
     v_email,
     'friend_post',
     v_text ->> 'title',
     COALESCE(SUBSTRING(p_post_preview FROM 1 FOR 100), ''),
     '✨',
     '/hub',
     jsonb_build_object('posterName', v_real_name))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_friend_post_for(UUID, TEXT, TEXT) TO authenticated;


-- ── 3. Repost privacy enforcement (documented gap, not yet shipped) ──
--
-- The Hub-feed audit also surfaced that a tampered client can INSERT
-- a hub_posts row with `post_type='repost'` + `original_post_id=<any
-- uuid>`, regardless of the original's privacy setting. The leak path
-- requires the viewer to actually fetch the original via RepostCard;
-- hub_posts' existing read policy (author OR public OR follower) gates
-- that read for non-public sources, so the privacy clamp is partially
-- mitigated at read time. But the repost row itself shouldn't exist.
--
-- Not shipped in this migration — needs a product call on the desired
-- behavior (silently drop repost vs raise an error vs auto-quote the
-- preview), and an INSERT trigger is meaningful only after the
-- product decision lands.


NOTIFY pgrst, 'reload schema';
