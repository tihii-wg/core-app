-- =============================================================================
-- Goods receipts remember the supplier (supplier_name) + backfill
-- Script: 20261106130000_goods_receipt_supplier_name.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Problem:
--   Inventory items store the supplier as free text (inventory_items.supplier), but
--   goods receipts never record who delivered them, so "all deliveries of a supplier"
--   cannot be listed reliably.
--
-- Fix:
--   1) goods_receipts.supplier_name text (nullable) + index on (workspace_id, lower(supplier_name)).
--   2) One-time backfill for existing receipts where supplier_name is NULL and ALL lines
--      with a catalog item point to items having the SAME non-empty supplier.
--      Receipts with mixed / unknown suppliers stay NULL (the app falls back to matching
--      by item supplier for those).
--   supplier_name is not in crm_guard_receipt_header_immutable's protected field list,
--   so posted receipts may be backfilled; totals, status, dates, stock are untouched.
--
-- Does NOT: change stock, posting RPCs, finance, RLS or existing columns.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.goods_receipts') is null or to_regclass('public.goods_receipt_lines') is null then
    raise exception 'goods_receipt_supplier_name preflight: goods_receipts / goods_receipt_lines missing';
  end if;
  if to_regclass('public.inventory_items') is null then
    raise exception 'goods_receipt_supplier_name preflight: inventory_items missing';
  end if;
end;
$preflight$;

alter table public.goods_receipts
  add column if not exists supplier_name text;

comment on column public.goods_receipts.supplier_name is
  'Supplier as free text (matches inventory_items.supplier). Set by the app on receipt creation; backfilled once for single-supplier receipts.';

create index if not exists goods_receipts_workspace_supplier_name_idx
  on public.goods_receipts (workspace_id, lower(supplier_name))
  where supplier_name is not null;

do $backfill$
declare
  v_updated integer := 0;
begin
  with per_receipt as (
    select l.goods_receipt_id,
           count(distinct nullif(trim(i.supplier), '')) as supplier_count,
           min(nullif(trim(i.supplier), '')) as supplier_name,
           count(*) filter (where i.id is not null and nullif(trim(i.supplier), '') is null) as unknown_lines
    from public.goods_receipt_lines l
    left join public.inventory_items i on i.id = l.inventory_item_id
    where l.inventory_item_id is not null
    group by l.goods_receipt_id
  )
  update public.goods_receipts gr
     set supplier_name = pr.supplier_name
    from per_receipt pr
   where gr.id = pr.goods_receipt_id
     and gr.supplier_name is null
     and pr.supplier_count = 1
     and pr.unknown_lines = 0;
  get diagnostics v_updated = row_count;
  raise notice 'goods_receipt_supplier_name: backfilled % receipt(s)', v_updated;
end;
$backfill$;

do $postflight$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.goods_receipts'::regclass
      and attname = 'supplier_name' and attnum > 0 and not attisdropped
  ) then
    raise exception 'goods_receipt_supplier_name postflight: column missing';
  end if;
end;
$postflight$;

commit;

-- Verify:
-- select supplier_name, count(*) from public.goods_receipts group by 1 order by 2 desc;
