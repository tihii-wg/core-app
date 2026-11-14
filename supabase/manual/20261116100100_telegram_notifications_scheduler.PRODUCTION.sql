-- =============================================================================
-- Scheduler for Telegram notifications (pg_cron + pg_net → Edge Function "telegram-dispatch")
-- Script: 20261116100100_telegram_notifications_scheduler.PRODUCTION.sql
-- Apply ONLY after: 20261116100000_telegram_notifications, Edge Functions "telegram-dispatch" and
-- "telegram-webhook" deployed, and two Vault secrets created (Project Settings → Vault):
--   telegram_dispatch_url = https://<project-ref>.supabase.co/functions/v1/telegram-dispatch
--   telegram_cron_token   = a long random string, also set as Edge Function secret TELEGRAM_CRON_TOKEN
-- Requires extensions pg_cron and pg_net (Database → Extensions).
-- =============================================================================

do $preflight$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'telegram scheduler preflight: enable pg_cron (Database → Extensions)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'telegram scheduler preflight: enable pg_net (Database → Extensions)';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'telegram_dispatch_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'telegram_cron_token') then
    raise exception 'telegram scheduler preflight: create Vault secrets telegram_dispatch_url and telegram_cron_token first';
  end if;
  if to_regprocedure('public.crm_notify_daily()') is null then
    raise exception 'telegram scheduler preflight: apply 20261116100000_telegram_notifications first';
  end if;
end;
$preflight$;

select cron.unschedule(jobid) from cron.job where jobname in ('telegram-dispatch-minutely', 'telegram-daily-reminders');

-- Retries / anything the instant kick missed.
select cron.schedule(
  'telegram-dispatch-minutely',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_dispatch_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-telegram-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_cron_token')
      ),
      body := jsonb_build_object('mode', 'scheduled'),
      timeout_milliseconds := 30000
    )
    where exists (select 1 from public.notification_outbox where sent_at is null and attempts < 5);
  $job$
);

-- Deadlines / overdue / payment stages: 06:05 UTC ≈ 08:05 Chisinau (dates use each workspace timezone).
select cron.schedule(
  'telegram-daily-reminders',
  '5 6 * * *',
  $job$ select public.crm_notify_daily(); $job$
);

-- Check: select jobname, schedule, active from cron.job where jobname like 'telegram-%';
