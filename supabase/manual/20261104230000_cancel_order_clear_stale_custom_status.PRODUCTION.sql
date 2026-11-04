-- =============================================================================
-- CANCEL ORDER: clear stale custom_status_id + avoid duplicate history (MAIN)
-- =============================================================================
-- Project: MAIN only (pundggjzzaqzbvykbxvo). Do NOT run against TEST.
-- Apply manually after review. Do not auto-apply.
--
-- Why required:
--   cancel_order@v1 used:
--     custom_status_id = coalesce(cancel_semantic_id, existing_custom_status_id)
--   When no cancel semantic definition exists (or lookup fails), the previous
--   custom_status_id is kept while orders.status becomes 'cancelled'. The unified
--   UI badge/board previously preferred custom_status_id, so the order still
--   looked "In Progress" (etc.) after a successful cancel.
--
--   Additionally, crm_orders_status_event wrote TWO status_changed rows when
--   both status and custom_status_id changed in the same UPDATE (system cancel
--   + custom_status change), producing duplicate history lines.
--
-- This script:
--   1) Replaces cancel_order so custom_status_id is set to the cancel semantic
--      definition id when present, otherwise NULL (clears stale custom status).
--      Still sets status = 'cancelled'. Never sets closed_at. No finance/inventory.
--   2) Updates crm_orders_status_event so a custom_status_id change in the same
--      UPDATE as a status change does not emit a second event (status row wins;
--      lifecycle payload still marks cancel/close/reopen).
--
-- Idempotent. Fail-closed preflight. Does not weaken RLS/grants.
-- =============================================================================

begin;

do $pre$
begin
  if to_regclass('public.orders') is null then
    raise exception 'cancel_order_clear_stale_custom_status preflight: orders missing';
  end if;
  if to_regprocedure('public.cancel_order(uuid,uuid)') is null then
    raise exception 'cancel_order_clear_stale_custom_status preflight: cancel_order(uuid,uuid) missing — apply order lifecycle SQL first';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'cancel_order_clear_stale_custom_status preflight: crm_has_permission missing';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) cancel_order — clear stale custom_status_id
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(
  p_order_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_cancel_status_id uuid;
  v_touch text;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  if v_order.workspace_id is distinct from p_workspace_id then
    raise exception 'order_lifecycle:workspace_mismatch' using errcode = '42501';
  end if;

  if v_order.closed_at is not null then
    raise exception 'order_lifecycle:cannot_cancel_closed' using errcode = 'P0001';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', p_order_id,
      'custom_status_id', v_order.custom_status_id,
      'closed_at', null
    );
  end if;

  select d.id into v_cancel_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'cancel'
  order by d.sort_order, d.name, d.id
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'cancel', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by, created_at = now();

  -- Always assign custom_status_id (may be NULL) so a prior ordinary status cannot linger.
  execute format(
    'update public.orders o
        set status = ''cancelled'',
            custom_status_id = $1%s
      where o.id = $2 and o.workspace_id = $3',
    v_touch
  )
    using v_cancel_status_id, p_order_id, p_workspace_id;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'cancel';

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'custom_status_id', v_cancel_status_id,
    'closed_at', null
  );
end;
$fn$;

revoke all on function public.cancel_order(uuid, uuid) from public, anon;
grant execute on function public.cancel_order(uuid, uuid) to authenticated, service_role;

comment on function public.cancel_order(uuid, uuid) is
  'managed-object: core-app/cancel_order@v2 — status=cancelled; custom_status_id = cancel semantic id or NULL (clears stale). Requires orders.edit. Never sets closed_at. Idempotent.';

-- ---------------------------------------------------------------------------
-- 2) Status history: one event when status + custom_status_id change together
-- ---------------------------------------------------------------------------
do $hist$
begin
  if to_regprocedure('public.crm_orders_status_event()') is null then
    raise notice 'crm_orders_status_event missing — skip history dedupe (activity history SQL not applied)';
    return;
  end if;

  execute $fn$
    create or replace function public.crm_orders_status_event()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $body$
    declare
      v_actor record;
      v_payload jsonb;
      v_status_changed boolean;
    begin
      if tg_op <> 'UPDATE' then
        return new;
      end if;

      select * into v_actor from public.crm_order_event_resolve_actor(new.workspace_id);

      v_status_changed := new.status is distinct from old.status;

      if v_status_changed then
        v_payload := jsonb_build_object('source', 'trigger');
        if new.status::text = 'closed' then
          v_payload := v_payload || jsonb_build_object('lifecycle', 'close');
        elsif new.status::text = 'cancelled' then
          v_payload := v_payload || jsonb_build_object('lifecycle', 'cancel');
        elsif old.status::text in ('closed', 'cancelled')
          and new.status::text is distinct from old.status::text then
          v_payload := v_payload || jsonb_build_object('lifecycle', 'reopen');
        end if;

        perform public.crm_order_event_insert(
          new.workspace_id, new.id, 'status_changed', 'status',
          old.status::text, new.status::text,
          v_payload, v_actor.actor_user_id, v_actor.actor_name
        );
      end if;

      -- Skip a second row when custom_status_id changed in the same UPDATE as status
      -- (cancel/close RPCs). Prevents duplicate "Status changed" history lines.
      if new.custom_status_id is distinct from old.custom_status_id
         and not v_status_changed then
        perform public.crm_order_event_insert(
          new.workspace_id, new.id, 'status_changed', 'custom_status_id',
          old.custom_status_id::text, new.custom_status_id::text,
          jsonb_build_object('source', 'trigger'),
          v_actor.actor_user_id, v_actor.actor_name
        );
      end if;

      return new;
    end
    $body$;
  $fn$;

  execute $c$
    comment on function public.crm_orders_status_event() is
      'managed-object: core-app/crm_orders_status_event@v2 — one status_changed per UPDATE when status changes; custom_status_id-only changes still logged.';
  $c$;

  revoke all on function public.crm_orders_status_event() from public, anon, authenticated;
end;
$hist$;

-- ---------------------------------------------------------------------------
-- 3) POST-APPLY
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_comment text;
  v_problems text := '';
begin
  if to_regprocedure('public.cancel_order(uuid,uuid)') is null then
    v_problems := v_problems || 'cancel_order missing; ';
  end if;

  select pg_catalog.obj_description(
    to_regprocedure('public.cancel_order(uuid,uuid)')::oid,
    'pg_proc'
  )
  into v_comment;

  if v_comment is null or position('cancel_order@v2' in v_comment) = 0 then
    v_problems := v_problems || 'cancel_order comment not @v2; ';
  end if;

  if has_function_privilege('anon', 'public.cancel_order(uuid,uuid)', 'execute') then
    v_problems := v_problems || 'anon must not execute cancel_order; ';
  end if;

  if not has_function_privilege('authenticated', 'public.cancel_order(uuid,uuid)', 'execute') then
    v_problems := v_problems || 'authenticated must execute cancel_order; ';
  end if;

  if v_problems <> '' then
    raise exception 'cancel_order_clear_stale_custom_status post-apply failed: %', v_problems;
  end if;
end;
$assert$;

commit;

-- VERIFY (read-only):
-- select pg_catalog.obj_description(to_regprocedure('public.cancel_order(uuid,uuid)')::oid, 'pg_proc');
-- select pg_catalog.obj_description(to_regprocedure('public.crm_orders_status_event()')::oid, 'pg_proc');
