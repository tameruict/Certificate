-- 009_learner_progress_and_password_recovery:
-- 1. Normalized learner progress tables:
--    - public.user_course_progress (per-user, per-course aggregated metrics & streaks)
--    - public.user_question_progress (per-user, per-course, per-question attempts & bookmarks)
--    - public.user_exam_attempts (per-user timed CBT mock exam history & domain breakdown)
-- 2. Automatic trigger sync from public.user_data_archive -> user_course_progress & user_question_progress.
-- 3. Self-service password recovery for forgotten passwords:
--    - Extend public.user_profiles with recovery_email and has_recovery_code
--    - public.user_recovery_credentials (bcrypt-hashed recovery code, rate-limit counters, lockout timestamp)
--    - public.password_reset_audit (immutable per-user audit log of recovery events)
--    - Hardened RPCs: public.set_user_recovery_code() and public.reset_password_with_recovery_code()

create extension if not exists pgcrypto with schema extensions;

create or replace function public.study_articles_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.study_articles_set_updated_at() from public, anon, authenticated;

-- ============================================================================
-- 1. Learner Progress Tables
-- ============================================================================

create table if not exists public.user_course_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null,
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  bookmarked_count integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  content_version text,
  last_activity_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, course_id),
  constraint user_course_progress_course_id_format
    check (course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  constraint user_course_progress_counts_valid
    check (
      answered_count >= 0
      and correct_count >= 0
      and correct_count <= answered_count
      and bookmarked_count >= 0
    ),
  constraint user_course_progress_streaks_valid
    check (streak >= 0 and best_streak >= 0 and best_streak >= streak),
  constraint user_course_progress_content_version_length
    check (content_version is null or char_length(content_version) <= 64)
);

comment on table public.user_course_progress is 'Normalized per-user, per-course study metrics and streaks synchronized with user_data_archive.';

create table if not exists public.user_question_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null,
  question_id text not null,
  selected_options text[] not null default '{}',
  is_correct boolean,
  bookmarked boolean not null default false,
  attempt_count integer not null default 0,
  answered_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, course_id, question_id),
  constraint user_question_progress_course_id_format
    check (course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  constraint user_question_progress_question_id_nonblank
    check (btrim(question_id) <> '' and char_length(question_id) <= 128),
  constraint user_question_progress_selected_options_bound
    check (coalesce(array_length(selected_options, 1), 0) <= 16),
  constraint user_question_progress_attempt_count_nonneg
    check (attempt_count >= 0)
);

comment on table public.user_question_progress is 'Normalized per-question answer state, attempt count, and review bookmarks for each learner.';

create index if not exists user_question_progress_review_idx
  on public.user_question_progress (user_id, course_id)
  where bookmarked = true or is_correct = false;

create table if not exists public.user_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null,
  total_questions integer not null,
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  score_percent smallint not null default 0,
  duration_seconds integer not null default 0,
  domain_breakdown jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint user_exam_attempts_course_id_format
    check (course_id ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  constraint user_exam_attempts_counts_valid
    check (
      total_questions > 0
      and total_questions <= 500
      and answered_count >= 0
      and answered_count <= total_questions
      and correct_count >= 0
      and correct_count <= answered_count
      and score_percent >= 0
      and score_percent <= 100
      and duration_seconds >= 0
      and duration_seconds <= 86400
    ),
  constraint user_exam_attempts_breakdown_valid
    check (
      jsonb_typeof(domain_breakdown) = 'object'
      and pg_column_size(domain_breakdown) <= 32768
    )
);

comment on table public.user_exam_attempts is 'Completed timed CBT mock exam sessions and per-domain score breakdowns.';

create index if not exists user_exam_attempts_user_course_completed_idx
  on public.user_exam_attempts (user_id, course_id, completed_at desc);

drop trigger if exists user_course_progress_updated_at on public.user_course_progress;
create trigger user_course_progress_updated_at
  before update on public.user_course_progress
  for each row execute function public.study_articles_set_updated_at();

drop trigger if exists user_question_progress_updated_at on public.user_question_progress;
create trigger user_question_progress_updated_at
  before update on public.user_question_progress
  for each row execute function public.study_articles_set_updated_at();

alter table public.user_course_progress enable row level security;
alter table public.user_question_progress enable row level security;
alter table public.user_exam_attempts enable row level security;

revoke all on table public.user_course_progress from public, anon, authenticated;
revoke all on table public.user_question_progress from public, anon, authenticated;
revoke all on table public.user_exam_attempts from public, anon, authenticated;

grant select, insert, update on table public.user_course_progress to authenticated;
grant select, insert, update, delete on table public.user_question_progress to authenticated;
grant select, insert on table public.user_exam_attempts to authenticated;

drop policy if exists user_course_progress_select_own on public.user_course_progress;
create policy user_course_progress_select_own
  on public.user_course_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_course_progress_insert_own on public.user_course_progress;
create policy user_course_progress_insert_own
  on public.user_course_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_course_progress_update_own on public.user_course_progress;
create policy user_course_progress_update_own
  on public.user_course_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_question_progress_select_own on public.user_question_progress;
create policy user_question_progress_select_own
  on public.user_question_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_question_progress_insert_own on public.user_question_progress;
create policy user_question_progress_insert_own
  on public.user_question_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_question_progress_update_own on public.user_question_progress;
create policy user_question_progress_update_own
  on public.user_question_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_question_progress_delete_own on public.user_question_progress;
create policy user_question_progress_delete_own
  on public.user_question_progress for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_exam_attempts_select_own on public.user_exam_attempts;
create policy user_exam_attempts_select_own
  on public.user_exam_attempts for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_exam_attempts_insert_own on public.user_exam_attempts;
create policy user_exam_attempts_insert_own
  on public.user_exam_attempts for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- ============================================================================
-- 2. Automatic Progress Synchronization Trigger from user_data_archive
-- ============================================================================

create or replace function public.sync_learner_progress_from_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_answers jsonb;
  v_bookmarks jsonb;
  v_answered_count integer := 0;
  v_correct_count integer := 0;
  v_bookmarked_count integer := 0;
  v_streak integer := 0;
  v_best_streak integer := 0;
  v_content_version text;
begin
  v_answers := case
    when pg_catalog.jsonb_typeof(new.payload->'answers') = 'object' then new.payload->'answers'
    else '{}'::jsonb
  end;
  v_bookmarks := case
    when pg_catalog.jsonb_typeof(new.payload->'bookmarks') = 'object' then new.payload->'bookmarks'
    else '{}'::jsonb
  end;

  select
    count(*)::integer,
    count(*) filter (where (val->>'correct') = 'true')::integer
  into v_answered_count, v_correct_count
  from pg_catalog.jsonb_each(v_answers) as t(k, val)
  where pg_catalog.jsonb_typeof(val) = 'object'
    and pg_catalog.btrim(k) <> ''
    and pg_catalog.char_length(k) <= 128;

  select count(*)::integer
  into v_bookmarked_count
  from pg_catalog.jsonb_each(v_bookmarks) as t(k, val)
  where val = 'true'::jsonb
    and pg_catalog.btrim(k) <> ''
    and pg_catalog.char_length(k) <= 128;

  v_streak := case
    when (new.payload->>'streak') ~ '^[0-9]{1,9}$' then greatest(0, (new.payload->>'streak')::integer)
    else 0
  end;
  v_best_streak := case
    when (new.payload->>'bestStreak') ~ '^[0-9]{1,9}$' then greatest(v_streak, (new.payload->>'bestStreak')::integer)
    else v_streak
  end;
  v_content_version := pg_catalog.left(
    nullif(pg_catalog.btrim(coalesce(new.payload->>'contentVersion', '')), ''),
    64
  );

  insert into public.user_course_progress (
    user_id, course_id, answered_count, correct_count, bookmarked_count,
    streak, best_streak, content_version, last_activity_at, updated_at
  )
  values (
    new.user_id, new.course_id, coalesce(v_answered_count, 0), coalesce(v_correct_count, 0),
    coalesce(v_bookmarked_count, 0), v_streak, v_best_streak, v_content_version,
    new.updated_at, pg_catalog.now()
  )
  on conflict (user_id, course_id) do update set
    answered_count = excluded.answered_count,
    correct_count = excluded.correct_count,
    bookmarked_count = excluded.bookmarked_count,
    streak = excluded.streak,
    best_streak = case
      when excluded.answered_count = 0 and excluded.streak = 0 and excluded.best_streak = 0 then 0
      else greatest(public.user_course_progress.best_streak, excluded.best_streak)
    end,
    content_version = excluded.content_version,
    last_activity_at = excluded.last_activity_at,
    updated_at = pg_catalog.now();

  delete from public.user_question_progress uqp
  where uqp.user_id = new.user_id
    and uqp.course_id = new.course_id
    and pg_catalog.jsonb_typeof(v_answers->uqp.question_id) is distinct from 'object'
    and coalesce((v_bookmarks->uqp.question_id) = 'true'::jsonb, false) is false;

  insert into public.user_question_progress (
    user_id, course_id, question_id, selected_options, is_correct,
    bookmarked, attempt_count, answered_at, updated_at
  )
  select
    new.user_id,
    new.course_id,
    q_id,
    coalesce(
      (
        select pg_catalog.array_agg(opt_text order by ord)
        from pg_catalog.jsonb_array_elements_text(
          case
            when pg_catalog.jsonb_typeof(v_answers->q_id) = 'object'
                 and pg_catalog.jsonb_typeof(v_answers->q_id->'selected') = 'array'
              then v_answers->q_id->'selected'
            else '[]'::jsonb
          end
        ) with ordinality as s(opt_text, ord)
        where ord <= 16
          and opt_text is not null
          and pg_catalog.char_length(opt_text) <= 64
      ),
      '{}'::text[]
    ),
    case
      when pg_catalog.jsonb_typeof(v_answers->q_id) = 'object' and (v_answers->q_id->>'correct') in ('true', 'false')
        then (v_answers->q_id->>'correct')::boolean
      else null
    end,
    coalesce((v_bookmarks->q_id) = 'true'::jsonb, false),
    case when pg_catalog.jsonb_typeof(v_answers->q_id) = 'object' then 1 else 0 end,
    case
      when pg_catalog.jsonb_typeof(v_answers->q_id) = 'object'
           and (v_answers->q_id->>'at') ~ '^[0-9]{1,15}$'
        then pg_catalog.to_timestamp(((v_answers->q_id->>'at')::bigint)::double precision / 1000.0)
      else null
    end,
    pg_catalog.now()
  from (
    select k as q_id from pg_catalog.jsonb_each(v_answers) as a(k, v) where pg_catalog.jsonb_typeof(v) = 'object'
    union
    select k as q_id from pg_catalog.jsonb_each(v_bookmarks) as b(k, v) where v = 'true'::jsonb
  ) as keys
  where pg_catalog.btrim(q_id) <> '' and pg_catalog.char_length(q_id) <= 128
  on conflict (user_id, course_id, question_id) do update set
    selected_options = excluded.selected_options,
    is_correct = excluded.is_correct,
    bookmarked = excluded.bookmarked,
    attempt_count = case
      when excluded.is_correct is not null and (
        public.user_question_progress.answered_at is distinct from excluded.answered_at
        or public.user_question_progress.selected_options is distinct from excluded.selected_options
      ) then public.user_question_progress.attempt_count + 1
      else greatest(public.user_question_progress.attempt_count, excluded.attempt_count)
    end,
    answered_at = coalesce(excluded.answered_at, public.user_question_progress.answered_at),
    updated_at = pg_catalog.now();

  return new;
end;
$$;

revoke all on function public.sync_learner_progress_from_archive() from public, anon, authenticated;

drop trigger if exists user_data_archive_sync_progress on public.user_data_archive;
create trigger user_data_archive_sync_progress
  after insert or update on public.user_data_archive
  for each row execute function public.sync_learner_progress_from_archive();

-- Backfill normalized progress tables from any pre-existing user_data_archive rows.
update public.user_data_archive
set updated_at = updated_at;

-- ============================================================================
-- 3. Password Recovery Schema & Hardened RPC Functions
-- ============================================================================

alter table public.user_profiles
  add column if not exists recovery_email text,
  add column if not exists has_recovery_code boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_profiles_recovery_email_format'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_recovery_email_format
      check (
        recovery_email is null
        or (
          char_length(recovery_email) <= 254
          and recovery_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        )
      );
  end if;
end $$;

create table if not exists public.user_recovery_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  recovery_code_hash text not null,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  last_reset_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_recovery_credentials_hash_bcrypt
    check (recovery_code_hash ~ '^\$2[abxy]\$[0-9]{2}\$.{53}$'),
  constraint user_recovery_credentials_failed_attempts_nonneg
    check (failed_attempts >= 0)
);

comment on table public.user_recovery_credentials is 'Bcrypt-hashed recovery codes and brute-force lockout state. Never directly selectable by client roles.';

drop trigger if exists user_recovery_credentials_updated_at on public.user_recovery_credentials;
create trigger user_recovery_credentials_updated_at
  before update on public.user_recovery_credentials
  for each row execute function public.study_articles_set_updated_at();

alter table public.user_recovery_credentials enable row level security;
revoke all on table public.user_recovery_credentials from public, anon, authenticated;

drop policy if exists user_recovery_credentials_deny_all on public.user_recovery_credentials;
create policy user_recovery_credentials_deny_all
  on public.user_recovery_credentials
  as restrictive
  for all
  to public
  using (false)
  with check (false);

create table if not exists public.password_reset_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  method text not null,
  succeeded boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint password_reset_audit_method_valid
    check (method in ('recovery_code', 'email_link'))
);

comment on table public.password_reset_audit is 'Per-user audit log of password recovery attempts.';

create index if not exists password_reset_audit_user_created_idx
  on public.password_reset_audit (user_id, created_at desc);

alter table public.password_reset_audit enable row level security;
revoke all on table public.password_reset_audit from public, anon, authenticated;
grant select on table public.password_reset_audit to authenticated;

drop policy if exists password_reset_audit_select_own on public.password_reset_audit;
create policy password_reset_audit_select_own
  on public.password_reset_audit for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- RPC: Configure or rotate the signed-in user's recovery code and optional recovery email.
create or replace function public.set_user_recovery_code(
  p_recovery_code text,
  p_recovery_email text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_normalized_code text;
  v_normalized_email text;
  v_fallback_username text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'Authentication required to set a recovery code.';
  end if;

  v_normalized_code := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(p_recovery_code, ''), '[\s-]+', '', 'g')
  );
  if v_normalized_code !~ '^[A-Z0-9]{12,64}$' then
    raise exception 'Recovery code must contain 12 to 64 alphanumeric characters.';
  end if;

  v_normalized_email := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_recovery_email, ''))), '');
  if v_normalized_email is not null and (
    pg_catalog.char_length(v_normalized_email) > 254
    or v_normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ) then
    raise exception 'Recovery email format is invalid.';
  end if;

  insert into public.user_recovery_credentials (
    user_id, recovery_code_hash, failed_attempts, locked_until, updated_at
  )
  values (
    v_user_id,
    extensions.crypt(v_normalized_code, extensions.gen_salt('bf', 10)),
    0,
    null,
    pg_catalog.now()
  )
  on conflict (user_id) do update set
    recovery_code_hash = excluded.recovery_code_hash,
    failed_attempts = 0,
    locked_until = null,
    updated_at = pg_catalog.now();

  update public.user_profiles
  set has_recovery_code = true,
      recovery_email = coalesce(v_normalized_email, public.user_profiles.recovery_email),
      updated_at = pg_catalog.now()
  where user_id = v_user_id;

  if not found then
    select pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(
          au.raw_user_meta_data->>'username',
          pg_catalog.split_part(coalesce(au.email, ''), '@', 1)
        )
      )
    )
    into v_fallback_username
    from auth.users au
    where au.id = v_user_id;

    if v_fallback_username ~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
      insert into public.user_profiles (user_id, username, has_recovery_code, recovery_email, updated_at)
      values (v_user_id, v_fallback_username, true, v_normalized_email, pg_catalog.now())
      on conflict (user_id) do update set
        has_recovery_code = true,
        recovery_email = coalesce(excluded.recovery_email, public.user_profiles.recovery_email),
        updated_at = pg_catalog.now();
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.set_user_recovery_code(text, text) from public, anon;
grant execute on function public.set_user_recovery_code(text, text) to authenticated;

-- RPC: Self-service password reset using username + recovery code.
-- Returns JSONB { ok: boolean, error?: string } so failed attempt counters and lockouts
-- persist across transactions without rolling back on authentication failure.
create or replace function public.reset_password_with_recovery_code(
  p_username text,
  p_recovery_code text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_normalized_code text;
  v_password text;
  v_user_id uuid;
  v_cred public.user_recovery_credentials%rowtype;
  v_next_attempts smallint;
begin
  v_username := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Username format is invalid.');
  end if;

  v_normalized_code := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(p_recovery_code, ''), '[\s-]+', '', 'g')
  );
  if v_normalized_code !~ '^[A-Z0-9]{12,64}$' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Recovery code must be 12–64 alphanumeric characters.');
  end if;

  v_password := coalesce(p_new_password, '');
  if pg_catalog.char_length(v_password) < 12
     or v_password !~ '[a-z]'
     or v_password !~ '[A-Z]'
     or v_password !~ '[0-9]'
     or v_password !~ '[^A-Za-z0-9]'
  then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'New password must be at least 12 characters and include lowercase, uppercase, number, and symbol.'
    );
  end if;

  select up.user_id
  into v_user_id
  from public.user_profiles up
  where pg_catalog.lower(up.username) = v_username
  limit 1;

  if v_user_id is null then
    select au.id
    into v_user_id
    from auth.users au
    where pg_catalog.lower(coalesce(au.raw_user_meta_data->>'username', '')) = v_username
       or pg_catalog.lower(coalesce(au.email, '')) = v_username || '@users.certlab.app'
    limit 1;
  end if;

  if v_user_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Invalid username or recovery code.');
  end if;

  select *
  into v_cred
  from public.user_recovery_credentials urc
  where urc.user_id = v_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Invalid username or recovery code.');
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > pg_catalog.now() then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'Account recovery is temporarily locked due to too many failed attempts. Please try again in 15 minutes.'
    );
  end if;

  if extensions.crypt(v_normalized_code, v_cred.recovery_code_hash) <> v_cred.recovery_code_hash then
    v_next_attempts := case
      when v_cred.locked_until is not null and v_cred.locked_until <= pg_catalog.now() then 1
      else least(32767, v_cred.failed_attempts + 1)
    end;
    update public.user_recovery_credentials
    set failed_attempts = v_next_attempts,
        locked_until = case
          when v_next_attempts >= 5 then pg_catalog.now() + interval '15 minutes'
          else null
        end,
        updated_at = pg_catalog.now()
    where user_id = v_user_id;

    insert into public.password_reset_audit (user_id, method, succeeded)
    values (v_user_id, 'recovery_code', false);

    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Invalid username or recovery code.');
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      updated_at = pg_catalog.now()
  where id = v_user_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'Invalid username or recovery code.');
  end if;

  update public.user_recovery_credentials
  set failed_attempts = 0,
      locked_until = null,
      last_reset_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where user_id = v_user_id;

  insert into public.password_reset_audit (user_id, method, succeeded)
  values (v_user_id, 'recovery_code', true);

  return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reset_password_with_recovery_code(text, text, text) from public;
grant execute on function public.reset_password_with_recovery_code(text, text, text) to anon, authenticated;
