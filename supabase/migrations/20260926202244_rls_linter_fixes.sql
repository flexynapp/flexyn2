-- RLS linter fixes: signed-out reads, redundant policies, overlapping owner policies.
--
-- Three changes, none of which alters what a signed-in user (including a
-- guest) can read or write. Proven on seeded data before and after: the set
-- of visible row ids per viewer is identical for two email accounts and one
-- guest on all 20 tables, and every owner write still succeeds while writes
-- to someone else's row still fail.
--
-- 1. Signed-out (anon key, no session) reads are closed.
--    These policies were TO public, so anyone holding the anon key, which
--    ships in the web bundle, could read who liked which comment, every
--    sticker reaction, every live session, every unexpired status note and
--    its likes, every story highlight, every public workout template and
--    every verified food item, without signing in. The app never reads any
--    of these signed out: the signed-out pages (public profile, duel invite,
--    gym landing, check-in) go through RPCs. Guests are unaffected because an
--    anonymous sign-in carries the authenticated role.
--    The owner policies move too. auth.uid() is NULL for anon so they never
--    matched, but they called current_user_email(), which is how a TO public
--    policy ends up depending on whether anon holds EXECUTE on a helper (see
--    the food_items note in CLAUDE.md: scope BOTH policies on a table in the
--    same migration, or the throwing one stops masking the permissive one).
--    ALTER POLICY ... TO changes the role without restating the expression.
--
-- 2. Five SELECT policies that duplicate an ALL policy with the same (or a
--    wider) expression are dropped. Each is fully covered by the owner
--    policy on the same table, so they cost an extra evaluation per row and
--    decided nothing.
--
-- 3. On seven tables an owner ALL policy overlapped a SELECT policy of
--    USING (true). For reads the owner branch can never add a row, so the
--    ALL policy is replaced by INSERT, UPDATE and DELETE policies with the
--    same expressions. Where the old ALL policy had no WITH CHECK, Postgres
--    used its USING expression as the check, so the new INSERT and UPDATE
--    policies state it explicitly.
--    hub_comment_likes restates its WITH CHECK with NULLIF(..., '') where
--    the installed one reads NULLIF(..., ''''), a single-quote character, an
--    artefact of the old clipboard paste. Both return the viewer's email for
--    every real email, so behaviour is unchanged.
--
-- Deliberately NOT changed, and still reported by the performance linter as
-- multiple permissive policies: food_items, regimens, workout_templates,
-- nutrition_recipes, gym_rival_assignments, gym_events, hub_comments,
-- hub_follows, hub_posts and status_notes. On those tables the two policies
-- genuinely OR together (your own private rows plus other people's public
-- ones), so merging them means restating both expressions as one, for a
-- speed-up nobody will measure at this table size.

BEGIN;

-- 1. Signed-in only ---------------------------------------------------------

ALTER POLICY "food_items: owner full access"                ON public.food_items             TO authenticated;
ALTER POLICY "food_items: verified items readable by all"   ON public.food_items             TO authenticated;
ALTER POLICY "gym_rival_rival_read"                          ON public.gym_rival_assignments  TO authenticated;
ALTER POLICY "nemesis_own"                                   ON public.gym_rival_assignments  TO authenticated;
ALTER POLICY "hub_comment_likes: public read"                ON public.hub_comment_likes      TO authenticated;
ALTER POLICY "hub_comments: owner write"                     ON public.hub_comments           TO authenticated;
ALTER POLICY "hub_follows: owner write"                      ON public.hub_follows            TO authenticated;
ALTER POLICY "hub_live_sessions_read"                        ON public.hub_live_sessions      TO authenticated;
ALTER POLICY "hub_posts: owner write"                        ON public.hub_posts              TO authenticated;
ALTER POLICY "hub_reactions: owner write"                    ON public.hub_reactions          TO authenticated;
ALTER POLICY "Anyone can read reactions"                     ON public.post_sticker_reactions TO authenticated;
ALTER POLICY "regimens: owner full access"                   ON public.regimens               TO authenticated;
ALTER POLICY "status_note_likes_select"                      ON public.status_note_likes      TO authenticated;
ALTER POLICY "status_notes_manage"                           ON public.status_notes           TO authenticated;
ALTER POLICY "status_notes_select"                           ON public.status_notes           TO authenticated;
ALTER POLICY "story_highlight_items: read all"               ON public.story_highlight_items  TO authenticated;
ALTER POLICY "story_highlights: read all"                    ON public.story_highlights       TO authenticated;
ALTER POLICY "story_reactions: own write"                    ON public.story_reactions        TO authenticated;
ALTER POLICY "weekly_debriefs_own"                           ON public.weekly_debriefs        TO authenticated;
ALTER POLICY "workout_templates: owner full access"          ON public.workout_templates      TO authenticated;
ALTER POLICY "workout_templates: public templates readable" ON public.workout_templates      TO authenticated;

-- 2. Redundant SELECT policies ----------------------------------------------

-- Same expression as "hub_reactions: owner write".
DROP POLICY IF EXISTS "hub_reactions: owner read"      ON public.hub_reactions;
-- Same expression as "meal_plans: owner write".
DROP POLICY IF EXISTS "meal_plans: owner read"         ON public.meal_plans;
-- Same expression as "nutrition_recipes: owner write".
DROP POLICY IF EXISTS "nutrition_recipes: owner read"  ON public.nutrition_recipes;
-- Same expression as "story_reactions: own write".
DROP POLICY IF EXISTS "story_reactions: own read"      ON public.story_reactions;
-- Reads (auth.uid() = user_id) OR (auth.uid() = user_id); weekly_debriefs_own
-- already grants exactly that.
DROP POLICY IF EXISTS "weekly_debriefs_select_merged"  ON public.weekly_debriefs;

-- 3. Owner ALL policies split where reads are already open to everyone ------

-- hub_comment_likes
DROP POLICY IF EXISTS "hub_comment_likes: owner write"  ON public.hub_comment_likes;
DROP POLICY IF EXISTS "hub_comment_likes: owner insert" ON public.hub_comment_likes;
DROP POLICY IF EXISTS "hub_comment_likes: owner update" ON public.hub_comment_likes;
DROP POLICY IF EXISTS "hub_comment_likes: owner delete" ON public.hub_comment_likes;
CREATE POLICY "hub_comment_likes: owner insert" ON public.hub_comment_likes
  FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = (SELECT NULLIF(public.current_user_email(), '')))
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND (created_by IS NOT NULL OR user_id IS NOT NULL));
CREATE POLICY "hub_comment_likes: owner update" ON public.hub_comment_likes
  FOR UPDATE TO authenticated
  USING (created_by = (SELECT NULLIF(public.current_user_email(), '')) OR user_id = (SELECT auth.uid()))
  WITH CHECK (
    (created_by IS NULL OR created_by = (SELECT NULLIF(public.current_user_email(), '')))
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
    AND (created_by IS NOT NULL OR user_id IS NOT NULL));
CREATE POLICY "hub_comment_likes: owner delete" ON public.hub_comment_likes
  FOR DELETE TO authenticated
  USING (created_by = (SELECT NULLIF(public.current_user_email(), '')) OR user_id = (SELECT auth.uid()));

-- hub_live_sessions
DROP POLICY IF EXISTS "hub_live_sessions_host_write"  ON public.hub_live_sessions;
DROP POLICY IF EXISTS "hub_live_sessions_host_insert" ON public.hub_live_sessions;
DROP POLICY IF EXISTS "hub_live_sessions_host_update" ON public.hub_live_sessions;
DROP POLICY IF EXISTS "hub_live_sessions_host_delete" ON public.hub_live_sessions;
CREATE POLICY "hub_live_sessions_host_insert" ON public.hub_live_sessions
  FOR INSERT TO authenticated
  WITH CHECK (host_email = (SELECT up.email FROM public.user_profiles up WHERE up.id = (SELECT auth.uid())));
CREATE POLICY "hub_live_sessions_host_update" ON public.hub_live_sessions
  FOR UPDATE TO authenticated
  USING (host_email = (SELECT up.email FROM public.user_profiles up WHERE up.id = (SELECT auth.uid())))
  WITH CHECK (host_email = (SELECT up.email FROM public.user_profiles up WHERE up.id = (SELECT auth.uid())));
CREATE POLICY "hub_live_sessions_host_delete" ON public.hub_live_sessions
  FOR DELETE TO authenticated
  USING (host_email = (SELECT up.email FROM public.user_profiles up WHERE up.id = (SELECT auth.uid())));

-- post_sticker_reactions
DROP POLICY IF EXISTS "Users manage own reactions"         ON public.post_sticker_reactions;
DROP POLICY IF EXISTS "post_sticker_reactions: own insert" ON public.post_sticker_reactions;
DROP POLICY IF EXISTS "post_sticker_reactions: own update" ON public.post_sticker_reactions;
DROP POLICY IF EXISTS "post_sticker_reactions: own delete" ON public.post_sticker_reactions;
CREATE POLICY "post_sticker_reactions: own insert" ON public.post_sticker_reactions
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "post_sticker_reactions: own update" ON public.post_sticker_reactions
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "post_sticker_reactions: own delete" ON public.post_sticker_reactions
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- status_note_likes
DROP POLICY IF EXISTS "status_note_likes_manage" ON public.status_note_likes;
DROP POLICY IF EXISTS "status_note_likes_insert" ON public.status_note_likes;
DROP POLICY IF EXISTS "status_note_likes_update" ON public.status_note_likes;
DROP POLICY IF EXISTS "status_note_likes_delete" ON public.status_note_likes;
CREATE POLICY "status_note_likes_insert" ON public.status_note_likes
  FOR INSERT TO authenticated WITH CHECK (liker_id = (SELECT auth.uid()));
CREATE POLICY "status_note_likes_update" ON public.status_note_likes
  FOR UPDATE TO authenticated USING (liker_id = (SELECT auth.uid())) WITH CHECK (liker_id = (SELECT auth.uid()));
CREATE POLICY "status_note_likes_delete" ON public.status_note_likes
  FOR DELETE TO authenticated USING (liker_id = (SELECT auth.uid()));

-- story_highlight_items
DROP POLICY IF EXISTS "story_highlight_items: owner write"  ON public.story_highlight_items;
DROP POLICY IF EXISTS "story_highlight_items: owner insert" ON public.story_highlight_items;
DROP POLICY IF EXISTS "story_highlight_items: owner update" ON public.story_highlight_items;
DROP POLICY IF EXISTS "story_highlight_items: owner delete" ON public.story_highlight_items;
CREATE POLICY "story_highlight_items: owner insert" ON public.story_highlight_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.story_highlights sh
                     WHERE sh.id = story_highlight_items.highlight_id AND sh.user_id = (SELECT auth.uid())));
CREATE POLICY "story_highlight_items: owner update" ON public.story_highlight_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.story_highlights sh
                     WHERE sh.id = story_highlight_items.highlight_id AND sh.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.story_highlights sh
                     WHERE sh.id = story_highlight_items.highlight_id AND sh.user_id = (SELECT auth.uid())));
CREATE POLICY "story_highlight_items: owner delete" ON public.story_highlight_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.story_highlights sh
                     WHERE sh.id = story_highlight_items.highlight_id AND sh.user_id = (SELECT auth.uid())));

-- story_highlights
DROP POLICY IF EXISTS "story_highlights: own write"  ON public.story_highlights;
DROP POLICY IF EXISTS "story_highlights: own insert" ON public.story_highlights;
DROP POLICY IF EXISTS "story_highlights: own update" ON public.story_highlights;
DROP POLICY IF EXISTS "story_highlights: own delete" ON public.story_highlights;
CREATE POLICY "story_highlights: own insert" ON public.story_highlights
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "story_highlights: own update" ON public.story_highlights
  FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "story_highlights: own delete" ON public.story_highlights
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- marketplace_bundles (already authenticated-only)
DROP POLICY IF EXISTS "bundles: seller manage" ON public.marketplace_bundles;
DROP POLICY IF EXISTS "bundles: seller insert" ON public.marketplace_bundles;
DROP POLICY IF EXISTS "bundles: seller update" ON public.marketplace_bundles;
DROP POLICY IF EXISTS "bundles: seller delete" ON public.marketplace_bundles;
CREATE POLICY "bundles: seller insert" ON public.marketplace_bundles
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = seller_user_id);
CREATE POLICY "bundles: seller update" ON public.marketplace_bundles
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = seller_user_id) WITH CHECK ((SELECT auth.uid()) = seller_user_id);
CREATE POLICY "bundles: seller delete" ON public.marketplace_bundles
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = seller_user_id);

COMMIT;
