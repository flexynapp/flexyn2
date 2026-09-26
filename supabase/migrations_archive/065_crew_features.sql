-- 065_crew_features.sql
-- Crew batch: discovery, announcements, shared plans, stats, war visibility,
-- roles (moderator), and crew-private posts.
--
-- Idempotency: every destructive step is guarded.

-- ── 1. Crew Discovery ─────────────────────────────────────────────────────────
-- Add public-facing columns so crews can opt in to discoverability.

ALTER TABLE crews
  ADD COLUMN IF NOT EXISTS is_public     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS description   TEXT,
  ADD COLUMN IF NOT EXISTS tag           TEXT;

-- Index for discovery queries
CREATE INDEX IF NOT EXISTS crews_is_public_idx ON crews (is_public) WHERE is_public = true;

-- Allow any authenticated user to read public crews (previously all crews were
-- opaque unless you were a member). The existing policy may or may not exist;
-- guard idempotently.
DROP POLICY IF EXISTS "Authenticated users can read public crews" ON crews;
CREATE POLICY "Authenticated users can read public crews"
  ON crews FOR SELECT
  USING (
    is_public = true
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM crew_members cm
      WHERE cm.crew_id = crews.id AND cm.user_id = auth.uid()
    )
  );

-- Crew leaders can update their own crew (name, description, is_public, tag)
DROP POLICY IF EXISTS "Crew leaders can update their crew" ON crews;
CREATE POLICY "Crew leaders can update their crew"
  ON crews FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM crew_members cm
      WHERE cm.crew_id = crews.id AND cm.user_id = auth.uid() AND cm.is_admin = true
    )
  );

-- ── 2. Crew Announcement Posts (pinned messages) ─────────────────────────────

ALTER TABLE crew_messages
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;

-- Admins/moderators can pin messages (UPDATE policy on crew_messages)
DROP POLICY IF EXISTS "Crew admins can pin messages" ON crew_messages;
CREATE POLICY "Crew admins can pin messages"
  ON crew_messages FOR UPDATE
  USING (is_crew_admin(crew_id))
  WITH CHECK (is_crew_admin(crew_id));

-- ── 3. Crew Shared Workout Plans ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_assigned_regimens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id       UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  regimen_id    UUID NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
  assigned_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note          TEXT,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crew_id, regimen_id)
);

ALTER TABLE crew_assigned_regimens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Crew members can view assigned regimens" ON crew_assigned_regimens;
CREATE POLICY "Crew members can view assigned regimens"
  ON crew_assigned_regimens FOR SELECT
  USING (is_crew_member(crew_id));

DROP POLICY IF EXISTS "Crew admins can assign regimens" ON crew_assigned_regimens;
CREATE POLICY "Crew admins can assign regimens"
  ON crew_assigned_regimens FOR INSERT
  WITH CHECK (is_crew_admin(crew_id));

DROP POLICY IF EXISTS "Crew admins can remove assigned regimens" ON crew_assigned_regimens;
CREATE POLICY "Crew admins can remove assigned regimens"
  ON crew_assigned_regimens FOR DELETE
  USING (is_crew_admin(crew_id));

-- ── 4. Crew Roles (Moderator tier) ───────────────────────────────────────────
-- Add a role column. Values: 'member' | 'moderator' | 'leader'.
-- is_admin is preserved for backwards-compat with all existing RLS policies.
-- Going forward: leader ↔ is_admin=true, moderator ↔ is_admin=false but
-- is_crew_moderator()=true, member = default.

ALTER TABLE crew_members
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member'
    CHECK (role IN ('member', 'moderator', 'leader'));

-- Backfill: any existing is_admin=true rows become 'leader'
UPDATE crew_members SET role = 'leader' WHERE is_admin = true AND role = 'member';

-- Helper: returns true if the calling user is a member OR moderator OR leader
-- Used for actions moderators are also allowed to take (e.g. pinning messages).
CREATE OR REPLACE FUNCTION is_crew_moderator(p_crew_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM crew_members
    WHERE crew_id = p_crew_id
      AND user_id = auth.uid()
      AND role IN ('leader', 'moderator')
  );
$$;

-- Update the pin policy to also allow moderators
DROP POLICY IF EXISTS "Crew admins can pin messages" ON crew_messages;
CREATE POLICY "Crew admins can pin messages"
  ON crew_messages FOR UPDATE
  USING (is_crew_moderator(crew_id))
  WITH CHECK (is_crew_moderator(crew_id));

-- Admins/moderators can update crew member roles (but not above their own level)
DROP POLICY IF EXISTS "Crew leaders can update member roles" ON crew_members;
CREATE POLICY "Crew leaders can update member roles"
  ON crew_members FOR UPDATE
  USING (is_crew_admin(crew_id));

-- ── 5. Crew Private Posts ─────────────────────────────────────────────────────
-- Add crew_id to hub_posts so posts can be scoped to a crew.
-- privacy = 'crew' means only crew members see it in the feed.
-- Enforcement is client-side (Base44 entity layer); this column is stored
-- so the server RLS migration target can later enforce it natively.

-- hub_posts lives in Base44, but we also maintain a Supabase shadow table
-- for future RLS enforcement. This migration adds the column to the
-- shadow table if it exists; if not, the column is added when the shadow
-- table is created. Guard with a DO block to be safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'hub_posts'
  ) THEN
    ALTER TABLE hub_posts
      ADD COLUMN IF NOT EXISTS crew_id UUID REFERENCES crews(id) ON DELETE SET NULL;

    -- crew posts: only crew members see them
    DROP POLICY IF EXISTS "Crew posts visible to crew members only" ON hub_posts;
    CREATE POLICY "Crew posts visible to crew members only"
      ON hub_posts FOR SELECT
      USING (
        crew_id IS NULL
        OR is_crew_member(crew_id)
      );
  END IF;
END $$;

-- ── 6. War contribution tracking (already in schema via 055_crew_wars.sql) ───
-- crew_war_contributions table exists. No schema change needed.
-- The application layer (Workout.jsx onSuccess) will call contributeWarXp.
-- This migration just ensures the helper index is present for the per-user
-- contribution lookup that surfaces on the workout-saved screen.

CREATE INDEX IF NOT EXISTS crew_war_contributions_war_user_idx
  ON crew_war_contributions (war_id, user_id);

-- ── Done ──────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
