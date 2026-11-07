-- =============================================================================
-- Hourly scheduler for per-workspace backups (pg_cron + pg_net → Edge Function)
-- Script: 20261107140100_workspace_backups_scheduler.PRODUCTION.sql
-- Apply ONLY after: 20261107140000_workspace_backups, Edge Function "workspace-backup" deployed,
-- and two Vault secrets created (Supabase → Project Settings → Vault):
--   backup_function_url  = https://<project-ref>.supabase.co/functions/v1/workspace-backup
--   backup_cron_token    = a long random string, also set as Edge Function secret BACKUP_CRON_TOKEN
-- Requires extensions pg_cron and pg_net (Database → Extensions).
-- =============================================================================

do $preflight$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'scheduler preflight: enable pg_cron (Database → Extensions)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'scheduler preflight: enable pg_net (Database → Extensions)';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'backup_function_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'backup_cron_token') then
    raise exception 'scheduler preflight: create Vault secrets backup_function_url and backup_cron_token first';
  end if;
end;
$preflight$;

select cron.unschedule(jobid) from cron.job where jobname = 'workspace-backups-hourly';

select cron.schedule(
  'workspace-backups-hourly',
  '7 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'backup_function_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-backup-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'backup_cron_token')
      ),
      body := jsonb_build_object('mode', 'scheduled'),
      timeout_milliseconds := 60000
    );
  $job$
);

-- Check: select jobname, schedule, active from cron.job where jobname = 'workspace-backups-hourly';
