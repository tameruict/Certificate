-- CertLab Study: authenticated progress archive
-- Run this migration in the Supabase SQL editor or with the Supabase CLI.

create table if not exists public.user_data_archive (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, course_id)
);

comment on table public.user_data_archive is 'Per-user, per-course CertLab progress archive. The payload contains no passwords or secrets.';

alter table public.user_data_archive enable row level security;

revoke all on table public.user_data_archive from anon;
grant select, insert, update on table public.user_data_archive to authenticated;

drop policy if exists "Users can read their own archived progress" on public.user_data_archive;
create policy "Users can read their own archived progress"
  on public.user_data_archive for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can archive their own progress" on public.user_data_archive;
create policy "Users can archive their own progress"
  on public.user_data_archive for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own archived progress" on public.user_data_archive;
create policy "Users can update their own archived progress"
  on public.user_data_archive for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists user_data_archive_updated_at_idx
  on public.user_data_archive (user_id, updated_at desc);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_profiles_username_format check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
);

comment on table public.user_profiles is 'Public username lookup for CertLab accounts; passwords remain managed by Supabase Auth.';
create unique index if not exists user_profiles_username_lower_idx on public.user_profiles (lower(username));
alter table public.user_profiles enable row level security;
revoke all on table public.user_profiles from anon;
grant select, insert, update on table public.user_profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
  on public.user_profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.user_profiles;
create policy "Users can create their own profile"
  on public.user_profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile"
  on public.user_profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
