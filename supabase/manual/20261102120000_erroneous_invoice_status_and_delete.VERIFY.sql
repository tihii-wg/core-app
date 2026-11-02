-- Read-only VERIFY for erroneous invoice status + delete_erroneous_invoice RPC.
-- Safe to re-run. Does not modify data.

with status_ok as (
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'invoices'
      and c.conname = 'invoices_status_check'
      and pg_get_constraintdef(c.oid) ilike '%erroneous%'
  ) as ok
),
rpc_ok as (
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'delete_erroneous_invoice'
      and pg_get_function_identity_arguments(p.oid) = 'p_invoice_id uuid'
      and p.prosecdef
  ) as ok
),
grant_ok as (
  select has_function_privilege('authenticated', 'public.delete_erroneous_invoice(uuid)', 'EXECUTE') as ok
)
select
  case when status_ok.ok and rpc_ok.ok and grant_ok.ok then 'READY' else 'NOT_READY' end as result,
  status_ok.ok as status_allows_erroneous,
  rpc_ok.ok as delete_rpc_exists_security_definer,
  grant_ok.ok as authenticated_can_execute
from status_ok, rpc_ok, grant_ok;
