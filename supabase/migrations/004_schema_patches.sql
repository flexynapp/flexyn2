-- ============================================================
-- Migration 004 — Post-Supabase-migration schema patches
-- Adds missing columns discovered during audit:
--   • created_date timestamptz (alias for created_at) on every table
--     so legacy sort strings '-created_date' keep working
--   • Hub feature columns the app writes/reads but were absent
--   • user_profiles columns for theme + nutrition onboarding
--   • exercise_forms columns for AI-generated content cache
-- Run in Supabase SQL Editor → New query
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- HELPER: add created_date to a table and back-fill from created_at
-- ─────────────────────────────────────────────────────────────

-- workout_logs
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.workout_logs SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.workout_logs ALTER COLUMN created_date SET DEFAULT now();

-- cardio_logs
ALTER TABLE public.cardio_logs
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.cardio_logs SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.cardio_logs ALTER COLUMN created_date SET DEFAULT now();

-- goals
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.goals SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.goals ALTER COLUMN created_date SET DEFAULT now();

-- regimens
ALTER TABLE public.regimens
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.regimens SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.regimens ALTER COLUMN created_date SET DEFAULT now();

-- nutrition_logs
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.nutrition_logs SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.nutrition_logs ALTER COLUMN created_date SET DEFAULT now();

-- body_metrics
ALTER TABLE public.body_metrics
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.body_metrics SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.body_metrics ALTER COLUMN created_date SET DEFAULT now();

-- achievements
ALTER TABLE public.achievements
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.achievements SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.achievements ALTER COLUMN created_date SET DEFAULT now();

-- exercise_forms
ALTER TABLE public.exercise_forms
  ADD COLUMN IF NOT EXISTS created_date timestamptz,
  ADD COLUMN IF NOT EXISTS exercise_name text,
  ADD COLUMN IF NOT EXISTS image_urls     jsonb default '[]',
  ADD COLUMN IF NOT EXISTS tips           jsonb default '[]',
  ADD COLUMN IF NOT EXISTS is_movement    boolean default false;
UPDATE public.exercise_forms SET created_date = created_at WHERE created_date IS NULL;
-- Mirror exercise → exercise_name so both field names resolve
UPDATE public.exercise_forms SET exercise_name = exercise WHERE exercise_name IS NULL AND exercise IS NOT NULL;
ALTER TABLE public.exercise_forms ALTER COLUMN created_date SET DEFAULT now();

-- workout_templates
ALTER TABLE public.workout_templates
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.workout_templates SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.workout_templates ALTER COLUMN created_date SET DEFAULT now();

-- food_items
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.food_items SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.food_items ALTER COLUMN created_date SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────
-- hub_posts — add all columns the app writes/reads
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_posts
  ADD COLUMN IF NOT EXISTS created_date          timestamptz,
  ADD COLUMN IF NOT EXISTS post_type             text default 'text',
  ADD COLUMN IF NOT EXISTS body                  text,
  ADD COLUMN IF NOT EXISTS like_count            integer default 0,
  ADD COLUMN IF NOT EXISTS dislike_count         integer default 0,
  ADD COLUMN IF NOT EXISTS comment_count         integer default 0,
  ADD COLUMN IF NOT EXISTS privacy               text default 'public',
  ADD COLUMN IF NOT EXISTS linked_entity_type    text,
  ADD COLUMN IF NOT EXISTS linked_entity_id      uuid,
  ADD COLUMN IF NOT EXISTS linked_entity_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS author_avatar_url     text;

UPDATE public.hub_posts SET created_date = created_at WHERE created_date IS NULL;
-- Sync body ↔ content for rows that only have one populated
UPDATE public.hub_posts SET body    = content WHERE body IS NULL AND content IS NOT NULL;
UPDATE public.hub_posts SET content = body    WHERE content IS NULL AND body IS NOT NULL;
ALTER TABLE public.hub_posts ALTER COLUMN created_date SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────
-- hub_follows
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_follows
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.hub_follows SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.hub_follows ALTER COLUMN created_date SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────
-- hub_comments — body, threaded replies, like_count
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_comments
  ADD COLUMN IF NOT EXISTS created_date      timestamptz,
  ADD COLUMN IF NOT EXISTS body              text,
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid references public.hub_comments(id) on delete cascade,
  ADD COLUMN IF NOT EXISTS like_count        integer default 0;

UPDATE public.hub_comments SET created_date = created_at WHERE created_date IS NULL;
UPDATE public.hub_comments SET body    = content WHERE body IS NULL AND content IS NOT NULL;
UPDATE public.hub_comments SET content = body    WHERE content IS NULL AND body IS NOT NULL;
ALTER TABLE public.hub_comments ALTER COLUMN created_date SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────
-- hub_comment_likes
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_comment_likes
  ADD COLUMN IF NOT EXISTS created_date timestamptz;
UPDATE public.hub_comment_likes SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.hub_comment_likes ALTER COLUMN created_date SET DEFAULT now();

-- ─────────────────────────────────────────────────────────────
-- hub_reactions — user_email + reaction_type (like/dislike)
-- The schema had `emoji text`; we alias it as reaction_type by adding
-- a separate column and keeping both in sync via a trigger.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_reactions
  ADD COLUMN IF NOT EXISTS created_date  timestamptz,
  ADD COLUMN IF NOT EXISTS user_email    text,
  ADD COLUMN IF NOT EXISTS reaction_type text;

UPDATE public.hub_reactions SET created_date  = created_at  WHERE created_date IS NULL;
UPDATE public.hub_reactions SET user_email    = created_by  WHERE user_email IS NULL AND created_by IS NOT NULL;
UPDATE public.hub_reactions SET reaction_type = emoji       WHERE reaction_type IS NULL AND emoji IS NOT NULL;
UPDATE public.hub_reactions SET emoji         = reaction_type WHERE emoji IS NULL AND reaction_type IS NOT NULL;
ALTER TABLE public.hub_reactions ALTER COLUMN created_date SET DEFAULT now();

-- Keep emoji ↔ reaction_type in sync on insert/update
CREATE OR REPLACE FUNCTION public.sync_reaction_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.emoji IS NULL AND NEW.reaction_type IS NOT NULL THEN
    NEW.emoji := NEW.reaction_type;
  ELSIF NEW.reaction_type IS NULL AND NEW.emoji IS NOT NULL THEN
    NEW.reaction_type := NEW.emoji;
  END IF;
  IF NEW.user_email IS NULL AND NEW.created_by IS NOT NULL THEN
    NEW.user_email := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reaction_fields ON public.hub_reactions;
CREATE TRIGGER trg_sync_reaction_fields
  BEFORE INSERT OR UPDATE ON public.hub_reactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_reaction_fields();

-- ─────────────────────────────────────────────────────────────
-- hub_conversations — participant_key + last_message_preview
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_conversations
  ADD COLUMN IF NOT EXISTS created_date          timestamptz,
  ADD COLUMN IF NOT EXISTS participant_key        text,
  ADD COLUMN IF NOT EXISTS last_message_preview  text;

UPDATE public.hub_conversations SET created_date = created_at WHERE created_date IS NULL;
ALTER TABLE public.hub_conversations ALTER COLUMN created_date SET DEFAULT now();

-- Unique index so findOrCreateConversation is truly idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_conversations_participant_key
  ON public.hub_conversations(participant_key)
  WHERE participant_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- hub_messages — recipient_email, read_at, body
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.hub_messages
  ADD COLUMN IF NOT EXISTS created_date     timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_email  text,
  ADD COLUMN IF NOT EXISTS read_at          timestamptz,
  ADD COLUMN IF NOT EXISTS body             text;

UPDATE public.hub_messages SET created_date = created_at WHERE created_date IS NULL;
UPDATE public.hub_messages SET body    = content WHERE body IS NULL AND content IS NOT NULL;
UPDATE public.hub_messages SET content = body    WHERE content IS NULL AND body IS NOT NULL;
ALTER TABLE public.hub_messages ALTER COLUMN created_date SET DEFAULT now();

-- Index for unread count query (recipient_email, read_at)
CREATE INDEX IF NOT EXISTS idx_hub_messages_recipient_unread
  ON public.hub_messages(recipient_email, read_at)
  WHERE read_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- user_profiles — preferred_theme + nutrition onboarding flag
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_theme                text,
  ADD COLUMN IF NOT EXISTS nutrition_onboarding_complete  boolean default false;

-- ─────────────────────────────────────────────────────────────
-- Re-apply grants so new columns are accessible to roles
-- ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
