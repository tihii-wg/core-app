-- =============================================================================
-- reopen_cancelled_order — owner reopens cancelled orders to a real open state
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Problem:
--   After cancel (often closed-then-cancelled), status=cancelled but closed_at is
--   preserved. Rule 1 of order_lifecycle_guard forbids clearing closed_at.
--   App/UI also lock status changes on cancelled orders. The order cannot
--   re-enter the normal Close Order workflow or get new warranty activations.
--
-- Fix:
--   1) Extend order_lifecycle_tokens with op = 'reopen'.
--   2) Allow clearing closed_at ONLY with a reopen token when leaving cancelled.
--   3) SECURITY DEFINER RPC reopen_cancelled_order — workspace owner_id only
--      (independent of owner_can_manage_closed_orders).
--   4) Sets an open system status, clears closed_at, clears cancel custom status
--      unless a normal custom status is supplied. History stays in order_events
--      (crm_orders_status_event already tags lifecycle=reopen).
--
-- Does NOT delete order_events, rewrite warranty_records, or bypass close_order
-- settlement. Ordinary closed (status=closed) orders are unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Preflight
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.order_lifecycle_tokens') is null then
    v_problems := v_problems || 'order_lifecycle_tokens missing; ';
  end if;
  if to_regprocedure('public.order_lifecycle_guard()') is null then
    v_problems := v_problems || 'order_lifecycle_guard missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id missing; ';
  end if;
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    v_problems := v_problems || 'close_order_if_settled missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'reopen_cancelled_order preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Allow 'reopen' on lifecycle tokens
-- ---------------------------------------------------------------------------
do $tokens$
declare
  v_con name;
begin
  select c.conname into v_con
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.order_lifecycle_tokens'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ~* '\mop\M'
  order by case when c.conname = 'order_lifecycle_tokens_op_check' then 0 else 1 end
  limit 1;

  if v_con is not null then
    execute format('alter table public.order_lifecycle_tokens drop constraint %I', v_con);
  end if;

  alter table public.order_lifecycle_tokens
    add constraint order_lifecycle_tokens_op_check
    check (op in ('close', 'cancel', 'replace', 'reopen'));
end;
$tokens$;

-- ---------------------------------------------------------------------------
-- 2) Lifecycle guard — reopen may clear closed_at when leaving cancelled
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
  v_reopen_tok boolean;
  v_new_action text;
  v_target record;
  v_owner_manage boolean;
  v_reopen_clearing boolean;
begin
  select
    coalesce(bool_or(t.op = 'close'), false),
    coalesce(bool_or(t.op = 'cancel'), false),
    coalesce(bool_or(t.op = 'replace'), false),
    coalesce(bool_or(t.op = 'reopen'), false)
    into v_close_tok, v_cancel_tok, v_replace_tok, v_reopen_tok
  from public.order_lifecycle_tokens t
  where t.order_id = new.id;

  v_reopen_clearing :=
       v_reopen_tok
   and old.status is not distinct from 'cancelled'
   and new.status is distinct from 'cancelled'
   and new.status is distinct from 'closed'
   and old.closed_at is not null
   and new.closed_at is null;

  -- Rule 1: closed_at cannot be cleared except via reopen token from cancelled.
  if old.closed_at is not null and new.closed_at is null and not v_reopen_clearing then
    raise exception 'order_lifecycle:cannot_clear_closed_at' using errcode = '42501';
  end if;

  v_owner_manage := coalesce(public.crm_owner_may_manage_closed_orders(new.workspace_id), false);

  -- Rule 2: formally closed rows are immutable except close/replace/cancel/reopen
  -- tokens or owner manage-closed (status/custom only; closed_at stays unless reopen).
  if old.closed_at is not null
     and (new.status is distinct from old.status
          or new.custom_status_id is distinct from old.custom_status_id
          or new.closed_at is distinct from old.closed_at) then
    if v_close_tok then
      null;
    elsif v_reopen_clearing then
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
      null;
    else
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  -- Rule 3: closed_at changes only via close (set) or reopen (clear).
  if new.closed_at is distinct from old.closed_at
     and not v_close_tok
     and not v_reopen_clearing then
    raise exception 'order_lifecycle:closed_at_via_rpc_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'closed' and not v_close_tok then
      raise exception 'order_lifecycle:closed_status_via_rpc_only' using errcode = '42501';
    end if;
    if new.status = 'cancelled' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_status_via_rpc_only' using errcode = '42501';
    end if;
  end if;

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

comment on function public.order_lifecycle_guard() is
  'managed-object: core-app/order_lifecycle_guard@v3 — token-only close/cancel/replace/reopen; reopen may clear closed_at when leaving cancelled; owner manage-closed cannot clear closed_at.';

-- ---------------------------------------------------------------------------
-- 3) reopen_cancelled_order RPC
-- ---------------------------------------------------------------------------
create or replace function public.reopen_cancelled_order(
  p_order_id uuid,
  p_workspace_id uuid,
  p_status text,
  p_custom_status_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_custom uuid := p_custom_status_id;
  v_target public.status_definitions%rowtype;
  v_touch text;
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  -- Actual workspace owner only — not admin/manager/member, not manage-closed setting.
  if not coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if v_status not in ('new', 'in-progress', 'waiting-parts', 'completed', 'paid') then
    raise exception 'order_lifecycle:invalid_reopen_status' using errcode = '22023';
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

  if v_order.status is distinct from 'cancelled' then
    raise exception 'order_lifecycle:not_cancelled' using errcode = 'P0001';
  end if;

  if v_custom is not null then
    select * into v_target
    from public.status_definitions d
    where d.id = v_custom
      and d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.is_active
      and d.deleted_at is null;

    if not found then
      raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
    end if;
    if v_target.semantic_action in ('close', 'cancel') then
      raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
    end if;
    if v_target.system_status is not null
       and v_target.system_status::text is distinct from v_status then
      -- Keep system status and custom definition aligned.
      v_status := lower(trim(v_target.system_status::text));
      if v_status not in ('new', 'in-progress', 'waiting-parts', 'completed', 'paid') then
        raise exception 'order_lifecycle:invalid_reopen_status' using errcode = '22023';
      end if;
    end if;
  end if;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'reopen', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by,
        created_at = now();

  begin
    execute format(
      'update public.orders o
          set status = $1,
              custom_status_id = $2,
              closed_at = null%s
        where o.id = $3
          and o.workspace_id = $4
          and o.status = ''cancelled''',
      v_touch
    )
      using v_status, v_custom, p_order_id, p_workspace_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'order_lifecycle:update_failed' using errcode = 'P0001';
    end if;
  exception
    when others then
      delete from public.order_lifecycle_tokens
      where order_id = p_order_id and op = 'reopen';
      raise;
  end;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'reopen';

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', v_order.status,
    'closed_at', v_order.closed_at,
    'custom_status_id', v_order.custom_status_id
  );
end;
$fn$;

revoke all on function public.reopen_cancelled_order(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.reopen_cancelled_order(uuid, uuid, text, uuid) to authenticated, service_role;

comment on function public.reopen_cancelled_order(uuid, uuid, text, uuid) is
  'managed-object: core-app/reopen_cancelled_order@v1 — workspace owner_id only; cancelled → open status; clears closed_at; preserves history/warranties; enables normal close_order_if_settled.';

-- ---------------------------------------------------------------------------
-- Postflight
-- ---------------------------------------------------------------------------
do $postflight$
declare
  v_problems text := '';
  v_def text;
  v_check text;
begin
  if to_regprocedure('public.reopen_cancelled_order(uuid,uuid,text,uuid)') is null then
    v_problems := v_problems || 'reopen_cancelled_order missing; ';
  end if;

  select pg_get_constraintdef(c.oid) into v_check
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.order_lifecycle_tokens'::regclass
    and c.conname = 'order_lifecycle_tokens_op_check';
  if v_check is null or position('reopen' in v_check) = 0 then
    v_problems := v_problems || 'order_lifecycle_tokens missing reopen op; ';
  end if;

  select pg_get_functiondef('public.order_lifecycle_guard()'::regprocedure) into v_def;
  if position('v_reopen_tok' in v_def) = 0 or position('v_reopen_clearing' in v_def) = 0 then
    v_problems := v_problems || 'order_lifecycle_guard missing reopen clear path; ';
  end if;
  -- Ordinary manage-closed must still be unable to clear closed_at without reopen.
  if position('cannot_clear_closed_at' in v_def) = 0 then
    v_problems := v_problems || 'cannot_clear_closed_at guard missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'reopen_cancelled_order postflight failed: %', v_problems;
  end if;
end;
$postflight$;

-- Manual checks (read-only):
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_lifecycle_tokens_op_check';
-- -- As owner: select reopen_cancelled_order('<order_id>', '<ws>', 'in-progress', null);
-- -- Expect status=in-progress, closed_at null; then close_order_if_settled works.
