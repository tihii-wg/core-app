-- =====================================================================
-- Core App: create a public order status link (token returned once)
--
--   crm_create_public_order_link(p_order_id uuid, p_expires_at timestamptz default null)
--     -> jsonb { id, token, entity_type, expires_at, created_at }
--
-- WHY: crm_ro_v1 grants SELECT * on public_links to every workspace member, which
-- would expose capability tokens. This script:
--   1. Creates a SECURITY DEFINER RPC that inserts a link after verifying the caller
--      may edit orders in the order's workspace, and that the order belongs there.
--   2. Revokes column privilege SELECT(token) from anon/authenticated so PostgREST
--      clients cannot read tokens via table select; only this RPC (and status lookup)
--      can surface them under SECURITY DEFINER.
--
-- REQUIRES: crm_ro_v1.PRODUCTION.sql (public_links) and ideally 2.1i status RPC.
-- Apply by hand: TEST first, then PROD. Idempotent. One transaction.
-- NOT applied automatically.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.public_links') is null or to_regclass('public.orders') is null then
    raise exception 'Preflight failed: public.public_links / public.orders missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight failed: is_workspace_member(uuid) missing.';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null
     and to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight failed: permission helpers missing.';
  end if;
end
$preflight$;

create or replace function public.crm_create_public_order_link(
  p_order_id uuid,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_role text;
  v_allowed boolean := false;
  v_link public.public_links%rowtype;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id;

  if v_workspace_id is null then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;
  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  if to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    v_allowed := public.crm_has_permission(v_workspace_id, 'orders.edit');
  end if;
  if not v_allowed and to_regprocedure('public.workspace_member_role(uuid)') is not null then
    v_role := public.workspace_member_role(v_workspace_id);
    v_allowed := v_role is not null and v_role in ('owner', 'admin', 'manager');
  end if;
  if not v_allowed then
    raise exception 'You do not have permission to create a public order link.' using errcode = '42501';
  end if;

  insert into public.public_links (
    workspace_id, entity_type, entity_id, expires_at, created_by
  ) values (
    v_workspace_id, 'order', p_order_id, p_expires_at, auth.uid()
  )
  returning * into v_link;

  return jsonb_build_object(
    'id', v_link.id,
    'token', v_link.token,
    'entity_type', v_link.entity_type,
    'expires_at', v_link.expires_at,
    'created_at', v_link.created_at
  );
end $$;

revoke all on function public.crm_create_public_order_link(uuid, timestamptz) from public;
grant execute on function public.crm_create_public_order_link(uuid, timestamptz) to authenticated;

-- Hide capability tokens from ordinary table SELECTs (PostgREST). SECURITY DEFINER
-- RPCs still read the column as the function owner.
revoke select (token) on table public.public_links from anon, authenticated;

notify pgrst, 'reload schema';

commit;
