-- =============================================================================
-- SAFE CANCELLED ORDER DELETION (MAIN) — delete_order_with_payments @v3
-- =============================================================================
-- Project: MAIN only (pundggjzzaqzbvykbxvo). Do NOT run against TEST.
-- Apply manually in Supabase SQL editor after review. Do not auto-apply.
--
-- Replaces public.delete_order_with_payments(uuid,uuid) with a stricter body:
--   1) Requires authentication + crm_has_permission(..., 'orders.delete')
--   2) Requires cancelled: orders.status = 'cancelled' OR linked
--      status_definitions.semantic_action = 'cancel' (never by display name)
--   3) Blocks when any invoice (or invoice_orders junction) still links the order
--   4) Blocks active payments and any refunds; only fully-voided payment trees
--      may be removed (same rules as delete_fully_voided_payment)
--   5) Blocks finance_transactions / credit_notes that still reference the order
--      when those tables exist
--   6) Returns outstanding issued stock via return_order_materials_to_warehouse
--      (ledger-authoritative, idempotent keys) before deleting the order
--   7) Queues attachment storage_path values for post-commit Storage cleanup
--   8) Deletes public_links for the order when that table exists
--   9) Deletes the order (CASCADE children); SET NULL on ledger/history links
--
-- Idempotent: CREATE OR REPLACE function; CREATE TABLE IF NOT EXISTS cleanup queue.
-- Fail-closed: missing prerequisites abort before any mutation.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  if to_regclass('public.payments') is null then
    v_problems := v_problems || 'payments missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'safe_cancelled_order_delete preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Attachment Storage cleanup queue (outside PG transaction for blobs)
-- ---------------------------------------------------------------------------
create table if not exists public.order_attachment_cleanup (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_path text not null,
  order_id uuid,
  created_at timestamptz not null default now(),
  constraint order_attachment_cleanup_path_uidx unique (workspace_id, storage_path)
);

comment on table public.order_attachment_cleanup is
  'managed-object: core-app/order_attachment_cleanup@v1 — pending Supabase Storage removals after cancelled-order delete; rows are workspace-scoped and idempotent by storage_path.';

alter table public.order_attachment_cleanup enable row level security;

drop policy if exists order_attachment_cleanup_select_member on public.order_attachment_cleanup;
create policy order_attachment_cleanup_select_member
  on public.order_attachment_cleanup
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists order_attachment_cleanup_delete_member on public.order_attachment_cleanup;
create policy order_attachment_cleanup_delete_member
  on public.order_attachment_cleanup
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- No INSERT/UPDATE for authenticated — only SECURITY DEFINER delete RPC writes rows.
revoke all on table public.order_attachment_cleanup from public, anon;
grant select, delete on table public.order_attachment_cleanup to authenticated;
grant all on table public.order_attachment_cleanup to service_role;

-- ---------------------------------------------------------------------------
-- 2) delete_order_with_payments @v3
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

  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.delete'), false) then
    raise exception 'order_delete:forbidden' using errcode = '42501';
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

  if not v_is_cancelled then
    raise exception 'order_delete:not_cancelled' using errcode = 'P0001';
  end if;

  -- ---- Financial: invoices ----
  if to_regclass('public.invoices') is not null then
    select string_agg(coalesce(nullif(trim(i.invoice_number), ''), i.id::text), ', ' order by i.created_at)
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

  if v_outstanding then
    if v_order.closed_at is not null then
      raise exception 'order_delete:issued_materials_on_closed_order' using errcode = 'P0001';
    end if;

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

comment on function public.delete_order_with_payments(uuid, uuid) is
  'managed-object: core-app/delete_order_with_payments@v3 — cancelled-only; blocks invoices/refunds/active payments/finance links; returns stock atomically; queues attachment Storage cleanup; removes fully-voided payment trees only.';

revoke all on function public.delete_order_with_payments(uuid, uuid) from public, anon;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) POST-APPLY ASSERTIONS
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_comment text;
  v_problems text := '';
begin
  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is null then
    v_problems := v_problems || 'delete_order_with_payments missing; ';
  end if;

  select pg_catalog.obj_description(
    to_regprocedure('public.delete_order_with_payments(uuid,uuid)')::oid,
    'pg_proc'
  )
  into v_comment;

  if v_comment is null
     or position('delete_order_with_payments@v3' in v_comment) = 0 then
    v_problems := v_problems || 'delete_order_with_payments comment not @v3; ';
  end if;

  if to_regclass('public.order_attachment_cleanup') is null then
    v_problems := v_problems || 'order_attachment_cleanup missing; ';
  end if;

  if has_function_privilege('anon', 'public.delete_order_with_payments(uuid,uuid)', 'execute') then
    v_problems := v_problems || 'anon must not execute delete_order_with_payments; ';
  end if;

  if not has_function_privilege('authenticated', 'public.delete_order_with_payments(uuid,uuid)', 'execute') then
    v_problems := v_problems || 'authenticated must execute delete_order_with_payments; ';
  end if;

  if v_problems <> '' then
    raise exception 'safe_cancelled_order_delete post-apply failed: %', v_problems;
  end if;
end;
$assert$;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only; run after apply)
-- ---------------------------------------------------------------------------
-- select pg_catalog.obj_description(p.oid, 'pg_proc') as comment
-- from pg_catalog.pg_proc p
-- join pg_catalog.pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'delete_order_with_payments';
--
-- select to_regclass('public.order_attachment_cleanup') is not null as cleanup_table_ok;
--
-- select has_table_privilege('authenticated', 'public.order_attachment_cleanup', 'SELECT') as can_select,
--        has_table_privilege('authenticated', 'public.order_attachment_cleanup', 'DELETE') as can_delete,
--        not has_table_privilege('authenticated', 'public.order_attachment_cleanup', 'INSERT') as no_insert;
