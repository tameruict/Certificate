-- 008_supabase_security_and_index_optimization:
-- 1. Enforce strict least-privilege table grants (revoke default TRUNCATE/DELETE/TRIGGER/REFERENCES from anon & authenticated).
-- 2. Revoke PUBLIC/anon/authenticated EXECUTE on trigger function public.study_articles_set_updated_at().
-- 3. Attach BEFORE UPDATE updated_at trigger on public.user_profiles.
-- 4. Add bounded size/format check constraints and UNIQUE (slug, language) on public.study_articles.
-- 5. Add partial index study_articles_published_list_idx for fetchArticleList().
-- 6. Harden writeup-images Storage bucket with a 5 MiB file size limit and image MIME allowlist.

revoke all on table public.user_data_archive from public, anon, authenticated;
revoke all on table public.user_profiles from public, anon, authenticated;
revoke all on table public.study_articles from public, anon, authenticated;
revoke all on table public.study_article_progress from public, anon, authenticated;

grant select, insert, update on table public.user_data_archive to authenticated;
grant select, insert, update on table public.user_profiles to authenticated;
grant select on table public.study_articles to anon, authenticated;
grant select, insert, update on table public.study_article_progress to authenticated;

revoke all on function public.study_articles_set_updated_at() from public, anon, authenticated;

create or replace trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.study_articles_set_updated_at();

comment on table public.study_articles is 'Published technical write-ups and study articles imported from git via service_role.';
comment on table public.study_article_progress is 'Per-user reading and bookmark state for study_articles.';

alter table public.study_articles
  add constraint study_articles_slug_nonblank
    check (btrim(slug) <> '' and char_length(slug) <= 255),
  add constraint study_articles_translation_key_nonblank
    check (btrim(translation_key) <> '' and char_length(translation_key) <= 255),
  add constraint study_articles_title_nonblank
    check (btrim(title) <> '' and char_length(title) <= 300),
  add constraint study_articles_description_length
    check (char_length(description) <= 180),
  add constraint study_articles_markdown_size
    check (octet_length(markdown) <= 524288),
  add constraint study_articles_slug_language_key
    unique (slug, language);

create index if not exists study_articles_published_list_idx
  on public.study_articles (published_at desc)
  where is_draft = false;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
where id = 'writeup-images';
