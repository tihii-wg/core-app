-- =============================================================================
-- Core App — Owner manage-closed-orders setting (MAIN only — manual apply)
-- Script: 20261105170000_owner_manage_closed_orders.PRODUCTION.sql
-- =============================================================================
-- Adds workspaces.owner_can_manage_closed_orders (default false).
-- When true AND workspaces.owner_id = auth.uid(), the owner may update closed
-- orders (status/custom_status fields via order_lifecycle_guard Rule 2 bypass,
-- and line warranty config via apply_order_material_warranties).
--
-- Non-owners NEVER receive this override.
-- Does not disable payment / inventory / warranty FK safeguards.
-- Does not clear closed_at, rewrite warranty_records, or auto-delete finance.
-- Cancel/delete of closed orders keep existing owner_id / role-grant rules.
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
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'owner_id'
  ) then
    v_problems := v_problems || 'workspaces.owner_id missing; ';
  end if;

  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;

  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;

  if to_regprocedure('public.order_lifecycle_guard()') is null then
    v_problems := v_problems || 'order_lifecycle_guard() missing; ';
  end if;

  -- Signature on MAIN: (p_order_id, p_workspace_id, p_lines)
  if to_regprocedure('public.apply_order_material_warranties(uuid,uuid,jsonb)') is null then
    v_problems := v_problems || 'apply_order_material_warranties(uuid,uuid,jsonb) missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'owner_manage_closed_orders preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Column (default false for existing + new workspaces)
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists owner_can_manage_closed_orders boolean;

update public.workspaces
   set owner_can_manage_closed_orders = false
 where owner_can_manage_closed_orders is null;

alter table public.workspaces
  alter column owner_can_manage_closed_orders set default false;

alter table public.workspaces
  alter column owner_can_manage_closed_orders set not null;

comment on column public.workspaces.owner_can_manage_closed_orders is
  'When true, workspaces.owner_id may edit/manage formally closed orders. Default false. Never grants this to non-owners.';

-- ---------------------------------------------------------------------------
-- 2) Authoritative helper: owner_id AND setting
-- ---------------------------------------------------------------------------
create or replace function public.crm_owner_may_manage_closed_orders(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(
    (
      select w.owner_can_manage_closed_orders
        and w.owner_id is not null
        and w.owner_id = auth.uid()
        and w.deleted_at is null
      from public.workspaces w
      where w.id = p_workspace_id
    ),
    false
  );
$fn$;

revoke all on function public.crm_owner_may_manage_closed_orders(uuid) from public, anon;
grant execute on function public.crm_owner_may_manage_closed_orders(uuid) to authenticated, service_role;

comment on function public.crm_owner_may_manage_closed_orders(uuid) is
  'managed-object: core-app/crm_owner_may_manage_closed_orders@v1 — true only when auth.uid() is workspaces.owner_id and owner_can_manage_closed_orders is enabled.';

-- ---------------------------------------------------------------------------
-- 3) order_lifecycle_guard — allow Rule 2 mutations for owner+setting
--     Still never clears closed_at (Rule 1). Still requires tokens to ENTER
--     closed/cancelled (Rules 4–5). Non-owners unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.order_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_close_tok boolean;
  v_cancel_tok boolean;
  v_replace_tok boolean;
  v_new_action text;
  v_target record;
  v_owner_manage boolean;
begin
  -- Rule 1: closed_at can never be cleared (including owner manage mode).
  if old.closed_at is not null and new.closed_at is null then
    raise exception 'order_lifecycle:cannot_clear_closed_at' using errcode = '42501';
  end if;

  select
    coalesce(bool_or(t.op = 'close'), false),
    coalesce(bool_or(t.op = 'cancel'), false),
    coalesce(bool_or(t.op = 'replace'), false)
    into v_close_tok, v_cancel_tok, v_replace_tok
  from public.order_lifecycle_tokens t
  where t.order_id = new.id;

  v_owner_manage := coalesce(public.crm_owner_may_manage_closed_orders(new.workspace_id), false);

  -- Rule 2: formally closed orders are immutable except:
  --   • idempotent close token
  --   • replace token changing custom_status_id ONLY
  --   • cancel token moving to cancelled
  --   • workspace owner with owner_can_manage_closed_orders (status/custom only;
  --     closed_at still immutable; entering closed/cancelled still needs tokens)
  if old.closed_at is not null
     and (new.status is distinct from old.status
          or new.custom_status_id is distinct from old.custom_status_id
          or new.closed_at is distinct from old.closed_at) then
    if v_close_tok then
      null;
    elsif v_replace_tok
          and new.status is not distinct from old.status
          and new.closed_at is not distinct from old.closed_at
          and new.custom_status_id is distinct from old.custom_status_id then
      select d.id, d.semantic_action into v_target
      from public.status_definitions d
      where d.id = new.custom_status_id
        and d.workspace_id = new.workspace_id
        and d.entity = 'order'
        and d.is_active
        and d.deleted_at is null;

      if not found or v_target.semantic_action in ('close', 'cancel') then
        raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
      end if;
      return new;
    elsif v_cancel_tok
          and new.closed_at is not distinct from old.closed_at
          and new.status = 'cancelled'
          and old.status is distinct from 'cancelled' then
      null;
    elsif v_owner_manage
          and new.closed_at is not distinct from old.closed_at then
      -- Owner may change status / custom_status while keeping closed_at.
      -- Rules 4–5 below still block unauthorized entry into closed/cancelled.
      null;
    else
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  -- Rule 3: closed_at changes only via close.
  if new.closed_at is distinct from old.closed_at and not v_close_tok then
    raise exception 'order_lifecycle:closed_at_via_rpc_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Rule 4
    if new.status = 'closed' and not v_close_tok then
      raise exception 'order_lifecycle:closed_status_via_rpc_only' using errcode = '42501';
    end if;
    -- Rule 5
    if new.status = 'cancelled' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_status_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  -- Rule 6: moving to a close/cancel-designated custom status needs the matching token.
  if new.custom_status_id is distinct from old.custom_status_id
     and new.custom_status_id is not null then
    select d.semantic_action into v_new_action
    from public.status_definitions d
    where d.id = new.custom_status_id
      and d.workspace_id = new.workspace_id
      and d.entity = 'order'
      and d.deleted_at is null;

    if v_new_action = 'close' and not v_close_tok then
      raise exception 'order_lifecycle:close_semantic_via_rpc_only' using errcode = '42501';
    elsif v_new_action = 'cancel' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_semantic_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;

revoke all on function public.order_lifecycle_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) apply_order_material_warranties — allow owner+setting after close
-- ---------------------------------------------------------------------------
-- Keep MAIN argument order: (p_order_id, p_workspace_id, p_lines)
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

  -- After formal close: only owner_id + owner_can_manage_closed_orders may rewrite
  -- line warranty fields. Activated warranty_records remain untouched.
  if v_order.closed_at is not null
     and not coalesce(public.crm_owner_may_manage_closed_orders(p_workspace_id), false) then
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
    -- Explicit JSON null clears the field.
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

revoke all on function public.apply_order_material_warranties(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_order_material_warranties(uuid, uuid, jsonb) to authenticated, service_role;

comment on function public.apply_order_material_warranties(uuid, uuid, jsonb) is
  'managed-object: core-app/apply_order_material_warranties@v2 — (order_id, workspace_id, lines); after close only when crm_owner_may_manage_closed_orders.';

-- ---------------------------------------------------------------------------
-- 5) Postflight
-- ---------------------------------------------------------------------------
do $post$
declare
  v_problems text := '';
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspaces'
      and column_name = 'owner_can_manage_closed_orders'
      and data_type = 'boolean'
      and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'workspaces.owner_can_manage_closed_orders missing or nullable; ';
  end if;

  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    v_problems := v_problems || 'crm_owner_may_manage_closed_orders missing; ';
  end if;

  select pg_get_functiondef('public.order_lifecycle_guard()'::regprocedure) into v_def;
  if position('crm_owner_may_manage_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'order_lifecycle_guard missing owner-manage bypass; ';
  end if;
  if position('cannot_clear_closed_at' in v_def) = 0 then
    v_problems := v_problems || 'order_lifecycle_guard lost cannot_clear_closed_at; ';
  end if;

  select pg_get_functiondef('public.apply_order_material_warranties(uuid,uuid,jsonb)'::regprocedure) into v_def;
  if position('crm_owner_may_manage_closed_orders' in v_def) = 0 then
    v_problems := v_problems || 'apply_order_material_warranties missing owner-manage gate; ';
  end if;

  if v_problems <> '' then
    raise exception 'owner_manage_closed_orders postflight failed: %', v_problems;
  end if;
end;
$post$;

commit;
