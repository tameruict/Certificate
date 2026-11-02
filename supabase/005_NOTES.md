# Supabase hardening 005 — draft notes (NOT yet applied)

> **Status: DRAFT ONLY.** `supabase/005_hardening.sql` is a migration file in
> a pull request. It has **not** been applied to any live Supabase project,
> it must **not** be run against the live "comptia learn" project without
> the staging checklist below, and no Supabase Auth dashboard setting has
> been changed by this PR. No secrets or service-role keys are involved.

## Files in this PR

- `supabase/005_hardening.sql` — the migration (draft).
- `supabase/verify-005.sql` — read-only verification queries to run
  **after** applying, on staging first and then (only after approval) live.
  It contains `SELECT` statements only and modifies nothing.
- This file — explanation, decisions still pending, and the checklist.

No application code (JS/CSS) is changed by this PR.

## 1. The 001 / 002 / 004 / 005 numbering gap — do not renumber

At the base of this branch (`main` at `2a509e4b`), `supabase/` contains
exactly:

- `001_user_auth_and_archive.sql`
- `002_security_hardening.sql`
- `004_drop_unused_index.sql`

There is **no `003` file in the tree**, and the README migration list
likewise jumps from 002 to 004. **Do not renumber the old files** — the
numbers are part of the applied-history record, and renumbering would
make it impossible to tell which files a given database has already run.

What the history shows (and what it does not prove):

- A file named `supabase/003_expand_payload_and_versioning.sql` **did
  exist in the parent commit** (`49002d7`, the commit immediately before
  the base). It raised the payload size constraint from 256 KB to 1 MB,
  added a nullable `content_version` column with a date-format check,
  and added a covering index for the `(user_id, course_id)` lookup.
- That file is absent from the base commit, so it was removed from the
  tree in (or by) the base commit. The commit message for the base does
  not explain the removal, so the **intent behind the removal is
  unknown**, and — more importantly — **whether 003 was ever applied to
  the live database is unverified from the repository alone**.
- The current app code (`lib/app.js`) still warns at 230 KB and refuses
  to archive above 256 KB, so even if a live database had the 1 MB cap
  from old 003, the app would not use the extra headroom today.

Consequences for 005, all deliberate:

- 005 does **not** touch the payload size constraint and does **not**
  add or reference a `content_version` column, so it applies cleanly
  whether the live database has the 256 KB cap (001/002 only) or the
  1 MB cap (old 003 also applied).
- Do **not** re-create 003 from history as part of this PR. If the
  1 MB headroom / `content_version` column is wanted, that is a separate
  decision with its own PR, after confirming the live schema.
- Before applying 005 live, check the live schema (via
  `verify-005.sql`, which reports the current payload constraint) and
  record which cap is actually in place. Do not assume it from the repo.

## 2. Server-side `updated_at` (user_data_archive only)

What changes: a `BEFORE INSERT OR UPDATE` trigger overwrites
`user_data_archive.updated_at` with `now()` (server time), ignoring
whatever the client sent.

Why: `lib/app.js` `archiveProgress()` upserts:

```js
supabase.from('user_data_archive').upsert({
  user_id: app.auth.user.id,
  course_id: app.course.id,
  payload: app.progress,
  updated_at: updatedAt, // from app.progress.updatedAt — the browser clock
}, { onConflict: 'user_id,course_id' });
```

and `restoreCloudProgress()` compares the returned `updated_at` column
against the local payload's `updatedAt` to decide which copy wins. A
client-controlled timestamp in that compare is exactly the field an
abusive or skewed client can manipulate.

Behaviour change to re-test (not just a formality):

- After the trigger, the column is server time while
  `payload.updatedAt` stays on the browser clock. With a browser clock
  ahead of the server, local time can remain "newer" than the server
  column after a successful upsert, so the next restore may re-archive
  (an extra upsert per load, not data loss — but confirm it on staging,
  including with a deliberately skewed client clock).
- `user_profiles.updated_at` is **not** covered: `ensureProfile()`
  still sends a client timestamp, and profiles are not part of the
  progress restore compare. Adding a profiles trigger is future work.

Rollback is a comment in the SQL file (drop trigger, then drop
function). Rolling back does not restore old client timestamps for
rows already written.

## 3. Per-user row cap (100 rows) — and what it is not

Mechanism: a `BEFORE INSERT` trigger on `user_data_archive` raises an
exception when the user already has at least 100 rows, **unless** a row
with the same `(user_id, course_id)` already exists (the upsert-update
path, which must never be blocked by the cap).

Why 100 is safe for current use: the app has only 2 courses, and the
live counts at plan time were 2 profiles / 1 archive row in total. The
cap only bites on invented `course_id` values, which the existing
format check (`^[a-z0-9][a-z0-9._-]{0,127}$`) does not prevent.

Limits, stated plainly:

- Best-effort, not an exact quota: concurrent inserts near the cap can
  both pass the count check. An exact quota needs a counter table or
  advisory lock and is out of scope.
- The trigger is deliberately **not** `SECURITY DEFINER`, so its count
  query is still scoped by RLS to the caller's own rows. Test it as the
  `authenticated` role on staging, not as `postgres` (which bypasses
  RLS and would hide a scoping bug).
- A capped user currently sees only the generic app toast
  ("Cloud archive failed: ..."). Dedicated UX copy is future work.

## 4. Grant tightening (defence in depth, not the primary control)

`authenticated` keeps exactly `SELECT, INSERT, UPDATE` on both tables —
the only privileges the app flow uses (select on restore/load,
insert/update on upsert). `DELETE`, `TRUNCATE`, and `REFERENCES` are
revoked from `authenticated`.

This is defence in depth: 001 already granted only those three
privileges, and no DELETE policy exists, so RLS would already block a
delete. The revokes make the intent explicit and protect against a
future migration accidentally widening grants. They **must** be tested
against the real insert/select/update flow on staging (see checklist):
a failure here surfaces as a permission error, not an RLS error.

Explicitly **not** touched: `postgres` and `service_role` grants, and
the `anon` revokes already in place from 001/002.

## 5. Corrected `user_profiles` comment

Old comment (001): "Public username lookup for CertLab accounts".
That is misleading: the SELECT policy allows a user to read only their
own row, so there is no cross-user username lookup through the
authenticated path. New comment:

> own-user only: policies allow a user to read/insert/update only their
> own row; NOT a public username lookup

Comment-only change; no policy, grant, or column changes.

## 6. `rls_auto_enable` + `ensure_rls`: KEEP, do not drop

- `public.rls_auto_enable()` is a `SECURITY DEFINER` event-trigger
  function that auto-enables RLS on newly created `public` tables.
- `ensure_rls` is the enabled `ddl_command_end` event trigger that
  calls it.
- 002 already revoked `EXECUTE` on `rls_auto_enable()` from `public`,
  `anon`, and `authenticated`, so browser roles cannot invoke it
  directly; the event trigger itself still fires.

These objects are **not defined in the repo migrations** (they are
live-database / platform objects); 005 neither creates nor drops them,
and deliberately does not re-run the 002 revoke (re-running it without
the exact function signature could fail if the function is ever
overloaded). Verify their presence and privileges with
`verify-005.sql` instead.

Do not drop them in a follow-up without a separate review: dropping
the auto-RLS guard would silently leave any future `public` table
without RLS until someone notices.

## 7. Strict payload allowlist: PROPOSAL ONLY, not enforced

The exact progress shape is not fully certain from the app code alone,
so this PR does **not** add an enforced payload allowlist constraint.

Observed shape (from `lib/app.js` at the base, for the proposal only):

- `baseProgress()` returns
  `{ version: 2, answers: {}, bookmarks: {}, streak: 0,
     migratedLegacy: false, updatedAt: null, contentVersion: null }`.
- `archiveProgress()` upserts `payload: app.progress` (that shape, plus
  whatever `loadProgress()` / `migrateLegacyProgress()` preserved),
  with a client-side size guard (warn > 230 KB, refuse > 256 KB).
- The database already enforces: payload is a JSON object, and
  `pg_column_size(payload) <= 262144` (or 1 MB if old 003 was applied
  live — see §1).

Proposal for a future, separately-reviewed migration (do not apply
without first dumping the real key set from staging payloads):

- Allowlist top-level keys to the observed set (`version`, `answers`,
  `bookmarks`, `streak`, `migratedLegacy`, `updatedAt`,
  `contentVersion`, plus any keys actually present in staging payloads
  that this review missed), with a `CHECK` that rejects unknown keys.
- Keep the existing object + size checks; an allowlist is in addition
  to them, not a replacement.
- Risk if done wrong: a legitimate key added by a future app version
  (or a legacy key preserved by `migrateLegacyProgress()`) would make
  every archive upsert fail for affected users. That is why this stays
  a proposal until the staging payload key set is measured.

## 8. Signup: STILL PENDING — no code change either way

This PR does **not** change the signup flow or any Auth setting.
The decision recorded in the audit remains open; both options are
restated here so the choice is made explicitly, not by accident:

**Option A — keep signup public, harden around it.**

- Keep open signup as-is.
- Rely on the caps in this PR (per-row size, 100-row cap) plus the
  existing client-side password rules, and add a neutral
  duplicate-username message (do not confirm whether a username is
  taken) — that message change is app code, not this SQL PR.
- Residual risk: anyone can create accounts; abuse is bounded by caps,
  not prevented at signup.

**Option B — gate signup.**

- Invite-only and/or CAPTCHA at signup, decided in the Supabase Auth
  dashboard (a dashboard step, never a change in this repo).
- Documented admin procedure for password reset and account deletion,
  since users can no longer self-serve those paths the same way.
- Residual risk / cost: friction for legitimate new users, and an
  admin process that must actually be staffed.

Either way, the **server-side password policy is a separate dashboard
step** (currently client-only in the app): it is pending, it is not
changed by this PR, and it must not be confused with "done" just
because this PR merges.

## 9. What is still pending after this PR (do not mark as done)

1. **Signup decision** (§8, Option A vs B) — user decision required.
2. **Server password-policy dashboard step** — dashboard change, not
   in this repo; still pending after this PR.
3. **Applying the migration** — this PR is a file only. Applying
   requires the staging checklist below, then a separate explicit
   approval to run it (SQL Editor or CLI) against the live project.
   Merging this PR does **not** apply anything to the database.

## 10. Manual checklist before applying live

Do all of these on a **staging project first**, then repeat the
apply + verify steps live only after a separate approval:

- [ ] Staging project created (or an existing non-production project
      chosen); 001, 002, 004 applied to it in order, and the app's
      insert/select/update flow confirmed working **before** 005.
- [ ] Record staging's current payload size constraint (256 KB vs
      1 MB) and whether a `content_version` column exists — this
      resolves the §1 open question for that database.
- [ ] Apply `005_hardening.sql` on staging; confirm it commits with
      no error (if any statement fails, the transaction rolls back —
      do not partially apply by hand).
- [ ] Run `verify-005.sql` on staging; confirm: RLS enabled on both
      tables, the expected 3 policies per table, both new triggers
      present, `authenticated` has exactly SELECT/INSERT/UPDATE and
      no DELETE/TRUNCATE, and the `user_profiles` comment is corrected.
- [ ] As an `authenticated` staging user (not postgres): sign up /
      sign in, open a course, answer questions, reload (restore path),
      and confirm progress saves and restores. Then create progress
      for a second course and confirm the upsert-update path still
      works when the row already exists.
- [ ] Skewed-clock test: set the test browser clock ahead of the
      server, save progress, reload, and observe the restore compare
      (§2). Record whether it re-archives on every load; if it does,
      decide whether that is acceptable or whether the app compare
      needs a fix **before** live apply.
- [ ] Row-cap test: on staging, insert rows for 100 distinct
      `course_id` values for one test user (via the SQL editor as that
      user or a staging script), then confirm (a) the 101st new course
      is rejected, and (b) updating one of the existing 100 still
      succeeds.
- [ ] Grant test: as `authenticated`, confirm a DELETE attempt fails
      (it should already have failed under RLS; the grant revoke is
      the second layer) and that insert/select/update still succeed.
- [ ] Confirm `rls_auto_enable` / `ensure_rls` are still present and
      enabled after applying (verify-005 covers this); confirm no
      `postgres` / `service_role` grant changed.
- [ ] Only then, with explicit user approval: apply the same file to
      the live project, re-run `verify-005.sql` live, and re-run the
      app smoke test (sign in, save, reload) against live.
- [ ] If anything fails live: do not hand-edit the live schema to
      "fix it forward" without recording it — use the rollback
      comments in the SQL file, and record the deviation in a
      follow-up note so the repo and the live schema do not drift.
