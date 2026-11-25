-- =============================================================================
-- Корзина (trash): soft-deleted clients, vehicles, print templates, tasks and workspaces.
-- Script: 20261125213000_trash.PRODUCTION.sql
--
-- * Items stay in the trash for 90 days, then are removed automatically (pg_cron, hourly).
-- * The workspace owner can restore an item, delete one item now, or empty the whole trash now.
-- * "Delete now" erases a row physically when nothing else references it. A client / vehicle / template /
--   task still linked to orders, payments, invoices… is NOT erased (the history must stay): it is marked
--   trash_purged_at and disappears from the trash, staying hidden everywhere as before.
-- * A deleted workspace is erased with all its data by the scheduler (heavy; never inside a user request).
--   "Delete now" on a workspace marks it; the hourly job erases it. Storage files are not touched.
--
-- Re-runnable. Requires pg_cron for the automatic part (Database → Extensions); without it everything
-- else works and the schedule step is skipped with a notice.
-- =============================================================================

alter table public.clients            add column if not exists trash_purged_at timestamptz;
alter table public.vehicles           add column if not exists trash_purged_at timestamptz;
alter table public.document_templates add column if not exists trash_purged_at timestamptz;
alter table public.tasks              add column if not exists trash_purged_at timestamptz;
alter table public.workspaces         add column if not exists trash_purged_at timestamptz;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

/** Workspace owner (active membership). */
create or replace function public.crm_trash_is_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id and w.deleted_at is null
    where wm.workspace_id = p_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role::text = 'owner'
      and wm.deleted_at is null
  );
$$;

/**
 * True when any row of another table (or another row of the same table) references p_id through a
 * single-column foreign key — except the listed owned child tables (schema-qualified names).
 */
create or replace function public.crm_trash_has_refs(p_table regclass, p_id uuid, p_children text[])
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  r record;
  v_found boolean;
begin
  for r in
    select c.conrelid::regclass as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = p_table
      and array_length(c.conkey, 1) = 1
  loop
    if (r.tbl)::text = any (p_children) then
      continue;
    end if;
    if r.tbl = p_table then
      execute format('select exists (select 1 from %s where %I = $1 and id <> $1)', r.tbl, r.col) into v_found using p_id;
    else
      execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into v_found using p_id;
    end if;
    if v_found then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

/**
 * Remove one soft-deleted item for good. Returns 'deleted' (row erased) or 'kept' (still linked to
 * history: marked trash_purged_at, data kept). Caller checks permissions.
 */
create or replace function public.crm_trash_purge_item(p_kind text, p_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_table regclass;
  v_children text[] := array[]::text[];
  v_child text;
  v_col text;
begin
  v_table := case p_kind
    when 'client' then 'public.clients'::regclass
    when 'vehicle' then 'public.vehicles'::regclass
    when 'template' then 'public.document_templates'::regclass
    when 'task' then 'public.tasks'::regclass
    else null
  end;
  if v_table is null then
    raise exception 'trash:unknown_kind:%', p_kind using errcode = '22023';
  end if;

  if p_kind = 'client' then
    -- Owned child rows that go with the client card (not history).
    foreach v_child in array array['public.client_phones', 'public.client_addresses', 'public.client_discounts'] loop
      if to_regclass(v_child) is not null then
        v_children := v_children || (to_regclass(v_child))::text;
      end if;
    end loop;
  end if;

  if public.crm_trash_has_refs(v_table, p_id, v_children) then
    execute format('update %s set trash_purged_at = now() where id = $1 and deleted_at is not null', v_table) using p_id;
    return 'kept';
  end if;

  begin
    foreach v_child in array v_children loop
      select a.attname::text into v_col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confrelid = v_table and c.conrelid = v_child::regclass
        and array_length(c.conkey, 1) = 1
      limit 1;
      if v_col is not null then
        execute format('delete from %s where %I = $1', v_child, v_col) using p_id;
      end if;
    end loop;
    execute format('delete from %s where id = $1 and deleted_at is not null', v_table) using p_id;
    return 'deleted';
  exception
    -- Still referenced, or a guard trigger refuses: keep the data, just take it out of the trash.
    when others then
      execute format('update %s set trash_purged_at = now() where id = $1 and deleted_at is not null', v_table) using p_id;
      return 'kept';
  end;
end;
$$;

/**
 * Erase a deleted workspace with all its data (scheduler only). Several passes over every table with a
 * workspace_id column, each delete in its own subtransaction, until nothing more can be removed.
 */
create or replace function public.crm_trash_purge_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  r record;
  v_pass int := 0;
  v_progress boolean := true;
  v_rows bigint;
begin
  if not exists (select 1 from public.workspaces where id = p_workspace_id and deleted_at is not null) then
    return false;
  end if;

  while v_progress and v_pass < 12 loop
    v_pass := v_pass + 1;
    v_progress := false;
    for r in
      select c.table_name::text as tbl
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'workspace_id' and c.table_name <> 'workspaces'
    loop
      begin
        execute format('delete from public.%I where workspace_id = $1', r.tbl) using p_workspace_id;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_progress := true;
        end if;
      exception
        when others then
          null; -- another table still points here (or a guard refuses); a later pass retries
      end;
    end loop;
  end loop;

  -- Profiles that still have it as the active workspace.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'active_workspace_id'
  ) then
    update public.profiles set active_workspace_id = null where active_workspace_id = p_workspace_id;
  end if;

  begin
    delete from public.workspaces where id = p_workspace_id and deleted_at is not null;
    return true;
  exception
    when others then
      update public.workspaces set trash_purged_at = coalesce(trash_purged_at, now()) where id = p_workspace_id;
      raise notice 'trash: workspace % could not be fully erased (still referenced)', p_workspace_id;
      return false;
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs for the app (owner only)
-- -----------------------------------------------------------------------------

/** Trash contents of a workspace (+ the caller's own deleted workspaces). Newest first. */
create or replace function public.crm_trash_list(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_items jsonb;
begin
  if not public.crm_trash_is_owner(p_workspace_id) then
    raise exception 'trash:forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x.deleted_at desc), '[]'::jsonb) into v_items
  from (
    select 'client'::text as kind, c.id, c.name as title,
           nullif(concat_ws(' · ', nullif(c.phone, ''), nullif(c.email, '')), '') as subtitle,
           c.deleted_at, (c.merged_into_client_id is null) as restorable,
           (c.merged_into_client_id is not null) as merged
    from public.clients c
    where c.workspace_id = p_workspace_id and c.deleted_at is not null and c.trash_purged_at is null
    union all
    select 'vehicle', v.id,
           nullif(concat_ws(' ', nullif(v.make, ''), nullif(v.model, ''), v.year::text), ''),
           nullif(concat_ws(' · ', nullif(v.license_plate, ''), nullif(v.vin, '')), ''),
           v.deleted_at, true, false
    from public.vehicles v
    where v.workspace_id = p_workspace_id and v.deleted_at is not null and v.trash_purged_at is null
    union all
    select 'template', t.id, t.name, t.document_type::text, t.deleted_at, true, false
    from public.document_templates t
    where t.workspace_id = p_workspace_id and t.deleted_at is not null and t.trash_purged_at is null
    union all
    select 'task', k.id, k.title, null, k.deleted_at, true, false
    from public.tasks k
    where k.workspace_id = p_workspace_id and k.deleted_at is not null and k.trash_purged_at is null
    union all
    select 'workspace', w.id, w.name, null, w.deleted_at, true, false
    from public.workspaces w
    where w.owner_id = (select auth.uid()) and w.deleted_at is not null and w.trash_purged_at is null
    limit 2000
  ) x;

  return v_items;
end;
$$;

/** Put an item back. Merged clients cannot be restored (their orders now belong to the survivor). */
create or replace function public.crm_trash_restore(p_workspace_id uuid, p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted_at timestamptz;
begin
  if not public.crm_trash_is_owner(p_workspace_id) then
    raise exception 'trash:forbidden' using errcode = '42501';
  end if;

  if p_kind = 'client' then
    update public.clients set deleted_at = null, updated_at = now()
    where id = p_id and workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null
      and merged_into_client_id is null;
  elsif p_kind = 'vehicle' then
    update public.vehicles set deleted_at = null, updated_at = now()
    where id = p_id and workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null;
  elsif p_kind = 'template' then
    update public.document_templates set deleted_at = null, updated_at = now()
    where id = p_id and workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null;
  elsif p_kind = 'task' then
    update public.tasks set deleted_at = null, updated_at = now()
    where id = p_id and workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null;
  elsif p_kind = 'workspace' then
    select deleted_at into v_deleted_at from public.workspaces
    where id = p_id and owner_id = (select auth.uid()) and deleted_at is not null and trash_purged_at is null;
    if v_deleted_at is null then
      raise exception 'trash:not_found' using errcode = 'P0002';
    end if;
    update public.workspaces set deleted_at = null, updated_at = now() where id = p_id;
    -- Members removed together with the workspace come back with it.
    update public.workspace_members set deleted_at = null
    where workspace_id = p_id and deleted_at >= v_deleted_at - interval '5 seconds';
    return;
  else
    raise exception 'trash:unknown_kind:%', p_kind using errcode = '22023';
  end if;

  if not found then
    raise exception 'trash:not_found' using errcode = 'P0002';
  end if;
end;
$$;

/**
 * Delete now: one item (p_kind + p_id) or the whole trash (both null). Workspaces are only marked here;
 * the hourly job erases them. Returns {deleted, kept, workspaces}.
 */
create or replace function public.crm_trash_purge(p_workspace_id uuid, p_kind text default null, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted int := 0;
  v_kept int := 0;
  v_workspaces int := 0;
  v_result text;
  r record;
  v_exists int;
begin
  if not public.crm_trash_is_owner(p_workspace_id) then
    raise exception 'trash:forbidden' using errcode = '42501';
  end if;

  if p_kind is not null then
    if p_kind = 'workspace' then
      update public.workspaces set trash_purged_at = now()
      where id = p_id and owner_id = (select auth.uid()) and deleted_at is not null and trash_purged_at is null;
      get diagnostics v_workspaces = row_count;
    else
      -- The item must belong to this workspace and be in the trash.
      execute format(
        'select 1 from %s where id = $1 and workspace_id = $2 and deleted_at is not null and trash_purged_at is null',
        case p_kind when 'client' then 'public.clients' when 'vehicle' then 'public.vehicles'
                    when 'template' then 'public.document_templates' when 'task' then 'public.tasks'
                    else 'public.clients' end
      ) into v_exists using p_id, p_workspace_id;
      if v_exists is null then
        raise exception 'trash:not_found' using errcode = 'P0002';
      end if;
      v_result := public.crm_trash_purge_item(p_kind, p_id);
      if v_result = 'deleted' then v_deleted := 1; else v_kept := 1; end if;
    end if;
    return jsonb_build_object('deleted', v_deleted, 'kept', v_kept, 'workspaces', v_workspaces);
  end if;

  -- Whole trash. Order matters: tasks / templates / vehicles first free their references to clients.
  for r in
    select 'task'::text as kind, id from public.tasks
      where workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null
    union all
    select 'template', id from public.document_templates
      where workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null
    union all
    select 'vehicle', id from public.vehicles
      where workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null
  loop
    v_result := public.crm_trash_purge_item(r.kind, r.id);
    if v_result = 'deleted' then v_deleted := v_deleted + 1; else v_kept := v_kept + 1; end if;
  end loop;

  -- Clients: merged ones last (another merged client may still point at them).
  for r in
    select id from public.clients
    where workspace_id = p_workspace_id and deleted_at is not null and trash_purged_at is null
    order by (merged_into_client_id is null) desc, deleted_at
  loop
    v_result := public.crm_trash_purge_item('client', r.id);
    if v_result = 'deleted' then v_deleted := v_deleted + 1; else v_kept := v_kept + 1; end if;
  end loop;

  update public.workspaces set trash_purged_at = now()
  where owner_id = (select auth.uid()) and deleted_at is not null and trash_purged_at is null;
  get diagnostics v_workspaces = row_count;

  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept, 'workspaces', v_workspaces);
end;
$$;

/** Scheduler: items older than 90 days in the trash, and workspaces due for erasing. */
create or replace function public.crm_trash_auto_purge()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_deleted int := 0;
  v_kept int := 0;
  v_workspaces int := 0;
  r record;
begin
  for r in
    select 'task'::text as kind, id, 1 as ord from public.tasks where deleted_at < v_cutoff and trash_purged_at is null
    union all
    select 'template', id, 2 from public.document_templates where deleted_at < v_cutoff and trash_purged_at is null
    union all
    select 'vehicle', id, 3 from public.vehicles where deleted_at < v_cutoff and trash_purged_at is null
    union all
    select 'client', id, case when merged_into_client_id is null then 4 else 5 end
      from public.clients where deleted_at < v_cutoff and trash_purged_at is null
    order by 3
  loop
    begin
      if public.crm_trash_purge_item(r.kind, r.id) = 'deleted' then v_deleted := v_deleted + 1; else v_kept := v_kept + 1; end if;
    exception when others then
      raise notice 'trash: % % skipped: %', r.kind, r.id, sqlerrm;
    end;
  end loop;

  for r in
    select id from public.workspaces
    where deleted_at is not null and (deleted_at < v_cutoff or trash_purged_at is not null)
  loop
    begin
      if public.crm_trash_purge_workspace(r.id) then v_workspaces := v_workspaces + 1; end if;
    exception when others then
      raise notice 'trash: workspace % skipped: %', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept, 'workspaces', v_workspaces);
end;
$$;

-- Grants: the app calls list / restore / purge; helpers and the scheduler entry are internal.
revoke all on function public.crm_trash_is_owner(uuid) from public, anon, authenticated;
revoke all on function public.crm_trash_has_refs(regclass, uuid, text[]) from public, anon, authenticated;
revoke all on function public.crm_trash_purge_item(text, uuid) from public, anon, authenticated;
revoke all on function public.crm_trash_purge_workspace(uuid) from public, anon, authenticated;
revoke all on function public.crm_trash_auto_purge() from public, anon, authenticated;
revoke all on function public.crm_trash_list(uuid) from public, anon;
revoke all on function public.crm_trash_restore(uuid, text, uuid) from public, anon;
revoke all on function public.crm_trash_purge(uuid, text, uuid) from public, anon;
grant execute on function public.crm_trash_list(uuid) to authenticated;
grant execute on function public.crm_trash_restore(uuid, text, uuid) to authenticated;
grant execute on function public.crm_trash_purge(uuid, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Schedule (hourly): 90-day expiry + workspaces marked for erasing.
-- -----------------------------------------------------------------------------
do $schedule$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'trash: pg_cron is not enabled — automatic 90-day cleanup is not scheduled. Enable pg_cron and re-run this script.';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'crm-trash-auto-purge';
  perform cron.schedule('crm-trash-auto-purge', '41 * * * *', 'select public.crm_trash_auto_purge();');
end;
$schedule$;

-- Checks:
--   select jobname, schedule, active from cron.job where jobname = 'crm-trash-auto-purge';
--   select public.crm_trash_auto_purge();   -- run once by hand
