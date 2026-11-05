# Supabase Database Migrations & RLS Schema (`supabase`)

## Overview
Ordered PostgreSQL DDL migration scripts defining user profiles, per-course progress archives, bilingual study articles/writeups, per-article reading progress, Row Level Security (RLS) policies, least-privilege grants, and public Storage bucket configuration for Supabase.

## Interface
- Tables:
  - `public.user_data_archive (user_id uuid, course_id text, payload jsonb, updated_at timestamptz, PRIMARY KEY (user_id, course_id))`
  - `public.user_profiles (user_id uuid PRIMARY KEY, username text, created_at timestamptz, updated_at timestamptz)`
  - `public.study_articles (id uuid PRIMARY KEY, slug text, translation_key text, language text, library text, course_id text, title text, description text, platform text, category text, difficulty text, tags text[], markdown text, cover_url text, source_repo text, source_path text, source_sha text, is_draft boolean, featured boolean, published_at timestamptz, created_at timestamptz, updated_at timestamptz)`
  - `public.study_article_progress (user_id uuid, article_id uuid, bookmarked boolean, completed boolean, last_read_at timestamptz, updated_at timestamptz, PRIMARY KEY (user_id, article_id))`
- Functions & Triggers:
  - `public.study_articles_set_updated_at() returns trigger` (bound via `study_articles_updated_at`, `study_article_progress_updated_at`, and `user_profiles_updated_at` `BEFORE UPDATE` triggers; execution revoked from `public`, `anon`, and `authenticated`)
  - `public.rls_auto_enable()` (execution revoked from `public`, `anon`, and `authenticated`)
- Indexes:
  - `public.user_profiles_username_lower_idx` (`UNIQUE` on `lower(username)`)
  - `public.study_articles_library_lang_published_idx` (on `(library, language, published_at DESC)`)
  - `public.study_articles_published_list_idx` (partial index on `(published_at DESC) WHERE is_draft = false`)
  - `public.study_articles_slug_language_key` (`UNIQUE` on `(slug, language)`)
  - `public.study_article_progress_article_id_idx` (on `(article_id)`)
- Storage & RLS Policies:
  - Bucket `writeup-images` in `storage.buckets` (`public = true`, `file_size_limit = 5242880`, `allowed_mime_types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']`)
  - Per-user ownership policies (`(select auth.uid()) = user_id`) for `SELECT`, `INSERT`, and `UPDATE` on `user_data_archive`, `user_profiles`, and `study_article_progress`
  - Public read policies (`SELECT` to `anon, authenticated`) on `study_articles` (`is_draft = false`) and `storage.objects` (`bucket_id = 'writeup-images'`)

## Invariants
- `user_data_archive.user_id`, `user_profiles.user_id`, and `study_article_progress.user_id` reference `auth.users(id) ON DELETE CASCADE`; `study_article_progress.article_id` references `public.study_articles(id) ON DELETE CASCADE`.
- `user_data_archive_course_id_format` enforces `course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'`.
- `user_data_archive_payload_object` enforces `jsonb_typeof(payload) = 'object'`, and `user_data_archive_payload_size` enforces `pg_column_size(payload) <= 262144` (256 KiB).
- `user_profiles_username_format` enforces `username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`, and `user_profiles_username_lower_idx` enforces case-insensitive uniqueness via `lower(username)`.
- `study_articles` enforces `language IN ('vi', 'en')`, `UNIQUE (translation_key, language)`, `UNIQUE (slug, language)`, `difficulty IN ('', 'Easy', 'Medium', 'Hard', 'Insane')`, non-blank `slug`/`translation_key` (`<= 255` chars), non-blank `title` (`<= 300` chars), `char_length(description) <= 180`, and `octet_length(markdown) <= 524288` (512 KiB).
- Row Level Security (RLS) is enabled across `user_data_archive`, `user_profiles`, `study_articles`, and `study_article_progress`.
- Default table privileges (`TRUNCATE`, `DELETE`, `TRIGGER`, `REFERENCES`) are revoked from `public`, `anon`, and `authenticated` across all four tables; `authenticated` holds only `SELECT, INSERT, UPDATE` on `user_data_archive`, `user_profiles`, and `study_article_progress` and `SELECT` on `study_articles`; `anon` holds only `SELECT` on `study_articles`.
- Roles `public`, `anon`, and `authenticated` have all privileges revoked on `public.rls_auto_enable()` and `public.study_articles_set_updated_at()`.

## Side Effects
- Creates and alters tables, check constraints, indexes, trigger functions, triggers, RLS policies, and role grants/revokes in the `public` and `storage` schemas when executed in the Supabase SQL Editor or via Supabase migrations.
- Migration `004_drop_unused_index.sql` drops index `public.user_data_archive_updated_at_idx`.
- Migration `006_writeups.sql` creates `study_articles`, `study_article_progress`, and the `'writeup-images'` Storage bucket.
- Migration `007_writeups_advisor_fixes.sql` pins `search_path = ''` on `public.study_articles_set_updated_at()`, rewrites `study_article_progress` RLS policies to use `(select auth.uid()) = user_id`, and indexes `study_article_progress(article_id)`.
- Migration `008_supabase_security_and_index_optimization.sql` locks down table/function grants, attaches `user_profiles_updated_at`, adds `study_articles` constraints and `study_articles_published_list_idx`, and sets size/MIME limits on `writeup-images`.

## Verification
- Run: `npm test`
