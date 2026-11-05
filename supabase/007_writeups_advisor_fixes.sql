-- 007_writeups_advisor_fixes: Harden writeups trigger function search_path,
-- wrap auth.uid() in scalar subqueries for RLS initplan caching, and add
-- covering index for study_article_progress.article_id foreign key.

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

alter policy study_article_progress_select_own
  on public.study_article_progress
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy study_article_progress_insert_own
  on public.study_article_progress
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy study_article_progress_update_own
  on public.study_article_progress
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists study_article_progress_article_id_idx
  on public.study_article_progress (article_id);
