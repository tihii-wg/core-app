-- =====================================================================================
-- Pay an order / invoice from the client's balance (advance)
-- Script: 20261125190000_pay_from_client_balance.PRODUCTION.sql
-- MAIN only. Manual apply after review.
-- Prerequisites: payments_enforce_integrity (20261102170000), client_balance_entries,
--   crm_balance_write_allowed (20261119200000_cancel_client_balance_entry).
-- =====================================================================================
-- * New payment method 'client_balance' (payments_enforce_integrity accepts it; patched in place).
-- * crm_payer_balance(order, invoice): who pays (invoice payer → invoice client → order payer → order
--   client) and their current balance — one call for the payment form.
-- * crm_pay_from_client_balance(order, invoice, amount, paid_at, note): ONE transaction —
--   payment (method client_balance, no cash account: the money was received earlier as an advance),
--   balance ledger row −amount (document_type 'order_payment', document_id = payment), clients.balance −amount.
--   Refuses when the balance is lower than the amount. All payment rules (remaining, currency, closed
--   orders…) are still enforced by the payments trigger.
-- * Voiding such a payment (or a refund recorded with method client_balance) returns the amount to the
--   balance (document_type 'order_payment_return').
-- =====================================================================================

begin;

do $preflight$
declare
  v_def text;
begin
  if to_regprocedure('public.payments_enforce_integrity()') is null then
    raise exception 'pay_from_balance preflight: payments_enforce_integrity missing';
  end if;
  v_def := pg_get_functiondef('public.payments_enforce_integrity()'::regprocedure);
  if position('''client_balance''' in v_def) = 0
     and position('(''cash'', ''card'', ''bank_transfer'', ''other'')' in v_def) = 0 then
    raise exception 'pay_from_balance preflight: payments_enforce_integrity method list not found';
  end if;
  if to_regclass('public.client_balance_entries') is null then
    raise exception 'pay_from_balance preflight: client_balance_entries missing';
  end if;
  if to_regprocedure('public.crm_balance_write_allowed(uuid)') is null then
    raise exception 'pay_from_balance preflight: apply 20261119200000_cancel_client_balance_entry first';
  end if;
end;
$preflight$;

-- 1) Accept the new method (every occurrence of the method list in the validation trigger).
do $patch$
declare
  v_def text;
  v_con record;
begin
  v_def := pg_get_functiondef('public.payments_enforce_integrity()'::regprocedure);
  if position('''client_balance''' in v_def) = 0 then
    v_def := replace(
      v_def,
      '(''cash'', ''card'', ''bank_transfer'', ''other'')',
      '(''cash'', ''card'', ''bank_transfer'', ''other'', ''client_balance'')'
    );
    execute v_def;
  end if;

  -- A CHECK constraint on payments.payment_method (older schemas) must allow it too.
  for v_con in
    select c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.conrelid = 'public.payments'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%payment_method%'
      and pg_get_constraintdef(c.oid) not ilike '%client_balance%'
  loop
    if position('''other''::text' in v_con.def) = 0 then
      raise exception 'pay_from_balance: unexpected payment_method check %: %', v_con.conname, v_con.def;
    end if;
    execute format('alter table public.payments drop constraint %I', v_con.conname);
    execute format(
      'alter table public.payments add constraint %I %s',
      v_con.conname,
      replace(v_con.def, '''other''::text', '''other''::text, ''client_balance''::text')
    );
  end loop;
end;
$patch$;

-- 2) Payer + balance for the payment form.
create or replace function public.crm_payer_balance(p_order_id uuid, p_invoice_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws uuid;
  v_client uuid;
  v_name text;
  v_balance numeric;
begin
  if p_invoice_id is not null then
    select i.workspace_id, coalesce(i.payer_client_id, i.client_id) into v_ws, v_client
    from public.invoices i where i.id = p_invoice_id;
  end if;
  if v_client is null and p_order_id is not null then
    select o.workspace_id, coalesce(o.payer_client_id, o.client_id) into v_ws, v_client
    from public.orders o where o.id = p_order_id;
  end if;
  if v_ws is null or not coalesce(public.is_workspace_member(v_ws), false) or v_client is null then
    return null;
  end if;
  select nullif(btrim(c.name), ''), coalesce(c.balance, 0) into v_name, v_balance
  from public.clients c where c.id = v_client and c.workspace_id = v_ws;
  if not found then
    return null;
  end if;
  return jsonb_build_object('client_id', v_client, 'client_name', v_name, 'balance', v_balance);
end;
$fn$;

revoke all on function public.crm_payer_balance(uuid, uuid) from public, anon;
grant execute on function public.crm_payer_balance(uuid, uuid) to authenticated, service_role;

-- 3) Pay from the balance.
create or replace function public.crm_pay_from_client_balance(
  p_order_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at timestamptz default now(),
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_ws uuid;
  v_client uuid;
  v_balance numeric;
  v_currency text;
  v_payment public.payments%rowtype;
  v_number text;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
begin
  if v_uid is null then
    raise exception 'pay_from_balance:not_authenticated' using errcode = '42501';
  end if;
  if v_amount <= 0 then
    raise exception 'pay_from_balance:amount_positive' using errcode = '22023';
  end if;

  if p_invoice_id is not null then
    select i.workspace_id, coalesce(i.payer_client_id, i.client_id) into v_ws, v_client
    from public.invoices i where i.id = p_invoice_id;
  end if;
  if v_client is null and p_order_id is not null then
    select o.workspace_id, coalesce(o.payer_client_id, o.client_id) into v_ws, v_client
    from public.orders o where o.id = p_order_id;
  end if;
  if v_ws is null then
    raise exception 'pay_from_balance:not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_ws), false) then
    raise exception 'pay_from_balance:forbidden' using errcode = '42501';
  end if;
  if not coalesce(public.crm_balance_write_allowed(v_ws), true) then
    raise exception 'pay_from_balance:read_only' using errcode = '42501';
  end if;
  if v_client is null then
    raise exception 'pay_from_balance:no_client' using errcode = '22023';
  end if;

  select coalesce(c.balance, 0) into v_balance
  from public.clients c where c.id = v_client and c.workspace_id = v_ws
  for update;
  if not found then
    raise exception 'pay_from_balance:no_client' using errcode = '22023';
  end if;
  if v_balance + 0.005 < v_amount then
    raise exception 'pay_from_balance:insufficient:%', v_balance using errcode = 'P0001';
  end if;

  select upper(btrim(w.currency)) into v_currency from public.workspaces w where w.id = v_ws;

  insert into public.payments (
    workspace_id, order_id, invoice_id, related_payment_id, kind, amount, currency_code,
    payment_method, paid_at, note
  ) values (
    v_ws, p_order_id, p_invoice_id, null, 'payment', v_amount, v_currency,
    'client_balance', coalesce(p_paid_at, now()), nullif(btrim(coalesce(p_note, '')), '')
  )
  returning * into v_payment;

  select o.number into v_number from public.orders o where o.id = v_payment.order_id;

  insert into public.client_balance_entries (
    workspace_id, client_id, amount, currency_code, document_type, document_id, description
  ) values (
    v_ws, v_client, -v_amount, coalesce(v_currency, 'MDL'), 'order_payment', v_payment.id,
    'Оплата заказа' || coalesce(' №' || v_number, '') || ' с баланса'
  );

  update public.clients set balance = coalesce(balance, 0) - v_amount, updated_at = now()
  where id = v_client;

  return jsonb_build_object('payment', to_jsonb(v_payment), 'client_id', v_client, 'balance', v_balance - v_amount);
end;
$fn$;

revoke all on function public.crm_pay_from_client_balance(uuid, uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.crm_pay_from_client_balance(uuid, uuid, numeric, timestamptz, text) to authenticated, service_role;

-- 4) Void / refund of a balance payment returns the money to the balance.
create or replace function public.payments_return_to_client_balance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_entry public.client_balance_entries%rowtype;
  v_number text;
begin
  if new.kind not in ('void', 'refund') or new.related_payment_id is null or new.payment_method <> 'client_balance' then
    return new;
  end if;
  select * into v_entry from public.client_balance_entries e
  where e.workspace_id = new.workspace_id
    and e.document_type = 'order_payment'
    and e.document_id = new.related_payment_id
  limit 1;
  if not found then
    return new;
  end if;
  select o.number into v_number from public.orders o where o.id = new.order_id;
  insert into public.client_balance_entries (
    workspace_id, client_id, amount, currency_code, document_type, document_id, description
  ) values (
    new.workspace_id, v_entry.client_id, new.amount, new.currency_code, 'order_payment_return', new.id,
    'Возврат на баланс' || coalesce(' (заказ №' || v_number || ')', '')
  );
  update public.clients set balance = coalesce(balance, 0) + new.amount, updated_at = now()
  where id = v_entry.client_id;
  return new;
end;
$fn$;

drop trigger if exists payments_return_to_client_balance_ai on public.payments;
create trigger payments_return_to_client_balance_ai
  after insert on public.payments
  for each row execute function public.payments_return_to_client_balance();

revoke all on function public.payments_return_to_client_balance() from public, anon, authenticated;

notify pgrst, 'reload schema';

do $postflight$
begin
  if position('''client_balance''' in pg_get_functiondef('public.payments_enforce_integrity()'::regprocedure)) = 0 then
    raise exception 'pay_from_balance postflight: payment method not accepted';
  end if;
  if to_regprocedure('public.crm_pay_from_client_balance(uuid,uuid,numeric,timestamptz,text)') is null
     or to_regprocedure('public.crm_payer_balance(uuid,uuid)') is null then
    raise exception 'pay_from_balance postflight: functions missing';
  end if;
end;
$postflight$;

commit;
