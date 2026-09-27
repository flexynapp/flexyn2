-- Point the weekly review cron at the renamed Edge Function.
--
-- generateWeeklyDebriefs is now generate-weekly-debriefs. The camelCase name
-- could never be deployed by the Supabase GitHub integration: the CLI
-- lowercases every config.toml key, so it looked for a folder that did not
-- exist. It had to be deployed by hand, which is how a security fix to it
-- (2026-09-27 audit: an unverified service_role claim was accepted as
-- authorisation) would otherwise never have reached production.
--
-- kick_weekly_reviews() reads the URL from the Vault entry debrief_func_url
-- on every run, so repointing that entry is the whole change. Only the path
-- segment is rewritten; the host is left exactly as it was.
--
-- On a fresh database (local, preview branches) the Vault entry does not
-- exist and this is a no-op.

DO $$
DECLARE
  v_id  uuid;
  v_url text;
BEGIN
  SELECT id, decrypted_secret INTO v_id, v_url
    FROM vault.decrypted_secrets
   WHERE name = 'debrief_func_url'
   LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE 'debrief_func_url not in the Vault; nothing to repoint';
    RETURN;
  END IF;

  IF v_url LIKE '%/generateWeeklyDebriefs' THEN
    PERFORM vault.update_secret(
      v_id,
      regexp_replace(v_url, '/generateWeeklyDebriefs$', '/generate-weekly-debriefs')
    );
  END IF;

  -- Assert the result rather than trusting the update: the cron's failure
  -- mode is a silent 404 every Sunday, which is how the previous incarnation
  -- of this job went unnoticed for ten weeks.
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE id = v_id;
  IF v_url NOT LIKE '%/generate-weekly-debriefs' THEN
    RAISE EXCEPTION 'debrief_func_url does not end in /generate-weekly-debriefs after the update';
  END IF;
END
$$;
