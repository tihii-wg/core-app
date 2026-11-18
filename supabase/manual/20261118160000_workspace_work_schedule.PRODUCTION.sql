-- =====================================================================================
-- Company working hours for printed documents
-- Script: 20261118160000_workspace_work_schedule.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- =====================================================================================
-- Adds workspaces.work_schedule (free text, e.g. "Mon–Fri 9:00–18:00, Sat 10:00–15:00").
-- Edited in Settings → Company, printed with the template variable #КОМПАНИЯ-ГРАФИК.
-- Same access as the other company fields (workspaces RLS / owner updates). Idempotent.
-- =====================================================================================

begin;

alter table public.workspaces
  add column if not exists work_schedule text;

do $check$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'workspaces_work_schedule_length' and conrelid = 'public.workspaces'::regclass
  ) then
    return;
  end if;
  alter table public.workspaces
    add constraint workspaces_work_schedule_length check (work_schedule is null or char_length(work_schedule) <= 500);
end;
$check$;

notify pgrst, 'reload schema';

do $postflight$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.workspaces'::regclass and attname = 'work_schedule' and not attisdropped
  ) then
    raise exception 'workspace_work_schedule postflight: column missing';
  end if;
end;
$postflight$;

commit;
