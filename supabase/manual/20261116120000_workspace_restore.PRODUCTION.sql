-- =============================================================================
-- Restore a workspace backup (ZIP from workspace-backup) into a NEW workspace.
-- Script: 20261116120000_workspace_restore.PRODUCTION.sql — apply manually on MAIN.
-- Apply after 20261107140000_workspace_backups. Then deploy Edge Function "workspace-restore".
--
-- Adds:
--   * orders.number unique per workspace (was globally unique) so a restored copy can keep its order numbers.
--     All app lookups by number are already scoped by workspace_id.
--   * public.workspace_restore_jobs — restore progress (owner can read own jobs; writes service_role only).
--   * public.crm_backup_restore_workspace(...) — service_role only, called by the Edge Function:
--       creates the new workspace, inserts all backup rows (ids already remapped by the function) with the user
--       triggers of the affected tables disabled inside the transaction (so nothing is re-applied: stock moves,
--       notifications, numbering) and FK checks deferred to the end of the restore, forces workspace_id to the
--       new workspace, rejects references to other tenants' rows, skips credential/integration tables
--       (reconnect them after restore). The affected tables are locked for the few seconds the restore takes.
--   * public.crm_backup_restore_tables() — plan tables + skip reason (used by the Edge Function).
--   * public.crm_backup_restore_unique_risks() — lists unique indexes that ignore workspace_id (diagnostics).
-- Idempotent. Transactional.
-- =============================================================================

begin;

create or replace function pg_temp.crm_backup_restore_skip_reason_preflight(p_table text)
returns boolean language sql stable as $fn$
  select not (
    p_table in ('notification_outbox', 'telegram_link_tokens', 'user_telegram_links', 'workspace_backup_settings',
                'workspace_backup_runs')
    or p_table ~* '(oauth|integration|webhook)'
    or exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || quote_ident(p_table))
               and a.attnum > 0 and not a.attisdropped
               and a.attname ~* '(secret|token|credential|password|refresh|access_key|api_key)')
  );
$fn$;

do $preflight$
begin
  if to_regprocedure('public.crm_backup_table_plan()') is null then
    raise exception 'workspace_restore preflight: apply 20261107140000_workspace_backups first';
  end if;
  -- The restore disables triggers / defers FKs on the tables it writes: that needs table ownership.
  declare
    v_not_owned text;
  begin
    select string_agg(x.t, ', ') into v_not_owned
    from (
      select p.table_name as t from public.crm_backup_table_plan() p
      union select 'workspaces' union select 'workspace_members'
    ) x
    join pg_class c on c.oid = to_regclass('public.' || quote_ident(x.t))
    where c.relowner <> (select oid from pg_roles where rolname = current_user)
      and pg_temp.crm_backup_restore_skip_reason_preflight(x.t);
    if v_not_owned is not null then
      raise exception 'workspace_restore preflight: tables not owned by %: %', current_user, v_not_owned;
    end if;
  end;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- orders.number: unique per workspace instead of globally
-- ---------------------------------------------------------------------------
do $orders_number$
begin
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.orders'::regclass and c.conname = 'orders_number_key'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (number)'
  ) then
    alter table public.orders drop constraint orders_number_key;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.orders'::regclass and pg_get_constraintdef(c.oid) = 'UNIQUE (workspace_id, number)'
  ) then
    alter table public.orders add constraint orders_workspace_number_key unique (workspace_id, number);
  end if;
end;
$orders_number$;

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_restore_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_workspace_id uuid not null,
  target_workspace_id uuid,
  status text not null default 'running' check (status in ('running', 'files', 'done', 'failed')),
  file_map jsonb not null default '{}'::jsonb,
  files_total integer not null default 0,
  files_done integer not null default 0,
  files_failed integer not null default 0,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists workspace_restore_jobs_user_idx on public.workspace_restore_jobs (user_id, created_at desc);
alter table public.workspace_restore_jobs enable row level security;
drop policy if exists workspace_restore_jobs_own_select on public.workspace_restore_jobs;
create policy workspace_restore_jobs_own_select on public.workspace_restore_jobs
  for select to authenticated using (user_id = auth.uid());
revoke all on public.workspace_restore_jobs from public, anon, authenticated;
grant select (id, source_workspace_id, target_workspace_id, status, files_total, files_done, files_failed, summary, error,
              created_at, finished_at)
  on public.workspace_restore_jobs to authenticated;
grant all on public.workspace_restore_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Which backup tables are restored, and which are skipped
-- ---------------------------------------------------------------------------
create or replace function public.crm_backup_restore_skip_reason(p_table text)
returns text
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select case
    when p_table in ('notification_outbox', 'telegram_link_tokens', 'user_telegram_links', 'workspace_restore_jobs',
                     'workspace_backup_settings', 'workspace_backup_runs')
      then 'system'
    when exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || quote_ident(p_table)) and a.attnum > 0 and not a.attisdropped
        and a.attname ~* '(secret|token|credential|password|refresh|access_key|api_key)'
    ) then 'credentials'
    when p_table ~* '(oauth|integration|webhook)' then 'credentials'
    else null
  end;
$fn$;
revoke all on function public.crm_backup_restore_skip_reason(text) from public, anon, authenticated;
grant execute on function public.crm_backup_restore_skip_reason(text) to service_role;

create or replace function public.crm_backup_restore_tables()
returns table (table_name text, mode text, skip_reason text)
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select p.table_name, p.mode, public.crm_backup_restore_skip_reason(p.table_name)
  from public.crm_backup_table_plan() p;
$fn$;
revoke all on function public.crm_backup_restore_tables() from public, anon, authenticated;
grant execute on function public.crm_backup_restore_tables() to service_role;

-- Unique indexes that do not include workspace_id (a restored copy may collide with the original on them).
create or replace function public.crm_backup_restore_unique_risks()
returns table (table_name text, index_name text, definition text)
language sql stable security definer set search_path = pg_catalog, public as $fn$
  select p.table_name, i.relname::text, pg_get_indexdef(ix.indexrelid)
  from public.crm_backup_table_plan() p
  join pg_index ix on ix.indrelid = to_regclass('public.' || quote_ident(p.table_name)) and ix.indisunique and not ix.indisprimary
  join pg_class i on i.oid = ix.indexrelid
  where public.crm_backup_restore_skip_reason(p.table_name) is null
    and not exists (
      select 1 from unnest(ix.indkey) k
      join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k
      where a.attname = 'workspace_id' or format_type(a.atttypid, a.atttypmod) = 'uuid'
    );
$fn$;
revoke all on function public.crm_backup_restore_unique_risks() from public, anon, authenticated;
grant execute on function public.crm_backup_restore_unique_risks() to service_role, postgres;

-- ---------------------------------------------------------------------------
-- Restore
-- ---------------------------------------------------------------------------
-- p_tables: { "<table>": [ rows... ] } with every id already remapped to fresh uuids (the source workspace id → p_target).
-- p_foreign_uuids: uuids found in the rows that are not ids of restored rows (users, global refs, or tampering).
create or replace function public.crm_backup_restore_workspace(
  p_user uuid,
  p_source uuid,
  p_target uuid,
  p_name text,
  p_workspace jsonb,
  p_tables jsonb,
  p_foreign_uuids uuid[]
)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, public as $fn$
declare
  v_source jsonb;
  v_ws jsonb;
  v_owned uuid[];
  v_plan record;
  v_table text;
  v_rows jsonb;
  v_reason text;
  v_cols text;
  v_select text;
  v_count bigint;
  v_bad bigint;
  v_restored jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_pk_col text;
  v_pk_type text;
  v_key text;
  v_rel regclass;
  v_tables text[];
  v_trg record;
  v_triggers jsonb := '[]'::jsonb;
  v_fks jsonb := '[]'::jsonb;
  v_item jsonb;
  v_protected text[] := array['id', 'owner_id', 'created_at', 'updated_at', 'deleted_at', 'name',
                              'subscription_status', 'subscription_started_at', 'subscription_expires_at',
                              'subscription_updated_at'];
begin
  if p_user is null or p_source is null or p_target is null then
    raise exception 'workspace_restore:invalid_args' using errcode = '22023';
  end if;

  select to_jsonb(w) into v_source from public.workspaces w where w.id = p_source and w.owner_id = p_user;
  if v_source is null then
    raise exception 'workspace_restore:owner_only' using errcode = '42501';
  end if;
  if exists (select 1 from public.workspaces where id = p_target) then
    raise exception 'workspace_restore:target_exists' using errcode = '23505';
  end if;

  select coalesce(array_agg(w.id), '{}') into v_owned from public.workspaces w where w.owner_id = p_user;

  -- No row may point at another tenant's workspace or rows.
  if coalesce(array_length(p_foreign_uuids, 1), 0) > 0 then
    if exists (select 1 from public.workspaces w where w.id = any (p_foreign_uuids) and not (w.id = any (v_owned))) then
      raise exception 'workspace_restore:foreign_reference workspaces' using errcode = '42501';
    end if;
    for v_plan in select * from public.crm_backup_table_plan() where mode = 'direct' loop
      if exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || quote_ident(v_plan.table_name))
                 and a.attname = 'id' and not a.attisdropped) then
        execute format('select count(*) from public.%I t where t.id::text = any ($1) and not (t.workspace_id = any ($2))',
                       v_plan.table_name)
          into v_bad using (select array_agg(u::text) from unnest(p_foreign_uuids) u), v_owned;
        if v_bad > 0 then
          raise exception 'workspace_restore:foreign_reference %', v_plan.table_name using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;

  -- Tables this restore writes to.
  select array_agg(p.table_name) into v_tables
  from public.crm_backup_table_plan() p
  where p_tables ? p.table_name and public.crm_backup_restore_skip_reason(p.table_name) is null;
  v_tables := coalesce(v_tables, '{}') || array['workspaces', 'workspace_members'];

  -- Fail fast instead of queueing behind busy sessions.
  perform set_config('lock_timeout', '15s', true);

  -- User triggers off (by name, remembering their mode) so rows are inserted exactly as backed up:
  -- no stock moves, notifications, numbering or seeding. Restored before the function returns.
  for v_trg in
    select t.tgrelid::regclass as rel, t.tgname, t.tgenabled
    from pg_trigger t
    where t.tgrelid in (select to_regclass('public.' || quote_ident(x)) from unnest(v_tables) x)
      and not t.tgisinternal and t.tgenabled <> 'D'
  loop
    execute format('alter table %s disable trigger %I', v_trg.rel, v_trg.tgname);
    v_triggers := v_triggers || jsonb_build_array(jsonb_build_object('rel', v_trg.rel::text, 'name', v_trg.tgname, 'mode', v_trg.tgenabled));
  end loop;

  -- FK checks deferred to the end of the restore (rows arrive in any order); checked all at once below.
  for v_trg in
    select con.conrelid::regclass as rel, con.conname
    from pg_constraint con
    where con.contype = 'f' and not con.condeferrable
      and con.conrelid in (select to_regclass('public.' || quote_ident(x)) from unnest(v_tables) x)
  loop
    execute format('alter table %s alter constraint %I deferrable initially deferred', v_trg.rel, v_trg.conname);
    v_fks := v_fks || jsonb_build_array(jsonb_build_object('rel', v_trg.rel::text, 'name', v_trg.conname));
  end loop;

  -- Workspace row: current source row as the base, archive settings on top, protected fields from the server.
  v_ws := v_source;
  if jsonb_typeof(p_workspace) = 'object' then
    for v_key in select jsonb_object_keys(p_workspace) loop
      if v_ws ? v_key and not (v_key = any (v_protected)) and v_key !~* '(secret|token|credential|password)' then
        v_ws := jsonb_set(v_ws, array[v_key], p_workspace -> v_key);
      end if;
    end loop;
  end if;
  v_ws := v_ws || jsonb_build_object(
    'id', p_target,
    'owner_id', p_user,
    'name', left(coalesce(nullif(trim(p_name), ''), v_source ->> 'name'), 200),
    'created_at', now(),
    'updated_at', now(),
    'deleted_at', null
  );
  insert into public.workspaces select * from jsonb_populate_record(null::public.workspaces, v_ws);

  -- Direct tables first, then child tables (their parent check needs the parents in place).
  for v_plan in
    select p.* from public.crm_backup_table_plan() p
    order by (p.mode = 'direct') desc, p.table_name
  loop
    v_table := v_plan.table_name;
    if not (p_tables ? v_table) then continue; end if;
    v_rows := p_tables -> v_table;
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 then continue; end if;

    v_reason := public.crm_backup_restore_skip_reason(v_table);
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object(v_table, v_reason);
      continue;
    end if;

    -- Single-column non-uuid primary key (identity/serial): let the database assign new values,
    -- unless other tables reference it (then the copy cannot be remapped safely).
    v_pk_col := null;
    select a.attname, format_type(a.atttypid, a.atttypmod) into v_pk_col, v_pk_type
    from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = ix.indkey[0]
    where ix.indrelid = to_regclass('public.' || quote_ident(v_table)) and ix.indisprimary and ix.indnatts = 1;
    if v_pk_col is not null and v_pk_type in ('integer', 'bigint', 'smallint') then
      if exists (select 1 from pg_constraint c where c.contype = 'f'
                 and c.confrelid = to_regclass('public.' || quote_ident(v_table))) then
        raise exception 'workspace_restore:unsupported_integer_key %', v_table using errcode = '0A000';
      end if;
    else
      v_pk_col := null;
    end if;

    -- Columns present in the backup and in the table today (new columns get their defaults).
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg(case when a.attname = 'workspace_id' and v_plan.mode = 'direct' then '$2'
                           else 'r.' || quote_ident(a.attname) end, ', ' order by a.attnum)
      into v_cols, v_select
    from pg_attribute a
    where a.attrelid = to_regclass('public.' || quote_ident(v_table)) and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity <> 'a'
      and (v_pk_col is null or a.attname <> v_pk_col)
      and (v_rows -> 0) ? a.attname;
    if v_cols is null then continue; end if;

    if v_plan.mode = 'via_parent' then
      execute format(
        'select count(*) from jsonb_populate_recordset(null::public.%I, $1) r
          where r.%I is not null and not exists (select 1 from public.%I p where p.id = r.%I and p.workspace_id = $2)',
        v_table, v_plan.fk_column, v_plan.parent_table, v_plan.fk_column)
        into v_bad using v_rows, p_target;
      if v_bad > 0 then
        raise exception 'workspace_restore:foreign_reference %', v_table using errcode = '42501';
      end if;
    end if;

    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) r',
                   v_table, v_cols, v_select, v_table)
      using v_rows, p_target;
    get diagnostics v_count = row_count;
    v_restored := v_restored || jsonb_build_object(v_table, v_count);
  end loop;

  -- The caller is the only owner of the new workspace.
  if to_regclass('public.workspace_members') is not null then
    update public.workspace_members set role = 'admin'
      where workspace_id = p_target and role = 'owner' and user_id <> p_user;
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_target, p_user, 'owner')
    on conflict (workspace_id, user_id) do update set role = 'owner', deleted_at = null;
  end if;

  -- Check every deferred FK now (a broken reference aborts the whole restore), then put things back.
  execute 'set constraints all immediate';
  for v_item in select * from jsonb_array_elements(v_fks) loop
    execute format('alter table %s alter constraint %I not deferrable', v_item ->> 'rel', v_item ->> 'name');
  end loop;
  for v_item in select * from jsonb_array_elements(v_triggers) loop
    execute format('alter table %s %s trigger %I', v_item ->> 'rel',
                   case v_item ->> 'mode' when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,
                   v_item ->> 'name');
  end loop;

  return jsonb_build_object('workspace_id', p_target, 'restored', v_restored, 'skipped', v_skipped);
end;
$fn$;
revoke all on function public.crm_backup_restore_workspace(uuid, uuid, uuid, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.crm_backup_restore_workspace(uuid, uuid, uuid, text, jsonb, jsonb, uuid[]) to service_role;

commit;

notify pgrst, 'reload schema';

-- Diagnostics (optional): unique indexes that may block a restore next to the original workspace.
-- select * from public.crm_backup_restore_unique_risks();
