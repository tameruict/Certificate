-- CertLab security hardening for an existing deployment.

revoke all on function public.rls_auto_enable() from public, anon, authenticated;

alter table if exists public.user_data_archive
  drop constraint if exists user_data_archive_course_id_format,
  drop constraint if exists user_data_archive_payload_object,
  drop constraint if exists user_data_archive_payload_size;

alter table if exists public.user_data_archive
  add constraint user_data_archive_course_id_format
    check (course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  add constraint user_data_archive_payload_object
    check (jsonb_typeof(payload) = 'object'),
  add constraint user_data_archive_payload_size
    check (pg_column_size(payload) <= 262144);

revoke all on table public.user_data_archive from anon;
revoke all on table public.user_profiles from anon;
