-- =============================================================================
-- Core App — Lifecycle close + warranty-safe delete @v8.1 (MAIN)
-- Script: 20261105120000_lifecycle_close_cancel_delete_warranty.PRODUCTION.sql
-- Target: MAIN only (pundggjzzaqzbvykbxvo). Manual apply. Do not run against TEST.
-- =============================================================================
--
-- Problems addressed
-- ------------------
-- 1) close_order_if_settled kept a stale custom_status_id via
--      custom_status_id = coalesce(close_def, existing)
--    so UI badges could keep showing "In Progress" after a successful close
--    while payment badges correctly showed Paid. Close must persist status=closed
--    and clear/replace custom_status_id with the close semantic (or NULL).
--    Idempotent re-close must also repair status/custom without rewriting closed_at.
--
-- 2) delete_order_with_payments @v7 never deleted exclusive warranty_records,
--    so deleting a closed→cancelled order failed with:
--      warranty_records_order_id_fkey
--    Exclusive snapshots (wr.workspace_id + wr.order_id = this order) are removed
--    only after dependency checks; trg_orders_block_delete_with_warranty still
--    blocks when external warranty_source_order_id / claims remain.
--
-- 3) Retain @v7 auto-return of outstanding materials during delete (including
--    previously closed then cancelled). Cancellation itself never returns stock.
--
-- Does NOT:
--   • cascade-delete warranties belonging to other orders
--   • refund payments or rewrite financial history during cancel/close
--   • weaken workspace isolation / closed-order permission grants
--   • drop, disable, or alter warranty_records_order_id_fkey / delete trigger
--
-- Idempotent. Transactional. Fail-closed preflight.
-- =============================================================================

begin;

do $pre$
declare
  v_problems text := '';
  v_has_warranty_trigger boolean := false;
  v_fk text;
  v_col text;
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  else
    foreach v_col in array array['id', 'workspace_id', 'status', 'custom_status_id', 'closed_at']
    loop
      if not exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = 'public.orders'::regclass
          and a.attname = v_col and a.attnum > 0 and not a.attisdropped
      ) then
        v_problems := v_problems || format('orders.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is null then
    v_problems := v_problems || 'delete_order_with_payments missing; ';
  end if;
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    v_problems := v_problems || 'close_order_if_settled missing; ';
  end if;
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text)') is null then
    v_problems := v_problems || 'return_order_materials_to_warehouse missing; ';
  end if;
  if to_regprocedure('public.order_lifecycle_guard()') is null then
    v_problems := v_problems || 'order_lifecycle_guard missing; ';
  end if;
  if to_regclass('public.order_lifecycle_tokens') is null then
    v_problems := v_problems || 'order_lifecycle_tokens missing; ';
  end if;
  if to_regclass('public.status_definitions') is null then
    v_problems := v_problems || 'status_definitions missing; ';
  end if;

  if to_regclass('public.order_materials') is null then
    v_problems := v_problems || 'order_materials missing; ';
  else
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.order_materials'::regclass
        and a.attname = 'quantity_issued' and a.attnum > 0 and not a.attisdropped
    ) then
      v_problems := v_problems || 'order_materials.quantity_issued missing; ';
    end if;
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.order_materials'::regclass
        and a.attname = 'quantity_returned' and a.attnum > 0 and not a.attisdropped
    ) then
      v_problems := v_problems || 'order_materials.quantity_returned missing; ';
    end if;
  end if;
  if to_regclass('public.inventory_movements') is null then
    v_problems := v_problems || 'inventory_movements missing; ';
  elsif not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.inventory_movements'::regclass
      and a.attname = 'warehouse_id' and a.attnum > 0 and not a.attisdropped
  ) then
    v_problems := v_problems || 'inventory_movements.warehouse_id missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null
     and to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_permission missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'owner_id'
  ) then
    v_problems := v_problems || 'workspaces.owner_id missing; ';
  end if;

  -- Warranty hardening trigger requires helper + tables + RESTRICT FKs.
  select exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and t.tgname = 'trg_orders_block_delete_with_warranty'
      and not t.tgisinternal
  ) into v_has_warranty_trigger;

  if v_has_warranty_trigger then
    if to_regprocedure('public.order_delete_blocked_by_warranty(uuid,uuid)') is null then
      v_problems := v_problems || 'order_delete_blocked_by_warranty missing (required by trg_orders_block_delete_with_warranty); ';
    end if;
    if to_regprocedure('public.orders_block_delete_with_warranty()') is null then
      v_problems := v_problems || 'orders_block_delete_with_warranty() missing; ';
    end if;
  end if;

  if to_regclass('public.warranty_records') is not null then
    foreach v_col in array array['id', 'workspace_id', 'order_id']
    loop
      if not exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = 'public.warranty_records'::regclass
          and a.attname = v_col and a.attnum > 0 and not a.attisdropped
      ) then
        v_problems := v_problems || format('warranty_records.%s missing; ', v_col);
      end if;
    end loop;

    select pg_get_constraintdef(c.oid) into v_fk
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.warranty_records'::regclass
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%order_id%references%orders%'
    order by case when c.conname = 'warranty_records_order_id_fkey' then 0 else 1 end
    limit 1;
    if v_fk is null then
      v_problems := v_problems || 'warranty_records.order_id FK missing; ';
    elsif v_fk ~* 'on delete (cascade|set null|set default)' then
      v_problems := v_problems || 'warranty_records.order_id FK must remain RESTRICT (found: ' || v_fk || '); ';
    end if;
  elsif v_has_warranty_trigger then
    v_problems := v_problems || 'warranty_records missing but delete-warranty trigger is installed; ';
  end if;

  if to_regclass('public.warranty_order_claims') is not null then
    foreach v_col in array array['id', 'workspace_id', 'warranty_order_id', 'warranty_record_id']
    loop
      if not exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = 'public.warranty_order_claims'::regclass
          and a.attname = v_col and a.attnum > 0 and not a.attisdropped
      ) then
        v_problems := v_problems || format('warranty_order_claims.%s missing; ', v_col);
      end if;
    end loop;
  elsif v_has_warranty_trigger then
    v_problems := v_problems || 'warranty_order_claims missing but delete-warranty trigger is installed; ';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'warranty_source_order_id' and a.attnum > 0 and not a.attisdropped
  ) then
    select pg_get_constraintdef(c.oid) into v_fk
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.orders'::regclass
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%warranty_source_order_id%references%orders%'
    order by case when c.conname = 'orders_warranty_source_order_id_fkey' then 0 else 1 end
    limit 1;
    if v_fk is not null and v_fk ~* 'on delete (cascade|set null|set default)' then
      v_problems := v_problems || 'orders.warranty_source_order_id FK must remain RESTRICT; ';
    end if;
  end if;

  if v_problems <> '' then
    raise exception 'lifecycle_close_cancel_delete_warranty preflight failed: %', v_problems;
  end if;
end;
$pre$;
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

revoke all on function public.delete_order_with_payments(uuid, uuid) from public, anon;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated, service_role;

comment on function public.delete_order_with_payments(uuid, uuid) is
  'managed-object: core-app/delete_order_with_payments@v8.1 — cancelled-first; auto-return outstanding materials; remove exclusive warranty_records after dependency checks; owner_id / delete_closed for closed; preserves warranty RESTRICT FKs and delete trigger.';

-- ---------------------------------------------------------------------------
-- close_order_if_settled @v4 — persist status=closed; clear stale custom_status_id
-- (Based on warranty-hardening @v3; does not change payment/is_paid.)
-- ---------------------------------------------------------------------------
create or replace function public.close_order_if_settled(
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
  v_remaining numeric;
  v_total numeric;
  v_close_status_id uuid;
  v_currency text;
  v_has_ledger boolean;
  v_touch text;
  v_closed_at timestamptz;
  v_warranty_count integer := 0;
  v_mileage numeric;
  v_mileage_sql text := '';
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not (
    coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
    or coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false)
  ) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
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

  perform 1
  from public.payments p
  where p.workspace_id = p_workspace_id
    and (
      p.order_id = p_order_id
      or p.invoice_id in (
        select i.id from public.invoices i
        where i.workspace_id = p_workspace_id and i.order_id = p_order_id
      )
    )
  order by p.id
  for update of p;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.workspaces'::regclass
      and a.attname = 'currency' and a.attnum > 0 and not a.attisdropped
  ) then
    execute 'select nullif(upper(btrim(w.currency::text)), '''') from public.workspaces w where w.id = $1'
      into v_currency using p_workspace_id;
  end if;

  if v_order.closed_at is not null then
    -- Closed-then-cancelled orders must not be forced back to status=closed.
    if v_order.status = 'cancelled' then
      raise exception 'order_lifecycle:cannot_close_cancelled' using errcode = 'P0001';
    end if;

    -- Repair lifecycle display fields without rewriting closed_at / payments.
    select d.id into v_close_status_id
    from public.status_definitions d
    where d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.deleted_at is null
      and d.is_active
      and d.semantic_action = 'close'
    order by d.sort_order, d.name, d.id
    limit 1;

    if v_order.status is distinct from 'closed'
       or v_order.custom_status_id is distinct from v_close_status_id then
      insert into public.order_lifecycle_tokens (order_id, op, created_by)
      values (p_order_id, 'close', v_uid)
      on conflict (order_id, op) do update
        set created_by = excluded.created_by, created_at = now();

      update public.orders o
         set status = 'closed',
             custom_status_id = v_close_status_id
       where o.id = p_order_id
         and o.workspace_id = p_workspace_id
         and o.closed_at is not distinct from v_order.closed_at
         and (
           o.status is distinct from 'closed'
           or o.custom_status_id is distinct from v_close_status_id
         );

      delete from public.order_lifecycle_tokens
      where order_id = p_order_id and op = 'close';

      select o.custom_status_id into v_close_status_id
      from public.orders o
      where o.id = p_order_id and o.workspace_id = p_workspace_id;
    else
      v_close_status_id := v_order.custom_status_id;
    end if;

    -- Fill only missing warranty snapshots (idempotent; never duplicates).
    if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is not null then
      v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_order.closed_at);
    end if;
    v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'status', 'closed',
      'closed_at', v_order.closed_at,
      'custom_status_id', v_close_status_id,
      'remaining', round(v_remaining, 2),
      'currency', coalesce(v_currency, ''),
      'warranties_activated', v_warranty_count
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_lifecycle:cannot_close_cancelled' using errcode = 'P0001';
  end if;

  v_total := coalesce(v_order.total_price, 0);

  select exists (
    select 1 from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id from public.invoices i
          where i.workspace_id = p_workspace_id and i.order_id = p_order_id
        )
      )
      and p.kind in ('payment', 'refund', 'void')
  ) into v_has_ledger;

  if v_total > 0.005 and not v_has_ledger then
    raise exception 'order_lifecycle:ledger_required remaining=% currency=%',
      round(v_total, 2), coalesce(v_currency, '')
      using errcode = 'P0001';
  end if;

  v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);
  if v_remaining > 0.005 then
    raise exception 'order_lifecycle:not_settled remaining=% currency=%',
      round(v_remaining, 2), coalesce(v_currency, '')
      using errcode = 'P0001';
  end if;

  select d.id into v_close_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'close'
  order by d.sort_order, d.name, d.id
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'close', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by, created_at = now();

  v_mileage := null;
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'vehicle_mileage_snapshot' and a.attnum > 0 and not a.attisdropped
  ) then
    if v_order.vehicle_id is not null and to_regclass('public.vehicles') is not null then
      select v.current_mileage into v_mileage
      from public.vehicles v
      where v.id = v_order.vehicle_id and v.workspace_id = p_workspace_id;
    end if;
    v_mileage_sql := ', vehicle_mileage_snapshot = coalesce(o.vehicle_mileage_snapshot, $4)';
  end if;

  -- Persist lifecycle status=closed. Set custom_status_id to the close semantic
  -- definition when present; otherwise NULL (never keep a stale regular custom).
  -- Does not touch is_paid / payment history.
  if v_mileage_sql <> '' then
    execute format(
      'update public.orders o
          set status = ''closed'',
              closed_at = coalesce(o.closed_at, now()),
              custom_status_id = $1%s%s
        where o.id = $2 and o.workspace_id = $3
        returning o.closed_at',
      v_mileage_sql, v_touch
    )
      into v_closed_at
      using v_close_status_id, p_order_id, p_workspace_id, v_mileage;
  else
    execute format(
      'update public.orders o
          set status = ''closed'',
              closed_at = coalesce(o.closed_at, now()),
              custom_status_id = $1%s
        where o.id = $2 and o.workspace_id = $3
        returning o.closed_at',
      v_touch
    )
      into v_closed_at
      using v_close_status_id, p_order_id, p_workspace_id;
  end if;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'close';

  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is not null then
    v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_closed_at);
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'status', 'closed',
    'closed_at', v_closed_at,
    'custom_status_id', v_close_status_id,
    'remaining', round(v_remaining, 2),
    'currency', coalesce(v_currency, ''),
    'warranties_activated', v_warranty_count
  );
end;
$fn$;

revoke all on function public.close_order_if_settled(uuid, uuid) from public, anon;
grant execute on function public.close_order_if_settled(uuid, uuid) to authenticated, service_role;

comment on function public.close_order_if_settled(uuid, uuid) is
  'managed-object: core-app/close_order_if_settled@v4.1 — formal close when settled; status=closed; clears stale custom_status_id; idempotent repair preserves closed_at; activates missing warranties only; no payment/inventory changes; owner_id or orders.edit.';

do $assert$
declare
  v_problems text := '';
  v_def text;
  v_fk text;
begin
  select pg_get_functiondef('public.delete_order_with_payments(uuid,uuid)'::regprocedure) into v_def;
  if v_def is null then
    v_problems := v_problems || 'delete_order_with_payments missing after replace; ';
  else
    if v_def ~* 'raise exception ''order_delete:issued_materials_on_closed_order''' then
      v_problems := v_problems || 'still raises issued_materials_on_closed_order; ';
    end if;
    if position('return_order_materials_to_warehouse' in v_def) = 0 then
      v_problems := v_problems || 'missing return_order_materials_to_warehouse call; ';
    end if;
    if position('order_delete:not_cancelled' in v_def) = 0 then
      v_problems := v_problems || 'missing cancelled-first check; ';
    end if;
    if position('delete from public.warranty_records' in v_def) = 0 then
      v_problems := v_problems || 'missing exclusive warranty_records delete; ';
    end if;
    if position('wr.workspace_id = p_workspace_id' in v_def) = 0
       or position('wr.order_id = p_order_id' in v_def) = 0 then
      v_problems := v_problems || 'warranty_records delete not scoped to workspace_id+order_id; ';
    end if;
    if position('delete from public.warranty_order_claims' in v_def) = 0 then
      v_problems := v_problems || 'missing warranty_order_claims cleanup before snapshots; ';
    end if;
    if position('c.warranty_order_id = p_order_id' in v_def) = 0 then
      v_problems := v_problems || 'claims cleanup not scoped to deleted order; ';
    end if;
    if position('order_delete_blocked_by_warranty' in v_def) = 0
       and position('order_delete:has_warranty_orders' in v_def) = 0 then
      v_problems := v_problems || 'missing warranty dependency guard; ';
    end if;
    if position('materials_outstanding_after_return' in v_def) = 0 then
      v_problems := v_problems || 'missing post-return outstanding assertion; ';
    end if;
    if position('crm_has_closed_order_permission' in v_def) = 0
       and position('orders.delete_closed' in v_def) = 0 then
      v_problems := v_problems || 'missing closed-order delete permission path; ';
    end if;
  end if;

  select pg_get_functiondef('public.close_order_if_settled(uuid,uuid)'::regprocedure) into v_def;
  if v_def is null then
    v_problems := v_problems || 'close_order_if_settled missing; ';
  else
    if position('custom_status_id = coalesce($1, o.custom_status_id)' in v_def) > 0 then
      v_problems := v_problems || 'close still coalesces stale custom_status_id; ';
    end if;
    if position('status = ''closed''' in v_def) = 0 then
      v_problems := v_problems || 'close missing status=closed assignment; ';
    end if;
    if position('crm_is_workspace_owner_id' in v_def) = 0 then
      v_problems := v_problems || 'close missing owner_id bypass; ';
    end if;
    -- Idempotent repair must preserve closed_at (compare, never assign a new now()).
    if position('o.closed_at is not distinct from v_order.closed_at' in v_def) = 0 then
      v_problems := v_problems || 'idempotent close missing closed_at preservation guard; ';
    end if;
    if position('''status'', ''closed''' in v_def) = 0 then
      v_problems := v_problems || 'close response missing status=closed payload; ';
    end if;
  end if;

  -- Constraints must remain RESTRICT when present.
  if to_regclass('public.warranty_records') is not null then
    select pg_get_constraintdef(c.oid) into v_fk
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.warranty_records'::regclass
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%order_id%references%orders%'
    order by case when c.conname = 'warranty_records_order_id_fkey' then 0 else 1 end
    limit 1;
    if v_fk is not null and v_fk ~* 'on delete (cascade|set null|set default)' then
      v_problems := v_problems || 'warranty_records.order_id FK was weakened; ';
    end if;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'orders'
      and t.tgname = 'trg_orders_block_delete_with_warranty' and not t.tgisinternal
  ) and to_regprocedure('public.order_delete_blocked_by_warranty(uuid,uuid)') is null then
    v_problems := v_problems || 'delete-warranty trigger present without helper RPC; ';
  end if;

  if v_problems <> '' then
    raise exception 'lifecycle_close_cancel_delete_warranty post-apply failed: %', v_problems;
  end if;
  raise notice 'lifecycle_close_cancel_delete_warranty @v8.1 OK';
end;
$assert$;

commit;

-- Post-apply verification (read-only):
-- select pg_get_functiondef('public.close_order_if_settled(uuid,uuid)'::regprocedure)
--   like '%o.closed_at is not distinct from v_order.closed_at%' as idempotent_preserves_closed_at;
-- select pg_get_functiondef('public.close_order_if_settled(uuid,uuid)'::regprocedure)
--   like '%custom_status_id = coalesce($1, o.custom_status_id)%' as stale_coalesce_gone; -- expect false
-- select pg_get_functiondef('public.delete_order_with_payments(uuid,uuid)'::regprocedure)
--   like '%delete from public.warranty_records wr%' as deletes_exclusive_warranties;
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.warranty_records'::regclass and contype = 'f'
--    and pg_get_constraintdef(oid) ilike '%order_id%'; -- still RESTRICT / NO ACTION
-- select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--  where c.relname = 'orders' and tgname = 'trg_orders_block_delete_with_warranty';
