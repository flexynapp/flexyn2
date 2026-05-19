-- 048_crews.sql
-- Crews: group chat ecosystem with interactive message types

-- 1. Crews master table
CREATE TABLE IF NOT EXISTS crews (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  max_capacity INT         NOT NULL DEFAULT 16
);

-- 2. Crew members junction (16-person cap enforced in app layer)
CREATE TABLE IF NOT EXISTS crew_members (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id   UUID        NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin  BOOLEAN     NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(crew_id, user_id)
);

-- 3. Crew messages (text / image_one_time / image_one_hour / regimen / roll_call / xp_fuel)
CREATE TABLE IF NOT EXISTS crew_messages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id      UUID        NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  sender_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_type TEXT        NOT NULL DEFAULT 'text',
  content      TEXT,
  media_url    TEXT,
  regimen_id   UUID,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- 4. Roll call responses
CREATE TABLE IF NOT EXISTS roll_call_responses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID        NOT NULL REFERENCES crew_messages(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vote       TEXT        NOT NULL CHECK (vote IN ('yes', 'no')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(message_id, user_id)
);

-- 5. Daily XP fuel claim tracker (prevents double-claiming)
CREATE TABLE IF NOT EXISTS crew_xp_claims (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID        NOT NULL REFERENCES crew_messages(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(message_id, user_id)
);

-- 6. Crew-scoped stories (existing stories table extended)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS crew_id UUID REFERENCES crews(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE crews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE roll_call_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_xp_claims    ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers (bypass RLS to prevent self-referential loops)
CREATE OR REPLACE FUNCTION is_crew_member(p_crew_id UUID)
RETURNS BOOLEAN AS
'SELECT EXISTS (SELECT 1 FROM crew_members WHERE crew_id = p_crew_id AND user_id = auth.uid())'
LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_crew_admin(p_crew_id UUID)
RETURNS BOOLEAN AS
'SELECT EXISTS (SELECT 1 FROM crew_members WHERE crew_id = p_crew_id AND user_id = auth.uid() AND is_admin = TRUE)'
LANGUAGE sql SECURITY DEFINER STABLE;

-- Crews policies
DROP POLICY IF EXISTS "crews_select" ON crews;
CREATE POLICY "crews_select" ON crews FOR SELECT USING (is_crew_member(id));
DROP POLICY IF EXISTS "crews_insert" ON crews;
CREATE POLICY "crews_insert" ON crews FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "crews_update" ON crews;
CREATE POLICY "crews_update" ON crews FOR UPDATE USING (is_crew_admin(id));

-- Crew members policies
DROP POLICY IF EXISTS "crew_members_select" ON crew_members;
CREATE POLICY "crew_members_select" ON crew_members FOR SELECT USING (is_crew_member(crew_id));
DROP POLICY IF EXISTS "crew_members_insert" ON crew_members;
CREATE POLICY "crew_members_insert" ON crew_members FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "crew_members_delete" ON crew_members;
CREATE POLICY "crew_members_delete" ON crew_members FOR DELETE USING (user_id = auth.uid() OR is_crew_admin(crew_id));
DROP POLICY IF EXISTS "crew_members_update" ON crew_members;
CREATE POLICY "crew_members_update" ON crew_members FOR UPDATE USING (is_crew_admin(crew_id));

-- Crew messages policies
DROP POLICY IF EXISTS "crew_messages_select" ON crew_messages;
CREATE POLICY "crew_messages_select" ON crew_messages FOR SELECT USING (is_crew_member(crew_id));
DROP POLICY IF EXISTS "crew_messages_insert" ON crew_messages;
CREATE POLICY "crew_messages_insert" ON crew_messages FOR INSERT WITH CHECK (sender_id = auth.uid() AND is_crew_member(crew_id));
DROP POLICY IF EXISTS "crew_messages_delete" ON crew_messages;
CREATE POLICY "crew_messages_delete" ON crew_messages FOR DELETE USING (sender_id = auth.uid() OR is_crew_admin(crew_id));

-- Roll call policies
DROP POLICY IF EXISTS "roll_call_select" ON roll_call_responses;
CREATE POLICY "roll_call_select" ON roll_call_responses FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "roll_call_insert" ON roll_call_responses;
CREATE POLICY "roll_call_insert" ON roll_call_responses FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "roll_call_update" ON roll_call_responses;
CREATE POLICY "roll_call_update" ON roll_call_responses FOR UPDATE USING (user_id = auth.uid());

-- XP claims policies
DROP POLICY IF EXISTS "xp_claims_select" ON crew_xp_claims;
CREATE POLICY "xp_claims_select" ON crew_xp_claims FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "xp_claims_insert" ON crew_xp_claims;
CREATE POLICY "xp_claims_insert" ON crew_xp_claims FOR INSERT WITH CHECK (user_id = auth.uid());
