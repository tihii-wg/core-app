-- =============================================================================
-- Cancel order + void its payments in ONE transaction
-- Script: 20261106120000_cancel_order_with_payment_void.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: cancel_order(uuid,uuid) (20261104270000 or later),
--                payments kind=void support (20261102140000 + 20261102170000)
-- =============================================================================
-- Problem:
--   cancel_order never touches money. To delete a cancelled order the user had to
--   open the order card and void every payment one by one (client-side, not atomic).
--
-- New RPC:
--   crm_cancel_order_with_payment_void(p_order_id, p_workspace_id, p_void_payments, p_reason)
--   1) Calls public.cancel_order (same permission rules, idempotent if already cancelled).
--   2) When p_void_payments = true: for every original payment of this order that has
--      NO refund/void yet, inserts a full kind='void' row (payments_enforce_integrity
--      validates it). Payments that are partially/fully refunded cannot be voided by
--      the ledger rules — they are returned in "skipped" and left untouched.
--   Everything happens in one transaction: if any void fails, the cancel is rolled back too.
--   After this, delete_order_with_payments removes fully voided payments with the order.
--
-- Does NOT:
--   - change cancel_order, delete_order_with_payments or the payments integrity trigger
--   - delete payments (cleanup happens in the existing delete RPC)
--   - create refunds (a void means "money was not kept"; real cash refunds stay manual)
-- Idempotent (create or replace). Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regprocedure('public.cancel_order(uuid,uuid)') is null then
    v_problems := v_problems || 'cancel_order(uuid,uuid) missing; ';
  end if;
  if to_regclass('public.payments') is null then
    v_problems := v_problems || 'payments missing; ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    v_problems := v_problems || 'crm_is_workspace_owner_id(uuid) missing; ';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'payments_enforce_integrity_bi'
      and tgrelid = 'public.payments'::regclass
      and not tgisinternal
  ) then
    v_problems := v_problems || 'payments_enforce_integrity_bi trigger missing (void support not applied); ';
  end if;
  if v_problems <> '' then
    raise exception 'cancel_order_with_payment_void preflight failed: %', v_problems;
  end if;
end;
$preflight$;

create or replace function public.crm_cancel_order_with_payment_void(
  p_order_id uuid,
  p_workspace_id uuid,
  p_void_payments boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_cancel jsonb;
  v_reason text;
  v_number text;
  v_pay record;
  v_voided_count integer := 0;
  v_voided_total numeric := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  -- Same permission + lifecycle rules as the normal cancel (raises on forbidden).
  v_cancel := public.cancel_order(p_order_id, p_workspace_id);

  if not coalesce(p_void_payments, false) then
    return coalesce(v_cancel, '{}'::jsonb)
      || jsonb_build_object('voided_count', 0, 'voided_total', 0, 'skipped', '[]'::jsonb);
  end if;

  -- Voiding money: workspace owner_id or a member with orders.edit.
  if not (
    coalesce(public.crm_is_workspace_owner_id(p_workspace_id), false)
    or coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false)
  ) then
    raise exception 'order_payment_void:forbidden' using errcode = '42501';
  end if;

  select o.number into v_number
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 8 then
    v_reason := 'Order cancelled' || coalesce(' ' || v_number, '');
  end if;

  for v_pay in
    select p.*
    from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and p.kind = 'payment'
    order by p.paid_at, p.id
    for update
  loop
    if exists (
      select 1 from public.payments r
      where r.workspace_id = p_workspace_id
        and r.related_payment_id = v_pay.id
        and r.kind in ('refund', 'void')
    ) then
      -- Already fully voided → nothing to do; partially/fully refunded → cannot void.
      if not exists (
        select 1 from public.payments v
        where v.workspace_id = p_workspace_id
          and v.related_payment_id = v_pay.id
          and v.kind = 'void'
      ) then
        v_skipped := v_skipped || jsonb_build_object(
          'payment_id', v_pay.id, 'amount', v_pay.amount, 'reason', 'has_refund'
        );
      end if;
      continue;
    end if;

    insert into public.payments (
      workspace_id, order_id, invoice_id, related_payment_id, kind,
      amount, currency_code, payment_method, paid_at, note
    ) values (
      v_pay.workspace_id, v_pay.order_id, v_pay.invoice_id, v_pay.id, 'void',
      v_pay.amount, v_pay.currency_code, v_pay.payment_method, now(), v_reason
    );

    v_voided_count := v_voided_count + 1;
    v_voided_total := v_voided_total + v_pay.amount;
  end loop;

  return coalesce(v_cancel, '{}'::jsonb) || jsonb_build_object(
    'voided_count', v_voided_count,
    'voided_total', v_voided_total,
    'skipped', v_skipped
  );
end;
$fn$;

revoke all on function public.crm_cancel_order_with_payment_void(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.crm_cancel_order_with_payment_void(uuid, uuid, boolean, text) to authenticated, service_role;

comment on function public.crm_cancel_order_with_payment_void(uuid, uuid, boolean, text) is
  'managed-object: core-app/crm_cancel_order_with_payment_void@v1 — cancel_order + full void of every un-offset payment of the order in one transaction; refunded payments are skipped.';

do $postflight$
begin
  if to_regprocedure('public.crm_cancel_order_with_payment_void(uuid,uuid,boolean,text)') is null then
    raise exception 'cancel_order_with_payment_void postflight failed: RPC missing';
  end if;
end;
$postflight$;

commit;

-- Manual verification (as owner):
-- select public.crm_cancel_order_with_payment_void('<order uuid>', '<workspace uuid>', true, 'Клиент отказался от заказа');
--   -> status cancelled, voided_count = number of payments; then Delete order works
--      and removes the voided payments together with the order.
