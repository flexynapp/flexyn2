-- Migration 013: Add onboarding_completed_at timestamp to users table
--
-- Purpose: Track exactly when each user finished onboarding so we can:
--   • Measure drop-off in the onboarding funnel
--   • Exclude very-new users from certain leaderboard rankings
--   • Support time-series analysis of cohort activation
--
-- Safe to re-run: IF NOT EXISTS guard prevents duplicate column errors.
-- Run in Supabase SQL Editor (same process as migrations 001-012).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
