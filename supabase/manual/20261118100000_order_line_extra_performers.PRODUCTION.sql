-- =============================================================================
-- Several performers on one service line
-- Script: 20261118100000_order_line_extra_performers.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: 20261107100000_order_team_and_line_technicians (order_services.technician_id,
--   order_employees), 20261107110000_orders_team_employee_ids, 20261112140000_order_line_rpcs
--   (crm_sync_order_employees_from_lines).
-- =============================================================================
-- 1) order_services.extra_technician_ids uuid[] — additional performers of a line
--    (technician_id stays the main performer; extras never repeat it).
-- 2) BEFORE INSERT/UPDATE guard: drops nulls / duplicates / the main performer, and checks every extra
--    is an employee of the order's workspace.
-- 3) team_employee_ids(orders) and crm_sync_order_employees_from_lines include the extra performers
--    (orders filter by employee + order team).
-- The app writes extra_technician_ids directly (same RLS as technician_id) and then calls
-- crm_update_order_service_line / its own team sync, which now include the extras.
-- Idempotent. Transactional. Does not change existing data (new column defaults to '{}').
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.order_services'::regclass
                 and attname = 'technician_id' and not attisdropped) then
    v_problems := v_problems || 'order_services.technician_id missing; ';
  end if;
  if to_regclass('public.order_employees') is null then
    v_problems := v_problems || 'order_employees missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_line_extra_performers preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 1) Column ------------------------------------------------------------------------------------------
alter table public.order_services
  add column if not exists extra_technician_ids uuid[] not null default '{}'::uuid[];

create index if not exists order_services_extra_technicians_gin
  on public.order_services using gin (extra_technician_ids);

-- 2) Guard -------------------------------------------------------------------------------------------
create or replace function public.crm_order_services_extra_technicians_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_order_ws uuid;
  v_clean uuid[];
  v_bad integer;
begin
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
    into v_clean
  from unnest(coalesce(new.extra_technician_ids, '{}'::uuid[])) as x
  where x is not null
    and x is distinct from new.technician_id;
  new.extra_technician_ids := v_clean;

  if cardinality(v_clean) = 0 then
    return new;
  end if;

  select o.workspace_id into v_order_ws from public.orders o where o.id = new.order_id;
  select count(*) into v_bad
  from unnest(v_clean) as x
  where not exists (
    select 1 from public.employees e where e.id = x and e.workspace_id = v_order_ws
  );
  if v_order_ws is null or v_bad > 0 then
    raise exception 'order_team:technician_workspace_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.crm_order_services_extra_technicians_guard() from public, anon, authenticated;

drop trigger if exists order_services_extra_technicians_biu on public.order_services;
create trigger order_services_extra_technicians_biu
  before insert or update of extra_technician_ids, technician_id on public.order_services
  for each row execute function public.crm_order_services_extra_technicians_guard();

-- 3a) Filter by employee ------------------------------------------------------------------------------
create or replace function public.team_employee_ids(o public.orders)
returns uuid[]
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  select coalesce(array_agg(distinct x.employee_id), '{}'::uuid[])
  from (
    select case
             when o.employee_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then o.employee_id::text::uuid
           end as employee_id
    union all
    select e.employee_id from public.order_employees e where e.order_id = o.id
    union all
    select s.technician_id from public.order_services s where s.order_id = o.id and s.technician_id is not null
    union all
    select x from public.order_services s, unnest(s.extra_technician_ids) as x where s.order_id = o.id
  ) x
  where x.employee_id is not null;
$fn$;

revoke all on function public.team_employee_ids(public.orders) from public, anon;
grant execute on function public.team_employee_ids(public.orders) to authenticated, service_role;
comment on function public.team_employee_ids(public.orders) is
  'managed-object: core-app/team_employee_ids@v2 — responsible + team + line performers (main and extra) of an order.';

-- 3b) Order team sync -----------------------------------------------------------------------------------
create or replace function public.crm_sync_order_employees_from_lines(p_order_id uuid, p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_assignee uuid;
  v_desired jsonb := '[]'::jsonb;
  v_id uuid;
  v_role text;
begin
  if to_regclass('public.order_employees') is null then
    return;
  end if;

  select o.employee_id into v_assignee from public.orders o where o.id = p_order_id;

  -- Desired set: assignee as lead, every line performer (main + extra) as helper.
  with techs as (
    select os.technician_id as employee_id
    from public.order_services os
    where os.order_id = p_order_id and os.technician_id is not null
    union
    select x
    from public.order_services os, unnest(os.extra_technician_ids) as x
    where os.order_id = p_order_id
  ),
  desired as (
    select v_assignee as employee_id, 'lead'::text as role
    where v_assignee is not null
    union
    select t.employee_id, case when t.employee_id = v_assignee then 'lead' else 'helper' end
    from techs t
    where t.employee_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', employee_id, 'role', role)), '[]'::jsonb)
    into v_desired
  from desired;

  delete from public.order_employees oe
  where oe.order_id = p_order_id
    and oe.workspace_id = p_workspace_id
    and not exists (
      select 1 from jsonb_array_elements(v_desired) d
      where (d ->> 'employee_id')::uuid = oe.employee_id
    );

  for v_id, v_role in
    select (d ->> 'employee_id')::uuid, d ->> 'role'
    from jsonb_array_elements(v_desired) d
  loop
    insert into public.order_employees (workspace_id, order_id, employee_id, role)
    values (p_workspace_id, p_order_id, v_id, coalesce(v_role, 'helper'))
    on conflict (order_id, employee_id) do update
      set role = excluded.role;
  end loop;
end;
$fn$;

revoke all on function public.crm_sync_order_employees_from_lines(uuid, uuid) from public, anon;
grant execute on function public.crm_sync_order_employees_from_lines(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

do $postflight$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.order_services'::regclass
                 and attname = 'extra_technician_ids' and not attisdropped) then
    raise exception 'order_line_extra_performers postflight: column missing';
  end if;
end;
$postflight$;

commit;
