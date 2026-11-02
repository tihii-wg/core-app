-- Read-only VERIFY for delete_erroneous_invoice entitlement hardening.
-- Safe to re-run. Does not modify data.

with write_fn as (
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'workspace_write_allowed'
      and pg_get_function_identity_arguments(p.oid) = 'p_workspace uuid'
      and p.prosecdef
  ) as ok
),
rpc as (
  select
    p.oid,
    p.prosecdef,
    pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'delete_erroneous_invoice'
    and pg_get_function_identity_arguments(p.oid) = 'p_invoice_id uuid'
),
rpc_ok as (
  select exists (select 1 from rpc where prosecdef) as ok
),
body_checks as (
  select
    exists (select 1 from rpc r where r.def ilike '%workspace_write_allowed%') as requires_subscription,
    exists (
      select 1 from rpc r
      where r.def ilike '%crm_has_permission%'
         or r.def ilike '%invoices.delete%'
         or r.def ilike '%is_workspace_member%'
    ) as requires_permission_or_membership,
    exists (
      select 1 from rpc r
      where r.def ilike '%from public.payments%'
        and r.def ilike '%invoice_id%'
        and r.def not ilike '%active payment%'
    ) as blocks_any_payments
),
grants as (
  select
    coalesce(has_function_privilege('authenticated', 'public.delete_erroneous_invoice(uuid)', 'EXECUTE'), false) as auth_exec,
    not coalesce(has_function_privilege('anon', 'public.delete_erroneous_invoice(uuid)', 'EXECUTE'), false) as anon_denied,
    coalesce(has_function_privilege('authenticated', 'public.workspace_write_allowed(uuid)', 'EXECUTE'), false) as write_auth_exec,
    not coalesce(has_function_privilege('anon', 'public.workspace_write_allowed(uuid)', 'EXECUTE'), false) as write_anon_denied
)
select
  case
    when write_fn.ok
     and rpc_ok.ok
     and body_checks.requires_subscription
     and body_checks.requires_permission_or_membership
     and body_checks.blocks_any_payments
     and grants.auth_exec
     and grants.anon_denied
     and grants.write_auth_exec
     and grants.write_anon_denied
    then 'READY'
    else 'NOT_READY'
  end as result,
  write_fn.ok as workspace_write_allowed_exists,
  rpc_ok.ok as delete_rpc_security_definer,
  body_checks.requires_subscription as delete_requires_subscription,
  body_checks.requires_permission_or_membership as delete_requires_permission_or_membership,
  body_checks.blocks_any_payments as delete_blocks_any_payments,
  grants.auth_exec as authenticated_can_execute_delete,
  grants.anon_denied as anon_cannot_execute_delete,
  grants.write_auth_exec as authenticated_can_execute_write_allowed,
  grants.write_anon_denied as anon_cannot_execute_write_allowed
from write_fn, rpc_ok, body_checks, grants;
