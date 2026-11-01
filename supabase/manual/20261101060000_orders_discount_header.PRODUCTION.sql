-- =====================================================================
-- Core App: orders.discount_type / orders.discount_value  (header discount metadata)
--
-- WHY: client / order discounts are now persisted into order totals by the app
-- (src/features/orders/orderTotals.ts + src/services/apiOrders.ts):
--   * line level  : order_services / order_materials .discount_type ('percent'|'amount') + .discount_value
--   * order level : orders.discount_total  = sum of the line discounts (money, 2 decimals)
--                   orders.total_price     = subtotal - discount_total (the final / net amount)
--   * header meta : orders.discount_type / orders.discount_value — written ONLY when every discounted
--                   line carries the same single percent; otherwise left NULL (discount_total is the truth).
--
-- WHERE EACH COLUMN COMES FROM:
--   * orders.discount_total                              -> crm_ro_v1.PRODUCTION.sql (orders alter) and
--                                                           20261031000000_orders_custom_status.PRODUCTION.sql.
--                                                           NOT created here; this file never touches it.
--   * order_services / order_materials discount_type /
--     discount_value                                     -> crm_ro_v1.PRODUCTION.sql (alter of both tables).
--                                                           NOT created here.
--   * orders.discount_type / orders.discount_value       -> THIS FILE (crm_ro_v1 only defines them on the
--                                                           estimates / invoices side, not on orders).
--
-- The app probes every one of these columns and transparently retries without the missing ones, so this
-- file is OPTIONAL: without it the totals are still correct (total_price / discount_total / line discounts);
-- only the uniform-percent header metadata is skipped.
--
-- Additive only: two nullable columns, no default, no backfill, no policy / trigger / RPC changes.
-- Checks are the same as on the lines: type in ('percent','amount'), value numeric(16,5).
--
-- KNOWN LIMITATION: the live RPC sync_order_materials (20261018180000_warehouse_issue_return) rewrites
-- orders.total_price as gross sum(price*quantity). The app re-writes total_price / discount_total right after
-- every such call, but a direct RPC call from another client would reset total_price to the gross amount
-- until the next app save. This file does NOT replace that RPC.
--
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- IDEMPOTENT: safe to re-run. One transaction. NOT applied automatically by the app or CI.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.orders') is null then
    raise exception 'Preflight failed: public.orders is missing.';
  end if;
end
$preflight$;

do $discount$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_type'
  ) then
    alter table public.orders add column discount_type text;
    alter table public.orders
      add constraint orders_discount_type_check check (discount_type is null or discount_type in ('percent', 'amount'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_value'
  ) then
    alter table public.orders add column discount_value numeric(16,5);
  end if;
end
$discount$;

-- PostgREST picks up the new columns after a schema reload.
notify pgrst, 'reload schema';

commit;
