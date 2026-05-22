-- 083_content_profanity_checks.sql
--
-- Server-side enforcement of profanity rules across user-generated
-- text surfaces. Today the client runs `containsProfanity()` from
-- `src/lib/profanityFilter.js`, but that's decoration — a malicious
-- user can bypass the React app and POST directly to Supabase.
--
-- Mirrors the proven pattern from migration 050 (username) and
-- 054 (bio). Same word-boundary regex, same leet-substitution pass,
-- same 23514 error code so the client error handler can branch on it
-- identically across all surfaces.
--
-- Surfaces covered:
--   • hub_posts.content    — public + followers-only post bodies
--   • hub_comments.content — comments under posts
--   • hub_messages.content — direct messages between users
--   • crews.name           — crew display names
--
-- Idempotent: CREATE OR REPLACE on functions; DROP TRIGGER IF EXISTS
-- before CREATE TRIGGER. Safely re-runnable.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Generic text-purity check
--
--    Same regex shape as is_bio_clean (054). Takes a `p_strict` flag
--    that switches between the conservative bio list (loose) and the
--    full username list (strict — adds 'rape' and a few others that
--    are unsafe as single-word handles but legitimate in prose).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_text_clean(p_text TEXT, p_strict BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN AS $$
DECLARE
  -- Core slur / hate-speech roots. Mirrors migration 054's bio list.
  loose_patterns TEXT[] := ARRAY[
    'nigger', 'nigga', 'kike', 'faggot', 'tranny', 'chink', 'spic', 'gook',
    'retard', 'whore',
    'pedo', 'pedophile', 'rapist'
  ];
  -- Strict list adds 'rape' (safe to block as a standalone handle/name,
  -- and worth blocking in a crew display name). Comment/post/DM use the
  -- loose list since people legitimately discuss recovery.
  strict_patterns TEXT[] := ARRAY[
    'nigger', 'nigga', 'kike', 'faggot', 'tranny', 'chink', 'spic', 'gook',
    'retard', 'whore', 'rape',
    'pedo', 'pedophile', 'rapist'
  ];
  patterns TEXT[];
  pat  TEXT;
  norm TEXT;
  leet TEXT;
BEGIN
  IF p_text IS NULL OR length(p_text) = 0 THEN
    RETURN TRUE;
  END IF;
  patterns := CASE WHEN p_strict THEN strict_patterns ELSE loose_patterns END;
  norm := regexp_replace(lower(p_text), '\s+', ' ', 'g');
  leet := translate(norm, '013457', 'oietas');
  FOREACH pat IN ARRAY patterns LOOP
    IF norm ~ ('\m' || pat || '\M') THEN RETURN FALSE; END IF;
    IF leet ~ ('\m' || pat || '\M') THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger helpers, one per table. Each one early-exits when the
--    relevant text column is unchanged so unrelated UPDATEs don't
--    pay the regex cost. Raise 23514 with a per-surface tag in the
--    HINT so the client can branch on the message text if needed.
-- ─────────────────────────────────────────────────────────────────────

-- hub_posts ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_post_profanity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;
  IF NEW.content IS NULL OR NEW.content = '' THEN RETURN NEW; END IF;
  IF NOT public.is_text_clean(NEW.content, FALSE) THEN
    RAISE EXCEPTION 'post_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Post contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_profanity ON public.hub_posts;
CREATE TRIGGER trg_post_profanity
  BEFORE INSERT OR UPDATE OF content ON public.hub_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_post_profanity();

-- hub_comments ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_comment_profanity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;
  IF NEW.content IS NULL OR NEW.content = '' THEN RETURN NEW; END IF;
  IF NOT public.is_text_clean(NEW.content, FALSE) THEN
    RAISE EXCEPTION 'comment_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Comment contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_profanity ON public.hub_comments;
CREATE TRIGGER trg_comment_profanity
  BEFORE INSERT OR UPDATE OF content ON public.hub_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_comment_profanity();

-- hub_messages ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_message_profanity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.content IS NOT DISTINCT FROM NEW.content THEN
    RETURN NEW;
  END IF;
  IF NEW.content IS NULL OR NEW.content = '' THEN RETURN NEW; END IF;
  IF NOT public.is_text_clean(NEW.content, FALSE) THEN
    RAISE EXCEPTION 'message_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Message contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_profanity ON public.hub_messages;
CREATE TRIGGER trg_message_profanity
  BEFORE INSERT OR UPDATE OF content ON public.hub_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_profanity();

-- crews.name ──────────────────────────────────────────────────────────
-- Crew names are short handles seen by other users in DMs, the
-- leaderboard, and crew battles. Use the STRICT list — single-word
-- offensive crew names shouldn't be possible, full stop.
CREATE OR REPLACE FUNCTION public.enforce_crew_name_profanity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.name IS NOT DISTINCT FROM NEW.name THEN
    RETURN NEW;
  END IF;
  IF NEW.name IS NULL OR NEW.name = '' THEN RETURN NEW; END IF;
  IF NOT public.is_text_clean(NEW.name, TRUE) THEN
    RAISE EXCEPTION 'crew_name_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Crew name contains prohibited content. Pick another name.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_crew_name_profanity ON public.crews;
CREATE TRIGGER trg_crew_name_profanity
  BEFORE INSERT OR UPDATE OF name ON public.crews
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_crew_name_profanity();
