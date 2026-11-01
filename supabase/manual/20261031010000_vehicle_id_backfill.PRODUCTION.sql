-- =====================================================================
-- Core App: backfill orders.vehicle_id для старых заказов (PREP ONLY).
--
-- НЕ ЗАПУСКАТЬ на проде без ревью и бэкапа. По умолчанию скрипт заканчивается
-- ROLLBACK: он только показывает, сколько заказов будет привязано. Чтобы применить,
-- после проверки счётчиков замените последнюю строку `rollback;` на `commit;`.
--
-- Контекст (docs/ro-app-migration-stage-0-report.md, п.5): карточка машины читает
-- заказы строго по orders.vehicle_id, а у старых заказов vehicle_id = NULL, хотя
-- на заказе заполнены снимок device / car_number / vin. DDL для public.vehicles и
-- orders.vehicle_id в репозитории отсутствует: скрипт ничего не создаёт и падает с
-- понятной ошибкой, если колонок на живой БД нет.
--
-- Используются только колонки, которые читает приложение:
--   orders:   id, workspace_id, client_id, vehicle_id, device, car_number, vin
--   vehicles: id, workspace_id, client_id, make, model, year, vin, license_plate, deleted_at
--
-- Правила сопоставления (в рамках одного workspace_id и client_id, неудалённые машины,
-- только заказы с vehicle_id IS NULL). Берётся самый сильный уровень, на котором у
-- заказа найдена РОВНО ОДНА машина; неоднозначные заказы пропускаются:
--   1. VIN совпадает (без регистра и пробелов по краям).
--   2. Госномер совпадает (без регистра, пробелов и дефисов), а VIN не противоречит
--      (у заказа или машины VIN пуст, либо они равны).
--   3. orders.device равен «make model year» или «make model» машины (без регистра),
--      а VIN и госномер не противоречат.
-- Обновляется только vehicle_id; updated_at не меняется. Существующие vehicle_id
-- никогда не перезаписываются.
--
-- Триггер orders_enforce_unique_open_vin (если есть) срабатывает на каждый UPDATE и
-- может отклонить строку при включённой настройке «не дублировать открытые заказы по
-- VIN», поэтому на время UPDATE он отключается и сразу включается обратно в той же
-- транзакции (нужен владелец таблицы orders).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Проверка схемы (ничего не создаём)
-- ---------------------------------------------------------------------
do $$
declare
  v_problems text[] := '{}';
  v_item text;
  v_type text;
begin
  foreach v_item in array array[
    'orders.id','orders.workspace_id','orders.client_id','orders.vehicle_id',
    'orders.device','orders.car_number','orders.vin',
    'vehicles.id','vehicles.workspace_id','vehicles.client_id','vehicles.make','vehicles.model',
    'vehicles.year','vehicles.vin','vehicles.license_plate','vehicles.deleted_at'
  ] loop
    select data_type into v_type from information_schema.columns
    where table_schema = 'public'
      and table_name = split_part(v_item, '.', 1)
      and column_name = split_part(v_item, '.', 2);
    if not found then
      v_problems := v_problems || format('нет колонки public.%s', v_item);
    end if;
  end loop;

  if cardinality(v_problems) > 0 then
    raise exception E'Backfill vehicle_id: схема не совпадает, ничего не изменено:\n%',
      array_to_string(v_problems, E'\n');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Кандидаты: заказ -> машина -> уровень совпадения
-- ---------------------------------------------------------------------
create temp table crm_vehicle_backfill_candidates on commit drop as
with o as (
  select
    id,
    workspace_id,
    client_id,
    nullif(upper(btrim(vin)), '') as nvin,
    nullif(upper(regexp_replace(coalesce(car_number, ''), '[\s\-]', '', 'g')), '') as nplate,
    nullif(lower(btrim(device)), '') as ndevice
  from public.orders
  where vehicle_id is null
    and client_id is not null
),
v as (
  select
    id,
    workspace_id,
    client_id,
    nullif(upper(btrim(vin)), '') as nvin,
    nullif(upper(regexp_replace(coalesce(license_plate, ''), '[\s\-]', '', 'g')), '') as nplate,
    nullif(lower(btrim(concat_ws(' ', nullif(btrim(make), ''), nullif(btrim(model), ''), year::text))), '') as label_full,
    nullif(lower(btrim(concat_ws(' ', nullif(btrim(make), ''), nullif(btrim(model), '')))), '') as label_short
  from public.vehicles
  where deleted_at is null
)
select order_id, vehicle_id, tier
from (
  select
    o.id as order_id,
    v.id as vehicle_id,
    case
      when o.nvin is not null and o.nvin = v.nvin then 1
      when o.nplate is not null and o.nplate = v.nplate
           and (o.nvin is null or v.nvin is null or o.nvin = v.nvin) then 2
      when o.ndevice is not null and o.ndevice in (v.label_full, v.label_short)
           and (o.nvin is null or v.nvin is null or o.nvin = v.nvin)
           and (o.nplate is null or v.nplate is null or o.nplate = v.nplate) then 3
    end as tier
  from o
  join v on v.workspace_id = o.workspace_id and v.client_id = o.client_id
) m
where tier is not null;

-- Один заказ -> одна машина на лучшем уровне; иначе заказ пропускается.
create temp table crm_vehicle_backfill_plan on commit drop as
select c.order_id, min(c.vehicle_id::text)::uuid as vehicle_id, c.tier
from crm_vehicle_backfill_candidates c
join (
  select order_id, min(tier) as best_tier
  from crm_vehicle_backfill_candidates
  group by order_id
) b on b.order_id = c.order_id and b.best_tier = c.tier
group by c.order_id, c.tier
having count(distinct c.vehicle_id) = 1;

-- ---------------------------------------------------------------------
-- 2. Предпросмотр (результат виден в выводе psql / SQL editor)
-- ---------------------------------------------------------------------
select 'orders_without_vehicle_id' as metric, count(*)::bigint as value
from public.orders where vehicle_id is null
union all
select 'will_link_tier_' || tier, count(*) from crm_vehicle_backfill_plan group by tier
union all
select 'will_link_total', count(*) from crm_vehicle_backfill_plan
union all
select 'ambiguous_skipped', count(distinct order_id) - (select count(*) from crm_vehicle_backfill_plan)
from crm_vehicle_backfill_candidates
order by 1;

-- Образцы для ручной проверки (первые 50):
select o.number, o.device, o.car_number, o.vin as order_vin,
       p.tier, v.make, v.model, v.year, v.license_plate, v.vin as vehicle_vin
from crm_vehicle_backfill_plan p
join public.orders o on o.id = p.order_id
join public.vehicles v on v.id = p.vehicle_id
order by p.tier, o.number
limit 50;

-- ---------------------------------------------------------------------
-- 3. Безопасный UPDATE (только vehicle_id IS NULL, повторная проверка в WHERE)
-- ---------------------------------------------------------------------
do $$
declare
  v_trigger_exists boolean;
  v_updated integer;
begin
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_enforce_unique_open_vin'
      and not tgisinternal
  ) into v_trigger_exists;

  if v_trigger_exists then
    alter table public.orders disable trigger orders_enforce_unique_open_vin;
  end if;

  update public.orders o
  set vehicle_id = p.vehicle_id
  from crm_vehicle_backfill_plan p
  join public.vehicles v on v.id = p.vehicle_id
  where o.id = p.order_id
    and o.vehicle_id is null
    and v.deleted_at is null
    and v.workspace_id = o.workspace_id
    and v.client_id = o.client_id;
  get diagnostics v_updated = row_count;

  if v_trigger_exists then
    alter table public.orders enable trigger orders_enforce_unique_open_vin;
  end if;

  raise notice 'Backfill vehicle_id: updated % orders', v_updated;
end $$;

-- По умолчанию откатываем. После ревью счётчиков и образцов замените на `commit;`.
rollback;
