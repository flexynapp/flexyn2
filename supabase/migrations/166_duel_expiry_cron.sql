-- 166_duel_expiry_cron.sql
--
-- Adds a pg_cron job that automatically flips overdue duels to 'expired'
-- so the UI never shows a stale pending/active card after the deadline passes.
--
-- Previously: the Workout page's getActiveDuel() filtered by expires_at >
-- now, so it HIDES expired rows from the banner, but the Duels page still
-- showed them with status='active'. This cron makes the DB status ground-
-- truth — once expired, the row surfaces correctly as expired everywhere.
--
-- Cron: every 15 minutes. Safe to run more often; the WHERE guard is tight.
-- Affects BOTH pending (invite never accepted) and active (accepted but
-- deadline passed without both results submitted).

SELECT cron.schedule(
  'expire-overdue-duels',
  '*/15 * * * *',
  $$
    UPDATE duels
    SET    status = 'expired'
    WHERE  status IN ('pending', 'active')
      AND  expires_at IS NOT NULL
      AND  expires_at < NOW();
  $$
);
