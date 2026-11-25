-- =====================================================================================
-- Merge duplicate vehicles of one client (crm_merge_vehicles)
-- Script: 20261125170000_merge_vehicles.PRODUCTION.sql
-- MAIN only. Manual apply after review.
-- Prerequisites: 20261110090000_merge_clients (orders_closed_content_guard@v3).
-- =====================================================================================
-- * orders_closed_content_guard @v4 = @v3 + a second narrow, transaction-local bypass
--   (GUC crm.vehicle_merge=on) that lets ONLY orders.vehicle_id (+ lifecycle allowlist) change on
--   closed orders. Everything else stays exactly as in @v3.
-- * crm_merge_vehicles(target, sources[]): all sources must be active vehicles of the SAME client
--   as the target. Every FK column referencing vehicles(id) (orders, warranty_records, mileage log,
--   bookings…, found in pg_constraint) is re-pointed to the target; empty target fields are filled
--   from the sources (initial mileage = lowest, current mileage = highest); sources are soft-deleted.
--   Fails closed on an unknown UNIQUE constraint over a vehicle FK column.
-- =====================================================================================

begin;

do $preflight$
declare
  v_def text;
  v_comment text;
begin
  if to_regprocedure('public.orders_closed_content_guard()') is null then
    raise exception 'merge_vehicles preflight: orders_closed_content_guard missing';
  end if;
  select obj_description('public.orders_closed_content_guard()'::regprocedure, 'pg_proc') into v_comment;
  if coalesce(v_comment, '') not like '%orders_closed_content_guard@v3%'
     and coalesce(v_comment, '') not like '%orders_closed_content_guard@v4%' then
    raise exception 'merge_vehicles preflight: expected orders_closed_content_guard@v3, found: %', coalesce(v_comment, '(no comment)');
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    raise exception 'merge_vehicles preflight: crm_has_permission missing';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Closed-order content guard @v4 — @v3 + vehicle-merge bypass (vehicle_id only)
-- ---------------------------------------------------------------------------
create or replace function public.orders_closed_content_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_allowed text[] := array['status', 'custom_status_id', 'closed_at', 'updated_at', 'status_changed_at'];
  v_merge_extra text[] := array['client_id', 'payer_client_id'];
  v_vehicle_merge_extra text[] := array['vehicle_id'];
  v_cols text[];
begin
  if old.closed_at is null then
    return new;
  end if;

  if coalesce(public.crm_owner_may_manage_closed_orders(new.workspace_id), false) then
    return new;
  end if;

  -- Closed-then-cancelled: actual owner may edit business fields on THIS order.
  if new.status is not distinct from 'cancelled'
     and coalesce(public.crm_owner_may_edit_cancelled_order(new.id), false) then
    return new;
  end if;

  -- Transaction-local client merge: only client FK (+ lifecycle allowlist) may change.
  if coalesce(current_setting('crm.client_merge', true), '') = 'on' then
    v_cols := v_allowed || v_merge_extra;
    if (to_jsonb(new) - v_cols) is distinct from (to_jsonb(old) - v_cols) then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Transaction-local vehicle merge: only vehicle_id (+ lifecycle allowlist) may change.
  if coalesce(current_setting('crm.vehicle_merge', true), '') = 'on' then
    v_cols := v_allowed || v_vehicle_merge_extra;
    if (to_jsonb(new) - v_cols) is distinct from (to_jsonb(old) - v_cols) then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.orders_closed_content_guard() is
  'managed-object: core-app/orders_closed_content_guard@v4 — closed content mutable for manage-closed OR cancelled+owner OR crm.client_merge=on (client_id/payer_client_id only) OR crm.vehicle_merge=on (vehicle_id only).';

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------
create or replace function public.crm_merge_vehicles(
  p_target_vehicle_id uuid,
  p_source_vehicle_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_target public.vehicles%rowtype;
  v_src public.vehicles%rowtype;
  v_sources uuid[];
  v_locked integer;
  v_row record;
  v_uq record;
  v_moved_orders bigint := 0;
  v_id_attnum smallint;
begin
  if v_uid is null then
    raise exception 'merge_vehicles:not_authenticated' using errcode = '42501';
  end if;
  if p_target_vehicle_id is null then
    raise exception 'merge_vehicles:invalid_args' using errcode = '22023';
  end if;

  select * into v_target from public.vehicles v
  where v.id = p_target_vehicle_id and v.deleted_at is null
  for update;
  if not found then
    raise exception 'merge_vehicles:target_not_found' using errcode = 'P0002';
  end if;

  if not coalesce(public.is_workspace_member(v_target.workspace_id), false)
     or not coalesce(public.crm_has_permission(v_target.workspace_id, 'orders.edit'), false) then
    raise exception 'merge_vehicles:forbidden' using errcode = '42501';
  end if;

  v_sources := array(
    select distinct x from unnest(coalesce(p_source_vehicle_ids, array[]::uuid[])) as x
    where x is not null and x is distinct from p_target_vehicle_id
  );
  if coalesce(cardinality(v_sources), 0) < 1 then
    raise exception 'merge_vehicles:sources_required' using errcode = '22023';
  end if;

  -- Only duplicates of ONE client are merged (orders stay consistent with their client).
  perform 1 from public.vehicles v
  where v.id = any(v_sources)
    and v.workspace_id = v_target.workspace_id
    and v.client_id = v_target.client_id
    and v.deleted_at is null
  for update;
  select count(*) into v_locked from public.vehicles v
  where v.id = any(v_sources)
    and v.workspace_id = v_target.workspace_id
    and v.client_id = v_target.client_id
    and v.deleted_at is null;
  if v_locked <> cardinality(v_sources) then
    raise exception 'merge_vehicles:source_not_found' using errcode = 'P0002';
  end if;

  select att.attnum into v_id_attnum from pg_attribute att
  where att.attrelid = 'public.vehicles'::regclass and att.attname = 'id';

  -- Fail closed on UNIQUE constraints that include a vehicles FK column.
  for v_uq in
    select rel.relname as table_name, c.conname as constraint_name
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where c.contype = 'u'
      and n.nspname = 'public'
      and rel.relname <> 'vehicles'
      and exists (
        select 1 from pg_constraint fk
        join lateral unnest(fk.conkey) as fkatt(attnum) on true
        where fk.conrelid = c.conrelid
          and fk.contype = 'f'
          and fk.confrelid = 'public.vehicles'::regclass
          and fkatt.attnum = any (c.conkey)
      )
  loop
    raise exception 'merge_vehicles:unhandled_unique:%.%', v_uq.table_name, v_uq.constraint_name using errcode = '0A000';
  end loop;

  select count(*) into v_moved_orders from public.orders o
  where o.workspace_id = v_target.workspace_id and o.vehicle_id = any(v_sources);

  perform set_config('crm.vehicle_merge', 'on', true);

  for v_row in
    select rel.relname as table_name, a.attname as column_name
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join lateral unnest(c.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confrelid = 'public.vehicles'::regclass
      and rel.relkind = 'r'
      and c.confkey[ck.ord] = v_id_attnum
    order by case when rel.relname = 'orders' then 0 else 1 end, rel.relname, a.attname
  loop
    execute format('update public.%I set %I = $1 where %I = any($2)', v_row.table_name, v_row.column_name, v_row.column_name)
      using p_target_vehicle_id, v_sources;
  end loop;

  perform set_config('crm.vehicle_merge', 'off', true);

  -- Fill empty fields of the kept vehicle from the duplicates (oldest first).
  for v_src in
    select * from public.vehicles v where v.id = any(v_sources) order by v.created_at
  loop
    v_target.make := coalesce(nullif(btrim(v_target.make), ''), nullif(btrim(v_src.make), ''));
    v_target.model := coalesce(nullif(btrim(v_target.model), ''), nullif(btrim(v_src.model), ''));
    v_target.year := coalesce(v_target.year, v_src.year);
    v_target.vin := coalesce(nullif(btrim(v_target.vin), ''), nullif(btrim(v_src.vin), ''));
    v_target.license_plate := coalesce(nullif(btrim(v_target.license_plate), ''), nullif(btrim(v_src.license_plate), ''));
    v_target.engine_displacement := coalesce(v_target.engine_displacement, v_src.engine_displacement);
    v_target.fuel_type := coalesce(nullif(btrim(v_target.fuel_type), ''), nullif(btrim(v_src.fuel_type), ''));
    v_target.mileage_unit := coalesce(v_target.mileage_unit, v_src.mileage_unit);
    v_target.initial_mileage := case
      when v_target.initial_mileage is null then v_src.initial_mileage
      when v_src.initial_mileage is null then v_target.initial_mileage
      else least(v_target.initial_mileage, v_src.initial_mileage) end;
    v_target.current_mileage := case
      when v_target.current_mileage is null then v_src.current_mileage
      when v_src.current_mileage is null then v_target.current_mileage
      else greatest(v_target.current_mileage, v_src.current_mileage) end;
  end loop;

  update public.vehicles
  set deleted_at = now(), updated_at = now()
  where id = any(v_sources);

  update public.vehicles
  set make = v_target.make,
      model = v_target.model,
      year = v_target.year,
      vin = v_target.vin,
      license_plate = v_target.license_plate,
      engine_displacement = v_target.engine_displacement,
      fuel_type = v_target.fuel_type,
      mileage_unit = v_target.mileage_unit,
      initial_mileage = v_target.initial_mileage,
      current_mileage = v_target.current_mileage,
      updated_at = now()
  where id = p_target_vehicle_id
  returning * into v_target;

  begin
    insert into public.activity_log (workspace_id, actor_user_id, actor_name, entity_type, entity_id, event, details)
    values (
      v_target.workspace_id, v_uid, null, 'vehicle', p_target_vehicle_id, 'vehicles_merged',
      jsonb_build_object('targetVehicleId', p_target_vehicle_id, 'sourceVehicleIds', to_jsonb(v_sources), 'movedOrders', v_moved_orders)
    );
  exception when others then
    null; -- the audit row is best-effort; the merge itself must not fail on it
  end;

  return jsonb_build_object(
    'vehicle', to_jsonb(v_target),
    'merged', cardinality(v_sources),
    'moved_orders', v_moved_orders
  );
end;
$fn$;

revoke all on function public.crm_merge_vehicles(uuid, uuid[]) from public, anon;
grant execute on function public.crm_merge_vehicles(uuid, uuid[]) to authenticated, service_role;

comment on function public.crm_merge_vehicles(uuid, uuid[]) is
  'managed-object: core-app/crm_merge_vehicles@v1 — merge duplicate vehicles of one client; re-points all vehicle FKs; soft-deletes sources.';

notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.crm_merge_vehicles(uuid,uuid[])') is null then
    raise exception 'merge_vehicles postflight: function missing';
  end if;
  if position('crm.vehicle_merge' in pg_get_functiondef('public.orders_closed_content_guard()'::regprocedure)) = 0 then
    raise exception 'merge_vehicles postflight: guard @v4 not installed';
  end if;
end;
$postflight$;

commit;
