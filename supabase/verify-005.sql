-- CertLab Study: read-only verification for migration 005.
--
-- *** READ-ONLY: this file contains SELECT statements only. ***
-- It modifies nothing. It is NOT a migration and it must NOT be run
-- as one. Run it in the Supabase SQL Editor AFTER applying
-- supabase/005_hardening.sql, on staging first and then (only after
-- approval) on the live project.
--
-- Privacy note: no query below selects payload contents or lists
-- user_ids. Aggregates only (row counts, maximum payload size) are
-- used where a size/count check is needed, so running this file does
-- not dump user progress data.

-- 1. Tables exist and RLS is enabled on both.
SELECT schemaname, tablename, rowsecurity AS rls_enabled
FROM pg_tables
  JOIN pg_class ON pg_class.relname = pg_tables.tablename
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    AND pg_namespace.nspname = pg_tables.schemaname
WHERE schemaname = 'public'
  AND tablename IN ('user_data_archive', 'user_profiles')
ORDER BY tablename;

-- 2. RLS policies: expect 3 per table (SELECT / INSERT / UPDATE),
--    all for role `authenticated`, all own-user (auth.uid() = user_id).
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_data_archive', 'user_profiles')
ORDER BY tablename, cmd;

-- 3. Triggers from 005 are present (and no unexpected extra triggers
--    on these tables beyond the two created by 005).
SELECT event_object_table AS table_name,
       trigger_name,
       event_manipulation AS event,
       action_timing AS timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('user_data_archive', 'user_profiles')
ORDER BY table_name, trigger_name;

-- 4. Trigger functions from 005 exist.
SELECT proname AS function_name,
       pg_get_function_identity_arguments(oid) AS arguments
FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN ('set_user_data_archive_updated_at',
                  'enforce_user_data_archive_row_cap')
ORDER BY function_name;

-- 5. Grants for `authenticated`: expect exactly SELECT, INSERT, UPDATE
--    on each table, and NO DELETE / TRUNCATE / REFERENCES.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('user_data_archive', 'user_profiles')
  AND grantee = 'authenticated'
ORDER BY table_name, privilege_type;

-- 6. Corrected user_profiles comment (should say "own-user only",
--    and should NOT say "Public username lookup").
SELECT obj_description('public.user_profiles'::regclass) AS user_profiles_comment;

-- 7. Current payload constraints, as actually in place (resolves the
--    001/002 vs old-003 question for THIS database: 262144 means the
--    256 KB cap, 1048576 means the old 1 MB cap was applied).
SELECT conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.user_data_archive'::regclass,
                   'public.user_profiles'::regclass)
ORDER BY conrelid::regclass::text, conname;

-- 8. rls_auto_enable / ensure_rls are KEPT: the function exists, the
--    event trigger exists and is enabled, and browser roles cannot
--    execute the function directly (proacl should not list
--    anon/authenticated/public with EXECUTE).
SELECT proname AS function_name,
       prosecdef AS is_security_definer,
       proacl AS acl
FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname = 'rls_auto_enable';

SELECT evtname AS event_trigger_name,
       evtenabled AS enabled
FROM pg_event_trigger
WHERE evtname = 'ensure_rls';

-- 9. Aggregate-only counts: total rows, and the largest per-user row
--    count (must be <= 100 after 005 is in place for any user who only
--    wrote through the trigger; pre-existing rows above 100, if any,
--    are NOT deleted by 005 and would show up here as a follow-up).
SELECT count(*) AS total_archive_rows,
       (SELECT max(cnt) FROM (
          SELECT count(*) AS cnt
          FROM public.user_data_archive
          GROUP BY user_id
        ) AS per_user) AS max_rows_per_user,
       (SELECT max(pg_column_size(payload))
        FROM public.user_data_archive) AS max_payload_bytes
FROM public.user_data_archive;
