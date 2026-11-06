# Supabase Database Migrations & RLS Schema (`supabase`)

## Overview
Ordered PostgreSQL DDL migration scripts defining user profiles, per-course progress archives, normalized learner progress tables, CBT mock exam history, self-service password recovery credentials and audit logs, bilingual study articles/writeups, per-article reading progress, Row Level Security (RLS) policies, least-privilege grants, and public Storage bucket configuration for Supabase.

## Interface
- Tables:
  - `public.user_data_archive (user_id uuid, course_id text, payload jsonb, updated_at timestamptz, PRIMARY KEY (user_id, course_id))`
  - `public.user_profiles (user_id uuid PRIMARY KEY, username text, recovery_email text, has_recovery_code boolean, created_at timestamptz, updated_at timestamptz)`
  - `public.user_course_progress (user_id uuid, course_id text, answered_count integer, correct_count integer, bookmarked_count integer, streak integer, best_streak integer, content_version text, last_activity_at timestamptz, created_at timestamptz, updated_at timestamptz, PRIMARY KEY (user_id, course_id))`
  - `public.user_question_progress (user_id uuid, course_id text, question_id text, selected_options text[], is_correct boolean, bookmarked boolean, attempt_count integer, answered_at timestamptz, updated_at timestamptz, PRIMARY KEY (user_id, course_id, question_id))`
  - `public.user_exam_attempts (id uuid PRIMARY KEY, user_id uuid, course_id text, total_questions integer, answered_count integer, correct_count integer, score_percent smallint, duration_seconds integer, domain_breakdown jsonb, completed_at timestamptz, created_at timestamptz)`
  - `public.user_recovery_credentials (user_id uuid PRIMARY KEY, recovery_code_hash text, failed_attempts smallint, locked_until timestamptz, last_reset_at timestamptz, created_at timestamptz, updated_at timestamptz)`
  - `public.password_reset_audit (id uuid PRIMARY KEY, user_id uuid, method text, succeeded boolean, created_at timestamptz)`
  - `public.study_articles (id uuid PRIMARY KEY, slug text, translation_key text, language text, library text, course_id text, title text, description text, platform text, category text, difficulty text, tags text[], markdown text, cover_url text, source_repo text, source_path text, source_sha text, is_draft boolean, featured boolean, published_at timestamptz, created_at timestamptz, updated_at timestamptz)`
  - `public.study_article_progress (user_id uuid, article_id uuid, bookmarked boolean, completed boolean, last_read_at timestamptz, updated_at timestamptz, PRIMARY KEY (user_id, article_id))`
- Functions & Triggers:
  - `public.study_articles_set_updated_at() returns trigger` (bound via `study_articles_updated_at`, `study_article_progress_updated_at`, `user_profiles_updated_at`, `user_course_progress_updated_at`, `user_question_progress_updated_at`, and `user_recovery_credentials_updated_at` `BEFORE UPDATE` triggers; execution revoked from `public`, `anon`, and `authenticated`)
  - `public.sync_learner_progress_from_archive() returns trigger` (bound via `user_data_archive_sync_progress` `AFTER INSERT OR UPDATE` trigger on `user_data_archive`; execution revoked from `public`, `anon`, and `authenticated`)
  - `public.set_user_recovery_code(p_recovery_code text, p_recovery_email text default null) returns boolean` (`SECURITY DEFINER`, `search_path = ''`, executable only by `authenticated`)
  - `public.reset_password_with_recovery_code(p_username text, p_recovery_code text, p_new_password text) returns jsonb` (`SECURITY DEFINER`, `search_path = ''`, executable by `anon, authenticated`)
  - `public.rls_auto_enable()` (execution revoked from `public`, `anon`, and `authenticated`)
- Indexes:
  - `public.user_profiles_username_lower_idx` (`UNIQUE` on `lower(username)`)
  - `public.user_question_progress_review_idx` (partial index on `(user_id, course_id) WHERE bookmarked = true OR is_correct = false`)
  - `public.user_exam_attempts_user_course_completed_idx` (on `(user_id, course_id, completed_at DESC)`)
  - `public.password_reset_audit_user_created_idx` (on `(user_id, created_at DESC)`)
  - `public.study_articles_library_lang_published_idx` (on `(library, language, published_at DESC)`)
  - `public.study_articles_published_list_idx` (partial index on `(published_at DESC) WHERE is_draft = false`)
  - `public.study_articles_slug_language_key` (`UNIQUE` on `(slug, language)`)
  - `public.study_article_progress_article_id_idx` (on `(article_id)`)
- Storage & RLS Policies:
  - Bucket `writeup-images` in `storage.buckets` (`public = true`, `file_size_limit = 5242880`, `allowed_mime_types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']`)
  - Per-user ownership policies (`(select auth.uid()) = user_id`) for `user_data_archive`, `user_profiles`, `user_course_progress`, `user_question_progress`, `user_exam_attempts`, `password_reset_audit`, and `study_article_progress`
  - Public read policies (`SELECT` to `anon, authenticated`) on `study_articles` (`is_draft = false`) and `storage.objects` (`bucket_id = 'writeup-images'`)

## Invariants
- `user_data_archive.user_id`, `user_profiles.user_id`, `user_course_progress.user_id`, `user_question_progress.user_id`, `user_exam_attempts.user_id`, `user_recovery_credentials.user_id`, `password_reset_audit.user_id`, and `study_article_progress.user_id` reference `auth.users(id) ON DELETE CASCADE`; `study_article_progress.article_id` references `public.study_articles(id) ON DELETE CASCADE`.
- `user_data_archive_course_id_format`, `user_course_progress_course_id_format`, `user_question_progress_course_id_format`, and `user_exam_attempts_course_id_format` enforce `course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'`.
- `user_data_archive_payload_object` enforces `jsonb_typeof(payload) = 'object'`, and `user_data_archive_payload_size` enforces `pg_column_size(payload) <= 262144` (256 KiB).
- `user_profiles_username_format` enforces `username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`, `user_profiles_username_lower_idx` enforces case-insensitive uniqueness via `lower(username)`, and `user_profiles_recovery_email_format` validates optional `recovery_email`.
- `user_recovery_credentials` stores only bcrypt hashes (`^\$2[abxy]\$[0-9]{2}\$.{53}$`), has all direct table access revoked from `public`, `anon`, and `authenticated`, and locks recovery for 15 minutes after 5 consecutive failed attempts.
- `study_articles` enforces `language IN ('vi', 'en')`, `UNIQUE (translation_key, language)`, `UNIQUE (slug, language)`, `difficulty IN ('', 'Easy', 'Medium', 'Hard', 'Insane')`, non-blank `slug`/`translation_key` (`<= 255` chars), non-blank `title` (`<= 300` chars), `char_length(description) <= 180`, and `octet_length(markdown) <= 524288` (512 KiB).
- Row Level Security (RLS) is enabled across all tables in `public`.

## Side Effects
- Creates and alters tables, check constraints, indexes, trigger functions, triggers, RLS policies, and role grants/revokes in the `public` and `storage` schemas when executed in the Supabase SQL Editor or via Supabase migrations.
- Migration `009_learner_progress_and_password_recovery.sql` creates normalized learner progress tables (`user_course_progress`, `user_question_progress`, `user_exam_attempts`), attaches `user_data_archive_sync_progress`, and adds self-service password recovery tables (`user_recovery_credentials`, `password_reset_audit`) and RPCs (`set_user_recovery_code`, `reset_password_with_recovery_code`).

## Verification
- Run: `npm test`

