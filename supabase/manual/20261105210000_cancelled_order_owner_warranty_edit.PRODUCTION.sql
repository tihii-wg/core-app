-- =============================================================================
-- Cancelled-order owner warranty line edits (MAIN only — do NOT run on TEST)
-- =============================================================================
-- Problem:
--   After close, activate_order_warranties creates warranty_records with
--   activated_on_close = true. FKs order_material_id / order_service_id are
--   ON DELETE SET NULL. Removing a covered line UPDATEs those FKs to NULL,
--   which trg_warranty_records_snapshot_immutable rejects with
--   warranty_records:snapshot_immutable.
--
-- Fix (narrow):
--   1) crm_owner_may_edit_cancelled_order(order_id) — true only when
--      workspaces.owner_id = auth.uid() AND that order.status = 'cancelled'
--      in the same workspace. Never trusts client flags. Independent of
--      owner_can_manage_closed_orders (ordinary closed orders unchanged).
--   2) Allow SET NULL of order_material_id / order_service_id on activated
--      snapshots ONLY under that helper, when no other snapshot fields change.
--      Historical dates / mileage / duration / order_id stay immutable.
--   3) Line/content guards allow the same cancelled+owner path so materials
--      and services can be removed/replaced after cancel.
--   4) apply_order_material_warranties may write NEW line warranty_* fields
--      on cancelled+owner (activated warranty_records remain untouched).
--
-- Does NOT:
--   • drop snapshot_immutable
--   • rewrite historical warranty terms
--   • delete warranty_records on line removal
--   • reuse old warranty record IDs for new lines
--   • unlock ordinary closed (status=closed) orders without the manage setting
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'warranty_records missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.workspaces') is null then
    v_problems := v_problems || 'workspaces missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders(uuid) missing; ';
  end if;
  if to_regprocedure('public.warranty_records_reject_snapshot_mutation()') is null then
    v_problems := v_problems || 'warranty_records_reject_snapshot_mutation missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'cancelled_order_owner_warranty_edit preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Authorization helper — cancelled order + workspace owner_id only
-- ---------------------------------------------------------------------------
create or replace function public.crm_owner_may_edit_cancelled_order(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_status text;
begin
  if v_uid is null or p_order_id is null then
    return false;
  end if;

  select o.workspace_id, o.status
    into v_ws, v_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return false;
  end if;

  if v_status is distinct from 'cancelled' then
    return false;
  end if;

  -- Actual owner_id only — never membership role "owner", admin, manager, member.
  return coalesce(public.crm_is_workspace_owner_id(v_ws), false);
end;
$fn$;

revoke all on function public.crm_owner_may_edit_cancelled_order(uuid) from public, anon;
grant execute on function public.crm_owner_may_edit_cancelled_order(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_edit_cancelled_order(uuid) is
  'managed-object: core-app/crm_owner_may_edit_cancelled_order@v1 — true only when auth.uid() is workspaces.owner_id and the order status is cancelled. Independent of owner_can_manage_closed_orders.';

-- ---------------------------------------------------------------------------
-- 2) Snapshot immutability — allow FK unlink (SET NULL) on cancelled+owner
-- ---------------------------------------------------------------------------
create or replace function public.warranty_records_reject_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_terms_changed boolean;
  v_service_relink boolean;
  v_material_relink boolean;
  v_service_unlink boolean;
  v_material_unlink boolean;
begin
  if tg_op <> 'UPDATE' or not coalesce(old.activated_on_close, false) then
    return new;
  end if;

  v_terms_changed :=
       old.starts_at is distinct from new.starts_at
    or old.starts_on is distinct from new.starts_on
    or old.ends_on is distinct from new.ends_on
    or old.start_mileage is distinct from new.start_mileage
    or old.expires_at_mileage is distinct from new.expires_at_mileage
    or old.duration_months is distinct from new.duration_months
    or old.duration_days is distinct from new.duration_days
    or old.mileage_limit is distinct from new.mileage_limit
    or old.order_id is distinct from new.order_id
    or old.workspace_id is distinct from new.workspace_id;

  -- Retargeting a snapshot to a different live line is never allowed.
  v_service_relink :=
    old.order_service_id is distinct from new.order_service_id
    and new.order_service_id is not null;
  v_material_relink :=
    old.order_material_id is distinct from new.order_material_id
    and new.order_material_id is not null;

  if v_terms_changed or v_service_relink or v_material_relink then
    raise exception 'warranty_records:snapshot_immutable'
      using errcode = 'P0001',
            hint = 'Activated warranty snapshots cannot be rewritten.';
  end if;

  v_service_unlink :=
    old.order_service_id is not null
    and new.order_service_id is null
    and old.order_service_id is distinct from new.order_service_id;
  v_material_unlink :=
    old.order_material_id is not null
    and new.order_material_id is null
    and old.order_material_id is distinct from new.order_material_id;

  if v_service_unlink or v_material_unlink then
    -- Parent line DELETE → ON DELETE SET NULL. Preserve the historical row;
    -- only the cancelled order's workspace owner may complete the unlink.
    if coalesce(public.crm_owner_may_edit_cancelled_order(old.order_id), false) then
      return new;
    end if;
    raise exception 'warranty_records:snapshot_immutable'
      using errcode = 'P0001',
            hint = 'Activated warranty snapshots cannot be rewritten.';
  end if;

  return new;
end;
$fn$;

comment on function public.warranty_records_reject_snapshot_mutation() is
  'managed-object: core-app/warranty_records_reject_snapshot_mutation@v2 — freeze activated snapshot terms; allow order_material_id/order_service_id SET NULL only for cancelled-order workspace owner.';

-- Trigger already exists; recreate to bind the replaced function body.
drop trigger if exists trg_warranty_records_snapshot_immutable on public.warranty_records;
create trigger trg_warranty_records_snapshot_immutable
  before update on public.warranty_records
  for each row
  execute function public.warranty_records_reject_snapshot_mutation();

-- ---------------------------------------------------------------------------
-- 3) Closed content / line guards — cancelled+owner may mutate
-- ---------------------------------------------------------------------------
create or replace function public.orders_closed_content_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_allowed text[] := array['status', 'custom_status_id', 'closed_at', 'updated_at', 'status_changed_at'];
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

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.orders_closed_content_guard() is
  'managed-object: core-app/orders_closed_content_guard@v2 — closed content mutable for crm_owner_may_manage_closed_orders OR cancelled+owner_id.';

create or replace function public.order_services_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_closed_at timestamptz;
  v_status text;
  v_order_id uuid;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id, o.closed_at, o.status into v_ws, v_closed_at, v_status
  from public.orders o
  where o.id = v_order_id;

  if not found or v_closed_at is null then
    return coalesce(new, old);
  end if;

  if coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false) then
    return coalesce(new, old);
  end if;

  if v_status is not distinct from 'cancelled'
     and coalesce(public.crm_owner_may_edit_cancelled_order(v_order_id), false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE'
     and coalesce(public.crm_has_closed_order_permission(v_ws, 'orders.delete_closed'), false) then
    return old;
  end if;

  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

comment on function public.order_services_closed_guard() is
  'managed-object: core-app/order_services_closed_guard@v2 — closed service lines: owner manage setting, or cancelled+owner_id, or delete_closed teardown.';

create or replace function public.order_materials_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_closed_at timestamptz;
  v_status text;
  v_order_id uuid;
  v_owner_manage boolean;
  v_delete_closed boolean;
  v_return_only boolean;
  v_issue_only boolean;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id, o.closed_at, o.status into v_ws, v_closed_at, v_status
  from public.orders o
  where o.id = v_order_id;

  if not found or v_closed_at is null then
    return coalesce(new, old);
  end if;

  v_owner_manage := coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false);
  if v_owner_manage then
    return coalesce(new, old);
  end if;

  if v_status is not distinct from 'cancelled'
     and coalesce(public.crm_owner_may_edit_cancelled_order(v_order_id), false) then
    return coalesce(new, old);
  end if;

  v_delete_closed := coalesce(public.crm_has_closed_order_permission(v_ws, 'orders.delete_closed'), false);

  if tg_op = 'DELETE' then
    if v_delete_closed then
      return old;
    end if;
    raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    v_return_only :=
         new.quantity_returned is distinct from old.quantity_returned
     and new.quantity_issued is not distinct from old.quantity_issued
     and new.quantity is not distinct from old.quantity
     and new.price is not distinct from old.price
     and new.item_name is not distinct from old.item_name
     and new.inventory_item_id is not distinct from old.inventory_item_id
     and new.supply_source is not distinct from old.supply_source
     and new.warranty_months is not distinct from old.warranty_months
     and new.warranty_days is not distinct from old.warranty_days
     and new.warranty_km is not distinct from old.warranty_km;

    v_issue_only :=
         new.quantity_issued is distinct from old.quantity_issued
     and new.quantity_returned is not distinct from old.quantity_returned
     and new.quantity is not distinct from old.quantity
     and new.price is not distinct from old.price
     and new.item_name is not distinct from old.item_name
     and new.inventory_item_id is not distinct from old.inventory_item_id
     and new.supply_source is not distinct from old.supply_source
     and new.warranty_months is not distinct from old.warranty_months
     and new.warranty_days is not distinct from old.warranty_days
     and new.warranty_km is not distinct from old.warranty_km;

    if v_return_only and v_delete_closed then
      return new;
    end if;

    if v_issue_only then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

comment on function public.order_materials_closed_guard() is
  'managed-object: core-app/order_materials_closed_guard@v2 — closed materials: owner manage setting, or cancelled+owner_id; return/delete teardown may use delete_closed.';

-- ---------------------------------------------------------------------------
-- 4) apply_order_material_warranties — allow line warranty writes on cancelled+owner
-- ---------------------------------------------------------------------------
create or replace function public.apply_order_material_warranties(
  p_order_id uuid,
  p_workspace_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_elem jsonb;
  v_line_id uuid;
  v_item_id uuid;
  v_months integer;
  v_days integer;
  v_km integer;
  v_updated integer := 0;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'order_warranty:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_warranty:invalid_args' using errcode = '22023';
  end if;
  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false) then
    raise exception 'order_warranty:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_warranty:order_not_found' using errcode = 'P0002';
  end if;

  -- After formal close: owner manage setting OR cancelled+owner_id may rewrite
  -- order_materials.warranty_* snapshots. Activated warranty_records stay untouched.
  if v_order.closed_at is not null
     and not coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false)
     and not (
       v_order.status is not distinct from 'cancelled'
       and coalesce(public.crm_owner_may_edit_cancelled_order(p_order_id), false)
     ) then
    return 0;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    return 0;
  end if;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id := null;
    v_item_id := null;
    begin
      if (v_elem ? 'line_id') and jsonb_typeof(v_elem -> 'line_id') = 'string' then
        v_line_id := nullif(trim(v_elem ->> 'line_id'), '')::uuid;
      end if;
      if (v_elem ? 'inventory_item_id') and jsonb_typeof(v_elem -> 'inventory_item_id') = 'string' then
        v_item_id := nullif(trim(v_elem ->> 'inventory_item_id'), '')::uuid;
      end if;
    exception when others then
      raise exception 'order_warranty:invalid_line_ref' using errcode = '22P02';
    end;

    v_months := null;
    v_days := null;
    v_km := null;
    if (v_elem ? 'warranty_months') and jsonb_typeof(v_elem -> 'warranty_months') = 'number' then
      v_months := trunc((v_elem ->> 'warranty_months')::numeric)::integer;
      if v_months is not null and v_months <= 0 then v_months := null; end if;
    end if;
    if (v_elem ? 'warranty_days') and jsonb_typeof(v_elem -> 'warranty_days') = 'number' then
      v_days := trunc((v_elem ->> 'warranty_days')::numeric)::integer;
      if v_days is not null and v_days <= 0 then v_days := null; end if;
    end if;
    if (v_elem ? 'warranty_km') and jsonb_typeof(v_elem -> 'warranty_km') = 'number' then
      v_km := trunc((v_elem ->> 'warranty_km')::numeric)::integer;
      if v_km is not null and v_km <= 0 then v_km := null; end if;
    end if;
    if (v_elem ? 'warranty_months') and jsonb_typeof(v_elem -> 'warranty_months') = 'null' then
      v_months := null;
    end if;
    if (v_elem ? 'warranty_days') and jsonb_typeof(v_elem -> 'warranty_days') = 'null' then
      v_days := null;
    end if;
    if (v_elem ? 'warranty_km') and jsonb_typeof(v_elem -> 'warranty_km') = 'null' then
      v_km := null;
    end if;

    if v_line_id is not null then
      update public.order_materials m
         set warranty_months = v_months,
             warranty_days = v_days,
             warranty_km = v_km
       where m.id = v_line_id
         and m.order_id = p_order_id;
    elsif v_item_id is not null then
      update public.order_materials m
         set warranty_months = v_months,
             warranty_days = v_days,
             warranty_km = v_km
       where m.order_id = p_order_id
         and m.inventory_item_id = v_item_id;
    else
      continue;
    end if;

    get diagnostics v_n = row_count;
    v_updated := v_updated + v_n;
  end loop;

  return v_updated;
end;
$fn$;

comment on function public.apply_order_material_warranties(uuid, uuid, jsonb) is
  'managed-object: core-app/apply_order_material_warranties@v3 — line warranty_* writes; after close requires owner manage setting or cancelled+owner_id; never mutates warranty_records.';

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
declare
  v_problems text := '';
  v_def text;
begin
  if to_regprocedure('public.crm_owner_may_edit_cancelled_order(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order missing; ';
  end if;

  select pg_get_functiondef('public.warranty_records_reject_snapshot_mutation()'::regprocedure) into v_def;
  if position('crm_owner_may_edit_cancelled_order' in v_def) = 0 then
    v_problems := v_problems || 'snapshot trigger missing cancelled-owner unlink path; ';
  end if;
  if position('snapshot_immutable' in v_def) = 0 then
    v_problems := v_problems || 'snapshot_immutable raise missing; ';
  end if;

  select pg_get_functiondef('public.order_materials_closed_guard()'::regprocedure) into v_def;
  if position('crm_owner_may_edit_cancelled_order' in v_def) = 0 then
    v_problems := v_problems || 'order_materials_closed_guard missing cancelled-owner path; ';
  end if;

  select pg_get_functiondef('public.order_services_closed_guard()'::regprocedure) into v_def;
  if position('crm_owner_may_edit_cancelled_order' in v_def) = 0 then
    v_problems := v_problems || 'order_services_closed_guard missing cancelled-owner path; ';
  end if;

  select pg_get_functiondef('public.apply_order_material_warranties(uuid,uuid,jsonb)'::regprocedure) into v_def;
  if position('crm_owner_may_edit_cancelled_order' in v_def) = 0 then
    v_problems := v_problems || 'apply_order_material_warranties missing cancelled-owner path; ';
  end if;

  -- owner_can_manage_closed_orders helper must remain intact and separate.
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders was removed; ';
  end if;

  if v_problems <> '' then
    raise exception 'cancelled_order_owner_warranty_edit postflight failed: %', v_problems;
  end if;
end;
$postflight$;

-- Manual verification (read-only):
-- select proname from pg_proc where proname in (
--   'crm_owner_may_edit_cancelled_order',
--   'warranty_records_reject_snapshot_mutation',
--   'order_materials_closed_guard',
--   'order_services_closed_guard'
-- );
-- -- After apply: cancel a closed warranty order as owner_id, delete a covered
-- -- order_materials row, confirm warranty_records row remains with
-- -- order_material_id IS NULL and unchanged starts_at/ends_on/mileage.
