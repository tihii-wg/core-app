-- =============================================================================
-- Google Calendar: multiple visible calendars (overlay)
-- Script: 20261114120000_google_calendar_multi.PRODUCTION.sql
-- MAIN only. Requires 20261113100000_google_calendar (+ order sync optional).
-- Do NOT run against TEST. Manual apply after review.
-- =============================================================================

do $gcal_multi$
begin
  -- -------------------------------------------------------------------------
  -- Preflight
  -- -------------------------------------------------------------------------
  if to_regclass('public.workspace_google_calendar') is null then
    raise exception 'gcal_multi preflight: workspace_google_calendar missing';
  end if;

  -- -------------------------------------------------------------------------
  -- visible_calendars: snapshot of extra calendars (main is never stored here)
  -- -------------------------------------------------------------------------
  alter table public.workspace_google_calendar
    add column if not exists visible_calendars jsonb not null default '[]'::jsonb;

  -- -------------------------------------------------------------------------
  -- Postflight
  -- -------------------------------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'workspace_google_calendar'
       and column_name = 'visible_calendars'
  ) then
    raise exception 'gcal_multi postflight: visible_calendars missing';
  end if;

  notify pgrst, 'reload schema';
end;
$gcal_multi$;
