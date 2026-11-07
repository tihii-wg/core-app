-- =============================================================================
-- Filter orders by employee in the database: computed field orders.team_employee_ids
-- Script: 20261107110000_orders_team_employee_ids.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisite: 20261107100000_order_team_and_line_technicians
-- =============================================================================
-- Adds a PostgREST computed field public.team_employee_ids(public.orders) → uuid[]:
--   main responsible (orders.employee_id when it is a uuid) + order_employees.employee_id +
--   order_services.technician_id of the order.
-- The app filters with  .contains("team_employee_ids", [employeeId])  (PostgREST: team_employee_ids=cs.{id})
-- in the same paginated query — no id lists in the URL.
-- SECURITY INVOKER: RLS of orders / order_employees / order_services still applies.
-- Plus supporting indexes. Does NOT change data. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_employees') is null then
    raise exception 'orders_team_employee_ids preflight: order_employees missing (apply 20261107100000 first)';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.order_services'::regclass
                 and attname = 'technician_id' and not attisdropped) then
    raise exception 'orders_team_employee_ids preflight: order_services.technician_id missing';
  end if;
end;
$preflight$;

create index if not exists order_services_order_technician_idx
  on public.order_services (order_id, technician_id) where technician_id is not null;
create index if not exists order_employees_order_idx
  on public.order_employees (order_id, employee_id);

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
  ) x
  where x.employee_id is not null;
$fn$;

revoke all on function public.team_employee_ids(public.orders) from public, anon;
grant execute on function public.team_employee_ids(public.orders) to authenticated, service_role;

comment on function public.team_employee_ids(public.orders) is
  'managed-object: core-app/team_employee_ids@v1 — computed field: responsible + team + line performers of an order (for filtering).';

-- Make PostgREST see the new computed field right away.
notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.team_employee_ids(public.orders)') is null then
    raise exception 'orders_team_employee_ids postflight: function missing';
  end if;
end;
$postflight$;

commit;

-- Check (replace ids):
-- select id, number, public.team_employee_ids(o) from public.orders o where workspace_id = '<ws>' limit 20;
