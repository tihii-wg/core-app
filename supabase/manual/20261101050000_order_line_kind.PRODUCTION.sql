-- =====================================================================
-- Core App: order_services.kind  ('labor' | 'service')
--
-- WHY: the RO migration (Appendix A, "Работы" vs "Услуги") distinguishes labor lines
-- from service lines on an order. The app reads/writes `order_services.kind` when the
-- column exists and transparently retries without it when it does not
-- (src/services/apiOrders.ts), so this file is OPTIONAL and purely additive.
--
-- NOTE: crm_ro_v1.PRODUCTION.sql already adds this exact column (with an inline CHECK).
-- On a database where crm_ro_v1 is applied this script changes nothing. It exists for
-- databases that only have the legacy schema and want line kinds ahead of the full cutover.
--
-- Additive only: nullable column, no default, no backfill, no policy/trigger changes.
-- NULL means "not classified" and is rendered as a plain service line.
-- Existing rows and the existing order total logic are untouched.
--
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- IDEMPOTENT: safe to re-run. One transaction. NOT applied automatically by the app or CI.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_services') is null then
    raise exception 'Preflight failed: public.order_services is missing.';
  end if;
end
$preflight$;

do $kind$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_services' and column_name = 'kind'
  ) then
    alter table public.order_services add column kind text;
    alter table public.order_services
      add constraint order_services_kind_check check (kind is null or kind in ('labor', 'service'));
  end if;
end
$kind$;

-- PostgREST picks up the new column after a schema reload.
notify pgrst, 'reload schema';

commit;
