-- CertLab Study: Supabase hardening, migration 005 (DRAFT ONLY).
--
-- *** DO NOT APPLY TO THE LIVE DATABASE YET ***
-- This file is a draft in a pull request only. It has NOT been applied to
-- any live Supabase project, and it has NOT been executed against a live
-- database. Before applying, it MUST be reviewed and tested on a staging
-- project (see supabase/005_NOTES.md for the manual checklist).
--
-- Prerequisites (in order):
--   supabase/001_user_auth_and_archive.sql
--   supabase/002_security_hardening.sql
--   supabase/004_drop_unused_index.sql
-- See supabase/005_NOTES.md for the 001/002/004/005 numbering gap: a file
-- named 003 existed in an earlier commit but is absent from the tree at
-- the base of this branch. Do NOT renumber the old files, and do NOT
-- re-create 003 here. This file deliberately does not touch the payload
-- size constraint or any content_version column, so it is compatible
-- whether or not that old 003 was ever applied live.
--
-- What this file does (and does not do):
--   1. Server-side updated_at for public.user_data_archive only.
--   2. A generous per-user row cap (100 rows) for user_data_archive.
--   3. Grant tightening for role `authenticated` on both public tables.
--   4. A corrected comment for public.user_profiles.
--   5. NOTHING for rls_auto_enable / ensure_rls except documentation:
--      they are KEPT, not dropped, and not re-created here.
--   6. NO change to the signup flow, NO Auth dashboard change, NO change
--      to postgres or service_role grants, NO service-role key anywhere.
--   7. NO strict payload allowlist as an enforced constraint (see the
--      notes file for the documented proposal instead).
--
-- This file is intended to be idempotent: re-running it should produce
-- the same end state (triggers are dropped and re-created, grants are
-- re-asserted). If any statement fails, the whole transaction rolls back.

BEGIN;

-- =========================================================================
-- 1. Server-side updated_at for public.user_data_archive
-- =========================================================================
-- The app currently upserts a client-supplied updated_at
-- (lib/app.js: archiveProgress() sends
--   { user_id, course_id, payload: app.progress, updated_at: updatedAt }
-- where updatedAt comes from app.progress.updatedAt, i.e. the browser
-- clock). A client can therefore backdate or forward-date the column
-- that restoreCloudProgress() compares against local progress.
--
-- After this trigger, the column is always server time on INSERT and on
-- UPDATE, and any client-supplied value is ignored (overwritten).
--
-- WARNING -- restore-conflict behaviour changes:
--   restoreCloudProgress() compares the returned updated_at column
--   against the local payload's updatedAt. After this trigger, the
--   column is server time while the payload's updatedAt is still the
--   browser clock. If a browser clock runs ahead of the server, the
--   local timestamp can stay "newer" than the server column after a
--   successful upsert, so the next restore may re-archive (one extra
--   upsert per load, not data loss -- but it must be observed, not
--   assumed). Re-test the local-vs-cloud compare on staging, including
--   with a skewed client clock, BEFORE applying live. See 005_NOTES.md.
--   user_profiles.updated_at is intentionally NOT covered by this file:
--   ensureProfile() still sends a client timestamp, and profiles are not
--   used in the progress restore compare. Covering it is future work,
--   not a silent part of this draft.
--
-- Rollback (run only if you need to undo this section):
--   DROP TRIGGER IF EXISTS user_data_archive_set_updated_at
--     ON public.user_data_archive;
--   DROP FUNCTION IF EXISTS public.set_user_data_archive_updated_at();
-- Rolling back the trigger alone does not restore old client timestamps;
-- rows already written keep their server timestamps.

CREATE OR REPLACE FUNCTION public.set_user_data_archive_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_data_archive_set_updated_at
  ON public.user_data_archive;

CREATE TRIGGER user_data_archive_set_updated_at
  BEFORE INSERT OR UPDATE ON public.user_data_archive
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_data_archive_updated_at();

-- =========================================================================
-- 2. Per-user row cap for public.user_data_archive (generous, safe)
-- =========================================================================
-- Why a row cap, and why 100:
--   The table's primary key is (user_id, course_id), so one user can
--   only hold one row per course_id. The app currently has only
--   2 courses, and the live counts at plan time were 2 profiles /
--   1 archive row in total. A cap of 100 rows per user therefore cannot
--   break current use, but it stops unbounded row creation (e.g. a
--   scripted client inventing course_id values, which the existing
--   course_id format check alone does not prevent).
--
-- Why this trigger is safe for the app's upsert flow:
--   * It fires on INSERT only, not on UPDATE, so updating an existing
--     course's progress is never blocked by the cap.
--   * It explicitly allows the INSERT leg of an upsert when a row with
--     the same (user_id, course_id) already exists: in that case the
--     statement resolves to an UPDATE, not a new row, so it must not
--     count against the cap. Without this check, a user already at
--     100 rows could never update any existing course again.
--   * It is deliberately NOT SECURITY DEFINER, so the count query is
--     still scoped by RLS to the caller's own rows (the INSERT policy
--     already requires NEW.user_id = auth.uid()). Test it as the
--     `authenticated` role on staging, not as postgres, because
--     postgres bypasses RLS and would mask an RLS-scoping bug.
--
-- Limits of this mechanism (read before relying on it):
--   * Best-effort, not an exact quota: two concurrent INSERTs near the
--     cap can both pass the count check. An exact quota would need a
--     separate counter table / advisory lock and is out of scope here.
--   * The error is a check-style exception (SQLSTATE 23514). The app
--     currently surfaces upsert errors only as a toast
--     ("Cloud archive failed: ..."), so a capped user sees a toast,
--     not a dedicated message. That UX copy is future work, not part
--     of this SQL draft.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS user_data_archive_enforce_row_cap
--     ON public.user_data_archive;
--   DROP FUNCTION IF EXISTS public.enforce_user_data_archive_row_cap();

CREATE OR REPLACE FUNCTION public.enforce_user_data_archive_row_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_rows integer;
BEGIN
  -- Upsert of an already-stored course: this resolves to an UPDATE,
  -- so it must not be blocked even if the user is already at the cap.
  IF EXISTS (
    SELECT 1
    FROM public.user_data_archive
    WHERE user_id = NEW.user_id
      AND course_id = NEW.course_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO v_existing_rows
    FROM public.user_data_archive
    WHERE user_id = NEW.user_id;

  IF v_existing_rows >= 100 THEN
    RAISE EXCEPTION 'user_data_archive row cap reached (100 rows per user)'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_data_archive_enforce_row_cap
  ON public.user_data_archive;

CREATE TRIGGER user_data_archive_enforce_row_cap
  BEFORE INSERT ON public.user_data_archive
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_data_archive_row_cap();

-- =========================================================================
-- 3. Grant tightening for role `authenticated` (defence in depth)
-- =========================================================================
-- The app flow needs exactly SELECT, INSERT, UPDATE on both tables:
--   * user_data_archive: restoreCloudProgress() selects, archiveProgress()
--     upserts (INSERT ... ON CONFLICT DO UPDATE).
--   * user_profiles: loadProfile() selects, ensureProfile() upserts.
-- It never deletes, truncates, or creates foreign keys against these
-- tables from the browser.
--
-- 001 already granted only SELECT, INSERT, UPDATE to `authenticated`
-- and revoked ALL from `anon`, and no DELETE policy exists for either
-- table, so RLS would already block a DELETE. These REVOKEs are
-- therefore defence in depth, not the primary control: they make the
-- intent explicit and keep the grant set correct even if a future
-- migration accidentally grants more.
--
-- TEST WARNING -- MUST be tested against the app's insert/select/update
-- flow on staging before applying live. If any app path unexpectedly
-- needs a revoked privilege, the failure will surface as a PostgREST
-- permission error, not as an RLS error; check both.
--
-- NOT touched here, on purpose: postgres and service_role grants.
-- Do not add REVOKE statements for those roles to this file.

REVOKE DELETE, TRUNCATE, REFERENCES
  ON TABLE public.user_data_archive FROM authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES
  ON TABLE public.user_profiles FROM authenticated;

-- Re-assert exactly the privileges the app needs (idempotent).
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.user_data_archive TO authenticated;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.user_profiles TO authenticated;

-- =========================================================================
-- 4. Corrected comment for public.user_profiles
-- =========================================================================
-- 001 described this table as a "Public username lookup". That wording
-- is misleading: the SELECT policy allows a user to read only their
-- OWN row (using (auth.uid() = user_id)), so one user cannot look up
-- another user's profile through the app's anon/authenticated path.
-- This COMMENT changes documentation only; it changes no policy,
-- grant, or column.

COMMENT ON TABLE public.user_profiles IS
  'own-user only: policies allow a user to read/insert/update only their own row; NOT a public username lookup';

-- =========================================================================
-- 5. rls_auto_enable / ensure_rls: KEPT, NOT dropped, NOT re-created
-- =========================================================================
-- No DDL for these objects appears in this file, on purpose.
-- Documented behaviour (see supabase/005_NOTES.md for detail):
--   * public.rls_auto_enable() is a SECURITY DEFINER event-trigger
--     function that auto-enables RLS on newly created public tables.
--   * ensure_rls is the enabled ddl_command_end event trigger that
--     calls it.
--   * 002 already revoked EXECUTE on rls_auto_enable() from public,
--     anon, and authenticated, so browser roles cannot call it
--     directly; the event trigger itself still fires.
-- This file intentionally does NOT re-run that REVOKE: re-running it
-- without the exact function signature could fail if the function is
-- ever overloaded, and the revoke is already in place from 002.
-- Verify the event trigger and the function privileges with
-- supabase/verify-005.sql after applying, instead of re-asserting
-- them blindly here.

COMMIT;
