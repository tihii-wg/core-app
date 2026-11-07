-- =============================================================================
-- VAT on orders (prices include VAT): rate snapshot + automatic tax_total
-- Script: 20261107130000_order_vat.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: crm_ro_v1 (public.taxes, orders.tax_total)
-- =============================================================================
-- Prices are VAT-inclusive. VAT is extracted from the order total:
--   tax_total = round(total_price * rate / (100 + rate), 2)
--
-- Adds:
--   1) orders.vat_rate numeric(7,3) NULL — VAT rate snapshot of the order.
--   2) crm_workspace_vat_rate(workspace_id) — the workspace VAT rate from Settings → Taxes:
--      highest rate among active, not deleted, is_included = true taxes; NULL when none.
--   3) BEFORE INSERT / UPDATE OF total_price, vat_rate trigger on orders:
--      - on INSERT: vat_rate defaults to crm_workspace_vat_rate(workspace_id)
--      - tax_total is recalculated from total_price and vat_rate (0 when no rate)
--   Works for every path that changes totals (app, sync_order_materials, discount / price RPCs).
--
-- No backfill (closed orders are protected); for old orders the app shows VAT using the current
-- workspace rate until the order total changes. Does NOT change total_price or payments.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.orders') is null then
    raise exception 'order_vat preflight: orders missing';
  end if;
  if to_regclass('public.taxes') is null then
    raise exception 'order_vat preflight: taxes missing (apply crm_ro_v1 first)';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass
                 and attname = 'tax_total' and not attisdropped) then
    raise exception 'order_vat preflight: orders.tax_total missing (apply crm_ro_v1 first)';
  end if;
end;
$preflight$;

alter table public.orders add column if not exists vat_rate numeric(7,3);

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_vat_rate_range'
                 and conrelid = 'public.orders'::regclass) then
    alter table public.orders
      add constraint orders_vat_rate_range check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100));
  end if;
end;
$chk$;

create or replace function public.crm_workspace_vat_rate(p_workspace_id uuid)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select t.rate::numeric
  from public.taxes t
  where t.workspace_id = p_workspace_id
    and t.deleted_at is null
    and coalesce(t.is_active, true)
    and coalesce(t.is_included, true)
    and t.rate > 0
  order by t.rate desc, t.created_at asc nulls last
  limit 1;
$fn$;

revoke all on function public.crm_workspace_vat_rate(uuid) from public, anon;
grant execute on function public.crm_workspace_vat_rate(uuid) to authenticated, service_role;

create or replace function public.crm_orders_vat_biu()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_rate numeric;
begin
  if tg_op = 'INSERT' and new.vat_rate is null then
    new.vat_rate := public.crm_workspace_vat_rate(new.workspace_id);
  end if;

  -- Recalculate only when the total or the rate really changes (never touch untouched closed orders).
  if tg_op = 'UPDATE'
     and new.total_price is not distinct from old.total_price
     and new.vat_rate is not distinct from old.vat_rate then
    return new;
  end if;

  v_rate := coalesce(new.vat_rate, 0);
  if v_rate > 0 and new.total_price is not null then
    new.tax_total := round(new.total_price::numeric * v_rate / (100 + v_rate), 2);
  else
    new.tax_total := 0;
  end if;
  return new;
end;
$fn$;

revoke all on function public.crm_orders_vat_biu() from public, anon, authenticated;

-- Name starts with "crm_" so it runs before orders_closed_content_guard (alphabetical BEFORE trigger order);
-- tax_total only changes together with total_price / vat_rate, which the guard already validates.
drop trigger if exists crm_orders_vat_biu on public.orders;
create trigger crm_orders_vat_biu
  before insert or update of total_price, vat_rate on public.orders
  for each row execute function public.crm_orders_vat_biu();

comment on column public.orders.vat_rate is
  'VAT rate snapshot (percent, prices include VAT). tax_total = total_price * rate / (100 + rate), maintained by crm_orders_vat_biu.';

do $postflight$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_orders_vat_biu'
                 and tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'order_vat postflight: trigger missing';
  end if;
end;
$postflight$;

commit;
