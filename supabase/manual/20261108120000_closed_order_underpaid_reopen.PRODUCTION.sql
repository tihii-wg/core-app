-- =============================================================================
-- Auto-reopen a closed order when its total grows above the paid amount
-- Script: 20261108120000_closed_order_underpaid_reopen.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261105220000_reopen_cancelled_order (guard v3, reopen token op).
-- =============================================================================
-- Problem: the owner may edit closed orders. Raising a price on a closed order
-- (e.g. 18 000 -> 25 000 with 18 000 paid) left the order CLOSED and underpaid.
-- Rule: a closed order must be fully paid.
--
-- Fix:
--   1) order_lifecycle_guard v4: a 'reopen' token may clear closed_at when leaving
--      'closed' as well as 'cancelled' (tokens are written only by SECURITY DEFINER code).
--   2) AFTER UPDATE OF total_price trigger on orders: if a closed order's total grows
--      above its net paid amount (payments - refunds - voids, incl. linked invoices,
--      same formula as order_ledger_remaining), the order is reopened automatically:
--        status = 'in-progress', custom_status_id = the workspace's active
--        'in-progress' status (or null), closed_at = null.
--      Payments, warranties and history are kept. Closing again goes through the normal
--      Close Order flow (requires the remaining amount to be paid).
--   Decreasing a closed order's total (overpayment) does NOT reopen it.
-- No backfill: already-underpaid closed orders are reported in a NOTICE only.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_def text;
begin
  if to_regprocedure('public.order_lifecycle_guard()') is null then
    raise exception 'underpaid_reopen preflight: order_lifecycle_guard missing';
  end if;
  select pg_get_functiondef('public.order_lifecycle_guard()'::regprocedure) into v_def;
  if position('v_reopen_clearing' in v_def) = 0 then
    raise exception 'underpaid_reopen preflight: order_lifecycle_guard is older than v3 (apply 20261105220000 first)';
  end if;
  if to_regclass('public.order_lifecycle_tokens') is null or to_regclass('public.payments') is null then
    raise exception 'underpaid_reopen preflight: order_lifecycle_tokens / payments missing';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.order_lifecycle_tokens'::regclass
                   and conname = 'order_lifecycle_tokens_op_check'
                   and pg_get_constraintdef(oid) like '%reopen%') then
    raise exception 'underpaid_reopen preflight: reopen token op missing (apply 20261105220000 first)';
  end if;
end;
$preflight$;

-- 1) Lifecycle guard v4 (copied from v3; only the reopen-from-closed condition changed)
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
   and old.status in ('cancelled', 'closed')
   and new.status is distinct from 'cancelled'
   and new.status is distinct from 'closed'
   and old.closed_at is not null
   and new.closed_at is null;

  -- Rule 1: closed_at cannot be cleared except via a reopen token (from cancelled,
  -- or from closed by crm_orders_reopen_underpaid when the total grew above the paid amount).
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
  'managed-object: core-app/order_lifecycle_guard@v4 — token-only close/cancel/replace/reopen; reopen may clear closed_at when leaving cancelled or closed (closed only via crm_orders_reopen_underpaid); owner manage-closed cannot clear closed_at.';

-- 2) Net paid amount of an order (payments - refunds - voids), not clamped at 0
create or replace function public.crm_order_net_paid(p_workspace_id uuid, p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(sum(
           case
             when s.kind = 'payment' then s.amount
             when s.kind in ('refund', 'void') then -s.amount
             else 0
           end
         ), 0)
  from (
    select distinct p.id, p.kind, p.amount
    from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id from public.invoices i
          where i.workspace_id = p_workspace_id and i.order_id = p_order_id
        )
      )
  ) s;
$fn$;

revoke all on function public.crm_order_net_paid(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_order_net_paid(uuid, uuid) to service_role;

-- 3) Reopen trigger
create or replace function public.crm_orders_reopen_underpaid()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_net numeric;
  v_custom uuid;
  v_touch text;
begin
  if new.closed_at is null or new.status is distinct from 'closed' then
    return null;
  end if;
  if coalesce(new.total_price, 0) <= coalesce(old.total_price, 0) then
    return null;
  end if;

  v_net := public.crm_order_net_paid(new.workspace_id, new.id);
  if round(coalesce(new.total_price, 0), 2) <= round(v_net, 2) + 0.005 then
    return null;
  end if;

  select d.id into v_custom
  from public.status_definitions d
  where d.workspace_id = new.workspace_id
    and d.entity = 'order'
    and d.is_active
    and d.deleted_at is null
    and d.system_status::text = 'in-progress'
    and coalesce(d.semantic_action::text, '') not in ('close', 'cancel')
  order by d.sort_order nulls last, d.created_at
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (new.id, 'reopen', coalesce(auth.uid(), new.created_by))
  on conflict (order_id, op) do update
    set created_by = excluded.created_by,
        created_at = now();

  begin
    execute format(
      'update public.orders o
          set status = ''in-progress'',
              custom_status_id = $1,
              closed_at = null%s
        where o.id = $2
          and o.status = ''closed''',
      v_touch
    ) using v_custom, new.id;
  exception
    when others then
      delete from public.order_lifecycle_tokens where order_id = new.id and op = 'reopen';
      raise;
  end;

  delete from public.order_lifecycle_tokens where order_id = new.id and op = 'reopen';
  return null;
end;
$fn$;

revoke all on function public.crm_orders_reopen_underpaid() from public, anon, authenticated;

comment on function public.crm_orders_reopen_underpaid() is
  'managed-object: core-app/crm_orders_reopen_underpaid@v1 — closed order whose total grows above net paid is reopened (in-progress, closed_at null); payments/warranties/history kept.';

drop trigger if exists crm_orders_reopen_underpaid_au on public.orders;
create trigger crm_orders_reopen_underpaid_au
  after update of total_price on public.orders
  for each row
  when (new.closed_at is not null and new.total_price is distinct from old.total_price)
  execute function public.crm_orders_reopen_underpaid();

-- 4) Report (no changes) closed orders that are already underpaid
do $report$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select o.number, o.total_price, public.crm_order_net_paid(o.workspace_id, o.id) as net
    from public.orders o
    where o.closed_at is not null and o.status = 'closed'
      and exists (select 1 from public.payments p where p.order_id = o.id)
  loop
    if round(coalesce(r.total_price, 0), 2) > round(r.net, 2) + 0.005 then
      v_n := v_n + 1;
      raise notice 'closed but underpaid: % total=% paid=%', r.number, r.total_price, r.net;
    end if;
  end loop;
  raise notice 'underpaid closed orders (not changed): %', v_n;
end;
$report$;

do $postflight$
declare
  v_def text;
begin
  select pg_get_functiondef('public.order_lifecycle_guard()'::regprocedure) into v_def;
  if position('old.status in (''cancelled'', ''closed'')' in v_def) = 0
     or position('cannot_clear_closed_at' in v_def) = 0 then
    raise exception 'underpaid_reopen postflight: guard v4 not installed';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'crm_orders_reopen_underpaid_au'
                   and tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'underpaid_reopen postflight: trigger missing';
  end if;
end;
$postflight$;

commit;
