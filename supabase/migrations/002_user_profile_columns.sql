-- ============================================================
-- Migration 002: Add missing user_profiles columns
-- Run in Supabase SQL Editor → New query → Run
-- ============================================================

alter table public.user_profiles
  add column if not exists fitness_goals        text,
  add column if not exists fitness_level        text,
  add column if not exists training_days        text[],
  add column if not exists preferred_workout_time text,
  add column if not exists age                  integer,
  add column if not exists height_cm            text,
  add column if not exists height_inches        text,
  add column if not exists height_unit          text,
  add column if not exists weight_kg            text,
  add column if not exists weight_lbs           text,
  add column if not exists weight_unit          text,
  add column if not exists onboarding_complete  boolean default false;
