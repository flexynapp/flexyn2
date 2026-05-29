-- 165_journal_mood_score.sql
--
-- Adds a mood_score column to journal_entries so tapping a mood emoji on
-- the dashboard automatically tags that day's journal entry. The column
-- is nullable: entries written before this migration (or entries where the
-- user never logged a mood) simply have NULL.
--
-- Score range mirrors MoodLogCard: 1 (😩) – 5 (🔥).

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS mood_score smallint
    CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 5));

-- Expose the new column to the service role (auto-granted by the
-- ALTER DEFAULT PRIVILEGES set in migration 085, but explicit grant
-- here keeps the migration self-contained for replay scenarios).
GRANT SELECT, INSERT, UPDATE ON journal_entries TO service_role;
