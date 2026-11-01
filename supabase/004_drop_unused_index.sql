-- CertLab: drop the unused per-user updated_at index.
-- Run after 001_user_auth_and_archive.sql. Safe to re-run (idempotent).
--
-- Rationale: the app only ever reads user_data_archive with a point lookup on
-- the (user_id, course_id) primary key (restoreCloudProgress / archiveProgress).
-- It never orders or filters by updated_at, so user_data_archive_updated_at_idx
-- has recorded 0 scans (confirmed by pg_stat_user_indexes and the Supabase
-- performance advisor) and only adds write overhead on every progress upsert.
-- The primary key already serves every query optimally.

drop index if exists public.user_data_archive_updated_at_idx;
