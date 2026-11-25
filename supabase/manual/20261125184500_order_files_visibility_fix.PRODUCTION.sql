-- =====================================================================================
-- Fix for 20261125180000_order_comments_files_visibility
-- Script: 20261125184500_order_files_visibility_fix.PRODUCTION.sql
-- MAIN only. Manual apply after review.
-- =====================================================================================
-- order_attachments.is_public already existed (crm_ro_v1) with DEFAULT false, so:
--   * "add column if not exists" was skipped and the backfill (only NULL rows) changed nothing —
--     every existing file became PRIVATE (hidden from employees);
--   * the column default false filled new rows before the trigger could apply the workspace default.
-- This script makes all files that existed before the visibility feature public again and drops the
-- column default so the trigger decides (workspace "default files visibility").
-- =====================================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.order_attachments_default_visibility()') is null then
    raise exception 'files_visibility_fix preflight: apply 20261125180000_order_comments_files_visibility first';
  end if;
end;
$preflight$;

-- Files uploaded before the visibility switch shipped (25.11.2026 16:45 Chisinau) were never chosen private.
update public.order_attachments
set is_public = true
where is_public = false
  and created_at < timestamptz '2026-11-25 16:45:00+02';

alter table public.order_attachments alter column is_public drop default;

do $postflight$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_attachments' and column_name = 'is_public'
      and column_default is not null
  ) then
    raise exception 'files_visibility_fix postflight: is_public still has a default';
  end if;
end;
$postflight$;

commit;
