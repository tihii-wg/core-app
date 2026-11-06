-- =============================================================================
-- Seed default cash accounts for ONE workspace
-- Script: 20261106160000_seed_finance_accounts.PRODUCTION.sql
-- MAIN only. Manual apply.
-- =============================================================================
-- STEP 1 (run alone first): find your workspace id
--   select id, name, currency, created_at from public.workspaces
--   where deleted_at is null order by created_at;
--
-- STEP 2: replace the placeholder below with that id and run the whole block.
-- Creates "Касса (наличные)" and "Банковский счёт" in the workspace currency,
-- opening balance 0, income/expense/transfers allowed. Skips an account if one
-- with the same name already exists. Touches no other workspace.
-- =============================================================================

do $seed$
declare
  v_ws uuid := 'PASTE-WORKSPACE-ID-HERE';
  v_currency text;
  v_created integer := 0;
begin
  if to_regclass('public.finance_accounts') is null then
    raise exception 'finance_accounts table is missing (crm_ro_v1 not applied)';
  end if;

  select upper(coalesce(w.currency, 'MDL')) into v_currency
  from public.workspaces w
  where w.id = v_ws and w.deleted_at is null;
  if v_currency is null then
    raise exception 'workspace % not found', v_ws;
  end if;

  if not exists (select 1 from public.finance_accounts
                 where workspace_id = v_ws and name = 'Касса (наличные)' and deleted_at is null) then
    insert into public.finance_accounts (workspace_id, name, account_type, currency_code, opening_balance)
    values (v_ws, 'Касса (наличные)', 'cash', v_currency, 0);
    v_created := v_created + 1;
  end if;

  if not exists (select 1 from public.finance_accounts
                 where workspace_id = v_ws and name = 'Банковский счёт' and deleted_at is null) then
    insert into public.finance_accounts (workspace_id, name, account_type, currency_code, opening_balance)
    values (v_ws, 'Банковский счёт', 'cashless', v_currency, 0);
    v_created := v_created + 1;
  end if;

  raise notice 'seed_finance_accounts: created % account(s) in % for workspace %', v_created, v_currency, v_ws;
end;
$seed$;

-- Check:
-- select name, account_type, currency_code, opening_balance, is_active
-- from public.finance_accounts where workspace_id = 'PASTE-WORKSPACE-ID-HERE';
