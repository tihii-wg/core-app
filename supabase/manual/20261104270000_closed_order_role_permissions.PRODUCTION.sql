-- =============================================================================
-- Core App — Closed-order cancel/delete permissions @v2 (MAIN only — manual)
-- =============================================================================
-- Root causes this script fixes (confirmed on MAIN before apply):
--   1) cancel_order hard-raises order_lifecycle:cannot_cancel_closed for EVERY
--      closed order — including the workspace owner — and never checks a grant.
--   2) delete_order_with_payments only checks crm_has_permission(...,'orders.delete')
--      then requires cancelled. crm_has_permission does NOT read workspaces.owner_id;
--      it grants owner via workspace_members.role = 'owner'. Combined with (1),
--      owners cannot cancel closed orders and therefore cannot reach deletion.
--
-- Adds owner-configurable grants for:
--   • orders.cancel_closed
--   • orders.delete_closed
-- Stored as workspace_role_permission_grants (admin/manager/member).
-- Authoritative owner bypass: workspaces.owner_id = auth.uid() (not revocable).
-- Defaults: no grants → only the workspace owner can cancel/delete closed orders.
-- Deletion still requires the order to be cancelled first (open or closed).
-- Also patches cancel_order, order_lifecycle_guard, delete_order_with_payments.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.workspaces') is null then
    v_problems := v_problems || 'workspaces missing; ';
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'owner_id'
  ) then
    v_problems := v_problems || 'workspaces.owner_id missing; ';
  end if;
  if to_regclass('public.workspace_members') is null then
    v_problems := v_problems || 'workspace_members missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null
     and to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_permission missing; ';
  end if;
  if to_regprocedure('public.cancel_order(uuid,uuid)') is null then
    v_problems := v_problems || 'cancel_order missing; ';
  end if;
  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is null then
    v_problems := v_problems || 'delete_order_with_payments missing; ';
  end if;
  if to_regprocedure('public.order_lifecycle_guard()') is null then
    v_problems := v_problems || 'order_lifecycle_guard missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'closed_order_permissions preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Grants table (workspace role → closed-order permission)
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_role_permission_grants (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  permission text not null,
  workspace_role text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (workspace_id, permission, workspace_role),
  constraint workspace_role_permission_grants_permission_check
    check (permission in ('orders.cancel_closed', 'orders.delete_closed')),
  constraint workspace_role_permission_grants_role_check
    check (workspace_role in ('admin', 'manager', 'member'))
);

create index if not exists workspace_role_permission_grants_ws_idx
  on public.workspace_role_permission_grants (workspace_id, permission);

alter table public.workspace_role_permission_grants enable row level security;

drop policy if exists workspace_role_permission_grants_select_member on public.workspace_role_permission_grants;
create policy workspace_role_permission_grants_select_member
  on public.workspace_role_permission_grants for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_role_permission_grants_write_owner on public.workspace_role_permission_grants;
create policy workspace_role_permission_grants_write_owner
  on public.workspace_role_permission_grants for all to authenticated
  using (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_role_permission_grants.workspace_id
        and w.owner_id = auth.uid()
        and w.deleted_at is null
    )
  )
  with check (
    exists (
      select 1 from public.workspaces w
      where w.id = workspace_role_permission_grants.workspace_id
        and w.owner_id = auth.uid()
        and w.deleted_at is null
    )
  );

revoke all on table public.workspace_role_permission_grants from public, anon;
grant select, insert, update, delete on table public.workspace_role_permission_grants to authenticated;
grant all on table public.workspace_role_permission_grants to service_role;

comment on table public.workspace_role_permission_grants is
  'managed-object: core-app/workspace_role_permission_grants@v2 — owner_id-configured admin/manager/member grants for closed-order cancel/delete.';

-- ---------------------------------------------------------------------------
-- 2) Authoritative workspace-owner check (workspaces.owner_id)
-- ---------------------------------------------------------------------------
-- crm_has_permission / crm_permitted_workspaces grant "owner" via
-- workspace_members.role = 'owner' only. They never read workspaces.owner_id.
-- This helper is the closed-order authority the product requires.
create or replace function public.crm_is_workspace_owner_id(
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
      and w.owner_id = auth.uid()
      and w.deleted_at is null
  );
$fn$;

revoke all on function public.crm_is_workspace_owner_id(uuid) from public, anon;
grant execute on function public.crm_is_workspace_owner_id(uuid) to authenticated, service_role;

comment on function public.crm_is_workspace_owner_id(uuid) is
  'managed-object: core-app/crm_is_workspace_owner_id@v1 — true when workspaces.owner_id = auth.uid() and workspace is not soft-deleted.';

-- ---------------------------------------------------------------------------
-- 3) Closed-order permission helper (owner_id always; else role grant).
--    Does NOT use admin-default-all crm_has_permission.
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
    coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
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
  'managed-object: core-app/crm_has_closed_order_permission@v2 — workspaces.owner_id always; admin/manager/member only via workspace_role_permission_grants.';

-- ---------------------------------------------------------------------------
-- 4) Lifecycle guard @v2 — allow cancel token to cancel a closed order (keep closed_at)
-- ---------------------------------------------------------------------------
create or replace function public.order_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_close_tok boolean;
  v_cancel_tok boolean;
  v_replace_tok boolean;
  v_new_action text;
  v_target record;
begin
  -- Rule 1: closed_at can never be cleared.
  if old.closed_at is not null and new.closed_at is null then
    raise exception 'order_lifecycle:cannot_clear_closed_at' using errcode = '42501';
  end if;

  select
    coalesce(bool_or(t.op = 'close'), false),
    coalesce(bool_or(t.op = 'cancel'), false),
    coalesce(bool_or(t.op = 'replace'), false)
    into v_close_tok, v_cancel_tok, v_replace_tok
  from public.order_lifecycle_tokens t
  where t.order_id = new.id;

  -- Rule 2: formally closed orders are immutable except idempotent close
  -- or a status replacement that changes custom_status_id ONLY.
  if old.closed_at is not null
     and (new.status is distinct from old.status
          or new.custom_status_id is distinct from old.custom_status_id
          or new.closed_at is distinct from old.closed_at) then
    if v_close_tok then
      null;
    elsif v_replace_tok
          and new.status is not distinct from old.status
          and new.closed_at is not distinct from old.closed_at
          and new.custom_status_id is distinct from old.custom_status_id then
      select d.id, d.semantic_action into v_target
      from public.status_definitions d
      where d.id = new.custom_status_id
        and d.workspace_id = new.workspace_id
        and d.entity = 'order'
        and d.is_active
        and d.deleted_at is null;

      if not found or v_target.semantic_action in ('close', 'cancel') then
        raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
      end if;
      return new;
    elsif v_cancel_tok
          and new.closed_at is not distinct from old.closed_at
          and new.status = 'cancelled'
          and old.status is distinct from 'cancelled' then
      -- Formal cancel of a closed order (orders.cancel_closed). Keep closed_at.
      null;
    else
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  -- Rule 3: closed_at changes only via close.
  if new.closed_at is distinct from old.closed_at and not v_close_tok then
    raise exception 'order_lifecycle:closed_at_via_rpc_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Rule 4
    if new.status = 'closed' and not v_close_tok then
      raise exception 'order_lifecycle:closed_status_via_rpc_only' using errcode = '42501';
    end if;
    -- Rule 5: always, even when no cancel semantic is configured.
    if new.status = 'cancelled' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_status_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  -- Rule 6: moving to a close/cancel-designated custom status needs the matching token.
  if new.custom_status_id is distinct from old.custom_status_id
     and new.custom_status_id is not null then
    select d.semantic_action into v_new_action
    from public.status_definitions d
    where d.id = new.custom_status_id
      and d.workspace_id = new.workspace_id
      and d.entity = 'order'
      and d.deleted_at is null;

    if v_new_action = 'close' and not v_close_tok then
      raise exception 'order_lifecycle:close_semantic_via_rpc_only' using errcode = '42501';
    elsif v_new_action = 'cancel' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_semantic_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;



-- ---------------------------------------------------------------------------
-- 5) cancel_order @v4 — closed cancel via owner_id / orders.cancel_closed
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(
  p_order_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_cancel_status_id uuid;
  v_touch text;
  v_was_closed boolean := false;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  -- Lock and load the order from the database (never trust client state).
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  -- Verify workspace against the order row, not a client-only claim.
  if v_order.workspace_id is distinct from p_workspace_id then
    raise exception 'order_lifecycle:workspace_mismatch' using errcode = '42501';
  end if;

  v_was_closed := v_order.closed_at is not null;

  if v_was_closed then
    -- Owner (workspaces.owner_id) always; others need orders.cancel_closed grant.
    if not coalesce(public.crm_has_closed_order_permission(p_workspace_id, 'orders.cancel_closed'), false) then
      raise exception 'order_lifecycle:forbidden_cancel_closed' using errcode = '42501';
    end if;
  else
    -- Open orders: preserve existing orders.edit gate (owner via members.role still works).
    -- Also accept authoritative owner_id so owner_id/membership drift cannot block cancel.
    if not (
      coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
      or coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false)
    ) then
      raise exception 'order_lifecycle:forbidden' using errcode = '42501';
    end if;
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', p_order_id,
      'custom_status_id', v_order.custom_status_id,
      'closed_at', v_order.closed_at,
      'was_closed', v_was_closed
    );
  end if;

  select d.id into v_cancel_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'cancel'
  order by d.sort_order, d.name, d.id
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'cancel', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by, created_at = now();

  -- closed_at is intentionally preserved (Rule 1 forbids clearing it).
  execute format(
    'update public.orders o
        set status = ''cancelled'',
            custom_status_id = $1%s
      where o.id = $2 and o.workspace_id = $3',
    v_touch
  )
    using v_cancel_status_id, p_order_id, p_workspace_id;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'cancel';

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'custom_status_id', v_cancel_status_id,
    'closed_at', v_order.closed_at,
    'was_closed', v_was_closed
  );
end;
$fn$;

revoke all on function public.cancel_order(uuid, uuid) from public, anon;
grant execute on function public.cancel_order(uuid, uuid) to authenticated, service_role;

comment on function public.cancel_order(uuid, uuid) is
  'managed-object: core-app/cancel_order@v4 — open: owner_id or orders.edit; closed: owner_id or orders.cancel_closed; preserves closed_at and history; no finance/warranty/inventory deletes.';

-- ---------------------------------------------------------------------------
-- 6) delete_order_with_payments @v7 — auto-return outstanding materials on delete
-- ---------------------------------------------------------------------------

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
      coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
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
    'attachment_storage_paths', to_jsonb(coalesce(v_storage_paths, array[]::text[])),
    'storage_cleanup_pending', coalesce(cardinality(v_storage_paths), 0) > 0
  );
end;
$fn$;


revoke all on function public.delete_order_with_payments(uuid, uuid) from public, anon;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated, service_role;

comment on function public.delete_order_with_payments(uuid, uuid) is
  'managed-object: core-app/delete_order_with_payments@v7 — cancelled-first; auto-returns outstanding issued materials via return_order_materials_to_warehouse (open or previously-closed); non-closed: owner_id or orders.delete; closed: owner_id or orders.delete_closed; financial/warranty safeguards unchanged; activity_log audit before delete.';

-- Re-create lifecycle guard trigger (function replaced above).
drop trigger if exists orders_lifecycle_guard_bu on public.orders;
create trigger orders_lifecycle_guard_bu
  before update of status, custom_status_id, closed_at on public.orders
  for each row
  execute function public.order_lifecycle_guard();

revoke all on function public.order_lifecycle_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Post-apply
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_problems text := '';
  v_def text;
begin
  if to_regclass('public.workspace_role_permission_grants') is null then
    v_problems := v_problems || 'grants table missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id missing; ';
  end if;
  if to_regprocedure('public.crm_has_closed_order_permission(uuid,text)') is null
     and to_regprocedure('public.crm_has_closed_order_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_closed_order_permission missing; ';
  end if;

  select pg_get_functiondef('public.crm_has_closed_order_permission(uuid,text)'::regprocedure) into v_def;
  if v_def is null then
    select pg_get_functiondef('public.crm_has_closed_order_permission(uuid, text)'::regprocedure) into v_def;
  end if;
  if v_def is null or v_def !~* 'crm_is_workspace_owner_id' or v_def !~* 'owner_id' then
    v_problems := v_problems || 'closed-order helper missing owner_id bypass; ';
  end if;

  select pg_get_functiondef('public.cancel_order(uuid,uuid)'::regprocedure) into v_def;
  if v_def is null or v_def !~* 'orders\.cancel_closed' then
    v_problems := v_problems || 'cancel_order missing cancel_closed check; ';
  end if;
  if v_def ~* 'cannot_cancel_closed' then
    v_problems := v_problems || 'cancel_order still hard-blocks closed; ';
  end if;
  if v_def is null or v_def !~* 'crm_is_workspace_owner_id|crm_has_closed_order_permission' then
    v_problems := v_problems || 'cancel_order missing owner/closed permission path; ';
  end if;

  select pg_get_functiondef('public.delete_order_with_payments(uuid,uuid)'::regprocedure) into v_def;
  if v_def is null or v_def !~* 'orders\.delete_closed' then
    v_problems := v_problems || 'delete_order missing delete_closed check; ';
  end if;
  if v_def is null or v_def !~* 'not_cancelled' then
    v_problems := v_problems || 'delete_order missing cancelled-first requirement; ';
  end if;
  if v_def !~* 'order_deleted' then
    v_problems := v_problems || 'delete_order missing activity_log audit; ';
  end if;
  if v_def is null or v_def !~* 'crm_is_workspace_owner_id|crm_has_closed_order_permission' then
    v_problems := v_problems || 'delete_order missing owner/closed permission path; ';
  end if;
  if v_def ~* 'raise exception ''order_delete:issued_materials_on_closed_order''' then
    v_problems := v_problems || 'delete_order still blocks closed orders with issued materials; ';
  end if;
  if v_def is null or v_def !~* 'return_order_materials_to_warehouse' then
    v_problems := v_problems || 'delete_order missing auto inventory return; ';
  end if;

  select pg_get_functiondef('public.order_lifecycle_guard()'::regprocedure) into v_def;
  if v_def is null or v_def !~* 'v_cancel_tok' then
    v_problems := v_problems || 'lifecycle guard missing cancel_tok closed path; ';
  end if;

  if v_problems <> '' then
    raise exception 'closed_order_permissions post-apply failed: %', v_problems;
  end if;
  raise notice 'closed_order_permissions @v2 OK';
end;
$assert$;

commit;
