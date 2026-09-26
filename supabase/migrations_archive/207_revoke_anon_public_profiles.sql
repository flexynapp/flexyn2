-- 207_revoke_anon_public_profiles.sql
--
-- RUN THIS ONLY AFTER the PublicProfile.jsx change (migration 206 companion)
-- has deployed to production via Netlify. PublicProfile was the sole anon
-- reader of the public_profiles view; once it reads through
-- get_public_profile_by_username instead, no anon code path needs the view,
-- so revoking anon SELECT closes anonymous email harvesting through it.
--
-- The base user_profiles table is unaffected — its RLS already restricts
-- SELECT to the caller's own row (auth.uid() = id), so anon can read nothing
-- there directly. Authenticated users retain view access (the app's
-- cross-user profile reads still depend on it); removing email from the view
-- for them is a separate, larger client refactor.

REVOKE SELECT ON public.public_profiles FROM anon;
