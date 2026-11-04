-- =============================================================================
-- Core App — Order lifecycle statuses (semantic actions + close/cancel RPCs)
-- File: supabase/manual/20261104120000_order_lifecycle_statuses.PRODUCTION.sql
--
-- TARGET: MAIN Supabase project ONLY (pundggjzzaqzbvykbxvo).
-- Do NOT run against TEST (hnfvrlgcnpykncixxqha).
--
-- This script is NOT auto-applied. Review, then paste into the MAIN SQL Editor.
-- The authoring process does not execute this script against any remote database.
--
-- WHAT IT DOES:
--   * Adds status_definitions.code + status_definitions.semantic_action
--   * Unique indexes: one default, one active close, one active cancel (order entity)
--   * order_lifecycle_tokens table (not writable by authenticated clients)
--   * BEFORE UPDATE guard on orders blocking direct closed_at / close|cancel assign
--   * close_order_if_settled / cancel_order / set_order_lifecycle_semantic /
--     replace_order_status / ensure_default_order_statuses RPCs
--   * Seeds FIVE defaults only for workspaces that have ZERO order statuses
--   * Does NOT delete, rename, or remap existing nine RO statuses
--   * Does NOT set semantic_action=close/cancel on existing rows by display name
--
-- DEPENDS ON (preflight-enforced):
--   public.orders (closed_at, custom_status_id, status, total_price, workspace_id)
--   public.payments (ledger)
--   public.status_definitions
--   public.crm_has_permission(uuid, text)
--   public.payments_enforce_integrity() void-aware body
--
-- ROLLBACK (manual, after backup):
--   drop trigger if exists orders_lifecycle_guard_bu on public.orders;
--   drop function if exists public.order_lifecycle_guard();
--   drop function if exists public.close_order_if_settled(uuid, uuid);
--   drop function if exists public.cancel_order(uuid, uuid);
--   drop function if exists public.set_order_lifecycle_semantic(uuid, uuid, text);
--   drop function if exists public.replace_order_status(uuid, uuid, uuid);
--   drop function if exists public.ensure_default_order_statuses(uuid);
--   drop function if exists public.workspaces_seed_order_statuses();
--   drop trigger if exists workspaces_seed_order_statuses_ai on public.workspaces;
--   drop function if exists public.order_ledger_remaining(uuid, uuid);
--   drop table if exists public.order_lifecycle_tokens;
--   -- Columns code/semantic_action may be left in place (non-destructive) or:
--   -- alter table public.status_definitions drop column if exists code;
--   -- alter table public.status_definitions drop column if exists semantic_action;
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — fail closed
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_problems text := '';
  v_fn_def text;
  v_has_void boolean := false;
  v_col text;
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.payments') is null then
    v_problems := v_problems || 'payments missing; ';
  end if;
  if to_regclass('public.status_definitions') is null then
    v_problems := v_problems || 'status_definitions missing; ';
  end if;
  if to_regclass('public.workspaces') is null then
    v_problems := v_problems || 'workspaces missing; ';
  end if;
  if to_regclass('public.workspace_members') is null then
    v_problems := v_problems || 'workspace_members missing; ';
  end if;

  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='closed_at'
  ) then
    v_problems := v_problems || 'orders.closed_at missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='custom_status_id'
  ) then
    v_problems := v_problems || 'orders.custom_status_id missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='total_price'
  ) then
    v_problems := v_problems || 'orders.total_price missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='orders' and column_name='status'
  ) then
    v_problems := v_problems || 'orders.status missing; ';
  end if;

  foreach v_col in array array['id','workspace_id','order_id','invoice_id','kind','amount','currency_code','paid_at','related_payment_id']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='payments' and column_name = v_col
    ) then
      v_problems := v_problems || format('payments.%s missing; ', v_col);
    end if;
  end loop;

  if to_regprocedure('public.payments_enforce_integrity()') is null then
    v_problems := v_problems || 'payments_enforce_integrity() missing; ';
  else
    select pg_get_functiondef(to_regprocedure('public.payments_enforce_integrity()')) into v_fn_def;
    v_has_void := coalesce(
      v_fn_def like '%kind in (''refund'', ''void'')%'
      or v_fn_def like '%when p.kind in (''refund'', ''void'')%'
      or v_fn_def like '%p.kind = ''void''%',
      false
    );
    if not v_has_void then
      v_problems := v_problems || 'payments_enforce_integrity does not subtract void — apply void-offset script first; ';
    end if;
  end if;

  if v_problems <> '' then
    raise exception 'PREFLIGHT FAILED (order lifecycle): %', v_problems;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) status_definitions: code + semantic_action
-- ---------------------------------------------------------------------------
alter table public.status_definitions
  add column if not exists code text;

alter table public.status_definitions
  add column if not exists semantic_action text;

update public.status_definitions
set semantic_action = 'normal'
where semantic_action is null;

do $sa_chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'status_definitions_semantic_action_check'
      and conrelid = 'public.status_definitions'::regclass
  ) then
    alter table public.status_definitions
      add constraint status_definitions_semantic_action_check
      check (semantic_action in ('normal', 'close', 'cancel'));
  end if;
end
$sa_chk$;

alter table public.status_definitions
  alter column semantic_action set default 'normal';

alter table public.status_definitions
  alter column semantic_action set not null;

comment on column public.status_definitions.semantic_action is
  'Business action independent of name: normal | close | cancel. Managed via set_order_lifecycle_semantic.';
comment on column public.status_definitions.code is
  'Stable machine key (new, in_progress, waiting_parts, closed, cancelled). Independent of display name.';

-- Soft-fill codes from known system_status for order rows ONLY (does not change semantic_action).
update public.status_definitions d
set code = case d.system_status
  when 'new' then 'new'
  when 'in-progress' then 'in_progress'
  when 'waiting-parts' then 'waiting_parts'
  when 'cancelled' then 'cancelled'
  when 'closed' then 'closed'
  else d.code
end
where d.entity = 'order'
  and d.deleted_at is null
  and d.code is null
  and d.system_status in ('new', 'in-progress', 'waiting-parts', 'cancelled', 'closed');

create unique index if not exists status_definitions_code_uidx
  on public.status_definitions (workspace_id, entity, code)
  where deleted_at is null and code is not null;

create unique index if not exists status_definitions_one_default_uidx
  on public.status_definitions (workspace_id, entity)
  where is_default and deleted_at is null and is_active;

create unique index if not exists status_definitions_one_close_uidx
  on public.status_definitions (workspace_id, entity)
  where deleted_at is null and is_active and semantic_action = 'close';

create unique index if not exists status_definitions_one_cancel_uidx
  on public.status_definitions (workspace_id, entity)
  where deleted_at is null and is_active and semantic_action = 'cancel';

-- ---------------------------------------------------------------------------
-- 2) Lifecycle tokens — only SECURITY DEFINER writers may insert
-- ---------------------------------------------------------------------------
create table if not exists public.order_lifecycle_tokens (
  order_id uuid primary key references public.orders(id) on delete cascade,
  op text not null check (op in ('close', 'cancel')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.order_lifecycle_tokens enable row level security;
revoke all on table public.order_lifecycle_tokens from public, anon, authenticated;
grant all on table public.order_lifecycle_tokens to service_role;

comment on table public.order_lifecycle_tokens is
  'Single-use tokens proving close/cancel RPCs authorize a protected orders UPDATE. Not client-writable.';

-- ---------------------------------------------------------------------------
-- 3) Remaining helper (payment − refund − void; order+invoice economic set)
-- ---------------------------------------------------------------------------
create or replace function public.order_ledger_remaining(p_workspace_id uuid, p_order_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_total numeric;
  v_paid numeric;
  v_invoice_id uuid;
begin
  select o.total_price into v_total
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  select i.id into v_invoice_id
  from public.invoices i
  where i.workspace_id = p_workspace_id and i.order_id = p_order_id
  limit 1;

  select coalesce(sum(
           case
             when p.kind = 'payment' then p.amount
             when p.kind in ('refund', 'void') then -p.amount
             else 0
           end
         ), 0)
    into v_paid
  from public.payments p
  where p.workspace_id = p_workspace_id
    and (
      p.order_id = p_order_id
      or (v_invoice_id is not null and p.invoice_id = v_invoice_id)
    );

  return greatest(coalesce(v_total, 0) - coalesce(v_paid, 0), 0);
end;
$fn$;

revoke all on function public.order_ledger_remaining(uuid, uuid) from public, anon;
grant execute on function public.order_ledger_remaining(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Guard: block client UPDATE of closed_at / close|cancel semantic assign
-- ---------------------------------------------------------------------------
create or replace function public.order_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token_op text;
  v_new_action text;
begin
  if new.closed_at is distinct from old.closed_at then
    select t.op into v_token_op
    from public.order_lifecycle_tokens t
    where t.order_id = new.id and t.op = 'close'
    for update;
    if v_token_op is null then
      raise exception 'order_lifecycle:closed_at_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'closed' then
    select t.op into v_token_op
    from public.order_lifecycle_tokens t
    where t.order_id = new.id and t.op = 'close'
    for update;
    if v_token_op is null then
      raise exception 'order_lifecycle:closed_status_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  if new.custom_status_id is distinct from old.custom_status_id
     and new.custom_status_id is not null then
    select d.semantic_action into v_new_action
    from public.status_definitions d
    where d.id = new.custom_status_id
      and d.workspace_id = new.workspace_id
      and d.entity = 'order'
      and d.deleted_at is null;

    if v_new_action = 'close' then
      select t.op into v_token_op
      from public.order_lifecycle_tokens t
      where t.order_id = new.id and t.op = 'close'
      for update;
      if v_token_op is null then
        raise exception 'order_lifecycle:close_semantic_via_rpc_only' using errcode = '42501';
      end if;
    elsif v_new_action = 'cancel' then
      select t.op into v_token_op
      from public.order_lifecycle_tokens t
      where t.order_id = new.id and t.op = 'cancel'
      for update;
      if v_token_op is null then
        raise exception 'order_lifecycle:cancel_semantic_via_rpc_only' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'cancelled' then
    -- Allow legacy cancel string only with cancel token (protected cancel RPC)
    select t.op into v_token_op
    from public.order_lifecycle_tokens t
    where t.order_id = new.id and t.op = 'cancel'
    for update;
    if v_token_op is null then
      -- Backward compatible: if no cancel semantic is configured yet, allow
      -- ordinary status updates to 'cancelled' so existing UIs keep working
      -- until the cancel RPC is adopted. Once an active cancel semantic exists
      -- for the workspace, require the token.
      if exists (
        select 1 from public.status_definitions d
        where d.workspace_id = new.workspace_id
          and d.entity = 'order'
          and d.deleted_at is null
          and d.is_active
          and d.semantic_action = 'cancel'
      ) then
        raise exception 'order_lifecycle:cancel_status_via_rpc_only' using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists orders_lifecycle_guard_bu on public.orders;
create trigger orders_lifecycle_guard_bu
  before update of status, custom_status_id, closed_at on public.orders
  for each row
  execute function public.order_lifecycle_guard();

revoke all on function public.order_lifecycle_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) close_order_if_settled
-- Lock order: WORKSPACE FOR SHARE → ORDER FOR UPDATE → payments FOR UPDATE by id
-- (compatible with payments_enforce_integrity WORKSPACE→ORDER→INVOICE)
-- ---------------------------------------------------------------------------
create or replace function public.close_order_if_settled(
  p_order_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_remaining numeric;
  v_total numeric;
  v_close_status_id uuid;
  v_currency text;
  v_pay record;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not public.crm_has_permission(p_workspace_id, 'orders.edit') then
    -- Fallback: active membership (workspaces without granular CRM roles still work)
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = v_uid
        and m.deleted_at is null
    ) then
      raise exception 'order_lifecycle:forbidden' using errcode = '42501';
    end if;
  end if;

  -- Lock order first (align with payment path; do not lock invoice before order).
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  if v_order.workspace_id is distinct from p_workspace_id then
    raise exception 'order_lifecycle:workspace_mismatch' using errcode = '42501';
  end if;

  -- Serialize vs refund/void: lock every payment row in the economic set.
  for v_pay in
    select p.id
    from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or exists (
          select 1 from public.invoices i
          where i.workspace_id = p_workspace_id
            and i.order_id = p_order_id
            and i.id = p.invoice_id
        )
      )
    order by p.id
    for update
  loop
    null;
  end loop;

  -- Idempotent formal close
  if v_order.closed_at is not null then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'closed_at', v_order.closed_at,
      'remaining', 0
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_lifecycle:cannot_close_cancelled' using errcode = 'P0001';
  end if;

  v_total := coalesce(v_order.total_price, 0);
  v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);

  select nullif(upper(trim(w.currency)), '') into v_currency
  from public.workspaces w
  where w.id = p_workspace_id;

  if v_total > 0.005 then
    -- Positive total: require ledger evidence and remaining <= eps
    if not exists (
      select 1 from public.payments p
      where p.workspace_id = p_workspace_id
        and (
          p.order_id = p_order_id
          or exists (
            select 1 from public.invoices i
            where i.workspace_id = p_workspace_id
              and i.order_id = p_order_id
              and i.id = p.invoice_id
          )
        )
        and p.kind in ('payment', 'refund', 'void')
    ) then
      raise exception 'order_lifecycle:ledger_required remaining=% currency=%',
        round(v_total::numeric, 2), coalesce(v_currency, '')
        using errcode = 'P0001';
    end if;
  end if;

  -- Zero (or ~0) total may close without payment rows.
  if v_remaining > 0.005 then
    raise exception 'order_lifecycle:not_settled remaining=% currency=%',
      round(v_remaining::numeric, 2), coalesce(v_currency, '')
      using errcode = 'P0001';
  end if;

  select d.id into v_close_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'close'
  order by d.sort_order, d.name
  limit 1;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'close', v_uid)
  on conflict (order_id) do update
    set op = excluded.op, created_by = excluded.created_by, created_at = now();

  update public.orders o
  set
    status = 'closed',
    closed_at = coalesce(o.closed_at, now()),
    custom_status_id = coalesce(v_close_status_id, o.custom_status_id),
    status_changed_at = now(),
    updated_at = now()
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id;

  delete from public.order_lifecycle_tokens where order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'closed_at', (select closed_at from public.orders where id = p_order_id),
    'custom_status_id', v_close_status_id,
    'remaining', 0,
    'currency', coalesce(v_currency, '')
  );
end;
$fn$;

revoke all on function public.close_order_if_settled(uuid, uuid) from public, anon;
grant execute on function public.close_order_if_settled(uuid, uuid) to authenticated, service_role;

comment on function public.close_order_if_settled(uuid, uuid) is
  'Formal order close when ledger remaining<=0.005. Sets closed_at once. No payment insert. Idempotent.';

-- ---------------------------------------------------------------------------
-- 6) cancel_order — no closed_at, no payments, no inventory
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(
  p_order_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_cancel_status_id uuid;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if not public.crm_has_permission(p_workspace_id, 'orders.edit') then
    if not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = p_workspace_id and m.user_id = v_uid and m.deleted_at is null
    ) then
      raise exception 'order_lifecycle:forbidden' using errcode = '42501';
    end if;
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  if v_order.workspace_id is distinct from p_workspace_id then
    raise exception 'order_lifecycle:workspace_mismatch' using errcode = '42501';
  end if;

  if v_order.closed_at is not null then
    raise exception 'order_lifecycle:cannot_cancel_closed' using errcode = 'P0001';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', p_order_id);
  end if;

  select d.id into v_cancel_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'cancel'
  order by d.sort_order, d.name
  limit 1;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'cancel', v_uid)
  on conflict (order_id) do update
    set op = excluded.op, created_by = excluded.created_by, created_at = now();

  update public.orders o
  set
    status = 'cancelled',
    custom_status_id = coalesce(v_cancel_status_id, o.custom_status_id),
    status_changed_at = now(),
    updated_at = now()
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id;

  delete from public.order_lifecycle_tokens where order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'custom_status_id', v_cancel_status_id,
    'closed_at', null
  );
end;
$fn$;

revoke all on function public.cancel_order(uuid, uuid) from public, anon;
grant execute on function public.cancel_order(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Designate close/cancel semantic (settings.statuses). Clears previous.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_lifecycle_semantic(
  p_workspace_id uuid,
  p_status_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.status_definitions%rowtype;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_action not in ('close', 'cancel', 'normal') then
    raise exception 'order_lifecycle:invalid_action' using errcode = '22023';
  end if;

  if not public.crm_has_permission(p_workspace_id, 'settings.statuses') then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  select * into v_row
  from public.status_definitions d
  where d.id = p_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
  for update;

  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  if p_action in ('close', 'cancel') then
    update public.status_definitions d
    set semantic_action = 'normal', updated_at = now()
    where d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.deleted_at is null
      and d.semantic_action = p_action
      and d.id is distinct from p_status_id;
  end if;

  update public.status_definitions d
  set semantic_action = p_action, updated_at = now()
  where d.id = p_status_id;

  return jsonb_build_object('ok', true, 'status_id', p_status_id, 'semantic_action', p_action);
end;
$fn$;

revoke all on function public.set_order_lifecycle_semantic(uuid, uuid, text) from public, anon;
grant execute on function public.set_order_lifecycle_semantic(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) Replace in-use status (orders.custom_status_id) then soft-delete source
-- ---------------------------------------------------------------------------
create or replace function public.replace_order_status(
  p_workspace_id uuid,
  p_from_status_id uuid,
  p_to_status_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_from public.status_definitions%rowtype;
  v_to public.status_definitions%rowtype;
  v_moved integer := 0;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if not public.crm_has_permission(p_workspace_id, 'settings.statuses') then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if p_from_status_id is not distinct from p_to_status_id then
    raise exception 'order_lifecycle:replace_same' using errcode = '22023';
  end if;

  select * into v_from from public.status_definitions
  where id = p_from_status_id and workspace_id = p_workspace_id and entity = 'order' and deleted_at is null
  for update;
  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  select * into v_to from public.status_definitions
  where id = p_to_status_id and workspace_id = p_workspace_id and entity = 'order' and deleted_at is null and is_active
  for update;
  if not found then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = 'P0002';
  end if;

  if v_to.semantic_action in ('close', 'cancel') then
    raise exception 'order_lifecycle:replace_target_protected' using errcode = 'P0001';
  end if;

  update public.orders o
  set custom_status_id = p_to_status_id, updated_at = now()
  where o.workspace_id = p_workspace_id
    and o.custom_status_id = p_from_status_id;
  get diagnostics v_moved = row_count;

  update public.status_definitions
  set is_active = false, is_default = false, deleted_at = now(), updated_at = now()
  where id = p_from_status_id;

  return jsonb_build_object('ok', true, 'moved', v_moved, 'from', p_from_status_id, 'to', p_to_status_id);
end;
$fn$;

revoke all on function public.replace_order_status(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_order_status(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) Default five statuses for EMPTY workspaces only (+ new workspace trigger)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_default_order_statuses(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null;

  if coalesce(v_count, 0) > 0 then
    return;
  end if;

  insert into public.status_definitions (
    workspace_id, entity, name, color, status_group, system_status,
    code, semantic_action, sort_order, is_default, is_active
  ) values
    (p_workspace_id, 'order', 'New',               '#2563EB', 'new',         'new',           'new',           'normal', 1, true,  true),
    (p_workspace_id, 'order', 'In Progress',       '#16A34A', 'in_progress', 'in-progress',   'in_progress',   'normal', 2, false, true),
    (p_workspace_id, 'order', 'Waiting for Parts', '#F59E0B', 'pending',     'waiting-parts', 'waiting_parts', 'normal', 3, false, true),
    (p_workspace_id, 'order', 'Closed',            '#737373', 'closed',      'closed',        'closed',        'close',  4, false, true),
    (p_workspace_id, 'order', 'Cancelled',         '#A3A3A3', 'dropped_off', 'cancelled',     'cancelled',     'cancel', 5, false, true);
end;
$fn$;

revoke all on function public.ensure_default_order_statuses(uuid) from public, anon, authenticated;
grant execute on function public.ensure_default_order_statuses(uuid) to service_role;

create or replace function public.workspaces_seed_order_statuses()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.ensure_default_order_statuses(new.id);
  return new;
end;
$fn$;

drop trigger if exists workspaces_seed_order_statuses_ai on public.workspaces;
create trigger workspaces_seed_order_statuses_ai
  after insert on public.workspaces
  for each row
  execute function public.workspaces_seed_order_statuses();

revoke all on function public.workspaces_seed_order_statuses() from public, anon, authenticated;

-- Backfill ONLY empty workspaces (preserves existing nine-status workspaces).
do $backfill$
declare
  r record;
begin
  for r in
    select w.id
    from public.workspaces w
    where w.deleted_at is null
      and not exists (
        select 1 from public.status_definitions d
        where d.workspace_id = w.id and d.entity = 'order' and d.deleted_at is null
      )
  loop
    perform public.ensure_default_order_statuses(r.id);
  end loop;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- 10) POST-APPLY ASSERTIONS
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_problems text := '';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='status_definitions' and column_name='semantic_action'
  ) then
    v_problems := v_problems || 'semantic_action missing; ';
  end if;

  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    v_problems := v_problems || 'close_order_if_settled missing; ';
  end if;
  if to_regprocedure('public.cancel_order(uuid,uuid)') is null then
    v_problems := v_problems || 'cancel_order missing; ';
  end if;
  if to_regprocedure('public.set_order_lifecycle_semantic(uuid,uuid,text)') is null then
    v_problems := v_problems || 'set_order_lifecycle_semantic missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'orders_lifecycle_guard_bu' and tgrelid = 'public.orders'::regclass and not tgisinternal
  ) then
    v_problems := v_problems || 'orders_lifecycle_guard_bu missing; ';
  end if;

  -- Existing order-status event trigger must still be present.
  if not exists (
    select 1 from pg_trigger
    where tgname = 'crm_orders_status_event' and tgrelid = 'public.orders'::regclass and not tgisinternal
  ) then
    v_problems := v_problems || 'crm_orders_status_event missing after apply; ';
  end if;

  if has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'insert') then
    v_problems := v_problems || 'authenticated must NOT insert order_lifecycle_tokens; ';
  end if;

  if v_problems <> '' then
    raise exception 'POST-APPLY ASSERT FAILED: %', v_problems;
  end if;
end
$assert$;

notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- READ-ONLY VERIFICATION (run separately after APPLY; do not wrap in txn with DDL)
-- =============================================================================
-- select column_name from information_schema.columns
--  where table_name='status_definitions' and column_name in ('code','semantic_action');
-- select proname from pg_proc where proname in
--  ('close_order_if_settled','cancel_order','set_order_lifecycle_semantic','replace_order_status');
-- select workspace_id, count(*) from status_definitions
--  where entity='order' and deleted_at is null group by 1 order by 1;
-- select semantic_action, count(*) from status_definitions
--  where entity='order' and deleted_at is null group by 1;
-- -- Expect existing workspaces still at normal for all rows until owner assigns close/cancel.
