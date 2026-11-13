-- =============================================================================
-- Closed orders: role grant orders.closed_full_access (= owner for closed/cancelled)
-- Script: 20261114200000_closed_order_full_access.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: workspace_role_permission_grants, crm_is_workspace_owner_id,
--   crm_has_closed_order_permission@v3, crm_owner_may_edit_cancelled_order,
--   crm_owner_may_unlink_order_warranty, reopen_cancelled_order,
--   crm_owner_may_manage_closed_orders@v2 (always false — keep closed immutable).
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.workspace_role_permission_grants') is null then
    v_problems := v_problems || 'workspace_role_permission_grants missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id missing; ';
  end if;
  if to_regprocedure('public.crm_has_closed_order_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_closed_order_permission missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_edit_cancelled_order(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_unlink_order_warranty(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_unlink_order_warranty missing; ';
  end if;
  if to_regprocedure('public.reopen_cancelled_order(uuid,uuid,text,uuid)') is null then
    v_problems := v_problems || 'reopen_cancelled_order missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'closed_order_full_access preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Allow permission key on grants table (idempotent constraint refresh)
-- ---------------------------------------------------------------------------
alter table public.workspace_role_permission_grants
  drop constraint if exists workspace_role_permission_grants_permission_check;

alter table public.workspace_role_permission_grants
  add constraint workspace_role_permission_grants_permission_check
  check (permission in (
    'orders.cancel_closed',
    'orders.delete_closed',
    'orders.closed_full_access'
  ));

-- ---------------------------------------------------------------------------
-- 2) Helper: owner_id OR membership role with orders.closed_full_access
-- ---------------------------------------------------------------------------
create or replace function public.crm_acts_as_owner_for_closed_orders(
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
    or exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w
        on w.id = wm.workspace_id
      join public.workspace_role_permission_grants g
        on g.workspace_id = wm.workspace_id
       and g.permission = 'orders.closed_full_access'
       and g.workspace_role = wm.role
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.deleted_at is null
        and w.deleted_at is null
        and wm.role in ('admin', 'manager', 'member')
    );
$fn$;

revoke all on function public.crm_acts_as_owner_for_closed_orders(uuid) from public, anon;
grant execute on function public.crm_acts_as_owner_for_closed_orders(uuid) to authenticated, service_role;

comment on function public.crm_acts_as_owner_for_closed_orders(uuid) is
  'managed-object: core-app/crm_acts_as_owner_for_closed_orders@v1 — workspaces.owner_id OR admin/manager/member with orders.closed_full_access. Closed/cancelled lifecycle only; not other owner powers.';

-- ---------------------------------------------------------------------------
-- 3) cancel/delete: full access implies both (independent of owner_can_manage)
-- ---------------------------------------------------------------------------
create or replace function public.crm_has_closed_order_permission(
  p_workspace_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    (
      p_permission in ('orders.cancel_closed', 'orders.delete_closed')
      and coalesce(public.crm_acts_as_owner_for_closed_orders(p_workspace_id), false)
      and (
        -- Full-access role: always (does not need owner_can_manage_closed_orders).
        exists (
          select 1
          from public.workspace_members wm
          join public.workspace_role_permission_grants g
            on g.workspace_id = wm.workspace_id
           and g.permission = 'orders.closed_full_access'
           and g.workspace_role = wm.role
          where wm.workspace_id = p_workspace_id
            and wm.user_id = auth.uid()
            and wm.deleted_at is null
            and wm.role in ('admin', 'manager', 'member')
        )
        -- Actual owner: still requires owner_can_manage_closed_orders.
        or coalesce((
          select w.owner_can_manage_closed_orders
            and w.owner_id is not null
            and w.owner_id = auth.uid()
            and w.deleted_at is null
          from public.workspaces w
          where w.id = p_workspace_id
        ), false)
      )
    )
    or (
      p_permission in ('orders.cancel_closed', 'orders.delete_closed')
      and exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        join public.workspace_role_permission_grants g
          on g.workspace_id = wm.workspace_id
         and g.permission = p_permission
         and g.workspace_role = wm.role
        where wm.workspace_id = p_workspace_id
          and wm.user_id = auth.uid()
          and wm.deleted_at is null
          and w.deleted_at is null
          and wm.role in ('admin', 'manager', 'member')
      )
    );
$fn$;

revoke all on function public.crm_has_closed_order_permission(uuid, text) from public, anon;
grant execute on function public.crm_has_closed_order_permission(uuid, text) to authenticated, service_role;

comment on function public.crm_has_closed_order_permission(uuid, text) is
  'managed-object: core-app/crm_has_closed_order_permission@v4 — cancel/delete: owner+owner_can_manage_closed_orders, OR orders.closed_full_access role, OR specific cancel/delete grants. Not an edit permission for closed (non-cancelled) content.';

-- ---------------------------------------------------------------------------
-- 4) Cancelled-order content edit: owner OR full access
-- ---------------------------------------------------------------------------
create or replace function public.crm_owner_may_edit_cancelled_order(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_status text;
begin
  if v_uid is null or p_order_id is null then
    return false;
  end if;

  select o.workspace_id, o.status
    into v_ws, v_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return false;
  end if;

  if v_status is distinct from 'cancelled' then
    return false;
  end if;

  return coalesce(public.crm_acts_as_owner_for_closed_orders(v_ws), false);
end;
$fn$;

revoke all on function public.crm_owner_may_edit_cancelled_order(uuid) from public, anon;
grant execute on function public.crm_owner_may_edit_cancelled_order(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_edit_cancelled_order(uuid) is
  'managed-object: core-app/crm_owner_may_edit_cancelled_order@v2 — cancelled orders only; owner_id OR orders.closed_full_access. Independent of owner_can_manage_closed_orders. Closed non-cancelled stay immutable.';

-- ---------------------------------------------------------------------------
-- 5) Unlink warranty: owner OR full access (same eligibility windows)
-- ---------------------------------------------------------------------------
create or replace function public.crm_owner_may_unlink_order_warranty(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_status text;
  v_closed_at timestamptz;
begin
  if v_uid is null or p_order_id is null then
    return false;
  end if;

  select o.workspace_id, o.status, o.closed_at
    into v_ws, v_status, v_closed_at
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return false;
  end if;

  if not coalesce(public.crm_acts_as_owner_for_closed_orders(v_ws), false) then
    return false;
  end if;

  if v_status is not distinct from 'cancelled' then
    return true;
  end if;
  if v_closed_at is null then
    return true;
  end if;
  -- manage-closed remains always-false: formally closed non-cancelled stay blocked.
  return coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false);
end;
$fn$;

revoke all on function public.crm_owner_may_unlink_order_warranty(uuid) from public, anon;
grant execute on function public.crm_owner_may_unlink_order_warranty(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_unlink_order_warranty(uuid) is
  'managed-object: core-app/crm_owner_may_unlink_order_warranty@v2 — owner_id OR orders.closed_full_access; cancelled / reopened / manage-closed windows unchanged.';

-- ---------------------------------------------------------------------------
-- 6) Reopen cancelled: owner OR full access
-- ---------------------------------------------------------------------------
create or replace function public.reopen_cancelled_order(
  p_order_id uuid,
  p_workspace_id uuid,
  p_status text,
  p_custom_status_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_custom uuid := p_custom_status_id;
  v_target public.status_definitions%rowtype;
  v_touch text;
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not coalesce(public.crm_acts_as_owner_for_closed_orders(p_workspace_id), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if v_status not in ('new', 'in-progress', 'waiting-parts', 'completed', 'paid') then
    raise exception 'order_lifecycle:invalid_reopen_status' using errcode = '22023';
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

  if v_order.status is distinct from 'cancelled' then
    raise exception 'order_lifecycle:not_cancelled' using errcode = 'P0001';
  end if;

  if v_custom is not null then
    select * into v_target
    from public.status_definitions d
    where d.id = v_custom
      and d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.is_active
      and d.deleted_at is null;

    if not found then
      raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
    end if;
    if v_target.semantic_action in ('close', 'cancel') then
      raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
    end if;
    if v_target.system_status is not null
       and v_target.system_status::text is distinct from v_status then
      v_status := lower(trim(v_target.system_status::text));
      if v_status not in ('new', 'in-progress', 'waiting-parts', 'completed', 'paid') then
        raise exception 'order_lifecycle:invalid_reopen_status' using errcode = '22023';
      end if;
    end if;
  end if;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'reopen', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by,
        created_at = now();

  begin
    execute format(
      'update public.orders o
          set status = $1,
              custom_status_id = $2,
              closed_at = null%s
        where o.id = $3
          and o.workspace_id = $4
          and o.status = ''cancelled''',
      v_touch
    )
      using v_status, v_custom, p_order_id, p_workspace_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'order_lifecycle:update_failed' using errcode = 'P0001';
    end if;
  exception
    when others then
      delete from public.order_lifecycle_tokens
      where order_id = p_order_id and op = 'reopen';
      raise;
  end;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'reopen';

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', v_order.status,
    'closed_at', v_order.closed_at,
    'custom_status_id', v_order.custom_status_id
  );
end;
$fn$;

revoke all on function public.reopen_cancelled_order(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.reopen_cancelled_order(uuid, uuid, text, uuid) to authenticated, service_role;

comment on function public.reopen_cancelled_order(uuid, uuid, text, uuid) is
  'managed-object: core-app/reopen_cancelled_order@v2 — owner_id OR orders.closed_full_access; cancelled → open status; clears closed_at.';

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 7) Remaining bare owner_id checks on cancelled-order lifecycle -> acts-as-owner
--    (CREATE OR REPLACE keeps existing grants)
-- ---------------------------------------------------------------------------

-- set_order_lifecycle_regular_custom_status: copied verbatim from 20261105180000_owner_manage_closed_orders_complete.PRODUCTION.sql;
-- only change: cancelled (not closed) orders: owner OR full access may set a regular custom status.
create or replace function public.set_order_lifecycle_regular_custom_status(
  p_workspace_id uuid,
  p_order_id uuid,
  p_custom_status_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_target public.status_definitions%rowtype;
  v_need_replace_token boolean := false;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_order_id is null or p_custom_status_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  -- Formally closed: owner + setting. Cancelled-without-close: bare owner_id (unchanged).
  if v_order.closed_at is not null then
    if not coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false) then
      raise exception 'order_lifecycle:forbidden' using errcode = '42501';
    end if;
  elsif not coalesce(public.crm_acts_as_owner_for_closed_orders(p_workspace_id), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if v_order.closed_at is null
     and v_order.status is distinct from 'closed'
     and v_order.status is distinct from 'cancelled' then
    raise exception 'order_lifecycle:not_lifecycle_order' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.status_definitions d
  where d.id = p_custom_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.is_active
    and d.deleted_at is null;

  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  if v_target.semantic_action is distinct from 'normal' then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
  end if;

  if v_target.system_status in ('closed', 'cancelled') then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
  end if;

  if v_order.custom_status_id is not distinct from p_custom_status_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'closed_at', v_order.closed_at,
      'custom_status_id', v_order.custom_status_id
    );
  end if;

  v_need_replace_token := v_order.closed_at is not null;
  if v_need_replace_token then
    insert into public.order_lifecycle_tokens (order_id, op, created_by)
    values (v_order.id, 'replace', v_uid)
    on conflict (order_id, op) do update
      set created_by = excluded.created_by,
          created_at = now();
  end if;

  begin
    update public.orders o
       set custom_status_id = p_custom_status_id
     where o.id = v_order.id
       and o.workspace_id = p_workspace_id
       and o.status is not distinct from v_order.status
       and o.closed_at is not distinct from v_order.closed_at;

    if not found then
      raise exception 'order_lifecycle:update_failed' using errcode = 'P0001';
    end if;
  exception
    when others then
      if v_need_replace_token then
        delete from public.order_lifecycle_tokens
        where order_id = v_order.id and op = 'replace';
      end if;
      raise;
  end;

  if v_need_replace_token then
    delete from public.order_lifecycle_tokens
    where order_id = v_order.id and op = 'replace';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', v_order.id,
    'status', v_order.status,
    'closed_at', v_order.closed_at,
    'custom_status_id', p_custom_status_id
  );
end;
$fn$;

-- crm_cancel_order_with_payment_void: copied verbatim from 20261106120000_cancel_order_with_payment_void.PRODUCTION.sql;
-- only change: voiding payments on cancel: owner OR full access OR orders.edit.
create or replace function public.crm_cancel_order_with_payment_void(
  p_order_id uuid,
  p_workspace_id uuid,
  p_void_payments boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_cancel jsonb;
  v_reason text;
  v_number text;
  v_pay record;
  v_voided_count integer := 0;
  v_voided_total numeric := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  -- Same permission + lifecycle rules as the normal cancel (raises on forbidden).
  v_cancel := public.cancel_order(p_order_id, p_workspace_id);

  if not coalesce(p_void_payments, false) then
    return coalesce(v_cancel, '{}'::jsonb)
      || jsonb_build_object('voided_count', 0, 'voided_total', 0, 'skipped', '[]'::jsonb);
  end if;

  -- Voiding money: workspace owner_id or a member with orders.edit.
  if not (
    coalesce(public.crm_acts_as_owner_for_closed_orders(p_workspace_id), false)
    or coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false)
  ) then
    raise exception 'order_payment_void:forbidden' using errcode = '42501';
  end if;

  select o.number into v_number
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 8 then
    v_reason := 'Order cancelled' || coalesce(' ' || v_number, '');
  end if;

  for v_pay in
    select p.*
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and p.kind = 'payment'
    order by p.paid_at, p.id
    for update
  loop
    if exists (
      select 1 from public.payments r
      where r.workspace_id = p_workspace_id
        and r.related_payment_id = v_pay.id
        and r.kind in ('refund', 'void')
    ) then
      -- Already fully voided → nothing to do; partially/fully refunded → cannot void.
      if not exists (
        select 1 from public.payments v
        where v.workspace_id = p_workspace_id
          and v.related_payment_id = v_pay.id
          and v.kind = 'void'
      ) then
        v_skipped := v_skipped || jsonb_build_object(
          'payment_id', v_pay.id, 'amount', v_pay.amount, 'reason', 'has_refund'
        );
      end if;
      continue;
    end if;

    insert into public.payments (
      workspace_id, order_id, invoice_id, related_payment_id, kind,
      amount, currency_code, payment_method, paid_at, note
    ) values (
      v_pay.workspace_id, v_pay.order_id, v_pay.invoice_id, v_pay.id, 'void',
      v_pay.amount, v_pay.currency_code, v_pay.payment_method, now(), v_reason
    );

    v_voided_count := v_voided_count + 1;
    v_voided_total := v_voided_total + v_pay.amount;
  end loop;

  return coalesce(v_cancel, '{}'::jsonb) || jsonb_build_object(
    'voided_count', v_voided_count,
    'voided_total', v_voided_total,
    'skipped', v_skipped
  );
end;
$fn$;

-- delete_order_with_payments: copied verbatim from 20261105120000_lifecycle_close_cancel_delete_warranty.PRODUCTION.sql;
-- only change: non-closed cancelled orders: owner OR full access OR orders.delete (all other checks unchanged).
create or replace function public.delete_order_with_payments(
  p_workspace_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_is_cancelled boolean := false;
  v_payment_count integer := 0;
  v_voided_deleted integer := 0;
  v_rowcount integer;
  v_has_om boolean := false;
  v_outstanding boolean := false;
  v_mismatch text;
  v_bad_wh text;
  v_key text;
  v_returned jsonb := '[]'::jsonb;
  v_invoice_labels text;
  v_active_pay_labels text;
  v_refund_count integer := 0;
  v_storage_paths text[] := array[]::text[];
  v_path text;
  r_wh record;
  r_pay record;
  v_voided numeric;
  v_refunded numeric;
  v_warranty_block text;
  v_warranty_deleted integer := 0;
begin
  if v_uid is null then
    raise exception 'order_delete:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_order_id is null then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  -- Cancellation: system status OR protected cancel semantic — never by display name.
  v_is_cancelled := (v_order.status is not distinct from 'cancelled');

  if not v_is_cancelled
     and to_regclass('public.status_definitions') is not null
     and v_order.custom_status_id is not null then
    select exists (
      select 1
      from public.status_definitions d
      where d.id = v_order.custom_status_id
        and d.workspace_id = p_workspace_id
        and d.entity = 'order'
        and d.semantic_action = 'cancel'
        and d.deleted_at is null
    ) into v_is_cancelled;
  end if;

  -- Always require cancelled first (open or closed). Closed cancel is a separate RPC.
  if not v_is_cancelled then
    raise exception 'order_delete:not_cancelled' using errcode = 'P0001';
  end if;

  -- Closed (and still cancelled): owner_id or orders.delete_closed.
  -- Non-closed cancelled: owner_id or existing orders.delete (crm_has_permission).
  if v_order.closed_at is not null then
    if not coalesce(public.crm_has_closed_order_permission(p_workspace_id, 'orders.delete_closed'), false) then
      raise exception 'order_delete:forbidden_closed' using errcode = '42501';
    end if;
  else
    if not (
      coalesce(public.crm_acts_as_owner_for_closed_orders(p_workspace_id), false)
      or coalesce(public.crm_has_permission(p_workspace_id, 'orders.delete'), false)
    ) then
      raise exception 'order_delete:forbidden' using errcode = '42501';
    end if;
  end if;

  -- ---- Financial: invoices ----
  -- Any remaining invoices.order_id link blocks deletion. Annulled/erroneous
  -- invoices must be removed via delete_erroneous_invoice (or equivalent) first.
  -- Label uses public.invoices.number (migration 20261004010000_invoices.sql).
  if to_regclass('public.invoices') is not null then
    select string_agg(coalesce(nullif(trim(i.number), ''), i.id::text), ', ' order by i.created_at)
      into v_invoice_labels
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.order_id = p_order_id;

    if v_invoice_labels is not null then
      raise exception 'order_delete:has_invoice:%', v_invoice_labels using errcode = '23514';
    end if;
  end if;

  if to_regclass('public.invoice_orders') is not null then
    select string_agg(io.invoice_id::text, ', ')
      into v_invoice_labels
    from public.invoice_orders io
    where io.order_id = p_order_id;

    if v_invoice_labels is not null then
      raise exception 'order_delete:has_invoice_orders:%', v_invoice_labels using errcode = '23514';
    end if;
  end if;

  -- ---- Financial: finance_transactions / credit_notes (retain if present) ----
  if to_regclass('public.finance_transactions') is not null
     and exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.finance_transactions'::regclass
         and a.attname = 'order_id' and a.attnum > 0 and not a.attisdropped
     ) then
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.finance_transactions'::regclass
        and a.attname = 'deleted_at' and a.attnum > 0 and not a.attisdropped
    ) then
      execute
        'select exists (
           select 1 from public.finance_transactions t
           where t.order_id = $1 and t.deleted_at is null
         )'
        into v_outstanding
        using p_order_id;
    else
      execute
        'select exists (
           select 1 from public.finance_transactions t where t.order_id = $1
         )'
        into v_outstanding
        using p_order_id;
    end if;
    if v_outstanding then
      raise exception 'order_delete:has_finance_transactions' using errcode = '23514';
    end if;
  end if;

  if to_regclass('public.credit_notes') is not null
     and exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.credit_notes'::regclass
         and a.attname = 'order_id' and a.attnum > 0 and not a.attisdropped
     ) then
    execute
      'select exists (select 1 from public.credit_notes cn where cn.order_id = $1)'
      into v_outstanding
      using p_order_id;
    if v_outstanding then
      raise exception 'order_delete:has_credit_notes' using errcode = '23514';
    end if;
  end if;

  -- ---- Financial: payments / refunds / voids ----
  -- Refunds are real money movements and must remain (accounting retention) —
  -- they permanently block order deletion until operationally resolved outside
  -- this RPC (there is no refund-annul path that clears order_id).
  select count(*)::integer into v_refund_count
  from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id
    and p.kind = 'refund';

  if v_refund_count > 0 then
    raise exception 'order_delete:has_refund:count=%', v_refund_count using errcode = '23514';
  end if;

  select string_agg(p.id::text, ', ' order by p.created_at)
    into v_active_pay_labels
  from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id
    and p.kind = 'payment'
    and abs(
          coalesce((
            select sum(v.amount)
            from public.payments v
            where v.related_payment_id = p.id
              and v.kind = 'void'
          ), 0) - p.amount
        ) > 0.005;

  if v_active_pay_labels is not null then
    raise exception 'order_delete:has_active_payment:%', v_active_pay_labels using errcode = '23514';
  end if;

  -- Orphan void/refund-shaped rows without a deletable parent payment should not remain.
  if exists (
    select 1
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and p.kind = 'void'
      and (
        p.related_payment_id is null
        or not exists (
          select 1 from public.payments o
          where o.id = p.related_payment_id
            and o.workspace_id = p_workspace_id
            and o.order_id = p_order_id
            and o.kind = 'payment'
        )
      )
  ) then
    raise exception 'order_delete:has_orphaned_void' using errcode = '23514';
  end if;

  -- ---- Inventory return (ledger-authoritative) ----
  v_has_om := to_regclass('public.order_materials') is not null
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.order_materials')
        and a.attname = 'quantity_issued' and a.attnum > 0 and not a.attisdropped
    )
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.order_materials')
        and a.attname = 'quantity_returned' and a.attnum > 0 and not a.attisdropped
    );

  if v_has_om then
    select exists (
      select 1
      from public.order_materials om
      where om.order_id = p_order_id
        and coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0) > 0
    ) into v_outstanding;
  end if;

  -- Outstanding issued stock is returned automatically for EVERY cancelled order
  -- (including previously closed then cancelled). Cancellation itself never returns
  -- stock; only this delete path does. Never raise issued_materials_on_closed_order.
  if v_outstanding then
    if to_regprocedure('public.return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text)') is null then
      raise exception 'order_delete:return_rpc_missing — return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text) is required'
        using errcode = 'P0001';
    end if;

    if to_regclass('public.inventory_movements') is null
       or not exists (
         select 1 from pg_catalog.pg_attribute a
         where a.attrelid = to_regclass('public.inventory_movements')
           and a.attname = 'warehouse_id' and a.attnum > 0 and not a.attisdropped
       ) then
      raise exception 'order_delete:inventory_ledger_missing' using errcode = 'P0001';
    end if;

    perform 1
    from public.order_materials om
    where om.order_id = p_order_id
    order by om.id
    for update of om;

    select string_agg(
             format('item=%s ledger=%s lines=%s',
                    coalesce(l.item_id, c.item_id), coalesce(l.qty, 0), coalesce(c.qty, 0)),
             '; ')
      into v_mismatch
    from (
      select m.inventory_item_id as item_id,
             sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
      from public.inventory_movements m
      where m.workspace_id = p_workspace_id
        and m.order_id = p_order_id
        and m.movement_type in ('issue', 'return')
      group by m.inventory_item_id
    ) l
    full join (
      select om.inventory_item_id as item_id,
             sum(coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0)) as qty
      from public.order_materials om
      where om.order_id = p_order_id
      group by om.inventory_item_id
    ) c on c.item_id = l.item_id
    where coalesce(l.qty, 0) <> coalesce(c.qty, 0);

    if v_mismatch is not null then
      raise exception 'order_delete:materials_ledger_mismatch %', v_mismatch using errcode = 'P0001';
    end if;

    select string_agg(
             format('warehouse=%s item=%s qty=%s', coalesce(x.warehouse_id::text, 'NULL'), x.item_id, x.qty),
             '; ')
      into v_bad_wh
    from (
      select m.warehouse_id, m.inventory_item_id as item_id,
             sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
      from public.inventory_movements m
      where m.workspace_id = p_workspace_id
        and m.order_id = p_order_id
        and m.movement_type in ('issue', 'return')
      group by m.warehouse_id, m.inventory_item_id
    ) x
    where x.qty <> 0
      and (x.warehouse_id is null or x.qty < 0);

    if v_bad_wh is not null then
      raise exception 'order_delete:materials_warehouse_unresolved %', v_bad_wh using errcode = 'P0001';
    end if;

    for r_wh in
      select x.warehouse_id,
             jsonb_agg(
               jsonb_build_object('inventory_item_id', x.item_id, 'quantity', x.qty)
               order by x.item_id
             ) as lines
      from (
        select m.warehouse_id, m.inventory_item_id as item_id,
               sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
        from public.inventory_movements m
        where m.workspace_id = p_workspace_id
          and m.order_id = p_order_id
          and m.movement_type in ('issue', 'return')
        group by m.warehouse_id, m.inventory_item_id
        having sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) > 0
      ) x
      group by x.warehouse_id
      order by x.warehouse_id
    loop
      v_key := 'order_delete:' || p_order_id::text || ':' || r_wh.warehouse_id::text;

      perform 1
      from public.return_order_materials_to_warehouse(
        p_order_id, r_wh.lines, r_wh.warehouse_id, 'order_deleted', v_key
      );

      v_returned := v_returned || jsonb_build_array(jsonb_build_object(
        'warehouse_id', r_wh.warehouse_id,
        'lines', r_wh.lines,
        'idempotency_key', v_key
      ));
    end loop;

    if exists (
      select 1
      from public.order_materials om
      where om.order_id = p_order_id
        and coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0) > 0
    ) then
      raise exception 'order_delete:materials_outstanding_after_return' using errcode = 'P0001';
    end if;
  end if;

  -- ---- Queue attachment storage paths, then drop metadata with the order ----
  if to_regclass('public.order_attachments') is not null then
    select coalesce(array_agg(a.storage_path order by a.created_at), array[]::text[])
      into v_storage_paths
    from public.order_attachments a
    where a.workspace_id = p_workspace_id
      and a.order_id = p_order_id
      and nullif(trim(a.storage_path), '') is not null;

    if cardinality(v_storage_paths) > 0 then
      foreach v_path in array v_storage_paths
      loop
        insert into public.order_attachment_cleanup (workspace_id, storage_path, order_id)
        values (p_workspace_id, v_path, p_order_id)
        on conflict (workspace_id, storage_path) do update
          set order_id = excluded.order_id,
              created_at = now();
      end loop;
    end if;
  end if;

  -- ---- Public status links (no FK) ----
  if to_regclass('public.public_links') is not null then
    delete from public.public_links l
    where l.workspace_id = p_workspace_id
      and l.entity_type = 'order'
      and l.entity_id = p_order_id;
  end if;

  -- ---- Remove only fully-voided payment trees (audit-cleared erroneous money) ----
  select count(*)::integer into v_payment_count
  from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id
    and p.kind = 'payment';

  for r_pay in
    select p.*
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and p.kind = 'payment'
    order by p.created_at
    for update of p
  loop
    select coalesce(sum(x.amount), 0) into v_refunded
    from public.payments x
    where x.related_payment_id = r_pay.id and x.kind = 'refund';
    if coalesce(v_refunded, 0) > 0.005 then
      raise exception 'order_delete:has_refund:count=1' using errcode = '23514';
    end if;

    select coalesce(sum(x.amount), 0) into v_voided
    from public.payments x
    where x.related_payment_id = r_pay.id and x.kind = 'void';
    if abs(coalesce(v_voided, 0) - r_pay.amount) > 0.005 then
      raise exception 'order_delete:has_active_payment:%', r_pay.id using errcode = '23514';
    end if;

    delete from public.payments x
    where x.related_payment_id = r_pay.id and x.kind = 'void';
    delete from public.payments x
    where x.id = r_pay.id and x.kind = 'payment';
    v_voided_deleted := v_voided_deleted + 1;
  end loop;

  -- Peel any remaining leaf payment rows (should be none).
  loop
    delete from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and not exists (
        select 1 from public.payments c where c.related_payment_id = p.id
      );
    get diagnostics v_rowcount = row_count;
    exit when v_rowcount = 0;
  end loop;

  if exists (
    select 1 from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
  ) then
    raise exception 'order_delete:payments_referenced_elsewhere' using errcode = '23503';
  end if;

  -- ---- Warranty dependencies (exclusive cleanup; never touch other orders) ----
  -- Block first so trg_orders_block_delete_with_warranty will also pass after cleanup.
  -- External deps: other orders.warranty_source_order_id OR claims from other orders
  -- that reference THIS order's warranty_records. Those must remain blocked.
  if to_regprocedure('public.order_delete_blocked_by_warranty(uuid,uuid)') is not null then
    v_warranty_block := public.order_delete_blocked_by_warranty(p_workspace_id, p_order_id);
    if v_warranty_block is not null and length(btrim(v_warranty_block)) > 0 then
      raise exception '%', v_warranty_block using errcode = '23514';
    end if;
  else
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.orders'::regclass
        and a.attname = 'warranty_source_order_id' and a.attnum > 0 and not a.attisdropped
    ) and exists (
      select 1 from public.orders o
      where o.workspace_id = p_workspace_id
        and o.warranty_source_order_id = p_order_id
    ) then
      raise exception 'order_delete:has_warranty_orders' using errcode = '23514';
    end if;
    if to_regclass('public.warranty_order_claims') is not null
       and to_regclass('public.warranty_records') is not null
       and exists (
         select 1
         from public.warranty_order_claims c
         join public.warranty_records r on r.id = c.warranty_record_id
         where r.workspace_id = p_workspace_id
           and r.order_id = p_order_id
           and c.warranty_order_id is distinct from p_order_id
       ) then
      raise exception 'order_delete:has_warranty_claims' using errcode = '23514';
    end if;
  end if;

  -- Claims owned by THIS order as the claim-order side (must precede snapshot delete
  -- because warranty_order_claims.warranty_record_id is ON DELETE RESTRICT).
  if to_regclass('public.warranty_order_claims') is not null then
    delete from public.warranty_order_claims c
    where c.workspace_id = p_workspace_id
      and c.warranty_order_id = p_order_id;
  end if;

  -- Exclusive snapshots created when THIS order closed (workspace_id + order_id scoped).
  -- After this, trg_orders_block_delete_with_warranty sees no remaining exclusive rows
  -- and still blocks if an external dependency was missed above.
  if to_regclass('public.warranty_records') is not null then
    delete from public.warranty_records wr
    where wr.workspace_id = p_workspace_id
      and wr.order_id = p_order_id;
    get diagnostics v_warranty_deleted = row_count;
  end if;

  -- Audit survives order deletion (activity_log is not cascaded from orders).
  if to_regclass('public.activity_log') is not null then
    insert into public.activity_log (
      workspace_id, actor_user_id, actor_name, entity_type, entity_id, event, details
    ) values (
      p_workspace_id,
      v_uid,
      null,
      'order',
      p_order_id,
      'order_deleted',
      jsonb_build_object(
        'order_number', coalesce(nullif(trim(v_order.number), ''), p_order_id::text),
        'was_closed', v_order.closed_at is not null,
        'status', v_order.status,
        'closed_at', v_order.closed_at,
        'warranty_records_deleted', v_warranty_deleted,
        'operation', 'delete_order_with_payments'
      )
    );
  end if;

  delete from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id;

  if not found then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payments_deleted', v_voided_deleted,
    'materials_returned', v_returned,
    'warranty_records_deleted', v_warranty_deleted,
    'attachment_storage_paths', to_jsonb(coalesce(v_storage_paths, array[]::text[])),
    'storage_cleanup_pending', coalesce(cardinality(v_storage_paths), 0) > 0
  );
end;
$fn$;

do $postflight$
declare
  v_fn text;
  v_problems text := '';
  v_def text;
  v_check text;
begin
  if to_regprocedure('public.crm_acts_as_owner_for_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_acts_as_owner_for_closed_orders missing; ';
  end if;

  select pg_get_constraintdef(c.oid) into v_check
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.workspace_role_permission_grants'::regclass
    and c.conname = 'workspace_role_permission_grants_permission_check';
  if v_check is null or position('orders.closed_full_access' in v_check) = 0 then
    v_problems := v_problems || 'permission check missing closed_full_access; ';
  end if;

  select pg_get_functiondef('public.crm_has_closed_order_permission(uuid,text)'::regprocedure) into v_def;
  if position('orders.closed_full_access' in v_def) = 0
     or position('crm_acts_as_owner_for_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'crm_has_closed_order_permission v4 not installed; ';
  end if;

  select pg_get_functiondef('public.crm_owner_may_edit_cancelled_order(uuid)'::regprocedure) into v_def;
  if position('crm_acts_as_owner_for_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order not using acts_as_owner; ';
  end if;

  select pg_get_functiondef('public.crm_owner_may_unlink_order_warranty(uuid)'::regprocedure) into v_def;
  if position('crm_acts_as_owner_for_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'crm_owner_may_unlink_order_warranty not using acts_as_owner; ';
  end if;

  select pg_get_functiondef('public.reopen_cancelled_order(uuid,uuid,text,uuid)'::regprocedure) into v_def;
  if position('crm_acts_as_owner_for_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'reopen_cancelled_order not using acts_as_owner; ';
  end if;

  -- Closed non-cancelled content must stay immutable (manage-closed still always false).
  select pg_get_functiondef('public.crm_owner_may_manage_closed_orders(uuid)'::regprocedure) into v_def;
  if position('select false' in v_def) = 0 then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders must remain always-false; ';
  end if;

  foreach v_fn in array array[
    'public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)',
    'public.crm_cancel_order_with_payment_void(uuid,uuid,boolean,text)',
    'public.delete_order_with_payments(uuid,uuid)'
  ] loop
    select pg_get_functiondef(v_fn::regprocedure) into v_def;
    if position('crm_acts_as_owner_for_closed_orders' in v_def) = 0 then
      v_problems := v_problems || v_fn || ' not using acts_as_owner; ';
    end if;
  end loop;

  if v_problems <> '' then
    raise exception 'closed_order_full_access postflight failed: %', v_problems;
  end if;

  notify pgrst, 'reload schema';
end;
$postflight$;

commit;
