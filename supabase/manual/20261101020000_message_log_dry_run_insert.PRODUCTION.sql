-- =====================================================================
-- Allow authenticated members with settings.notifications to INSERT
-- dry-run rows into message_log only:
--   provider = 'dry_run' AND status = 'skipped'
-- Real provider traffic stays blocked (crm_ro_v1 had insert = '-').
-- Idempotent. Apply after crm_ro_v1.PRODUCTION.sql (+ optional 2.1a).
-- =====================================================================

begin;

drop policy if exists message_log_dry_run_insert on public.message_log;
create policy message_log_dry_run_insert on public.message_log
  for insert
  to authenticated
  with check (
    workspace_id in (select public.crm_permitted_workspaces('settings.notifications'))
    and coalesce(provider, '') = 'dry_run'
    and status = 'skipped'
  );

commit;
