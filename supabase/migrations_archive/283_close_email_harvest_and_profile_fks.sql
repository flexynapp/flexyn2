-- 280_close_email_harvest_and_profile_fks.sql
--
-- Two unrelated defects from the 2026-08-04 review batch, bundled because
-- both are one-paste fixes and neither can wait for the other.
--
-- ── Part 1: resolve_profile_email is an unauthenticated email harvester ──
--
-- public.resolve_profile_email is SECURITY DEFINER, takes a username, and
-- returns that user's email address. It has no auth gate and anon holds
-- EXECUTE, so anyone with the anon key — which is baked into the production
-- JS bundle and is therefore public — can convert any username into an email
-- address over plain HTTP. Usernames are public by design: they are the
-- /@username URL, they are on the Hub, they are on every leaderboard. So the
-- whole user table is harvestable at one request per row.
--
-- RLS on user_profiles is correct and is NOT the hole — a direct
--   GET /rest/v1/user_profiles?select=email
-- as anon returns []. The function is the hole, because SECURITY DEFINER
-- runs it as the owner and bypasses that policy.
--
-- This was a documented decision, not an oversight. Migration 213 swept anon
-- EXECUTE off ~190 SECURITY DEFINER functions and deliberately excluded this
-- one, on the reasoning that it "returns email to anon one row at a time" and
-- that its removal was bound to the tracked email-off-public_profiles
-- refactor. Both halves have expired: one row at a time is not a mitigation
-- when the input is a public enumerable identifier — it is a loop — and the
-- refactor it was waiting on landed in migration 220, which dropped email
-- from the public_profiles view. The condition justifying the exception is
-- gone; the exception stayed.
--
-- All three client call sites run authenticated (HubProfile.jsx:458,
-- hubMessages.js:111, and the duels.js path), so nothing in the app breaks.
-- Verified against production that the function appears in no RLS policy and
-- in no other function body, so nothing server-side breaks either.
--
-- ── Part 2: four PostgREST embeds that can never resolve ──
--
-- listLeagueMembers and listGymMembers both 400 with PGRST200 on every call,
-- for every user, and have therefore never returned a row. Same for the two
-- gym-feed embeds, which fail silently into their fallback path.
--
-- The published review said these tables have "no user_id FK". That is not
-- what is wrong. They each DO have one — it points at auth.users(id):
--
--   league_members_user_id_fkey     user_id   -> auth.users(id)
--   gym_members_user_id_fkey        user_id   -> auth.users(id)
--   gym_feed_posts_author_id_fkey   author_id -> auth.users(id)
--   gym_feed_comments_author_id_fkey author_id -> auth.users(id)
--
-- PostgREST only embeds across relationships inside the schemas it exposes,
-- and auth is not one of them, so `user:user_profiles!user_id(...)` has no
-- resolvable path even though a foreign key on that exact column exists.
--
-- The consequence is that adding a constraint named *_user_id_fkey — as the
-- review's SQL did — fails with 42710 (already exists). These use distinct
-- names and coexist with the auth.users constraints rather than replacing
-- them. user_profiles.id is itself keyed to auth.users(id), so the two FKs on
-- each column agree by construction and neither is redundant: the auth one is
-- the identity anchor, the profile one is what PostgREST traverses.
--
-- The two gym_feed embeds were not in the review. They matter for a reason
-- beyond a blank list: both were added by Audit 12 (#42/#43) specifically to
-- stop the gym feed rendering the email local-part as a display name, after a
-- corporate user signing up as "j.smith.cfo@acme.com" had that handle posted
-- on every gym feed. The embed has never worked, so the fallback path — which
-- renders author_email — has been the live path the whole time. That leak is
-- latent today only because both tables currently hold zero rows.
--
-- Verified against production before writing: zero orphan rows and zero NULLs
-- in all four columns, so every constraint validates without a backfill.
--
-- ── Deliberately NOT in this migration ────────────────────────────────────
--
-- The review also proposed revoking anon EXECUTE on is_blocked and
-- is_crew_admin, and flipping public.public_profiles to security_invoker.
-- All three are regressions here, verified against production:
--
--   * is_blocked is called inside the SELECT policies on hub_posts and
--     hub_comments, and is_crew_admin inside ~13 crew policies. A policy
--     helper is executed as the *querying* role, so revoking anon EXECUTE
--     turns an anon read of hub_posts from "filtered rows" into "permission
--     denied for function". anon holds SELECT on hub_posts (public /@username
--     profile pages depend on it), so this would break those pages outright.
--     The review's own probe already found neither function is routable over
--     PostgREST (PGRST202), so the direct exposure it was closing is not
--     reachable in the first place.
--
--   * public_profiles is SECURITY DEFINER on purpose. RLS on user_profiles
--     permits reading only your OWN row, so the definer view IS the mechanism
--     by which anyone sees anyone else's profile. security_invoker = on would
--     reduce Hub, every leaderboard and every profile page to the viewer's own
--     row. The advisor lint is a true positive in general and a false positive
--     here; the view exposes a reviewed column subset and, since migration
--     220, no email.
--
-- Idempotent. Safe to re-run.

-- ── Part 1 ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_profile_email(
  p_id       uuid DEFAULT NULL,
  p_username text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
BEGIN
  -- The gate this function never had. Every legitimate caller is a
  -- signed-in user resolving a DM or duel counterparty.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'resolve_profile_email requires authentication'
      USING ERRCODE = '42501';
  END IF;

  SELECT email INTO v_email
    FROM public.user_profiles
   WHERE (p_id IS NOT NULL AND id = p_id)
      OR (p_username IS NOT NULL AND username = p_username)
   LIMIT 1;

  RETURN v_email;
END;
$function$;

-- CREATE OR REPLACE preserves existing grants, so the revoke has to follow
-- the redefinition rather than precede it.
REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.resolve_profile_email(uuid, text) TO authenticated;

-- ── Part 2 ────────────────────────────────────────────────────────────────

ALTER TABLE public.league_members
  DROP CONSTRAINT IF EXISTS league_members_user_profile_fkey;
ALTER TABLE public.league_members
  ADD  CONSTRAINT league_members_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gym_members
  DROP CONSTRAINT IF EXISTS gym_members_user_profile_fkey;
ALTER TABLE public.gym_members
  ADD  CONSTRAINT gym_members_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gym_feed_posts
  DROP CONSTRAINT IF EXISTS gym_feed_posts_author_profile_fkey;
ALTER TABLE public.gym_feed_posts
  ADD  CONSTRAINT gym_feed_posts_author_profile_fkey
  FOREIGN KEY (author_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gym_feed_comments
  DROP CONSTRAINT IF EXISTS gym_feed_comments_author_profile_fkey;
ALTER TABLE public.gym_feed_comments
  ADD  CONSTRAINT gym_feed_comments_author_profile_fkey
  FOREIGN KEY (author_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- PostgREST will not expose a new relationship until its schema cache
-- reloads. Without this the four embeds keep returning PGRST200 until the
-- next unrelated reload, which reads as "the migration did nothing".
NOTIFY pgrst, 'reload schema';
