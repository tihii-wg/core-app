-- =============================================================================
-- Industry-specific order fields (phase 2a)
-- Script: 20261108100000_order_industry_fields.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Adds nullable columns on public.orders, used by the UI depending on the
-- workspace business type (industry profile):
--   Device repair:   device_serial, device_imei, device_condition,
--                    device_completeness, device_passcode
--   Site / project:  site_address
--   Furniture:       product_dimensions, measurement_at, installation_at
--
-- Additive only: no data changes, no backfill. Existing RLS policies on orders
-- apply unchanged. Closed orders stay immutable: orders_closed_content_guard
-- compares the whole row, so the new columns are protected automatically.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.orders') is null then
    raise exception 'order_industry_fields preflight: public.orders missing';
  end if;
end;
$preflight$;

alter table public.orders add column if not exists device_serial text;
alter table public.orders add column if not exists device_imei text;
alter table public.orders add column if not exists device_condition text;
alter table public.orders add column if not exists device_completeness text;
alter table public.orders add column if not exists device_passcode text;
alter table public.orders add column if not exists site_address text;
alter table public.orders add column if not exists product_dimensions text;
alter table public.orders add column if not exists measurement_at timestamptz;
alter table public.orders add column if not exists installation_at timestamptz;

do $chk$
declare
  r record;
begin
  for r in
    select * from (values
      ('orders_device_serial_len',       'device_serial',       100),
      ('orders_device_imei_len',         'device_imei',         40),
      ('orders_device_condition_len',    'device_condition',    2000),
      ('orders_device_completeness_len', 'device_completeness', 2000),
      ('orders_device_passcode_len',     'device_passcode',     100),
      ('orders_site_address_len',        'site_address',        500),
      ('orders_product_dimensions_len',  'product_dimensions',  500)
    ) as v(conname, col, maxlen)
  loop
    if not exists (select 1 from pg_constraint
                   where conname = r.conname and conrelid = 'public.orders'::regclass) then
      execute format(
        'alter table public.orders add constraint %I check (%I is null or char_length(%I) <= %s)',
        r.conname, r.col, r.col, r.maxlen);
    end if;
  end loop;

  if not exists (select 1 from pg_constraint
                 where conname = 'orders_install_after_measure'
                   and conrelid = 'public.orders'::regclass) then
    alter table public.orders
      add constraint orders_install_after_measure
      check (measurement_at is null or installation_at is null or installation_at >= measurement_at);
  end if;
end;
$chk$;

create index if not exists orders_workspace_measurement_at_idx
  on public.orders (workspace_id, measurement_at) where measurement_at is not null;
create index if not exists orders_workspace_installation_at_idx
  on public.orders (workspace_id, installation_at) where installation_at is not null;

comment on column public.orders.device_passcode is
  'Device unlock code / pattern given by the client for repair. Visible to workspace members; clear it after the order is closed if not needed.';

do $postflight$
declare
  v_missing text;
begin
  select string_agg(c, ', ') into v_missing
  from unnest(array['device_serial','device_imei','device_condition','device_completeness',
                    'device_passcode','site_address','product_dimensions',
                    'measurement_at','installation_at']) as c
  where not exists (select 1 from pg_attribute
                    where attrelid = 'public.orders'::regclass and attname = c and not attisdropped);
  if v_missing is not null then
    raise exception 'order_industry_fields postflight: missing columns %', v_missing;
  end if;
end;
$postflight$;

commit;
