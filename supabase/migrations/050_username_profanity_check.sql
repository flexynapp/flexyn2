-- 050_username_profanity_check.sql
--
-- Server-side enforcement of username content rules. The client runs a
-- profanity check in src/lib/profanityFilter.js, but that's
-- decoration — a malicious user can bypass the React app and hit
-- Supabase directly with a curl POST. This adds a database trigger
-- that blocks the same patterns server-side.
--
-- Migration is idempotent: CREATE OR REPLACE on both functions,
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER so re-running is safe.

-- 1. Username-purity check. Pure function (IMMUTABLE) so Postgres can
--    cache calls. Operates on the post-sanitization charset:
--    [a-z0-9_]+ only — the client already lowercases and strips
--    everything else before submitting. With that charset, the only
--    inter-word boundary character is '_', so the regex uses
--    `(^|_)PATTERN($|_)` to avoid the "Scunthorpe problem" (catching
--    innocent substrings like "passing" because it contains "ass").
--
--    Leet-substitution pass: digits map to letters (0→o, 1→i, 3→e,
--    4→a, 5→s, 7→t) so "n1gg3r" / "f4ggot" don't slip past.
--
--    To extend the list later, just CREATE OR REPLACE this function
--    with a new array — no schema change required.
CREATE OR REPLACE FUNCTION public.is_username_clean(p_username TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  patterns TEXT[] := ARRAY[
    -- Core slurs / hate-speech roots. Conservative initial list — false
    -- positives in usernames are a high-cost UX failure, so we err on
    -- the side of missing rather than over-blocking.
    'nigger', 'nigga', 'kike', 'faggot', 'tranny', 'chink', 'spic', 'gook',
    'retard', 'whore',
    -- Sexual-abuse terms
    'pedo', 'pedophile', 'rapist', 'rape',
    -- Admin / staff impersonation — prevents a user from squatting an
    -- identity that could be used for social engineering.
    'admin', 'administrator', 'moderator', 'mod', 'support', 'staff',
    'flexyn_official', 'flexyn_admin', 'flexyn_support'
  ];
  pat  TEXT;
  norm TEXT;
  leet TEXT;
BEGIN
  IF p_username IS NULL OR length(p_username) = 0 THEN
    RETURN TRUE; -- empty / null is handled by NOT NULL constraints elsewhere
  END IF;
  norm := lower(p_username);
  leet := translate(norm, '013457', 'oietas');
  FOREACH pat IN ARRAY patterns LOOP
    IF norm ~ ('(^|_)' || pat || '($|_)') THEN RETURN FALSE; END IF;
    IF leet ~ ('(^|_)' || pat || '($|_)') THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Trigger that runs the check on INSERT and on any UPDATE that
--    changes the username column. UPDATEs that don't touch username
--    are skipped via the `UPDATE OF username` clause + the DISTINCT
--    FROM guard inside the function (so updateMe payloads that pass
--    the same username through don't get re-checked).
CREATE OR REPLACE FUNCTION public.enforce_username_profanity()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip the check when the username is unchanged on UPDATE so the
  -- trigger doesn't fire for unrelated profile edits.
  IF TG_OP = 'UPDATE' AND OLD.username IS NOT DISTINCT FROM NEW.username THEN
    RETURN NEW;
  END IF;
  IF NEW.username IS NULL OR NEW.username = '' THEN
    RETURN NEW; -- empty handled by other constraints
  END IF;
  IF NOT public.is_username_clean(NEW.username) THEN
    -- 23514 = check_violation. Pairs with the client-side handler
    -- which surfaces "username contains prohibited content" inline
    -- next to the field. RAISE EXCEPTION with HINT so the Supabase
    -- error response carries actionable detail.
    RAISE EXCEPTION 'username_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Username contains prohibited content. Pick a different username.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_username_profanity ON public.user_profiles;
CREATE TRIGGER trg_username_profanity
  BEFORE INSERT OR UPDATE OF username ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_username_profanity();
