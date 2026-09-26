-- 269_gym_owner_and_demo_dedupe.sql
--
-- Two production data fixes, both found while auditing the equipment
-- picker's owner-curation path.
--
-- ── What is NOT being fixed here, and why ────────────────────────────
--
-- `gym_businesses.owner_id` stays NULLABLE. Migration 137 dropped the
-- NOT NULL deliberately so seeded `Demo:` gyms could exist without an
-- auth.users row behind them, and real gyms still get a real owner from
-- approve_gym_verification. Demo rows are NOT backfilled with an owner:
-- granting a real user edit rights over fake data is worse than leaving
-- them ownerless.
--
-- ── 1. Camp Quannapowitt has no owner ────────────────────────────────
--
-- The only non-demo gym on the platform. No verification_id, so it was
-- hand-inserted during development rather than created through the
-- approval RPC — which is why it skipped the owner assignment that RPC
-- does. One member, who joined 96 seconds after the row was created.
-- Nobody can currently edit it, and (post-mig-268) its equipment can
-- never be owner-confirmed. Assigned to that member.
--
-- ── 2. The demo seed ran twice ───────────────────────────────────────
--
-- An earlier seed landed 2026-05-24 20:31 with `*FLX*` flexyn_codes;
-- migration 137 landed 2026-05-25 00:39 with `*DEMO` codes. 137's
-- `ON CONFLICT (flexyn_code) DO NOTHING` guard could not dedupe them
-- because the codes differ, so all 25 demo gyms exist twice and the
-- national map renders 50 pins for 25 gyms.
--
-- We keep the `*DEMO` set, because those are the codes hardcoded in
-- migration 137 — so a future re-run of 137 stays a genuine no-op.
--
-- CRITICALLY: the doomed copies are not inert. Real user content sits
-- on them (a membership and a gym event with an RSVP, both from the
-- same user), and every child FK is ON DELETE CASCADE — so a naive
-- DELETE would silently destroy them. Everything is repointed to the
-- surviving same-named gym FIRST. The repointing is written generically
-- rather than against the two known rows, so it stays correct if more
-- content lands before this is applied.
--
-- Idempotent: re-running after the old rows are gone matches nothing.

-- ── Mapping: each doomed demo row → its surviving twin ───────────────
-- Materialized into a temp table so every statement below shares one
-- consistent view of the pairing.
CREATE TEMP TABLE demo_dupe_map ON COMMIT DROP AS
SELECT doomed.id AS doomed_id, keeper.id AS keeper_id
  FROM public.gym_businesses AS doomed
  JOIN public.gym_businesses AS keeper
    ON keeper.name = doomed.name
   AND keeper.flexyn_code LIKE '%DEMO'
 WHERE doomed.name LIKE 'Demo:%'
   AND doomed.flexyn_code NOT LIKE '%DEMO';

-- ── 1. Owner for the one real orphan ────────────────────────────────
-- Resolved from its own membership rather than a hardcoded UUID, so
-- this is safe to run against any environment.
UPDATE public.gym_businesses
   SET owner_id = (
         SELECT user_id FROM public.gym_members
          WHERE gym_id = public.gym_businesses.id
          ORDER BY joined_at
          LIMIT 1
       ),
       updated_at = now()
 WHERE flexyn_code = 'WKF2QPWT'
   AND owner_id IS NULL
   AND EXISTS (SELECT 1 FROM public.gym_members
                WHERE gym_id = public.gym_businesses.id);

-- ── 2a. Move user content off the doomed copies ─────────────────────
-- Memberships. The UNIQUE (gym_id, user_id) means a user already in the
-- keeper would collide, so those are dropped instead of moved.
DELETE FROM public.gym_members
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map)
   AND EXISTS (
     SELECT 1 FROM public.gym_members AS existing
      JOIN demo_dupe_map ON demo_dupe_map.keeper_id = existing.gym_id
     WHERE existing.user_id = public.gym_members.user_id
       AND demo_dupe_map.doomed_id = public.gym_members.gym_id
   );

UPDATE public.gym_members
   SET gym_id = (SELECT keeper_id FROM demo_dupe_map
                  WHERE doomed_id = public.gym_members.gym_id)
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map);

-- Events (RSVPs hang off event_id, so they follow automatically).
UPDATE public.gym_events
   SET gym_id = (SELECT keeper_id FROM demo_dupe_map
                  WHERE doomed_id = public.gym_events.gym_id)
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map);

-- Feed posts (comments + reactions hang off post_id).
UPDATE public.gym_feed_posts
   SET gym_id = (SELECT keeper_id FROM demo_dupe_map
                  WHERE doomed_id = public.gym_feed_posts.gym_id)
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map);

-- Check-ins. UNIQUE (user_id, gym_id, checkin_date) can collide the
-- same way memberships can, so drop colliders before moving.
DELETE FROM public.gym_checkins
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map)
   AND EXISTS (
     SELECT 1 FROM public.gym_checkins AS existing
      JOIN demo_dupe_map ON demo_dupe_map.keeper_id = existing.gym_id
     WHERE existing.user_id = public.gym_checkins.user_id
       AND existing.checkin_date = public.gym_checkins.checkin_date
       AND demo_dupe_map.doomed_id = public.gym_checkins.gym_id
   );

UPDATE public.gym_checkins
   SET gym_id = (SELECT keeper_id FROM demo_dupe_map
                  WHERE doomed_id = public.gym_checkins.gym_id)
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map);

-- Training spaces from migration 268, for completeness. None exist yet,
-- but the picker creates them lazily and this migration should stay
-- correct whenever it actually runs.
DELETE FROM public.training_spaces
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map)
   AND EXISTS (
     SELECT 1 FROM public.training_spaces AS existing
      JOIN demo_dupe_map ON demo_dupe_map.keeper_id = existing.gym_id
     WHERE existing.owner_id = public.training_spaces.owner_id
       AND demo_dupe_map.doomed_id = public.training_spaces.gym_id
   );

UPDATE public.training_spaces
   SET gym_id = (SELECT keeper_id FROM demo_dupe_map
                  WHERE doomed_id = public.training_spaces.gym_id)
 WHERE gym_id IN (SELECT doomed_id FROM demo_dupe_map);

-- ── 2b. Drop the duplicate rows ─────────────────────────────────────
DELETE FROM public.gym_businesses
 WHERE id IN (SELECT doomed_id FROM demo_dupe_map);

-- NOTE on member_count: the demo rows carry decorative seeded counts
-- (47, 34, 82 …) chosen so they don't all sort last on the leaderboard.
-- Those are deliberately NOT resynced here — recomputing them would set
-- every demo gym to its real membership count of 0-1 and make the map
-- look dead, which is the exact thing migration 137 existed to avoid.
