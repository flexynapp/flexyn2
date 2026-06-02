-- ============================================================
-- Migration 003: Grant table privileges to Supabase roles
-- Required when tables are created via SQL (not Supabase UI).
-- Run in Supabase SQL Editor → New query → Run
-- ============================================================

-- Schema access
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Authenticated users get full CRUD on all tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Anonymous users get read-only access (for public hub content etc.)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Apply to any tables created in the future
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

NOTIFY pgrst, 'reload schema';
