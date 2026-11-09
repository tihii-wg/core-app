-- =============================================================================
-- Guard custom_field_values for closed orders + supporting index
-- Script: 20261110100000_order_custom_field_values_guard.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: custom_field_definitions / custom_field_values (crm_ro_v1),
--                crm_owner_may_manage_closed_orders, crm_owner_may_edit_cancelled_order.
-- =============================================================================
-- For definitions with entity='order', block INSERT/UPDATE/DELETE on
-- custom_field_values when the target order is closed — same bypass rules as
-- orders_closed_content_guard: crm_owner_may_manage_closed_orders OR
-- cancelled + crm_owner_may_edit_cancelled_order. Also require
-- custom_field_values.workspace_id = orders.workspace_id.
-- Non-order entities are left untouched.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.custom_field_values') is null then
    v_problems := v_problems || 'public.custom_field_values missing; ';
  end if;
  if to_regclass('public.custom_field_definitions') is null then
    v_problems := v_problems || 'public.custom_field_definitions missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'public.orders missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders missing; ';
  end if;
  if to_regprocedure('public.crm_owner_may_edit_cancelled_order(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_edit_cancelled_order missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'closed_at'
  ) then
    v_problems := v_problems || 'orders.closed_at missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'order_custom_field_values_guard preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- Supporting index for workspace + definition lookups (search / export)
create index if not exists custom_field_values_workspace_definition_idx
  on public.custom_field_values (workspace_id, definition_id);

create or replace function public.custom_field_values_order_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_def_id uuid;
  v_entity text;
  v_entity_id uuid;
  v_ws uuid;
  v_row_ws uuid;
  v_def_ws uuid;
  v_closed_at timestamptz;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_def_id := old.definition_id;
    v_entity_id := old.entity_id;
    v_row_ws := old.workspace_id;
  else
    v_def_id := new.definition_id;
    v_entity_id := new.entity_id;
    v_row_ws := new.workspace_id;
  end if;

  select d.entity, d.workspace_id into v_entity, v_def_ws
  from public.custom_field_definitions d
  where d.id = v_def_id;

  -- Missing definition or non-order entity → allow (FK / other entities)
  if v_entity is null or v_entity <> 'order' then
    return coalesce(new, old);
  end if;

  -- The definition must belong to the same workspace as the value row.
  if tg_op <> 'DELETE' and v_def_ws is distinct from v_row_ws then
    raise exception 'custom_field_values:workspace_mismatch' using errcode = '42501';
  end if;

  select o.workspace_id, o.closed_at, o.status
    into v_ws, v_closed_at, v_status
  from public.orders o
  where o.id = v_entity_id;

  if not found then
    -- Orphan cleanup after the order was deleted is allowed.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'custom_field_values:order_not_found' using errcode = 'P0001';
  end if;

  if v_row_ws is distinct from v_ws then
    raise exception 'custom_field_values:workspace_mismatch' using errcode = '42501';
  end if;

  if v_closed_at is null then
    return coalesce(new, old);
  end if;

  if coalesce(public.crm_owner_may_manage_closed_orders(v_ws), false) then
    return coalesce(new, old);
  end if;

  if v_status = 'cancelled'
     and coalesce(public.crm_owner_may_edit_cancelled_order(v_entity_id), false) then
    return coalesce(new, old);
  end if;

  raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
end;
$fn$;

drop trigger if exists custom_field_values_order_closed_guard_biud on public.custom_field_values;
create trigger custom_field_values_order_closed_guard_biud
  before insert or update or delete on public.custom_field_values
  for each row
  execute function public.custom_field_values_order_closed_guard();

revoke all on function public.custom_field_values_order_closed_guard() from public, anon, authenticated;
grant execute on function public.custom_field_values_order_closed_guard() to service_role;

comment on function public.custom_field_values_order_closed_guard() is
  'managed-object: core-app/custom_field_values_order_closed_guard@v1 — blocks order custom_field_values mutations when order is closed unless manage-closed or cancelled+owner; enforces workspace match.';

do $postflight$
declare
  v_problems text := '';
  v_def text;
begin
  if to_regprocedure('public.custom_field_values_order_closed_guard()') is null then
    v_problems := v_problems || 'custom_field_values_order_closed_guard missing; ';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'custom_field_values'
      and t.tgname = 'custom_field_values_order_closed_guard_biud'
      and not t.tgisinternal
  ) then
    v_problems := v_problems || 'custom_field_values_order_closed_guard_biud missing; ';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'custom_field_values_workspace_definition_idx'
  ) then
    v_problems := v_problems || 'custom_field_values_workspace_definition_idx missing; ';
  end if;

  select pg_get_functiondef('public.custom_field_values_order_closed_guard()'::regprocedure) into v_def;
  if position('crm_owner_may_edit_cancelled_order' in v_def) = 0
     or position('workspace_mismatch' in v_def) = 0 then
    v_problems := v_problems || 'guard body incomplete; ';
  end if;

  if v_problems <> '' then
    raise exception 'order_custom_field_values_guard postflight: %', v_problems;
  end if;
end;
$postflight$;

commit;
