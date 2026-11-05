-- =============================================================================
-- Core App — Complete owner manage-closed-orders enforcement (MAIN — manual)
-- Script: 20261105180000_owner_manage_closed_orders_complete.PRODUCTION.sql
-- =============================================================================
-- Prerequisite already applied: 20261105170000_owner_manage_closed_orders
--   • workspaces.owner_can_manage_closed_orders
--   • crm_owner_may_manage_closed_orders(uuid)
--   • order_lifecycle_guard owner-manage Rule 2 bypass
--   • apply_order_material_warranties closed gate
--
-- This script does NOT recreate those objects. It closes remaining gaps:
--   1) cancel/delete closed: owner requires setting (not bare owner_id)
--   2) set_order_lifecycle_regular_custom_status: closed_at requires setting
--   3) content guards: orders / order_services / order_materials when closed
--
-- Role grants orders.cancel_closed / orders.delete_closed for admin/manager/member
-- remain independent. Non-owners never receive the owner-manage override.
--
-- Does NOT execute remotely. Review, then run on MAIN only.
-- Idempotent where practical.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.workspaces') is null then
    v_problems := v_problems || 'workspaces missing; ';
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'owner_can_manage_closed_orders'
  ) then
    v_problems := v_problems || 'owner_can_manage_closed_orders missing (apply 20261105170000 first); ';
  end if;

  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id missing; ';
  end if;
  if to_regprocedure('public.crm_has_closed_order_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_closed_order_permission missing; ';
  end if;
  if to_regprocedure('public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)') is null then
    v_problems := v_problems || 'set_order_lifecycle_regular_custom_status missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.order_services') is null then
    v_problems := v_problems || 'order_services missing; ';
  end if;
  if to_regclass('public.order_materials') is null then
    v_problems := v_problems || 'order_materials missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'owner_manage_closed_orders_complete preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Shared assert helper
-- ---------------------------------------------------------------------------
create or replace function public.crm_assert_closed_order_mutable(
  p_workspace_id uuid,
  p_closed_at timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if p_closed_at is null then
    return;
  end if;
  if coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false) then
    return;
  end if;
  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

revoke all on function public.crm_assert_closed_order_mutable(uuid, timestamptz) from public, anon;
grant execute on function public.crm_assert_closed_order_mutable(uuid, timestamptz) to authenticated, service_role;

comment on function public.crm_assert_closed_order_mutable(uuid, timestamptz) is
  'managed-object: core-app/crm_assert_closed_order_mutable@v1 — raises closed_order_immutable unless closed_at is null or crm_owner_may_manage_closed_orders.';

-- ---------------------------------------------------------------------------
-- 2) cancel/delete closed: owner needs setting (role grants unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.crm_has_closed_order_permission(
  p_workspace_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    -- Owner override only when owner_can_manage_closed_orders is enabled.
    coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false)
    or (
      p_permission in ('orders.cancel_closed', 'orders.delete_closed')
      and exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        join public.workspace_role_permission_grants g
          on g.workspace_id = wm.workspace_id
         and g.permission = p_permission
         and g.workspace_role = wm.role
        where wm.workspace_id = p_workspace_id
          and wm.user_id = auth.uid()
          and wm.deleted_at is null
          and w.deleted_at is null
          and wm.role in ('admin', 'manager', 'member')
      )
    );
$fn$;

revoke all on function public.crm_has_closed_order_permission(uuid, text) from public, anon;
grant execute on function public.crm_has_closed_order_permission(uuid, text) to authenticated, service_role;

comment on function public.crm_has_closed_order_permission(uuid, text) is
  'managed-object: core-app/crm_has_closed_order_permission@v2 — owner via crm_owner_may_manage_closed_orders; else admin/manager/member role grants.';

-- ---------------------------------------------------------------------------
-- 3) Owner regular custom status on closed rows requires setting
-- ---------------------------------------------------------------------------
create or replace function public.set_order_lifecycle_regular_custom_status(
  p_workspace_id uuid,
  p_order_id uuid,
  p_custom_status_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_target public.status_definitions%rowtype;
  v_need_replace_token boolean := false;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_order_id is null or p_custom_status_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  -- Formally closed: owner + setting. Cancelled-without-close: bare owner_id (unchanged).
  if v_order.closed_at is not null then
    if not coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false) then
      raise exception 'order_lifecycle:forbidden' using errcode = '42501';
    end if;
  elsif not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if v_order.closed_at is null
     and v_order.status is distinct from 'closed'
     and v_order.status is distinct from 'cancelled' then
    raise exception 'order_lifecycle:not_lifecycle_order' using errcode = 'P0001';
  end if;

  select * into v_target
  from public.status_definitions d
  where d.id = p_custom_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.is_active
    and d.deleted_at is null;

  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  if v_target.semantic_action is distinct from 'normal' then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
  end if;

  if v_target.system_status in ('closed', 'cancelled') then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
  end if;

  if v_order.custom_status_id is not distinct from p_custom_status_id then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'status', v_order.status,
      'closed_at', v_order.closed_at,
      'custom_status_id', v_order.custom_status_id
    );
  end if;

  v_need_replace_token := v_order.closed_at is not null;
  if v_need_replace_token then
    insert into public.order_lifecycle_tokens (order_id, op, created_by)
    values (v_order.id, 'replace', v_uid)
    on conflict (order_id, op) do update
      set created_by = excluded.created_by,
          created_at = now();
  end if;

  begin
    update public.orders o
       set custom_status_id = p_custom_status_id
     where o.id = v_order.id
       and o.workspace_id = p_workspace_id
       and o.status is not distinct from v_order.status
       and o.closed_at is not distinct from v_order.closed_at;

    if not found then
      raise exception 'order_lifecycle:update_failed' using errcode = 'P0001';
    end if;
  exception
    when others then
      if v_need_replace_token then
        delete from public.order_lifecycle_tokens
        where order_id = v_order.id and op = 'replace';
      end if;
      raise;
  end;

  if v_need_replace_token then
    delete from public.order_lifecycle_tokens
    where order_id = v_order.id and op = 'replace';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', v_order.id,
    'status', v_order.status,
    'closed_at', v_order.closed_at,
    'custom_status_id', p_custom_status_id
  );
end;
$fn$;

revoke all on function public.set_order_lifecycle_regular_custom_status(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_order_lifecycle_regular_custom_status(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.set_order_lifecycle_regular_custom_status(uuid, uuid, uuid) is
  'managed-object: core-app/set_order_lifecycle_regular_custom_status@v2 — closed_at requires crm_owner_may_manage_closed_orders; cancelled-without-close keeps owner_id.';

-- ---------------------------------------------------------------------------
-- 4) Orders content guard — block non-lifecycle field changes when closed
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

  -- Reject any non-lifecycle business column change. Lifecycle RPCs may still
  -- update status / custom_status_id / closed_at (enforced by order_lifecycle_guard).
  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists orders_closed_content_guard_bu on public.orders;
create trigger orders_closed_content_guard_bu
  before update on public.orders
  for each row
  when (old.closed_at is not null)
  execute function public.orders_closed_content_guard();

revoke all on function public.orders_closed_content_guard() from public, anon, authenticated;
grant execute on function public.orders_closed_content_guard() to service_role;

comment on function public.orders_closed_content_guard() is
  'managed-object: core-app/orders_closed_content_guard@v1 — blocks non-lifecycle column updates on closed orders unless crm_owner_may_manage_closed_orders.';

-- ---------------------------------------------------------------------------
-- 5) order_services closed guard
-- ---------------------------------------------------------------------------
create or replace function public.order_services_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_closed_at timestamptz;
  v_order_id uuid;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id, o.closed_at into v_ws, v_closed_at
  from public.orders o
  where o.id = v_order_id;

  if not found or v_closed_at is null then
    return coalesce(new, old);
  end if;

  if coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false) then
    return coalesce(new, old);
  end if;

  -- Order teardown (cancelled+closed delete) may CASCADE-delete service lines.
  if tg_op = 'DELETE'
     and coalesce(public.crm_has_closed_order_permission(v_ws, 'orders.delete_closed'), false) then
    return old;
  end if;

  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

drop trigger if exists order_services_closed_guard_biud on public.order_services;
create trigger order_services_closed_guard_biud
  before insert or update or delete on public.order_services
  for each row
  execute function public.order_services_closed_guard();

revoke all on function public.order_services_closed_guard() from public, anon, authenticated;
grant execute on function public.order_services_closed_guard() to service_role;

comment on function public.order_services_closed_guard() is
  'managed-object: core-app/order_services_closed_guard@v1 — blocks service line mutations on closed orders unless owner manage setting.';

-- ---------------------------------------------------------------------------
-- 6) order_materials closed guard
--     • Full mutations: owner manage only
--     • quantity_returned-only UPDATE: owner manage OR delete_closed (delete/return path)
--     • quantity_issued-only UPDATE: owner manage only (issue is a manage op)
--     • DELETE: owner manage OR delete_closed (order teardown)
-- ---------------------------------------------------------------------------
create or replace function public.order_materials_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_closed_at timestamptz;
  v_order_id uuid;
  v_owner_manage boolean;
  v_delete_closed boolean;
  v_return_only boolean;
  v_issue_only boolean;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id, o.closed_at into v_ws, v_closed_at
  from public.orders o
  where o.id = v_order_id;

  if not found or v_closed_at is null then
    return coalesce(new, old);
  end if;

  v_owner_manage := coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false);
  if v_owner_manage then
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

    -- Return path during safe delete of cancelled+closed orders.
    if v_return_only and v_delete_closed then
      return new;
    end if;

    -- Issue on closed orders is owner-manage only (already failed above).
    if v_issue_only then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

drop trigger if exists order_materials_closed_guard_biud on public.order_materials;
create trigger order_materials_closed_guard_biud
  before insert or update or delete on public.order_materials
  for each row
  execute function public.order_materials_closed_guard();

revoke all on function public.order_materials_closed_guard() from public, anon, authenticated;
grant execute on function public.order_materials_closed_guard() to service_role;

comment on function public.order_materials_closed_guard() is
  'managed-object: core-app/order_materials_closed_guard@v1 — closed materials mutations require owner manage; return/delete teardown may use delete_closed.';

-- ---------------------------------------------------------------------------
-- 7) Postflight
-- ---------------------------------------------------------------------------
do $post$
declare
  v_problems text := '';
  v_def text;
begin
  select pg_get_functiondef('public.crm_has_closed_order_permission(uuid,text)'::regprocedure) into v_def;
  if position('crm_owner_may_manage_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'crm_has_closed_order_permission missing owner-manage gate; ';
  end if;
  if position('crm_is_workspace_owner_id' in v_def) > 0 then
    v_problems := v_problems || 'crm_has_closed_order_permission still uses bare owner_id; ';
  end if;

  select pg_get_functiondef('public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)'::regprocedure) into v_def;
  if position('crm_owner_may_manage_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'set_order_lifecycle_regular_custom_status missing owner-manage gate; ';
  end if;

  if to_regprocedure('public.crm_assert_closed_order_mutable(uuid,timestamptz)') is null then
    v_problems := v_problems || 'crm_assert_closed_order_mutable missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'orders' and t.tgname = 'orders_closed_content_guard_bu'
  ) then
    v_problems := v_problems || 'orders_closed_content_guard_bu missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_services' and t.tgname = 'order_services_closed_guard_biud'
  ) then
    v_problems := v_problems || 'order_services_closed_guard_biud missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_materials' and t.tgname = 'order_materials_closed_guard_biud'
  ) then
    v_problems := v_problems || 'order_materials_closed_guard_biud missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'owner_manage_closed_orders_complete postflight failed: %', v_problems;
  end if;
end;
$post$;

commit;
