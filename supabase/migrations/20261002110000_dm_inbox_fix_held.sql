-- Placeholder, intentionally empty.
--
-- This version was briefly on the release branch as the DM inbox preview
-- fix (bump_my_conversation), and the PR's preview database applied it.
-- The fix was then taken off the branch to wait for Kegan's OK. A preview
-- database that has recorded a version with no matching local file fails
-- with "Remote migration versions not found", so the version keeps a no-op
-- file. If the fix is approved, its SQL replaces this body (this file has
-- never merged, so editing it is safe).
SELECT 1;
