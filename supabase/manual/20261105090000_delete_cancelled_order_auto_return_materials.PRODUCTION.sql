-- =============================================================================
-- Core App — Cancelled-order delete auto-returns issued materials @v7 (MAIN)
-- =============================================================================
-- Project: MAIN only (pundggjzzaqzbvykbxvo). Do NOT run against TEST.
-- Apply manually after review. Do not auto-apply.
--
-- Root cause:
--   delete_order_with_payments blocked deletion when outstanding issued materials
--   remained AND orders.closed_at IS NOT NULL, raising:
--     order_delete:issued_materials_on_closed_order
--   That forced a manual UI return before delete could succeed for previously
--   closed (then cancelled) orders. Open cancelled orders already auto-returned
--   via return_order_materials_to_warehouse.
--
-- Fix:
--   For every cancelled order with outstanding stock (issued - returned > 0),
--   call return_order_materials_to_warehouse (ledger-authoritative, idempotent)
--   BEFORE deleting the order. Cancellation itself still never returns stock.
--
-- Inventory mechanism reused (do not invent schema):
--   * order_materials.quantity_issued / quantity_returned
--   * inventory_movements (movement_type issue|return, warehouse_id, order_id,
--     order_material_id, idempotency_key) — order_id ON DELETE SET NULL
--   * public.return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text)
--     which locks OM/items/warehouse_stock, restores batches, increments stock,
--     inserts return movements, bumps quantity_returned only for outstanding qty
--
-- Permissions / safeguards:
--   cancelled-first; closed → owner_id / orders.delete_closed;
--   open → owner_id / orders.delete; invoices/payments/refunds/warranty unchanged.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is null then
    v_problems := v_problems || 'delete_order_with_payments missing; ';
  end if;
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text)') is null then
    v_problems := v_problems || 'return_order_materials_to_warehouse missing; ';
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
  if v_problems <> '' then
    raise exception 'delete_cancelled_auto_return preflight failed: %', v_problems;
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
  'managed-object: core-app/delete_order_with_payments@v7 — cancelled-first;

revoke all on function public.delete_order_with_payments(uuid, uuid) from public, anon;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated, service_role;

do $assert$
declare
  v_problems text := '';
  v_def text;
begin
  select pg_get_functiondef('public.delete_order_with_payments(uuid,uuid)'::regprocedure) into v_def;
  if v_def is null then
    v_problems := v_problems || 'delete_order_with_payments missing after replace; ';
  else
    if v_def ~* 'raise exception ''order_delete:issued_materials_on_closed_order''' then
      v_problems := v_problems || 'still raises issued_materials_on_closed_order; ';
    end if;
    if v_def !~* 'return_order_materials_to_warehouse' then
      v_problems := v_problems || 'missing return_order_materials_to_warehouse call; ';
    end if;
    if v_def !~* 'not_cancelled' then
      v_problems := v_problems || 'missing cancelled-first check; ';
    end if;
    if v_def !~* 'order_deleted' then
      v_problems := v_problems || 'missing activity_log order_deleted; ';
    end if;
    if v_def !~* 'materials_outstanding_after_return' then
      v_problems := v_problems || 'missing post-return outstanding assertion; ';
    end if;
    if position('order_delete:' in v_def) = 0 then
      v_problems := v_problems || 'missing idempotency key prefix; ';
    end if;
  end if;
  if v_problems <> '' then
    raise exception 'delete_cancelled_auto_return post-apply failed: %', v_problems;
  end if;
  raise notice 'delete_cancelled_auto_return @v7 OK';
end;
$assert$;

commit;
