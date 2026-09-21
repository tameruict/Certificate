-- CertLab: expand payload limit and add content-version audit column.
-- Run after 001_user_auth_and_archive.sql and 002_security_hardening.sql.
-- Safe to re-run (idempotent).

-- 1. Expand the payload size constraint from 256 KB to 1 MB.
--    The app warns at 230 KB and refuses to archive above 256 KB, so normal
--    users never hit this; this headroom covers power users with many courses.
alter table if exists public.user_data_archive
  drop constraint if exists user_data_archive_payload_size;

alter table if exists public.user_data_archive
  add constraint user_data_archive_payload_size
    check (pg_column_size(payload) <= 1048576);  -- 1 MB

-- 2. Add a content_version column for future bank-change notifications.
--    Nullable; populated by the app when a course question bank has a
--    content_version field.
alter table if exists public.user_data_archive
  add column if not exists content_version text
    check (content_version is null or content_version ~ '^\d{4}-\d{2}-\d{2}(T\S+)?$');

comment on column public.user_data_archive.content_version is
  'ISO-date version of the question bank the user last studied. Populated by the app; used to detect bank updates.';

-- 3. Add a covering index for the per-user, per-course lookup the app does
--    on every progress restore/archive (content_version included so Postgres
--    can satisfy the column without a heap fetch).
drop index if exists user_data_archive_lookup_idx;
create index if not exists user_data_archive_lookup_idx
  on public.user_data_archive (user_id, course_id)
  include (updated_at, content_version);

-- RLS policies are unchanged; the new column is covered by the existing
-- "Users can read/update their own archived progress" policies.
