-- =============================================================================
-- Payment schedule (stages) per order + "min paid %" rule on statuses
-- Script: 20261108140000_order_payment_stages.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: payments ledger (crm_ro_v1), status_definitions, order_services_closed_guard
--                (20261105210000), closed orders immutable (20261108120000).
-- =============================================================================
-- Generic for all business types (furniture: prepayment / intermediate / balance;
-- site works, equipment, big auto jobs ...).
--
-- 1) public.order_payment_stages — ordered stages of an order's payment plan:
--      name, mode ('percent' | 'amount' | 'remainder'), percent / amount, due_date,
--      optional invoice_id. Paid/unpaid state is NOT stored: the app allocates the
--      order's net paid amount over the stages in position order (waterfall), so the
--      ledger (payments) stays the single source of truth.
--    At most one 'remainder' stage per order. Members can read/write their workspace;
--    closed orders are protected by order_services_closed_guard (same as lines/team).
-- 2) public.workspaces.payment_stage_template jsonb — the workspace default plan
--    (array of {name, mode, percent, amount, due_days}); the app falls back to the
--    industry default when null.
-- 3) public.status_definitions.min_paid_percent numeric(5,2) — optional rule: an order
--    may be moved to this status only when net paid >= min_paid_percent % of its total
--    (e.g. «В производстве» requires 50 % prepayment). Enforced by a trigger on orders.
-- No data changes. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then v_problems := v_problems || 'orders missing; '; end if;
  if to_regclass('public.payments') is null then v_problems := v_problems || 'payments missing; '; end if;
  if to_regclass('public.invoices') is null then v_problems := v_problems || 'invoices missing; '; end if;
  if to_regclass('public.status_definitions') is null then v_problems := v_problems || 'status_definitions missing; '; end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then v_problems := v_problems || 'is_workspace_member missing; '; end if;
  if to_regprocedure('public.order_services_closed_guard()') is null then v_problems := v_problems || 'order_services_closed_guard missing; '; end if;
  if v_problems <> '' then
    raise exception 'order_payment_stages preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- 1) Stages ------------------------------------------------------------------
create table if not exists public.order_payment_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  position integer not null,
  name text not null,
  mode text not null,
  percent numeric(5,2),
  amount numeric(12,2),
  due_date date,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint order_payment_stages_position_unique unique (order_id, position) deferrable initially deferred,
  constraint order_payment_stages_name_len check (char_length(btrim(name)) between 1 and 100),
  constraint order_payment_stages_mode_check check (mode in ('percent', 'amount', 'remainder')),
  constraint order_payment_stages_values_check check (
       (mode = 'percent'   and percent is not null and percent > 0 and percent <= 100 and amount is null)
    or (mode = 'amount'    and amount  is not null and amount > 0 and percent is null)
    or (mode = 'remainder' and percent is null and amount is null)
  ),
  constraint order_payment_stages_position_check check (position >= 0)
);

create unique index if not exists order_payment_stages_one_remainder
  on public.order_payment_stages (order_id) where mode = 'remainder';
create index if not exists order_payment_stages_workspace_order_idx
  on public.order_payment_stages (workspace_id, order_id, position);
create index if not exists order_payment_stages_due_idx
  on public.order_payment_stages (workspace_id, due_date) where due_date is not null;

alter table public.order_payment_stages enable row level security;

drop policy if exists order_payment_stages_member_select on public.order_payment_stages;
create policy order_payment_stages_member_select on public.order_payment_stages
  for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists order_payment_stages_member_insert on public.order_payment_stages;
create policy order_payment_stages_member_insert on public.order_payment_stages
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
drop policy if exists order_payment_stages_member_update on public.order_payment_stages;
create policy order_payment_stages_member_update on public.order_payment_stages
  for update to authenticated using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
drop policy if exists order_payment_stages_member_delete on public.order_payment_stages;
create policy order_payment_stages_member_delete on public.order_payment_stages
  for delete to authenticated using (public.is_workspace_member(workspace_id));

revoke all on table public.order_payment_stages from public, anon;
grant select, insert, update, delete on table public.order_payment_stages to authenticated;
grant all on table public.order_payment_stages to service_role;

-- Workspace / order / invoice consistency + updated_at
create or replace function public.crm_order_payment_stages_consistency()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_inv_ws uuid;
  v_inv_order uuid;
begin
  select o.workspace_id into v_ws from public.orders o where o.id = new.order_id;
  if v_ws is null then
    raise exception 'order_payment_stages:order_not_found' using errcode = 'P0002';
  end if;
  if new.workspace_id is distinct from v_ws then
    raise exception 'order_payment_stages:workspace_mismatch' using errcode = '42501';
  end if;
  if new.invoice_id is not null then
    select i.workspace_id, i.order_id into v_inv_ws, v_inv_order
    from public.invoices i where i.id = new.invoice_id;
    if v_inv_ws is distinct from v_ws or (v_inv_order is not null and v_inv_order is distinct from new.order_id) then
      raise exception 'order_payment_stages:invoice_mismatch' using errcode = '42501';
    end if;
  end if;
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;

revoke all on function public.crm_order_payment_stages_consistency() from public, anon, authenticated;

drop trigger if exists order_payment_stages_consistency_biu on public.order_payment_stages;
create trigger order_payment_stages_consistency_biu
  before insert or update on public.order_payment_stages
  for each row execute function public.crm_order_payment_stages_consistency();

-- Closed-order protection: same rules as service lines / team.
drop trigger if exists order_payment_stages_closed_guard_biud on public.order_payment_stages;
create trigger order_payment_stages_closed_guard_biud
  before insert or update or delete on public.order_payment_stages
  for each row execute function public.order_services_closed_guard();

-- 2) Workspace default plan ---------------------------------------------------
alter table public.workspaces add column if not exists payment_stage_template jsonb;

do $tpl$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_payment_stage_template_array'
                 and conrelid = 'public.workspaces'::regclass) then
    alter table public.workspaces
      add constraint workspaces_payment_stage_template_array
      check (payment_stage_template is null or jsonb_typeof(payment_stage_template) = 'array');
  end if;
end;
$tpl$;

-- 3) Status rule: minimum paid percent ----------------------------------------
alter table public.status_definitions add column if not exists min_paid_percent numeric(5,2);

do $st$
begin
  if not exists (select 1 from pg_constraint where conname = 'status_definitions_min_paid_percent_range'
                 and conrelid = 'public.status_definitions'::regclass) then
    alter table public.status_definitions
      add constraint status_definitions_min_paid_percent_range
      check (min_paid_percent is null or (min_paid_percent > 0 and min_paid_percent <= 100));
  end if;
end;
$st$;

-- Net paid of an order (payments - refunds - voids, incl. linked invoices) — same
-- formula as order_ledger_remaining, not clamped.
create or replace function public.crm_order_net_paid(p_workspace_id uuid, p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(sum(
           case
             when s.kind = 'payment' then s.amount
             when s.kind in ('refund', 'void') then -s.amount
             else 0
           end
         ), 0)
  from (
    select distinct p.id, p.kind, p.amount
    from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id from public.invoices i
          where i.workspace_id = p_workspace_id and i.order_id = p_order_id
        )
      )
  ) s;
$fn$;

revoke all on function public.crm_order_net_paid(uuid, uuid) from public, anon;
grant execute on function public.crm_order_net_paid(uuid, uuid) to authenticated, service_role;

comment on function public.crm_order_net_paid(uuid, uuid) is
  'managed-object: core-app/crm_order_net_paid@v1 — payments - refunds - voids for an order (incl. linked invoices), not clamped.';

create or replace function public.crm_orders_min_paid_status_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_min numeric;
  v_name text;
  v_net numeric;
  v_need numeric;
begin
  if new.custom_status_id is null
     or new.custom_status_id is not distinct from old.custom_status_id then
    return new;
  end if;

  select d.min_paid_percent, d.name into v_min, v_name
  from public.status_definitions d
  where d.id = new.custom_status_id and d.workspace_id = new.workspace_id;

  if v_min is null or coalesce(new.total_price, 0) <= 0 then
    return new;
  end if;

  v_net := public.crm_order_net_paid(new.workspace_id, new.id);
  v_need := round(new.total_price * v_min / 100, 2);
  if round(v_net, 2) + 0.005 < v_need then
    raise exception 'order_status:min_paid_required status=% percent=% required=% paid=%',
      v_name, v_min, v_need, round(v_net, 2)
      using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

revoke all on function public.crm_orders_min_paid_status_guard() from public, anon, authenticated;

comment on function public.crm_orders_min_paid_status_guard() is
  'managed-object: core-app/crm_orders_min_paid_status_guard@v1 — moving an order to a status with min_paid_percent requires net paid >= that share of total_price.';

drop trigger if exists orders_min_paid_status_guard_bu on public.orders;
create trigger orders_min_paid_status_guard_bu
  before update of custom_status_id on public.orders
  for each row execute function public.crm_orders_min_paid_status_guard();

do $postflight$
begin
  if to_regclass('public.order_payment_stages') is null then
    raise exception 'order_payment_stages postflight: table missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'status_definitions' and column_name = 'min_paid_percent') then
    raise exception 'order_payment_stages postflight: status_definitions.min_paid_percent missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'workspaces' and column_name = 'payment_stage_template') then
    raise exception 'order_payment_stages postflight: workspaces.payment_stage_template missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'orders_min_paid_status_guard_bu'
                 and tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'order_payment_stages postflight: status guard trigger missing';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
