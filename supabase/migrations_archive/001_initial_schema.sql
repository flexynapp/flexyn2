-- ============================================================
-- Flexyn — Initial Supabase Schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── user_profiles ─────────────────────────────────────────────────────────────
create table if not exists public.user_profiles (
  id                           uuid primary key references auth.users(id) on delete cascade,
  email                        text unique,
  username                     text,
  bio                          text,
  avatar_url                   text,
  full_name                    text,
  onboarding_completed         boolean default false,
  onboarding_goal              text,
  onboarding_experience        text,
  onboarding_days_per_week     integer,
  total_xp                     integer default 0,
  current_level                integer default 1,
  achievements_unlocked_count  integer default 0,
  total_volume_lbs             numeric default 0,
  total_distance_meters        numeric default 0,
  account_reset_at             timestamptz,
  created_at                   timestamptz default now(),
  updated_at                   timestamptz default now()
);

alter table public.user_profiles enable row level security;

create policy "Users can read their own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

-- Public read for hub features (username, avatar, etc.)
create policy "Public profiles are readable by all"
  on public.user_profiles for select
  using (true);

-- ── Auto-create profile on sign-up ───────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Atomic XP increment ───────────────────────────────────────────────────────
create or replace function public.increment_user_xp(p_user_id uuid, p_xp integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.user_profiles
  set total_xp = total_xp + p_xp,
      updated_at = now()
  where id = p_user_id;
end;
$$;

-- ── workout_logs ──────────────────────────────────────────────────────────────
create table if not exists public.workout_logs (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,           -- user email (matches base44 pattern)
  user_id      uuid references auth.users(id) on delete cascade,
  title        text,
  date         date,
  notes        text,
  exercises    jsonb default '[]',
  duration_min integer,
  total_volume numeric default 0,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.workout_logs enable row level security;

create policy "workout_logs: owner full access"
  on public.workout_logs for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── cardio_logs ───────────────────────────────────────────────────────────────
create table if not exists public.cardio_logs (
  id              uuid primary key default uuid_generate_v4(),
  created_by      text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  activity_type   text,
  date            date,
  distance_meters numeric,
  duration_min    integer,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.cardio_logs enable row level security;

create policy "cardio_logs: owner full access"
  on public.cardio_logs for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── goals ─────────────────────────────────────────────────────────────────────
create table if not exists public.goals (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  title        text,
  description  text,
  target_value numeric,
  current_value numeric default 0,
  unit         text,
  deadline     date,
  status       text default 'active',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.goals enable row level security;

create policy "goals: owner full access"
  on public.goals for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── regimens ──────────────────────────────────────────────────────────────────
create table if not exists public.regimens (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  name         text,
  description  text,
  days         jsonb default '[]',
  is_active    boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.regimens enable row level security;

create policy "regimens: owner full access"
  on public.regimens for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── nutrition_logs ────────────────────────────────────────────────────────────
create table if not exists public.nutrition_logs (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  date         date,
  meal_type    text,
  food_name    text,
  brand        text,
  serving_size text,
  servings     numeric default 1,
  calories     numeric default 0,
  protein      numeric default 0,
  carbs        numeric default 0,
  fat          numeric default 0,
  fiber        numeric default 0,
  sodium       numeric default 0,
  food_item_id uuid,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.nutrition_logs enable row level security;

create policy "nutrition_logs: owner full access"
  on public.nutrition_logs for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── body_metrics ──────────────────────────────────────────────────────────────
create table if not exists public.body_metrics (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  date         date,
  weight_lbs   numeric,
  body_fat_pct numeric,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.body_metrics enable row level security;

create policy "body_metrics: owner full access"
  on public.body_metrics for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── achievements ──────────────────────────────────────────────────────────────
create table if not exists public.achievements (
  id             uuid primary key default uuid_generate_v4(),
  created_by     text not null,
  user_id        uuid references auth.users(id) on delete cascade,
  achievement_id text,
  name           text,
  description    text,
  unlocked_at    timestamptz default now(),
  xp_awarded     integer default 0,
  created_at     timestamptz default now()
);

alter table public.achievements enable row level security;

create policy "achievements: owner full access"
  on public.achievements for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── exercise_forms ────────────────────────────────────────────────────────────
create table if not exists public.exercise_forms (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  exercise     text,
  form_notes   text,
  video_url    text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.exercise_forms enable row level security;

create policy "exercise_forms: owner full access"
  on public.exercise_forms for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── workout_templates ─────────────────────────────────────────────────────────
create table if not exists public.workout_templates (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  name         text,
  description  text,
  exercises    jsonb default '[]',
  is_public    boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.workout_templates enable row level security;

create policy "workout_templates: owner full access"
  on public.workout_templates for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

create policy "workout_templates: public templates readable"
  on public.workout_templates for select
  using (is_public = true);

-- ── food_items ────────────────────────────────────────────────────────────────
create table if not exists public.food_items (
  id           uuid primary key default uuid_generate_v4(),
  created_by   text not null,
  user_id      uuid references auth.users(id) on delete cascade,
  name         text,
  brand        text,
  barcode      text,
  serving_label text,
  calories     numeric default 0,
  protein      numeric default 0,
  carbs        numeric default 0,
  fat          numeric default 0,
  fiber        numeric default 0,
  sodium       numeric default 0,
  is_verified  boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.food_items enable row level security;

create policy "food_items: owner full access"
  on public.food_items for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

create policy "food_items: verified items readable by all"
  on public.food_items for select
  using (is_verified = true);

-- ── hub_posts ─────────────────────────────────────────────────────────────────
create table if not exists public.hub_posts (
  id            uuid primary key default uuid_generate_v4(),
  created_by    text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  author_email  text,
  author_name   text,
  author_avatar text,
  content       text,
  image_url     text,
  workout_log_id uuid,
  likes_count   integer default 0,
  comments_count integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.hub_posts enable row level security;

create policy "hub_posts: public read"
  on public.hub_posts for select using (true);

create policy "hub_posts: owner write"
  on public.hub_posts for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_follows ───────────────────────────────────────────────────────────────
create table if not exists public.hub_follows (
  id              uuid primary key default uuid_generate_v4(),
  created_by      text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  follower_email  text,
  followee_email  text,
  follower_id     uuid,
  followee_id     uuid,
  created_at      timestamptz default now(),
  unique (follower_email, followee_email)
);

alter table public.hub_follows enable row level security;

create policy "hub_follows: public read"
  on public.hub_follows for select using (true);

create policy "hub_follows: owner write"
  on public.hub_follows for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_comments ──────────────────────────────────────────────────────────────
create table if not exists public.hub_comments (
  id            uuid primary key default uuid_generate_v4(),
  created_by    text not null,
  user_id       uuid references auth.users(id) on delete cascade,
  post_id       uuid references public.hub_posts(id) on delete cascade,
  author_email  text,
  author_name   text,
  author_avatar text,
  content       text,
  likes_count   integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.hub_comments enable row level security;

create policy "hub_comments: public read"
  on public.hub_comments for select using (true);

create policy "hub_comments: owner write"
  on public.hub_comments for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_comment_likes ─────────────────────────────────────────────────────────
create table if not exists public.hub_comment_likes (
  id         uuid primary key default uuid_generate_v4(),
  created_by text not null,
  user_id    uuid references auth.users(id) on delete cascade,
  comment_id uuid references public.hub_comments(id) on delete cascade,
  created_at timestamptz default now(),
  unique (created_by, comment_id)
);

alter table public.hub_comment_likes enable row level security;

create policy "hub_comment_likes: public read"
  on public.hub_comment_likes for select using (true);

create policy "hub_comment_likes: owner write"
  on public.hub_comment_likes for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_reactions ─────────────────────────────────────────────────────────────
create table if not exists public.hub_reactions (
  id         uuid primary key default uuid_generate_v4(),
  created_by text not null,
  user_id    uuid references auth.users(id) on delete cascade,
  post_id    uuid references public.hub_posts(id) on delete cascade,
  emoji      text,
  created_at timestamptz default now(),
  unique (created_by, post_id, emoji)
);

alter table public.hub_reactions enable row level security;

create policy "hub_reactions: public read"
  on public.hub_reactions for select using (true);

create policy "hub_reactions: owner write"
  on public.hub_reactions for all
  using (auth.email() = created_by or auth.uid() = user_id)
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_conversations ─────────────────────────────────────────────────────────
create table if not exists public.hub_conversations (
  id              uuid primary key default uuid_generate_v4(),
  created_by      text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  participant_emails text[] default '{}',
  participant_ids    uuid[] default '{}',
  last_message_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.hub_conversations enable row level security;

create policy "hub_conversations: participant read/write"
  on public.hub_conversations for all
  using (auth.email() = any(participant_emails) or auth.uid() = any(participant_ids))
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── hub_messages ──────────────────────────────────────────────────────────────
create table if not exists public.hub_messages (
  id              uuid primary key default uuid_generate_v4(),
  created_by      text not null,
  user_id         uuid references auth.users(id) on delete cascade,
  conversation_id uuid references public.hub_conversations(id) on delete cascade,
  sender_email    text,
  sender_name     text,
  sender_avatar   text,
  content         text,
  read_by         text[] default '{}',
  created_at      timestamptz default now()
);

alter table public.hub_messages enable row level security;

create policy "hub_messages: participant read/write"
  on public.hub_messages for all
  using (
    auth.email() = created_by
    or auth.uid() = user_id
    or exists (
      select 1 from public.hub_conversations c
      where c.id = conversation_id
        and (auth.email() = any(c.participant_emails) or auth.uid() = any(c.participant_ids))
    )
  )
  with check (auth.email() = created_by or auth.uid() = user_id);

-- ── Indexes for common query patterns ─────────────────────────────────────────
create index if not exists idx_workout_logs_created_by   on public.workout_logs(created_by);
create index if not exists idx_workout_logs_date         on public.workout_logs(date desc);
create index if not exists idx_cardio_logs_created_by    on public.cardio_logs(created_by);
create index if not exists idx_cardio_logs_date          on public.cardio_logs(date desc);
create index if not exists idx_nutrition_logs_created_by on public.nutrition_logs(created_by);
create index if not exists idx_nutrition_logs_date       on public.nutrition_logs(date desc);
create index if not exists idx_body_metrics_created_by   on public.body_metrics(created_by);
create index if not exists idx_goals_created_by          on public.goals(created_by);
create index if not exists idx_regimens_created_by       on public.regimens(created_by);
create index if not exists idx_hub_posts_created_at      on public.hub_posts(created_at desc);
create index if not exists idx_hub_comments_post_id      on public.hub_comments(post_id);
create index if not exists idx_hub_messages_conversation on public.hub_messages(conversation_id, created_at);
create index if not exists idx_hub_follows_emails        on public.hub_follows(follower_email, followee_email);
