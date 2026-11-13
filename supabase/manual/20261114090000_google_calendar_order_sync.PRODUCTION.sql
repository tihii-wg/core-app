-- =============================================================================
-- Google Calendar: team visibility + one-way order date sync
-- Script: 20261114090000_google_calendar_order_sync.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites:
--   1) 20261113100000_google_calendar.PRODUCTION.sql applied
--   2) Edge Function google-calendar-sync deployed
--   3) Vault secrets (create BEFORE applying this script — preflight fails if missing):
--        gcal_sync_function_url = https://pundggjzzaqzbvykbxvo.supabase.co/functions/v1/google-calendar-sync
--        gcal_sync_cron_token   = <same long random string as Edge secret GCAL_CRON_TOKEN>
--      Example (replace placeholders; run in SQL editor as postgres):
--        select vault.create_secret(
--          'https://pundggjzzaqzbvykbxvo.supabase.co/functions/v1/google-calendar-sync',
--          'gcal_sync_function_url',
--          'URL for google-calendar-sync Edge Function'
--        );
--        select vault.create_secret(
--          'REPLACE_WITH_LONG_RANDOM_TOKEN',
--          'gcal_sync_cron_token',
--          'Cron token for google-calendar-sync (must match GCAL_CRON_TOKEN)'
--        );
--   4) Extensions pg_cron + pg_net enabled
-- =============================================================================

do $gcal_order_sync$
begin
  -- -------------------------------------------------------------------------
  -- Preflight
  -- -------------------------------------------------------------------------
  if to_regclass('public.workspace_google_calendar') is null then
    raise exception 'gcal_order_sync preflight: workspace_google_calendar missing (apply google_calendar SQL first)';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'gcal_order_sync preflight: public.orders missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'gcal_order_sync preflight: is_workspace_member(uuid) missing';
  end if;
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    raise exception 'gcal_order_sync preflight: supabase_vault extension missing';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'gcal_order_sync preflight: enable pg_cron (Database → Extensions)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'gcal_order_sync preflight: enable pg_net (Database → Extensions)';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'gcal_sync_function_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'gcal_sync_cron_token') then
    raise exception 'gcal_order_sync preflight: create Vault secrets gcal_sync_function_url and gcal_sync_cron_token first';
  end if;

  -- -------------------------------------------------------------------------
  -- Columns on workspace_google_calendar (defaults keep personal calendar private)
  -- -------------------------------------------------------------------------
  alter table public.workspace_google_calendar
    add column if not exists team_access boolean not null default false;
  alter table public.workspace_google_calendar
    add column if not exists sync_orders boolean not null default false;
  alter table public.workspace_google_calendar
    add column if not exists sync_measurement boolean not null default false;
  alter table public.workspace_google_calendar
    add column if not exists sync_installation boolean not null default false;
  alter table public.workspace_google_calendar
    add column if not exists last_sync_error text;

  -- -------------------------------------------------------------------------
  -- Link table: which Google events we created (no FK on order_id — survives delete)
  -- -------------------------------------------------------------------------
  create table if not exists public.gcal_order_event_links (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    order_id uuid not null,
    field text not null check (field in ('deadline', 'measurement', 'installation')),
    calendar_id text not null,
    google_event_id text not null,
    etag text,
    synced_hash text,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, order_id, field)
  );
  alter table public.gcal_order_event_links enable row level security;
  revoke all on table public.gcal_order_event_links from public, anon, authenticated;
  grant all on table public.gcal_order_event_links to service_role;

  create index if not exists gcal_order_event_links_order_idx
    on public.gcal_order_event_links (workspace_id, order_id);

  -- -------------------------------------------------------------------------
  -- Sync queue
  -- -------------------------------------------------------------------------
  create table if not exists public.gcal_sync_queue (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    order_id uuid not null,
    enqueued_at timestamptz not null default now(),
    attempts int not null default 0,
    next_attempt_at timestamptz not null default now(),
    last_error text,
    primary key (workspace_id, order_id)
  );
  alter table public.gcal_sync_queue enable row level security;
  revoke all on table public.gcal_sync_queue from public, anon, authenticated;
  grant all on table public.gcal_sync_queue to service_role;

  create index if not exists gcal_sync_queue_due_idx
    on public.gcal_sync_queue (next_attempt_at, enqueued_at);

  -- -------------------------------------------------------------------------
  -- Enqueue helper (upsert reset)
  -- -------------------------------------------------------------------------
  create or replace function public.crm_gcal_enqueue_order(p_workspace_id uuid, p_order_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  begin
    if p_workspace_id is null or p_order_id is null then
      return;
    end if;
    insert into public.gcal_sync_queue (workspace_id, order_id, enqueued_at, attempts, next_attempt_at, last_error)
    values (p_workspace_id, p_order_id, now(), 0, now(), null)
    on conflict (workspace_id, order_id) do update
      set enqueued_at = now(),
          attempts = 0,
          next_attempt_at = now(),
          last_error = null;
  end;
  $fn$;

  revoke all on function public.crm_gcal_enqueue_order(uuid, uuid) from public, anon, authenticated;
  grant execute on function public.crm_gcal_enqueue_order(uuid, uuid) to service_role;

  -- -------------------------------------------------------------------------
  -- AFTER trigger on orders — never fails the order write
  -- -------------------------------------------------------------------------
  create or replace function public.crm_gcal_orders_enqueue_trigger()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_ws uuid;
    v_order_id uuid;
    v_sync boolean;
  begin
    begin
      if tg_op = 'DELETE' then
        v_ws := old.workspace_id;
        v_order_id := old.id;
      else
        v_ws := new.workspace_id;
        v_order_id := new.id;
      end if;

      select sync_orders into v_sync
        from public.workspace_google_calendar
       where workspace_id = v_ws;

      if coalesce(v_sync, false) is not true then
        if tg_op = 'DELETE' then return old; else return new; end if;
      end if;

      if tg_op = 'INSERT' or tg_op = 'DELETE'
         or (tg_op = 'UPDATE' and (
              old.deadline is distinct from new.deadline
           or old.measurement_at is distinct from new.measurement_at
           or old.installation_at is distinct from new.installation_at
           or old.status is distinct from new.status
           or old.custom_status_id is distinct from new.custom_status_id
           or old.kind is distinct from new.kind
           or old.number is distinct from new.number
           or old.client_id is distinct from new.client_id
           or old.vehicle_id is distinct from new.vehicle_id
           or old.total_price is distinct from new.total_price
         ))
      then
        perform public.crm_gcal_enqueue_order(v_ws, v_order_id);
      end if;
    exception when others then
      -- Never block order writes
      null;
    end;

    if tg_op = 'DELETE' then return old; else return new; end if;
  end;
  $fn$;

  drop trigger if exists trg_gcal_orders_enqueue on public.orders;
  create trigger trg_gcal_orders_enqueue
    after insert or update or delete on public.orders
    for each row execute function public.crm_gcal_orders_enqueue_trigger();

  -- -------------------------------------------------------------------------
  -- Backfill: non-estimate, non-cancelled, dates >= now() - 7 days
  -- -------------------------------------------------------------------------
  create or replace function public.crm_gcal_enqueue_backfill(p_workspace_id uuid)
  returns int
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_count int := 0;
    r record;
    v_cutoff timestamptz := now() - interval '7 days';
  begin
    if p_workspace_id is null then
      raise exception 'gcal:invalid_args' using errcode = '22023';
    end if;
    for r in
      select o.id
        from public.orders o
       where o.workspace_id = p_workspace_id
         and coalesce(o.kind, 'order') is distinct from 'estimate'
         and coalesce(o.status, '') is distinct from 'cancelled'
         and (
           o.deadline >= v_cutoff
           or o.measurement_at >= v_cutoff
           or o.installation_at >= v_cutoff
         )
    loop
      perform public.crm_gcal_enqueue_order(p_workspace_id, r.id);
      v_count := v_count + 1;
    end loop;
    return v_count;
  end;
  $fn$;

  revoke all on function public.crm_gcal_enqueue_backfill(uuid) from public, anon, authenticated;
  grant execute on function public.crm_gcal_enqueue_backfill(uuid) to service_role;

  -- Enqueue every linked order (used when sync is turned off → delete events)
  create or replace function public.crm_gcal_enqueue_linked_orders(p_workspace_id uuid)
  returns int
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  declare
    v_count int := 0;
    r record;
  begin
    if p_workspace_id is null then
      raise exception 'gcal:invalid_args' using errcode = '22023';
    end if;
    for r in
      select distinct order_id
        from public.gcal_order_event_links
       where workspace_id = p_workspace_id
    loop
      perform public.crm_gcal_enqueue_order(p_workspace_id, r.order_id);
      v_count := v_count + 1;
    end loop;
    return v_count;
  end;
  $fn$;

  revoke all on function public.crm_gcal_enqueue_linked_orders(uuid) from public, anon, authenticated;
  grant execute on function public.crm_gcal_enqueue_linked_orders(uuid) to service_role;

  -- -------------------------------------------------------------------------
  -- Claim batch (for update skip locked)
  -- -------------------------------------------------------------------------
  -- Claim = lease: due rows get next_attempt_at = now() + 3 min in the same statement, so a concurrent run
  -- (cron + client poke) cannot pick the same order and create a duplicate Google event. The processor deletes
  -- the row on success or sets a backoff on failure; a crashed run's rows come back after the lease expires.
  create or replace function public.crm_gcal_claim_sync_batch(p_limit int)
  returns table (
    workspace_id uuid,
    order_id uuid,
    attempts int,
    enqueued_at timestamptz
  )
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  #variable_conflict use_column
  begin
    return query
    with due as (
      select q.workspace_id as ws, q.order_id as oid
        from public.gcal_sync_queue q
       where q.next_attempt_at <= now()
       order by q.enqueued_at
       limit greatest(coalesce(p_limit, 50), 1)
       for update skip locked
    )
    update public.gcal_sync_queue q
       set next_attempt_at = now() + interval '3 minutes'
      from due d
     where q.workspace_id = d.ws and q.order_id = d.oid
    returning q.workspace_id, q.order_id, q.attempts, q.enqueued_at;
  end;
  $fn$;

  revoke all on function public.crm_gcal_claim_sync_batch(int) from public, anon, authenticated;
  grant execute on function public.crm_gcal_claim_sync_batch(int) to service_role;

  -- Claim due rows for one workspace (client poke)
  create or replace function public.crm_gcal_claim_sync_batch_workspace(p_workspace_id uuid, p_limit int)
  returns table (
    workspace_id uuid,
    order_id uuid,
    attempts int,
    enqueued_at timestamptz
  )
  language plpgsql
  security definer
  set search_path = pg_catalog, public
  as $fn$
  #variable_conflict use_column
  begin
    return query
    with due as (
      select q.workspace_id as ws, q.order_id as oid
        from public.gcal_sync_queue q
       where q.workspace_id = p_workspace_id
         and q.next_attempt_at <= now()
       order by q.enqueued_at
       limit greatest(coalesce(p_limit, 20), 1)
       for update skip locked
    )
    update public.gcal_sync_queue q
       set next_attempt_at = now() + interval '3 minutes'
      from due d
     where q.workspace_id = d.ws and q.order_id = d.oid
    returning q.workspace_id, q.order_id, q.attempts, q.enqueued_at;
  end;
  $fn$;

  revoke all on function public.crm_gcal_claim_sync_batch_workspace(uuid, int) from public, anon, authenticated;
  grant execute on function public.crm_gcal_claim_sync_batch_workspace(uuid, int) to service_role;

  -- -------------------------------------------------------------------------
  -- Postflight
  -- -------------------------------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'workspace_google_calendar' and column_name = 'team_access'
  ) then
    raise exception 'gcal_order_sync postflight: team_access missing';
  end if;
  if to_regclass('public.gcal_order_event_links') is null then
    raise exception 'gcal_order_sync postflight: gcal_order_event_links missing';
  end if;
  if to_regclass('public.gcal_sync_queue') is null then
    raise exception 'gcal_order_sync postflight: gcal_sync_queue missing';
  end if;
  if to_regprocedure('public.crm_gcal_enqueue_backfill(uuid)') is null then
    raise exception 'gcal_order_sync postflight: crm_gcal_enqueue_backfill missing';
  end if;
  if to_regprocedure('public.crm_gcal_claim_sync_batch(int)') is null then
    raise exception 'gcal_order_sync postflight: crm_gcal_claim_sync_batch missing';
  end if;

  notify pgrst, 'reload schema';
end;
$gcal_order_sync$;

-- Cron every 2 minutes (outside DO — same pattern as backups scheduler)
select cron.unschedule(jobid) from cron.job where jobname = 'google-calendar-order-sync';

select cron.schedule(
  'google-calendar-order-sync',
  '*/2 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'gcal_sync_function_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-gcal-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'gcal_sync_cron_token')
      ),
      body := jsonb_build_object('mode', 'scheduled'),
      timeout_milliseconds := 55000
    );
  $job$
);
