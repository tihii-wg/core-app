-- =============================================================================
-- Supplier return refund: record money received back from the supplier
-- Script: 20261106150000_supplier_return_refund.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisite: 20261106140000_supplier_returns_post (crm_post_supplier_return)
-- =============================================================================
-- Adds:
--   1) supplier_returns.refund_account_id, finance_transaction_id (nullable FKs).
--   2) crm_record_supplier_return_refund(p_return_id, p_account_id, p_amount,
--        p_occurred_at default now(), p_comment default null) -> jsonb
--      - return must be POSTED and not refunded yet (one refund per return)
--      - permission: finance.transactions.income (same rule as finance_transactions insert RLS)
--      - account: same workspace, active, not deleted, allow_income, currency = workspace currency
--      - 0 < amount <= return total
--      - inserts finance_transactions (transaction_type 'income') into that account and links
--        it to the return (finance_transaction_id, refund_account_id)
--   3) crm_post_supplier_return_with_refund(p_return_id, p_account_id, p_amount, p_comment)
--      - posts the return and records the refund in ONE transaction
--        (p_account_id NULL → post only)
--
-- Does NOT: change payments, orders, receipt finance, account opening balances.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array['supplier_returns','finance_transactions','finance_accounts','workspaces']) as t
  where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'supplier_return_refund preflight: missing tables: %', v_missing;
  end if;
  if to_regprocedure('public.crm_post_supplier_return(uuid)') is null then
    raise exception 'supplier_return_refund preflight: crm_post_supplier_return missing (apply 20261106140000 first)';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    raise exception 'supplier_return_refund preflight: crm_has_permission missing';
  end if;
end;
$preflight$;

alter table public.supplier_returns
  add column if not exists refund_account_id uuid references public.finance_accounts(id) on delete set null;
alter table public.supplier_returns
  add column if not exists finance_transaction_id uuid references public.finance_transactions(id) on delete set null;

create or replace function public.crm_record_supplier_return_refund(
  p_return_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_occurred_at timestamptz default null,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ret public.supplier_returns%rowtype;
  v_account public.finance_accounts%rowtype;
  v_ws_currency text;
  v_txn_id uuid;
  v_comment text;
begin
  if (select auth.uid()) is null then
    raise exception 'supplier_return_refund:not_authenticated' using errcode = '42501';
  end if;
  if p_return_id is null or p_account_id is null then
    raise exception 'supplier_return_refund:invalid_args' using errcode = '22023';
  end if;

  select * into v_ret from public.supplier_returns where id = p_return_id for update;
  if not found or v_ret.deleted_at is not null then
    raise exception 'supplier_return_refund:not_found' using errcode = 'P0002';
  end if;

  if not public.crm_has_permission(v_ret.workspace_id, 'finance.transactions.income') then
    raise exception 'supplier_return_refund:forbidden' using errcode = '42501';
  end if;

  if v_ret.posted_at is null then
    raise exception 'supplier_return_refund:not_posted' using errcode = '22023';
  end if;
  if v_ret.finance_transaction_id is not null then
    raise exception 'supplier_return_refund:already_refunded' using errcode = '55000';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'supplier_return_refund:amount_positive' using errcode = '22023';
  end if;
  if round(p_amount, 2) > round(coalesce(v_ret.total, 0), 2) then
    raise exception 'supplier_return_refund:amount_exceeds_total' using errcode = '23514',
      detail = coalesce(v_ret.total, 0)::text;
  end if;

  select * into v_account from public.finance_accounts
   where id = p_account_id and workspace_id = v_ret.workspace_id;
  if not found or v_account.deleted_at is not null or not v_account.is_active then
    raise exception 'supplier_return_refund:account_invalid' using errcode = '22023';
  end if;
  if not coalesce(v_account.allow_income, true) then
    raise exception 'supplier_return_refund:account_no_income' using errcode = '22023';
  end if;

  select upper(coalesce(w.currency, v_account.currency_code)) into v_ws_currency
  from public.workspaces w where w.id = v_ret.workspace_id;
  if upper(v_account.currency_code) is distinct from v_ws_currency then
    raise exception 'supplier_return_refund:currency_mismatch' using errcode = '23514';
  end if;

  v_comment := coalesce(
    nullif(btrim(p_comment), ''),
    'Supplier return' || coalesce(' ' || v_ret.number, '') || coalesce(' — ' || nullif(btrim(v_ret.supplier_name), ''), '')
  );

  insert into public.finance_transactions (
    workspace_id, transaction_type, account_id, amount, currency_code,
    occurred_at, comment, client_id, created_by
  ) values (
    v_ret.workspace_id, 'income', v_account.id, round(p_amount, 2), v_account.currency_code,
    coalesce(p_occurred_at, now()), v_comment, v_ret.supplier_client_id, (select auth.uid())
  )
  returning id into v_txn_id;

  update public.supplier_returns
     set finance_transaction_id = v_txn_id,
         refund_account_id = v_account.id,
         updated_at = now()
   where id = p_return_id;

  return jsonb_build_object(
    'supplier_return_id', p_return_id,
    'finance_transaction_id', v_txn_id,
    'account_id', v_account.id,
    'amount', round(p_amount, 2)
  );
end;
$$;

revoke all on function public.crm_record_supplier_return_refund(uuid, uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.crm_record_supplier_return_refund(uuid, uuid, numeric, timestamptz, text) to authenticated;

comment on function public.crm_record_supplier_return_refund(uuid, uuid, numeric, timestamptz, text) is
  'managed-object: core-app/crm_record_supplier_return_refund@v1 — income finance transaction for money received back from a supplier on a posted return (one per return).';

create or replace function public.crm_post_supplier_return_with_refund(
  p_return_id uuid,
  p_account_id uuid default null,
  p_amount numeric default null,
  p_comment text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_post jsonb;
  v_refund jsonb := null;
  v_amount numeric;
begin
  v_post := public.crm_post_supplier_return(p_return_id);

  if p_account_id is not null then
    v_amount := coalesce(p_amount, (v_post ->> 'total')::numeric);
    v_refund := public.crm_record_supplier_return_refund(p_return_id, p_account_id, v_amount, now(), p_comment);
  end if;

  return v_post || jsonb_build_object('refund', v_refund);
end;
$$;

revoke all on function public.crm_post_supplier_return_with_refund(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.crm_post_supplier_return_with_refund(uuid, uuid, numeric, text) to authenticated;

comment on function public.crm_post_supplier_return_with_refund(uuid, uuid, numeric, text) is
  'managed-object: core-app/crm_post_supplier_return_with_refund@v1 — post supplier return + optional refund income in one transaction.';

do $postflight$
begin
  if to_regprocedure('public.crm_record_supplier_return_refund(uuid,uuid,numeric,timestamptz,text)') is null
     or to_regprocedure('public.crm_post_supplier_return_with_refund(uuid,uuid,numeric,text)') is null then
    raise exception 'supplier_return_refund postflight: RPC missing';
  end if;
end;
$postflight$;

commit;
