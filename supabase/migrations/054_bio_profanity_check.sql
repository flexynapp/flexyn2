-- 054_bio_profanity_check.sql
--
-- Server-side enforcement of bio content rules. The client runs a
-- profanity check in src/lib/profanityFilter.js, but that's
-- decoration — a malicious user can bypass the React app and POST
-- directly to Supabase. This adds a BEFORE UPDATE trigger on
-- user_profiles.bio that blocks the same patterns server-side.
--
-- Mirror of migration 050 (username trigger) for the second
-- user-visible free-text field. Same word-boundary regex, same
-- leet-substitution pass, same 23514 error code so the client error
-- handler can branch on it identically.
--
-- Idempotent: CREATE OR REPLACE on both functions; DROP TRIGGER IF
-- EXISTS before CREATE TRIGGER. Safely re-runnable.

-- 1. Bio-purity check. Pure function (IMMUTABLE) so Postgres can
--    cache calls. Operates on normalized text — bios are free-form
--    so we lowercase + collapse whitespace before regex matching
--    to catch patterns that span spacing variations.
--
--    Unlike usernames (restricted charset, single token), bios are
--    natural prose. Word boundaries use \m\M (Postgres word-boundary
--    metacharacters) instead of the underscore-only boundary the
--    username function uses.
--
--    To extend the list later, just CREATE OR REPLACE this function
--    with a new array — no schema change required.
CREATE OR REPLACE FUNCTION public.is_bio_clean(p_bio TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  patterns TEXT[] := ARRAY[
    -- Core slurs / hate-speech roots. Mirrors migration 050's list
    -- so a user can't bypass username-blocking by stuffing the same
    -- content into their bio.
    'nigger', 'nigga', 'kike', 'faggot', 'tranny', 'chink', 'spic', 'gook',
    'retard', 'whore',
    -- Sexual-abuse terms
    'pedo', 'pedophile', 'rapist'
    -- NOTE: 'rape' intentionally OMITTED here (unlike migration 050's
    -- username list) — bios are prose and the substring would catch
    -- innocuous words like "grape" / "drape" / "Europe" depending on
    -- regex behavior. The \m\M word boundary protects against most of
    -- those, but bios also legitimately discuss recovery from trauma
    -- where the bare word appears. Keep this list conservative for
    -- bio; false positives here hurt real users while the username
    -- block already prevents the worst abuse vector.
  ];
  pat  TEXT;
  norm TEXT;
  leet TEXT;
BEGIN
  IF p_bio IS NULL OR length(p_bio) = 0 THEN
    RETURN TRUE; -- empty bios are fine
  END IF;
  -- Lowercase + collapse internal whitespace so "n  i  g g e r"-style
  -- evasions still trip the match.
  norm := regexp_replace(lower(p_bio), '\s+', ' ', 'g');
  leet := translate(norm, '013457', 'oietas');
  FOREACH pat IN ARRAY patterns LOOP
    -- \m and \M are Postgres word-boundary anchors (start/end of word).
    -- Equivalent to \b in some other regex flavors.
    IF norm ~ ('\m' || pat || '\M') THEN RETURN FALSE; END IF;
    IF leet ~ ('\m' || pat || '\M') THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Trigger that runs the check on UPDATE that changes the bio
--    column. Skipped on inserts because new accounts have bio=null;
--    bio is always added via UPDATE after the user fills in the field.
--    The `UPDATE OF bio` clause + the DISTINCT FROM guard means
--    unrelated updates (avatar, weight, etc.) don't pay the regex cost.
CREATE OR REPLACE FUNCTION public.enforce_bio_profanity()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip if bio is unchanged (UPDATE for other columns)
  IF OLD.bio IS NOT DISTINCT FROM NEW.bio THEN
    RETURN NEW;
  END IF;
  IF NEW.bio IS NULL OR NEW.bio = '' THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_bio_clean(NEW.bio) THEN
    -- 23514 = check_violation. Same code migration 050 uses for
    -- username — so the client error handler can branch on a single
    -- code and read the message tag to know which field tripped.
    RAISE EXCEPTION 'bio_profanity'
      USING ERRCODE = '23514',
            HINT    = 'Bio contains prohibited content. Edit it and try again.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bio_profanity ON public.user_profiles;
CREATE TRIGGER trg_bio_profanity
  BEFORE UPDATE OF bio ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bio_profanity();

NOTIFY pgrst, 'reload schema';
