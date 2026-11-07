-- =============================================================================
-- Several employees per order + a performer per work/service line
-- Script: 20261107100000_order_team_and_line_technicians.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: crm_ro_v1 (order_services.technician_id), 20261105180000 (order_services_closed_guard)
-- =============================================================================
-- Adds:
--   1) order_services.technician_id (ensured) + index — performer of a specific work/service line.
--   2) services.default_technician_id — optional default performer for a catalog service
--      (pre-fills the line; the user can change it per order).
--   3) public.order_employees — the order team: (order_id, employee_id, role 'lead' | 'helper'),
--      unique per order, RLS: active members of the order's workspace (same as order_services).
--      Closed-order rules: reuses order_services_closed_guard() (same as service lines).
--   4) Consistency triggers: technician / team member / default technician must belong to the
--      same workspace as the order / service.
--
-- orders.employee_id (main responsible) stays as is.
-- Does NOT: change totals, payroll, existing rows. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_services') is null then v_problems := v_problems || 'order_services missing; '; end if;
  if to_regclass('public.orders') is null then v_problems := v_problems || 'orders missing; '; end if;
  if to_regclass('public.employees') is null then v_problems := v_problems || 'employees missing; '; end if;
  if to_regclass('public.services') is null then v_problems := v_problems || 'services missing; '; end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then v_problems := v_problems || 'is_workspace_member missing; '; end if;
  if to_regprocedure('public.order_services_closed_guard()') is null then
    v_problems := v_problems || 'order_services_closed_guard missing (apply 20261105180000 first); ';
  end if;
  if v_problems <> '' then
    raise exception 'order_team preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 1) Line performer ----------------------------------------------------------
alter table public.order_services
  add column if not exists technician_id uuid references public.employees(id) on delete set null;
create index if not exists order_services_technician_idx
  on public.order_services (technician_id) where technician_id is not null;

-- 2) Catalog default performer -----------------------------------------------
alter table public.services
  add column if not exists default_technician_id uuid references public.employees(id) on delete set null;

-- 3) Order team --------------------------------------------------------------
create table if not exists public.order_employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text not null default 'helper' check (role in ('lead', 'helper')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint order_employees_unique unique (order_id, employee_id)
);
create index if not exists order_employees_employee_idx on public.order_employees (workspace_id, employee_id);

alter table public.order_employees enable row level security;

drop policy if exists order_employees_member_select on public.order_employees;
create policy order_employees_member_select on public.order_employees
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists order_employees_member_insert on public.order_employees;
create policy order_employees_member_insert on public.order_employees
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
drop policy if exists order_employees_member_update on public.order_employees;
create policy order_employees_member_update on public.order_employees
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
drop policy if exists order_employees_member_delete on public.order_employees;
create policy order_employees_member_delete on public.order_employees
  for delete to authenticated using (public.is_workspace_member(workspace_id));

revoke all on table public.order_employees from public, anon;
grant select, insert, update, delete on table public.order_employees to authenticated;
grant all on table public.order_employees to service_role;

-- Closed-order protection: same rules as service lines.
drop trigger if exists order_employees_closed_guard_biud on public.order_employees;
create trigger order_employees_closed_guard_biud
  before insert or update or delete on public.order_employees
  for each row execute function public.order_services_closed_guard();

-- 4) Workspace consistency ---------------------------------------------------
create or replace function public.crm_order_employees_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_order_ws uuid;
  v_emp_ws uuid;
begin
  select o.workspace_id into v_order_ws from public.orders o where o.id = new.order_id;
  select e.workspace_id into v_emp_ws from public.employees e where e.id = new.employee_id;
  if v_order_ws is null or v_emp_ws is null
     or v_order_ws is distinct from v_emp_ws
     or new.workspace_id is distinct from v_order_ws then
    raise exception 'order_team:workspace_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.crm_order_employees_consistency() from public, anon, authenticated;

drop trigger if exists order_employees_consistency_biu on public.order_employees;
create trigger order_employees_consistency_biu
  before insert or update on public.order_employees
  for each row execute function public.crm_order_employees_consistency();

create or replace function public.crm_order_services_technician_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_order_ws uuid;
  v_emp_ws uuid;
begin
  if new.technician_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.technician_id is not distinct from old.technician_id then
    return new;
  end if;
  select o.workspace_id into v_order_ws from public.orders o where o.id = new.order_id;
  select e.workspace_id into v_emp_ws from public.employees e where e.id = new.technician_id;
  if v_order_ws is null or v_emp_ws is null or v_order_ws is distinct from v_emp_ws then
    raise exception 'order_team:technician_workspace_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.crm_order_services_technician_consistency() from public, anon, authenticated;

drop trigger if exists order_services_technician_consistency_biu on public.order_services;
create trigger order_services_technician_consistency_biu
  before insert or update on public.order_services
  for each row execute function public.crm_order_services_technician_consistency();

create or replace function public.crm_services_default_technician_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_emp_ws uuid;
begin
  if new.default_technician_id is null then
    return new;
  end if;
  select e.workspace_id into v_emp_ws from public.employees e where e.id = new.default_technician_id;
  if v_emp_ws is null or v_emp_ws is distinct from new.workspace_id then
    raise exception 'order_team:default_technician_workspace_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
revoke all on function public.crm_services_default_technician_consistency() from public, anon, authenticated;

drop trigger if exists services_default_technician_consistency_biu on public.services;
create trigger services_default_technician_consistency_biu
  before insert or update of default_technician_id on public.services
  for each row execute function public.crm_services_default_technician_consistency();

do $postflight$
begin
  if to_regclass('public.order_employees') is null then
    raise exception 'order_team postflight: order_employees missing';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.services'::regclass
                 and attname = 'default_technician_id' and not attisdropped) then
    raise exception 'order_team postflight: services.default_technician_id missing';
  end if;
end;
$postflight$;

commit;
