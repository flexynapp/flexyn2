-- 232_story_reports.sql
--
-- Stories are now reportable from the story viewer (a Flag button in the
-- viewer's top bar), so hub_reports.reported_type must accept 'story'
-- alongside the existing 'post' / 'comment'.
--
-- Migration 007 created the column with CHECK (reported_type IN
-- ('post','comment')); a story report would fail that check with 23514.
-- Drop and re-add the constraint with the wider set. Idempotent: the DROP
-- is IF EXISTS and the ADD is guarded, so re-running is safe.
--
-- Note for moderation: the moderator view from migration 103 resolves the
-- reported content with a CASE on reported_type and has no 'story' branch,
-- so story reports land in the queue with a null content preview until that
-- view is extended. The report row itself (reporter, target, reason) is
-- captured correctly, which is what the queue needs to act on.

ALTER TABLE public.hub_reports
  DROP CONSTRAINT IF EXISTS hub_reports_reported_type_check;

ALTER TABLE public.hub_reports
  ADD CONSTRAINT hub_reports_reported_type_check
  CHECK (reported_type IN ('post', 'comment', 'story'));

NOTIFY pgrst, 'reload schema';
