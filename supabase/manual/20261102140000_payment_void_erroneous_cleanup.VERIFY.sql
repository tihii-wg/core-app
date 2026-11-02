-- Read-only VERIFY for payment void + erroneous cleanup RPCs.
-- Also fails when payments_refund_requires_original rejects kind=void, or when
-- payments_enforce_integrity does not count void as a paid/refund offset
-- (see 20261102170000_payment_void_related_offset_fix.*).

with kind_ok as (
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'payments' and c.conname = 'payments_kind_check'
      and pg_get_constraintdef(c.oid) ilike '%void%'
  ) as ok
),
related_ok as (
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'payments'
      and c.conname = 'payments_refund_requires_original'
      and pg_get_constraintdef(c.oid) ilike '%void%'
  ) as ok
),
integrity_def as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'payments_enforce_integrity' and p.prosecdef
  limit 1
),
integrity_ok as (
  select
    exists (select 1 from integrity_def d where d.def ilike '%void%') as has_void,
    exists (
      select 1 from integrity_def d
      where d.def ~* $$when\s+p\.kind\s+in\s*\(\s*'refund'\s*,\s*'void'\s*\)\s+then\s+-p\.amount$$
    ) as nets_void_as_offset
),
void_rpc as (
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_fully_voided_payment' and p.prosecdef
  ) as ok
),
inv_rpc as (
  select
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'delete_erroneous_invoice'
        and p.prosecdef
        and pg_get_functiondef(p.oid) ilike '%workspace_write_allowed%'
        and (
          pg_get_functiondef(p.oid) ilike '%crm_has_permission%'
          or pg_get_functiondef(p.oid) ilike '%invoices.delete%'
          or pg_get_functiondef(p.oid) ilike '%is_workspace_member%'
        )
        and pg_get_functiondef(p.oid) ilike '%from public.payments%'
        and pg_get_functiondef(p.oid) not ilike '%active payment%'
    ) as ok,
    not coalesce(has_function_privilege('anon', 'public.delete_erroneous_invoice(uuid)', 'EXECUTE'), false) as anon_denied
)
select
  case
    when kind_ok.ok
     and related_ok.ok
     and integrity_ok.has_void
     and integrity_ok.nets_void_as_offset
     and void_rpc.ok
     and inv_rpc.ok
     and inv_rpc.anon_denied
    then 'READY'
    else 'NOT_READY'
  end as result,
  kind_ok.ok as kind_allows_void,
  related_ok.ok as related_allows_void,
  integrity_ok.has_void as integrity_supports_void,
  integrity_ok.nets_void_as_offset as integrity_nets_void_as_offset,
  void_rpc.ok as delete_fully_voided_payment_exists,
  inv_rpc.ok as delete_erroneous_invoice_entitled_any_payments,
  inv_rpc.anon_denied as delete_erroneous_invoice_anon_denied
from kind_ok, related_ok, integrity_ok, void_rpc, inv_rpc;
