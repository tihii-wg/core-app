-- =============================================================================
-- Default cash accounts are created automatically for every workspace
-- Script: 20261106170000_auto_default_finance_accounts.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- Problem: finance_accounts is empty and the app has no "create account" UI,
-- so payments / supplier refunds have no account to choose.
--
-- Fix:
--   1) crm_ensure_default_finance_accounts(p_workspace_id) — creates
--      "Касса (наличные)" (cash) and "Банковский счёт" (cashless) in the workspace
--      currency when the workspace has NO active accounts at all. Idempotent.
--   2) AFTER INSERT trigger on workspaces → every new workspace gets them.
--   3) AFTER UPDATE OF currency on workspaces → default accounts that have no
--      finance_transactions and no payments yet follow the new currency.
--   4) One-time backfill for existing, not deleted workspaces without accounts.
--
-- Does NOT: touch workspaces that already have accounts, change balances,
-- payments, or RLS. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.finance_accounts') is null then
    raise exception 'auto_default_finance_accounts preflight: finance_accounts missing (apply crm_ro_v1 first)';
  end if;
  if to_regclass('public.workspaces') is null then
    raise exception 'auto_default_finance_accounts preflight: workspaces missing';
  end if;
end;
$preflight$;

create or replace function public.crm_ensure_default_finance_accounts(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_currency text;
  v_created integer := 0;
begin
  if p_workspace_id is null then
    return 0;
  end if;

  select upper(coalesce(nullif(btrim(w.currency), ''), 'MDL')) into v_currency
  from public.workspaces w
  where w.id = p_workspace_id and w.deleted_at is null;
  if v_currency is null then
    return 0;
  end if;

  -- Only for workspaces with no accounts at all (never duplicates user-made accounts).
  if exists (
    select 1 from public.finance_accounts a
    where a.workspace_id = p_workspace_id and a.deleted_at is null
  ) then
    return 0;
  end if;

  insert into public.finance_accounts (workspace_id, name, account_type, currency_code, opening_balance)
  values
    (p_workspace_id, 'Касса (наличные)', 'cash', v_currency, 0),
    (p_workspace_id, 'Банковский счёт', 'cashless', v_currency, 0);
  get diagnostics v_created = row_count;
  return v_created;
end;
$fn$;

revoke all on function public.crm_ensure_default_finance_accounts(uuid) from public, anon, authenticated;

comment on function public.crm_ensure_default_finance_accounts(uuid) is
  'managed-object: core-app/crm_ensure_default_finance_accounts@v1 — creates default cash + bank accounts for a workspace without accounts.';

-- New workspaces
create or replace function public.crm_workspaces_default_finance_accounts_ai()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.crm_ensure_default_finance_accounts(new.id);
  return new;
end;
$fn$;

revoke all on function public.crm_workspaces_default_finance_accounts_ai() from public, anon, authenticated;

drop trigger if exists crm_workspaces_default_finance_accounts on public.workspaces;
create trigger crm_workspaces_default_finance_accounts
  after insert on public.workspaces
  for each row execute function public.crm_workspaces_default_finance_accounts_ai();

-- Currency change: unused default accounts follow the workspace currency
create or replace function public.crm_workspaces_default_accounts_currency_au()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_currency text := upper(coalesce(nullif(btrim(new.currency), ''), 'MDL'));
begin
  if new.currency is not distinct from old.currency then
    return new;
  end if;

  update public.finance_accounts a
     set currency_code = v_currency, updated_at = now()
   where a.workspace_id = new.id
     and a.deleted_at is null
     and a.name in ('Касса (наличные)', 'Банковский счёт')
     and a.opening_balance = 0
     and not exists (
       select 1 from public.finance_transactions t
       where t.account_id = a.id or t.transfer_to_account_id = a.id
     )
     and (
       to_regclass('public.payments') is null
       or not exists (
         select 1 from public.payments p
         where p.workspace_id = new.id
           and (to_jsonb(p) ->> 'account_id') = a.id::text
       )
     );
  return new;
end;
$fn$;

revoke all on function public.crm_workspaces_default_accounts_currency_au() from public, anon, authenticated;

drop trigger if exists crm_workspaces_default_accounts_currency on public.workspaces;
create trigger crm_workspaces_default_accounts_currency
  after update of currency on public.workspaces
  for each row execute function public.crm_workspaces_default_accounts_currency_au();

-- One-time backfill for existing workspaces
do $backfill$
declare
  v_ws record;
  v_total integer := 0;
begin
  for v_ws in select id from public.workspaces where deleted_at is null loop
    v_total := v_total + public.crm_ensure_default_finance_accounts(v_ws.id);
  end loop;
  raise notice 'auto_default_finance_accounts: created % account(s)', v_total;
end;
$backfill$;

do $postflight$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_workspaces_default_finance_accounts'
                 and tgrelid = 'public.workspaces'::regclass and not tgisinternal) then
    raise exception 'auto_default_finance_accounts postflight: insert trigger missing';
  end if;
end;
$postflight$;

commit;

-- Check:
-- select w.name, a.name, a.account_type, a.currency_code
-- from public.finance_accounts a join public.workspaces w on w.id = a.workspace_id
-- where a.deleted_at is null order by w.name, a.name;
