-- =============================================================================
-- Core App MAIN — owner may set a regular custom status on closed/cancelled orders
-- Script: 20261105110000_owner_regular_status_on_lifecycle.PRODUCTION.sql
-- Target: MAIN only (pundggjzzaqzbvykbxvo). Manual apply. Do not run against TEST.
-- =============================================================================
--
-- Problem
-- -------
-- Formal close/cancel are lifecycle actions. Regular configurable statuses must
-- stay separate. Owners (workspaces.owner_id = auth.uid()) must be able to attach
-- a normal custom status to a closed or cancelled order for display/organization
-- WITHOUT:
--   • clearing closed_at
--   • changing orders.status away from closed/cancelled
--   • reopening / re-closing / re-cancelling
--   • activating warranties or touching inventory / payments
--
-- Non-owners keep existing rules (closed orders remain immutable for them).
--
-- Approach
-- --------
-- SECURITY DEFINER RPC that:
--   1) requires crm_is_workspace_owner_id(p_workspace_id)  -- owner_id, not role
--   2) requires the order to be formally closed and/or cancelled
--   3) requires the target status_definitions row to be active + semantic_action=normal
--   4) updates custom_status_id ONLY (status + closed_at unchanged)
--   5) when closed_at is set, uses the existing replace token so order_lifecycle_guard
--      allows the custom_status_id write
--
-- Idempotent. Does not delete status definitions or historical data.
-- =============================================================================

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.status_definitions') is null then
    v_problems := v_problems || 'status_definitions missing; ';
  end if;
  if to_regclass('public.order_lifecycle_tokens') is null then
    v_problems := v_problems || 'order_lifecycle_tokens missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;
  if to_regprocedure('public.order_lifecycle_guard()') is null then
    v_problems := v_problems || 'order_lifecycle_guard missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'Preflight failed: %', v_problems;
  end if;
end;
$preflight$;

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

  -- Authoritative owner bypass: workspaces.owner_id = auth.uid() (not membership role).
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
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

  -- Never treat system closed/cancelled codes as "regular" even if mis-tagged normal.
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

  -- Formally closed rows need the replace token for order_lifecycle_guard Rule 2.
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
       -- Defense in depth: never clear or rewrite lifecycle fields in this path.
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
  'managed-object: core-app/set_order_lifecycle_regular_custom_status@v1 — workspace owner (workspaces.owner_id) may set a normal custom_status_id on a closed/cancelled order without changing status or closed_at.';

-- ---------------------------------------------------------------------------
-- Post-apply verification (read-only; safe to run after apply)
-- ---------------------------------------------------------------------------
-- select to_regprocedure('public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)') is not null as rpc_ok;
-- select pg_get_functiondef('public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)'::regprocedure)
--   like '%crm_is_workspace_owner_id%' as uses_owner_id;
-- select pg_get_functiondef('public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)'::regprocedure)
--   like '%closed_at%' as preserves_closed_at_mention;
-- select has_function_privilege('authenticated', 'public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)', 'execute') as auth_exec;
-- select has_function_privilege('anon', 'public.set_order_lifecycle_regular_custom_status(uuid,uuid,uuid)', 'execute') as anon_exec; -- expect false
