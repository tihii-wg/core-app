-- =============================================================================
-- crm_recent_active_order_ids — Dashboard Recent Orders by latest meaningful activity
-- MAIN only. Do NOT run against TEST. Apply manually after owner approval.
-- =============================================================================
-- Purpose:
--   Return up to N distinct order ids for a workspace, ordered by the newest
--   meaningful `order_events.created_at`. Used by Dashboard Recent Orders so
--   selection is activity-based (not orders.created_at alone).
--
-- Safe to re-run. Does not modify historical order_events rows.
-- App falls back to a bounded table scan when this RPC is absent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_events') is null then
    v_problems := v_problems || 'public.order_events missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_member(uuid)') is null
     and to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'workspace membership helpers missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'crm_recent_active_order_ids preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_recent_active_order_ids(
  p_workspace_id uuid,
  p_limit integer default 5
)
returns table (
  order_id uuid,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 50));
begin
  if v_uid is null then
    raise exception 'recent_orders:not_authenticated' using errcode = '42501';
  end if;
  if p_workspace_id is null then
    raise exception 'recent_orders:invalid_args' using errcode = '22023';
  end if;

  -- Same visibility as order_events RLS: workspace members only.
  if to_regprocedure('public.crm_is_workspace_member(uuid)') is not null then
    if not coalesce(public.crm_is_workspace_member(p_workspace_id), false) then
      raise exception 'recent_orders:forbidden' using errcode = '42501';
    end if;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.view'), false)
       and not coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false) then
      raise exception 'recent_orders:forbidden' using errcode = '42501';
    end if;
  else
    raise exception 'recent_orders:forbidden' using errcode = '42501';
  end if;

  return query
  select
    e.order_id,
    max(e.created_at) as last_activity_at
  from public.order_events e
  where e.workspace_id = p_workspace_id
    and e.event_type in (
      'order_created',
      'status_changed',
      'order_field_changed',
      'service_added',
      'service_updated',
      'service_removed',
      'material_added',
      'material_updated',
      'material_removed',
      'material_issued',
      'material_returned',
      'payment_recorded',
      'payment_refunded',
      'payment_voided',
      'warranty_activated',
      'warranty_updated',
      'warranty_claim_created',
      'warranty_claim_updated'
    )
  group by e.order_id
  order by last_activity_at desc, e.order_id desc
  limit v_limit;
end;
$fn$;

comment on function public.crm_recent_active_order_ids(uuid, integer) is
  'managed-object: core-app/crm_recent_active_order_ids@v1 — distinct order ids by latest meaningful order_events activity for Dashboard Recent Orders.';

revoke all on function public.crm_recent_active_order_ids(uuid, integer) from public, anon;
grant execute on function public.crm_recent_active_order_ids(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
begin
  if to_regprocedure('public.crm_recent_active_order_ids(uuid, integer)') is null then
    raise exception 'crm_recent_active_order_ids postflight failed: function missing';
  end if;
end;
$postflight$;
