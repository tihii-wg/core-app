-- =====================================================================================
-- Import from RO App spreadsheets (clients / organisations / services / parts / orders)
-- Script: 20261118180000_ro_import.PRODUCTION.sql
-- MAIN only. Manual apply after review. Do NOT run against TEST.
-- Depends on: crm_ro_v1 (migration_batches, migration_id_map, raw_ro_records, orders.legacy_number,
--   client_balance_entries, crm_has_permission), vehicles + mileage_unit, order_materials.supply_source.
-- =====================================================================================
-- The app parses the .xls in the browser and sends rows in chunks (≈100 orders / 300 clients per call).
-- Each chunk is ONE transaction:
--   * caller must have settings.general in the workspace (owner / admin);
--   * session_replication_role = replica for the chunk only: historical rows must not fire Telegram /
--     Google Calendar notifications, activity-history events, warranty creation, stock guards or the
--     "closed order is read-only" guards. Every reference written below is resolved inside the same
--     workspace, so the disabled FK triggers are not needed for integrity;
--   * idempotent: every source row is recorded in migration_id_map (entity, source id). Re-running the
--     same file skips rows that were imported before. Orders also skip a number already present
--     (orders.legacy_number) and an order the user already typed in by hand for the same car within
--     3 days of the RO date (count returned as "duplicates").
-- Times arrive as local wall-clock text ("2026-11-16T15:45:52") and are read in the workspace timezone.
-- =====================================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.migration_id_map') is null then v_problems := v_problems || 'migration_id_map missing; '; end if;
  if to_regclass('public.client_balance_entries') is null then v_problems := v_problems || 'client_balance_entries missing; '; end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then v_problems := v_problems || 'crm_has_permission missing; '; end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass and attname = 'legacy_number' and not attisdropped) then
    v_problems := v_problems || 'orders.legacy_number missing; ';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'supply_source' and not attisdropped) then
    v_problems := v_problems || 'order_materials.supply_source missing; ';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.vehicles'::regclass and attname = 'mileage_unit' and not attisdropped) then
    v_problems := v_problems || 'vehicles.mileage_unit missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'ro_import preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------------------

create or replace function public.crm_import_begin(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text;
begin
  if (select auth.uid()) is null then
    raise exception 'import:not_authenticated' using errcode = '42501';
  end if;
  if p_workspace_id is null or not public.crm_has_permission(p_workspace_id, 'settings.general') then
    raise exception 'import:forbidden' using errcode = '42501';
  end if;
  begin
    set local session_replication_role = replica;
  exception when insufficient_privilege then
    raise exception 'import:replica_not_allowed' using errcode = '42501';
  end;
  select nullif(btrim(w.timezone), '') into v_tz from public.workspaces w where w.id = p_workspace_id;
  return coalesce(v_tz, 'Europe/Chisinau');
end;
$fn$;

create or replace function public.crm_import_ts(p_value text, p_tz text)
returns timestamptz
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return (btrim(p_value)::timestamp) at time zone p_tz;
exception when others then
  return null;
end;
$fn$;

create or replace function public.crm_import_num(p_value text)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return replace(regexp_replace(btrim(p_value), '\s', '', 'g'), ',', '.')::numeric;
exception when others then
  return null;
end;
$fn$;

create or replace function public.crm_import_int(p_value text)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v numeric := public.crm_import_num(p_value);
begin
  if v is null or v < 0 or v > 2000000000 then return null; end if;
  return floor(v)::integer;
end;
$fn$;

create or replace function public.crm_import_norm_plate(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[\s\-]', '', 'g')), '')
$fn$;

/** Real VIN only: 11+ characters, not a row of zeros. */
create or replace function public.crm_import_norm_vin(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select case
    when length(regexp_replace(coalesce(p_value, ''), '\s', '', 'g')) >= 11
     and regexp_replace(coalesce(p_value, ''), '[\s0]', '', 'g') <> ''
    then upper(regexp_replace(p_value, '\s', '', 'g'))
    else null
  end
$fn$;

create or replace function public.crm_import_map_get(p_workspace_id uuid, p_entity text, p_source text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select m.target_id from public.migration_id_map m
  where m.workspace_id = p_workspace_id and m.entity = p_entity and m.source_id = p_source
$fn$;

create or replace function public.crm_import_map_put(p_workspace_id uuid, p_entity text, p_source text, p_target uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  insert into public.migration_id_map (workspace_id, entity, source_id, target_id)
  values (p_workspace_id, p_entity, p_source, p_target)
  on conflict (workspace_id, entity, source_id) do update set target_id = excluded.target_id
$fn$;

create or replace function public.crm_import_employee(p_workspace_id uuid, p_name text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select e.id from public.employees e
  where e.workspace_id = p_workspace_id
    and nullif(btrim(p_name), '') is not null
    and lower(btrim(e.name)) = lower(btrim(p_name))
  order by e.created_at
  limit 1
$fn$;

/**
 * Finds the client's car by VIN, then by plate; otherwise creates it.
 * v: {make, model, year, vin, plate, initial_mileage, current_mileage, mileage_unit, engine_l, fuel}
 */
create or replace function public.crm_import_vehicle(p_workspace_id uuid, p_client_id uuid, v jsonb, p_created_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_vin text := public.crm_import_norm_vin(v->>'vin');
  v_plate text := public.crm_import_norm_plate(v->>'plate');
  v_id uuid;
  v_unit text := case when v->>'mileage_unit' in ('km', 'mi') then v->>'mileage_unit' else null end;
  v_year integer := public.crm_import_int(v->>'year');
  v_engine numeric := public.crm_import_num(v->>'engine_l');
  v_initial integer := public.crm_import_int(v->>'initial_mileage');
  v_current integer := public.crm_import_int(v->>'current_mileage');
begin
  if v is null or jsonb_typeof(v) <> 'object' then return null; end if;
  if v_vin is null and v_plate is null and nullif(btrim(coalesce(v->>'make', '') || coalesce(v->>'model', '')), '') is null then
    return null;
  end if;
  if v_year is not null and (v_year < 1886 or v_year > 2200) then v_year := null; end if;
  if v_engine is not null and (v_engine <= 0 or v_engine >= 1000) then v_engine := null; end if;

  if v_vin is not null then
    select x.id into v_id from public.vehicles x
    where x.workspace_id = p_workspace_id and x.client_id = p_client_id and x.deleted_at is null
      and upper(regexp_replace(coalesce(x.vin, ''), '\s', '', 'g')) = v_vin
    order by x.created_at limit 1;
  end if;
  if v_id is null and v_plate is not null then
    select x.id into v_id from public.vehicles x
    where x.workspace_id = p_workspace_id and x.client_id = p_client_id and x.deleted_at is null
      and public.crm_import_norm_plate(x.license_plate) = v_plate
    order by x.created_at limit 1;
  end if;

  if v_id is not null then
    -- Keep the newest odometer reading.
    if v_current is not null then
      update public.vehicles x
         set current_mileage = greatest(coalesce(x.current_mileage, 0), v_current),
             mileage_unit = coalesce(x.mileage_unit, v_unit)
       where x.id = v_id;
    end if;
    return v_id;
  end if;

  insert into public.vehicles (
    workspace_id, client_id, make, model, year, vin, license_plate,
    initial_mileage, current_mileage, engine_displacement, fuel_type, mileage_unit, created_at, updated_at
  ) values (
    p_workspace_id, p_client_id,
    nullif(btrim(v->>'make'), ''), nullif(btrim(v->>'model'), ''), v_year,
    v_vin, nullif(btrim(v->>'plate'), ''),
    v_initial, coalesce(v_current, v_initial), v_engine, nullif(btrim(v->>'fuel'), ''), v_unit,
    coalesce(p_created_at, now()), now()
  ) returning id into v_id;
  return v_id;
end;
$fn$;

/**
 * Creates a client (no lookup). c: {name, first_name, last_name, phone, email, address, notes, client_type,
 * tax_id, contact_person, is_supplier, discount_card, created_at}
 */
create or replace function public.crm_import_insert_client(p_workspace_id uuid, c jsonb, p_tz text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_id uuid;
  v_created timestamptz := coalesce(public.crm_import_ts(c->>'created_at', p_tz), now());
begin
  insert into public.clients (
    workspace_id, name, first_name, last_name, phone, email, address, notes, client_type, tax_id,
    contact_person, is_supplier, discount_card_number, created_at, updated_at
  ) values (
    p_workspace_id,
    coalesce(nullif(btrim(c->>'name'), ''), '—'),
    nullif(btrim(c->>'first_name'), ''),
    nullif(btrim(c->>'last_name'), ''),
    nullif(btrim(c->>'phone'), ''),
    nullif(btrim(c->>'email'), ''),
    nullif(btrim(c->>'address'), ''),
    nullif(btrim(c->>'notes'), ''),
    case when c->>'client_type' = 'organization' then 'organization' else 'individual' end,
    nullif(btrim(c->>'tax_id'), ''),
    nullif(btrim(c->>'contact_person'), ''),
    coalesce((c->>'is_supplier')::boolean, false),
    nullif(btrim(c->>'discount_card'), ''),
    v_created, now()
  ) returning id into v_id;
  return v_id;
end;
$fn$;

/** Same client already in the workspace: same name and same phone (or no phone on either side). */
create or replace function public.crm_import_find_client(p_workspace_id uuid, p_name text, p_phone text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select c.id from public.clients c
  where c.workspace_id = p_workspace_id
    and c.deleted_at is null
    and c.merged_into_client_id is null
    and lower(btrim(c.name)) = lower(btrim(coalesce(p_name, '')))
    and coalesce(c.phone_normalized, '') = coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), '')
  order by c.created_at
  limit 1
$fn$;


/**
 * Catalog service for an order line: exact name → the name without a trailing "(…)" note
 * ("Замена подшипника ступицы колеса (FL)") → one hidden catch-all service "Прочие работы (RO App)".
 * The line keeps its own text in order_services.service_name either way.
 */
create or replace function public.crm_import_service_for_line(p_workspace_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_name text := lower(btrim(coalesce(p_name, '')));
  v_base text;
  v_id uuid;
begin
  v_base := v_name;
  for i in 1..3 loop
    v_id := public.crm_import_map_get(p_workspace_id, 'service', v_base);
    if v_id is null then
      select s.id into v_id from public.services s
      where s.workspace_id = p_workspace_id and lower(btrim(s.service_name)) = v_base
      order by s.created_at limit 1;
    end if;
    exit when v_id is not null;
    exit when v_base !~ '\([^()]*\)\s*$';
    v_base := btrim(regexp_replace(v_base, '\s*\([^()]*\)\s*$', ''));
    exit when v_base = '';
  end loop;
  if v_id is not null then return v_id; end if;

  v_id := public.crm_import_map_get(p_workspace_id, 'service', '__ro_other__');
  if v_id is null or not exists (select 1 from public.services s where s.id = v_id and s.workspace_id = p_workspace_id) then
    insert into public.services (workspace_id, service_name, service_price, status, warranty_type, created_at)
    values (p_workspace_id, 'Прочие работы (RO App)', 0, 'inactive', 'none', now())
    returning id into v_id;
    perform public.crm_import_map_put(p_workspace_id, 'service', '__ro_other__', v_id);
  end if;
  return v_id;
end;
$fn$;


/** RO number as the order number; "-RO", "-RO2"… when it is taken (orders.number may still be globally unique). */
create or replace function public.crm_import_free_number(p_number text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_candidate text := p_number;
  v_try integer := 1;
begin
  while exists (select 1 from public.orders o where o.number = v_candidate) loop
    v_try := v_try + 1;
    v_candidate := p_number || '-RO' || case when v_try = 2 then '' else v_try::text end;
    if v_try > 50 then
      return p_number || '-RO-' || substr(md5(random()::text), 1, 6);
    end if;
  end loop;
  return v_candidate;
end;
$fn$;

revoke all on function public.crm_import_begin(uuid) from public, anon, authenticated;
revoke all on function public.crm_import_ts(text, text) from public, anon, authenticated;
revoke all on function public.crm_import_num(text) from public, anon, authenticated;
revoke all on function public.crm_import_int(text) from public, anon, authenticated;
revoke all on function public.crm_import_norm_plate(text) from public, anon, authenticated;
revoke all on function public.crm_import_norm_vin(text) from public, anon, authenticated;
revoke all on function public.crm_import_map_get(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_import_map_put(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.crm_import_employee(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_import_vehicle(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.crm_import_insert_client(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.crm_import_find_client(uuid, text, text) from public, anon, authenticated;
revoke all on function public.crm_import_service_for_line(uuid, text) from public, anon, authenticated;
revoke all on function public.crm_import_free_number(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- 1. Clients (people and organisations)
-- row: {source_id, name, first_name, last_name, phone, email, address, notes, client_type, tax_id,
--       contact_person, is_supplier, discount_card, created_at, balance, vehicles: [vehicle…]}
-- ---------------------------------------------------------------------------------------
create or replace function public.crm_import_clients(p_workspace_id uuid, p_rows jsonb, p_with_balance boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text := public.crm_import_begin(p_workspace_id);
  r jsonb;
  v jsonb;
  v_source text;
  v_client uuid;
  v_created integer := 0;
  v_linked integer := 0;
  v_skipped integer := 0;
  v_vehicles integer := 0;
  v_balances integer := 0;
  v_vehicle uuid;
  v_balance numeric;
  v_new boolean;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'import:invalid_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_source := nullif(btrim(r->>'source_id'), '');
    if v_source is null then v_skipped := v_skipped + 1; continue; end if;
    v_client := public.crm_import_map_get(p_workspace_id, 'client', v_source);
    v_new := false;
    if v_client is not null and exists (select 1 from public.clients c where c.id = v_client and c.workspace_id = p_workspace_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Link to an existing client only on name + a real phone; contacts without a phone stay separate people.
    v_client := case when nullif(regexp_replace(coalesce(r->>'phone', ''), '\D', '', 'g'), '') is not null
                     then public.crm_import_find_client(p_workspace_id, r->>'name', r->>'phone') end;
    if v_client is null then
      v_client := public.crm_import_insert_client(p_workspace_id, r, v_tz);
      v_created := v_created + 1;
      v_new := true;
    else
      v_linked := v_linked + 1;
    end if;
    perform public.crm_import_map_put(p_workspace_id, 'client', v_source, v_client);

    if jsonb_typeof(r->'vehicles') = 'array' then
      for v in select * from jsonb_array_elements(r->'vehicles') loop
        v_vehicle := public.crm_import_vehicle(p_workspace_id, v_client, v, public.crm_import_ts(r->>'created_at', v_tz));
        if v_vehicle is not null then v_vehicles := v_vehicles + 1; end if;
      end loop;
    end if;

    v_balance := public.crm_import_num(r->>'balance');
    if p_with_balance and v_new and coalesce(v_balance, 0) <> 0 then
      insert into public.client_balance_entries (workspace_id, client_id, amount, currency_code, description, is_adjustment, created_by)
      values (p_workspace_id, v_client, v_balance, coalesce(nullif(r->>'currency', ''), 'MDL'), 'Начальный баланс (импорт из RO App)', true, (select auth.uid()));
      update public.clients c set balance = coalesce(c.balance, 0) + v_balance where c.id = v_client;
      v_balances := v_balances + 1;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'linked', v_linked, 'skipped', v_skipped, 'vehicles', v_vehicles, 'balances', v_balances);
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 2. Catalog: services and parts
-- services row: {name, kind: labor|service, price, cost, warranty_months}
-- materials row: {name, sku, mpn, brand, description, unit, cost, price, stock}
-- Returns stock rows ({id, qty, cost}) so the app posts ONE goods receipt through its normal stock flow.
-- ---------------------------------------------------------------------------------------
create or replace function public.crm_import_catalog(p_workspace_id uuid, p_kind text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text := public.crm_import_begin(p_workspace_id);
  r jsonb;
  v_name text;
  v_key text;
  v_id uuid;
  v_created integer := 0;
  v_linked integer := 0;
  v_skipped integer := 0;
  v_stock jsonb := '[]'::jsonb;
  v_qty numeric;
  v_months integer;
begin
  if p_kind not in ('services', 'materials') then raise exception 'import:invalid_kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'import:invalid_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(r->>'name'), '');
    if v_name is null then v_skipped := v_skipped + 1; continue; end if;
    v_key := lower(v_name);

    if p_kind = 'services' then
      v_id := public.crm_import_map_get(p_workspace_id, 'service', v_key);
      if v_id is not null and exists (select 1 from public.services s where s.id = v_id and s.workspace_id = p_workspace_id) then
        v_skipped := v_skipped + 1; continue;
      end if;
      select s.id into v_id from public.services s
      where s.workspace_id = p_workspace_id and lower(btrim(s.service_name)) = v_key
      order by s.created_at limit 1;
      if v_id is null then
        v_months := public.crm_import_int(r->>'warranty_months');
        insert into public.services (
          workspace_id, service_name, service_price, cost_price, kind, status,
          warranty_type, warranty_months, created_at
        ) values (
          p_workspace_id, v_name, coalesce(public.crm_import_num(r->>'price'), 0),
          public.crm_import_num(r->>'cost'),
          case when r->>'kind' in ('labor', 'service') then r->>'kind' else null end,
          'active',
          case when coalesce(v_months, 0) > 0 then 'duration' else 'none' end,
          nullif(v_months, 0),
          now()
        ) returning id into v_id;
        v_created := v_created + 1;
      else
        v_linked := v_linked + 1;
      end if;
      perform public.crm_import_map_put(p_workspace_id, 'service', v_key, v_id);
    else
      v_id := public.crm_import_map_get(p_workspace_id, 'inventory_item', v_key);
      if v_id is not null and exists (select 1 from public.inventory_items i where i.id = v_id and i.workspace_id = p_workspace_id) then
        v_skipped := v_skipped + 1; continue;
      end if;
      select i.id into v_id from public.inventory_items i
      where i.workspace_id = p_workspace_id and lower(btrim(i.name)) = v_key
      order by i.created_at limit 1;
      if v_id is null then
        insert into public.inventory_items (
          workspace_id, name, sku, mpn, description, category, unit, quantity, min_quantity,
          purchase_price, selling_price, is_active, created_at, updated_at
        ) values (
          p_workspace_id, v_name,
          -- inventory_items.sku is unique per workspace and RO codes repeat: the first item keeps it.
          case when nullif(btrim(r->>'sku'), '') is not null and not exists (
            select 1 from public.inventory_items i2 where i2.workspace_id = p_workspace_id and i2.sku = btrim(r->>'sku')
          ) then btrim(r->>'sku') else null end,
          nullif(btrim(r->>'mpn'), ''),
          nullif(btrim(concat_ws(' · ', nullif(btrim(r->>'brand'), ''), nullif(btrim(r->>'description'), ''))), ''),
          nullif(btrim(r->>'category'), ''),
          coalesce(nullif(btrim(r->>'unit'), ''), 'шт.'),
          0, 0,
          coalesce(public.crm_import_num(r->>'cost'), 0),
          coalesce(public.crm_import_num(r->>'price'), 0),
          true, now(), now()
        ) returning id into v_id;
        v_created := v_created + 1;
        v_qty := public.crm_import_num(r->>'stock');
        if coalesce(v_qty, 0) > 0 then
          v_stock := v_stock || jsonb_build_object('id', v_id, 'name', v_name, 'qty', v_qty, 'cost', coalesce(public.crm_import_num(r->>'cost'), 0));
        end if;
      else
        v_linked := v_linked + 1;
      end if;
      perform public.crm_import_map_put(p_workspace_id, 'inventory_item', v_key, v_id);
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'linked', v_linked, 'skipped', v_skipped, 'stock', v_stock);
end;
$fn$;

-- ---------------------------------------------------------------------------------------
-- 3. Orders
-- row: {number, created_at, deadline, closed_at, scheduled_from, scheduled_to, status_name, state: closed|cancelled|open,
--       client: {name, phone, client_type}, vehicle: {…}, manager, executor, total, paid, service_type,
--       description, technician_notes, manager_notes, malfunction, mileage, mileage_unit, warranty (bool),
--       services: [{name, qty, price, mileage}], materials: [{name, qty, price, mileage}]}
-- ---------------------------------------------------------------------------------------
create or replace function public.crm_import_orders(p_workspace_id uuid, p_rows jsonb, p_with_payments boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text := public.crm_import_begin(p_workspace_id);
  r jsonb;
  l jsonb;
  v_number text;
  v_order uuid;
  v_client uuid;
  v_vehicle uuid;
  v_created_at timestamptz;
  v_closed_at timestamptz;
  v_status text;
  v_custom uuid;
  v_plate text;
  v_vin text;
  v_total numeric;
  v_paid numeric;
  v_lines_sum numeric;
  v_pos integer;
  v_item uuid;
  v_service uuid;
  v_qty numeric;
  v_price numeric;
  v_device text;
  v_services_text text;
  v_mileage integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_duplicates integer := 0;
  v_clients integer := 0;
  v_vehicles integer := 0;
  v_lines integer := 0;
  v_payments integer := 0;
  v_vehicles_before integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'import:invalid_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_number := nullif(btrim(r->>'number'), '');
    if v_number is null then v_skipped := v_skipped + 1; continue; end if;

    -- Already imported (map or the RO number on an order).
    v_order := public.crm_import_map_get(p_workspace_id, 'order', v_number);
    if (v_order is not null and exists (select 1 from public.orders o where o.id = v_order and o.workspace_id = p_workspace_id))
       or exists (select 1 from public.orders o where o.workspace_id = p_workspace_id and o.legacy_number = v_number) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_created_at := coalesce(public.crm_import_ts(r->>'created_at', v_tz), now());
    v_closed_at := public.crm_import_ts(r->>'closed_at', v_tz);
    v_plate := public.crm_import_norm_plate(r->'vehicle'->>'plate');
    v_vin := public.crm_import_norm_vin(r->'vehicle'->>'vin');

    -- The same visit typed in by hand in Core App (no RO number) — keep the hand-made order.
    if v_plate is not null and exists (
      select 1 from public.orders o
      where o.workspace_id = p_workspace_id
        and o.legacy_number is null
        and public.crm_import_norm_plate(o.car_number) = v_plate
        and o.created_at between v_created_at - interval '3 days' and v_created_at + interval '3 days'
    ) then
      v_duplicates := v_duplicates + 1;
      perform public.crm_import_map_put(p_workspace_id, 'order_duplicate', v_number, p_workspace_id);
      continue;
    end if;

    -- Client: imported contact (same name + phone) → same name → owner of the car → new client.
    v_client := public.crm_import_find_client(p_workspace_id, r->'client'->>'name', r->'client'->>'phone');
    if v_client is null and nullif(btrim(r->'client'->>'name'), '') is not null then
      select c.id into v_client from public.clients c
      where c.workspace_id = p_workspace_id and c.deleted_at is null and c.merged_into_client_id is null
        and lower(btrim(c.name)) = lower(btrim(r->'client'->>'name'))
      order by c.created_at limit 1;
    end if;
    if v_client is null and (v_vin is not null or v_plate is not null) then
      select x.client_id into v_client from public.vehicles x
      join public.clients c on c.id = x.client_id and c.deleted_at is null
      where x.workspace_id = p_workspace_id and x.deleted_at is null
        and ((v_vin is not null and upper(regexp_replace(coalesce(x.vin, ''), '\s', '', 'g')) = v_vin)
          or (v_plate is not null and public.crm_import_norm_plate(x.license_plate) = v_plate))
      order by x.created_at limit 1;
    end if;
    if v_client is null then
      v_client := public.crm_import_insert_client(
        p_workspace_id,
        (r->'client') || jsonb_build_object('created_at', r->>'created_at'),
        v_tz
      );
      v_clients := v_clients + 1;
    end if;

    select count(*) into v_vehicles_before from public.vehicles x where x.workspace_id = p_workspace_id and x.client_id = v_client;
    v_vehicle := public.crm_import_vehicle(p_workspace_id, v_client, r->'vehicle', v_created_at);
    if v_vehicle is not null and (select count(*) from public.vehicles x where x.workspace_id = p_workspace_id and x.client_id = v_client) > v_vehicles_before then
      v_vehicles := v_vehicles + 1;
    end if;

    -- Status: RO "Закрыт" → closed, "Отказ" → cancelled; any other name → the workspace status with that name.
    v_custom := null;
    if r->>'state' = 'closed' then
      v_status := 'closed';
      v_closed_at := coalesce(v_closed_at, v_created_at);
    elsif r->>'state' = 'cancelled' then
      v_status := 'cancelled';
      v_closed_at := coalesce(v_closed_at, v_created_at);
    else
      v_closed_at := null;
      select d.id, d.system_status into v_custom, v_status
      from public.status_definitions d
      where d.workspace_id = p_workspace_id and d.entity = 'order' and d.deleted_at is null
        and lower(btrim(d.name)) = lower(btrim(coalesce(r->>'status_name', '')))
        and d.system_status not in ('closed', 'cancelled')
      order by d.is_active desc, d.created_at
      limit 1;
      if v_status is null then v_status := 'new'; v_custom := null; end if;
    end if;

    v_total := coalesce(public.crm_import_num(r->>'total'), 0);
    v_paid := greatest(coalesce(public.crm_import_num(r->>'paid'), 0), 0);
    select coalesce(sum(coalesce(public.crm_import_num(x->>'qty'), 0) * coalesce(public.crm_import_num(x->>'price'), 0)), 0)
      into v_lines_sum
      from jsonb_array_elements(coalesce(r->'services', '[]'::jsonb) || coalesce(r->'materials', '[]'::jsonb)) x;
    if v_total = 0 and v_lines_sum > 0 then v_total := v_lines_sum; end if;

    v_device := nullif(btrim(concat_ws(' ', nullif(btrim(r->'vehicle'->>'make'), ''), nullif(btrim(r->'vehicle'->>'model'), ''),
                                       nullif(btrim(r->'vehicle'->>'year'), ''))), '');
    select string_agg(x->>'name', ', ') into v_services_text
      from jsonb_array_elements(coalesce(r->'services', '[]'::jsonb)) x;
    v_mileage := public.crm_import_int(r->>'mileage');

    insert into public.orders (
      workspace_id, client_id, vehicle_id, number, legacy_number, kind, status, custom_status_id,
      created_at, updated_at, status_changed_at, closed_at, deadline, scheduled_from, scheduled_to,
      device, car_number, vin, service, service_type, description, technician_notes, manager_notes, malfunction,
      total_price, discount_total, is_paid, assigned_to, created_by, manager_id, employee_id,
      vehicle_mileage_snapshot, vehicle_mileage_unit_snapshot
    ) values (
      p_workspace_id, v_client, v_vehicle,
      public.crm_import_free_number(v_number),
      v_number, 'order', v_status, v_custom,
      v_created_at, coalesce(v_closed_at, v_created_at), coalesce(v_closed_at, v_created_at), v_closed_at,
      public.crm_import_ts(r->>'deadline', v_tz),
      public.crm_import_ts(r->>'scheduled_from', v_tz),
      public.crm_import_ts(r->>'scheduled_to', v_tz),
      v_device, nullif(btrim(r->'vehicle'->>'plate'), ''), v_vin,
      nullif(left(v_services_text, 2000), ''),
      nullif(btrim(r->>'service_type'), ''),
      nullif(btrim(r->>'description'), ''),
      nullif(btrim(r->>'technician_notes'), ''),
      nullif(btrim(r->>'manager_notes'), ''),
      nullif(btrim(r->>'malfunction'), ''),
      v_total,
      nullif(greatest(v_lines_sum - v_total, 0), 0),
      v_total > 0 and v_paid >= v_total,
      null, null,
      public.crm_import_employee(p_workspace_id, r->>'manager'),
      public.crm_import_employee(p_workspace_id, r->>'executor'),
      v_mileage,
      case when v_mileage is not null and r->>'mileage_unit' in ('km', 'mi') then r->>'mileage_unit' else null end
    ) returning id into v_order;

    v_pos := 0;
    for l in select * from jsonb_array_elements(coalesce(r->'services', '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      v_qty := coalesce(public.crm_import_num(l->>'qty'), 1);
      v_price := coalesce(public.crm_import_num(l->>'price'), 0);
      v_service := public.crm_import_service_for_line(p_workspace_id, l->>'name');
      insert into public.order_services (order_id, service_id, service_name, price, quantity, mileage, position, created_at)
      values (v_order, v_service, coalesce(nullif(btrim(l->>'name'), ''), '—'), v_price, v_qty,
              public.crm_import_int(l->>'mileage'), v_pos, v_created_at);
      v_lines := v_lines + 1;
    end loop;

    v_pos := 0;
    for l in select * from jsonb_array_elements(coalesce(r->'materials', '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      v_qty := coalesce(public.crm_import_num(l->>'qty'), 1);
      v_price := coalesce(public.crm_import_num(l->>'price'), 0);
      v_item := public.crm_import_map_get(p_workspace_id, 'inventory_item', lower(btrim(l->>'name')));
      if v_item is null then
        select i.id into v_item from public.inventory_items i
        where i.workspace_id = p_workspace_id and lower(btrim(i.name)) = lower(btrim(l->>'name'))
        order by i.created_at limit 1;
      end if;
      -- One catalog item per order (order_materials_order_catalog_item_uidx): a repeated item stays a separate
      -- line with its own price/qty, as in RO App, but as a one-time position.
      if v_item is not null and exists (
        select 1 from public.order_materials m where m.order_id = v_order and m.inventory_item_id = v_item
      ) then
        v_item := null;
      end if;
      -- Catalog link for reports / history; already handed out long ago, so no stock movement.
      insert into public.order_materials (
        order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned,
        supply_source, mileage, position, created_at, updated_at
      ) values (
        v_order, v_item, coalesce(nullif(btrim(l->>'name'), ''), '—'), v_price, v_qty,
        case when v_item is not null and v_status <> 'cancelled' then v_qty else 0 end, 0,
        case when v_item is not null then 'catalog' else 'one_time' end,
        public.crm_import_int(l->>'mileage'), v_pos, v_created_at, v_created_at
      );
      v_lines := v_lines + 1;
    end loop;

    if p_with_payments and v_paid > 0 then
      insert into public.payments (
        workspace_id, order_id, kind, amount, currency_code, payment_method, paid_at, note, created_by, created_at
      ) values (
        p_workspace_id, v_order, 'payment', v_paid,
        coalesce((select nullif(w.currency, '') from public.workspaces w where w.id = p_workspace_id), 'MDL'),
        'cash', coalesce(v_closed_at, v_created_at), 'Импорт из RO App', (select auth.uid()), coalesce(v_closed_at, v_created_at)
      );
      v_payments := v_payments + 1;
    end if;

    perform public.crm_import_map_put(p_workspace_id, 'order', v_number, v_order);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'created', v_created, 'skipped', v_skipped, 'duplicates', v_duplicates,
    'clients', v_clients, 'vehicles', v_vehicles, 'lines', v_lines, 'payments', v_payments
  );
end;
$fn$;

revoke all on function public.crm_import_clients(uuid, jsonb, boolean) from public, anon;
revoke all on function public.crm_import_catalog(uuid, text, jsonb) from public, anon;
revoke all on function public.crm_import_orders(uuid, jsonb, boolean) from public, anon;
grant execute on function public.crm_import_clients(uuid, jsonb, boolean) to authenticated;
grant execute on function public.crm_import_catalog(uuid, text, jsonb) to authenticated;
grant execute on function public.crm_import_orders(uuid, jsonb, boolean) to authenticated;

-- Lookups by name during import (and later searches) stay index-backed.
create index if not exists services_workspace_lower_name_idx on public.services (workspace_id, lower(btrim(service_name)));
create index if not exists inventory_items_workspace_lower_name_idx on public.inventory_items (workspace_id, lower(btrim(name)));
create index if not exists clients_workspace_lower_name_idx on public.clients (workspace_id, lower(btrim(name)));

notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.crm_import_orders(uuid,jsonb,boolean)') is null
     or to_regprocedure('public.crm_import_clients(uuid,jsonb,boolean)') is null
     or to_regprocedure('public.crm_import_catalog(uuid,text,jsonb)') is null then
    raise exception 'ro_import postflight: functions missing';
  end if;
end;
$postflight$;

commit;
