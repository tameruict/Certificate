-- 006_writeups: Write-ups library (CertLab tab Write-ups).
-- DRAFT migration: do NOT apply to live until it is reviewed in the
-- writeups PR and the apply order vs 005-hardening is approved.
-- Design: Git (tameruict.github.io) stays the authoring source; this
-- schema is the serving store populated by scripts/import-writeups.js.
-- Frontend never writes these tables with an anon/authenticated key.
-- Articles are readable by anyone who can read them through PostgREST;
-- the app itself still gates the workspace behind login, so this RLS
-- policy alone does not make the library public on the web.

create table if not exists public.study_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  translation_key text not null,
  language text not null check (language in ('vi', 'en')),
  library text not null default 'writeups',
  course_id text,
  title text not null,
  description text not null default '',
  platform text not null default '',
  category text not null default '',
  difficulty text not null default '' check (difficulty in ('', 'Easy', 'Medium', 'Hard', 'Insane')),
  tags text[] not null default '{}',
  markdown text not null default '',
  cover_url text,
  source_repo text not null default '',
  source_path text not null default '',
  source_sha text not null default '',
  is_draft boolean not null default true,
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (translation_key, language)
);

create index if not exists study_articles_library_lang_published_idx
  on public.study_articles (library, language, published_at desc);
create index if not exists study_articles_tags_idx
  on public.study_articles using gin (tags);

create table if not exists public.study_article_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references public.study_articles (id) on delete cascade,
  bookmarked boolean not null default false,
  completed boolean not null default false,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create or replace function public.study_articles_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists study_articles_updated_at on public.study_articles;
create trigger study_articles_updated_at
  before update on public.study_articles
  for each row execute function public.study_articles_set_updated_at();

drop trigger if exists study_article_progress_updated_at on public.study_article_progress;
create trigger study_article_progress_updated_at
  before update on public.study_article_progress
  for each row execute function public.study_articles_set_updated_at();

alter table public.study_articles enable row level security;
alter table public.study_article_progress enable row level security;

-- Published articles: read-only for anon + authenticated. No write
-- policy is created on purpose: writes happen only with service_role
-- from the import script, which bypasses RLS.
drop policy if exists study_articles_select_published on public.study_articles;
create policy study_articles_select_published
  on public.study_articles for select
  to anon, authenticated
  using (is_draft = false);

-- Reading progress: own-user only, mirroring user_profiles / archive.
drop policy if exists study_article_progress_select_own on public.study_article_progress;
create policy study_article_progress_select_own
  on public.study_article_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists study_article_progress_insert_own on public.study_article_progress;
create policy study_article_progress_insert_own
  on public.study_article_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists study_article_progress_update_own on public.study_article_progress;
create policy study_article_progress_update_own
  on public.study_article_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.study_articles to anon, authenticated;
grant select, insert, update on public.study_article_progress to authenticated;

-- Storage bucket for writeup images. The bucket itself is created by
-- this insert; if Storage is managed from the Dashboard instead, this
-- statement is a harmless no-op.
insert into storage.buckets (id, name, public)
values ('writeup-images', 'writeup-images', true)
on conflict (id) do nothing;

drop policy if exists writeup_images_select_public on storage.objects;
create policy writeup_images_select_public
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'writeup-images');
-- No insert/update/delete policy for anon/authenticated on purpose:
-- image uploads happen only with service_role from the import script.
