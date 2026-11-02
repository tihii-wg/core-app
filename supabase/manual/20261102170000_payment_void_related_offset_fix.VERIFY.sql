-- Read-only VERIFY for void related_payment_id CHECK + integrity void offsets.
-- Safe to re-run. Does not modify data.
-- Fails (NOT_READY) when payments_refund_requires_original rejects kind=void,
-- or when payments_enforce_integrity does not treat void as a paid/refund offset.

with related_ok as (
  select exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'payments'
      and c.conname = 'payments_refund_requires_original'
      and pg_get_constraintdef(c.oid) ilike '%void%'
      and pg_get_constraintdef(c.oid) ilike '%related_payment_id%'
  ) as ok
),
integrity_def as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'payments_enforce_integrity'
    and p.prosecdef
  limit 1
),
offset_ok as (
  select
    exists (select 1 from integrity_def) as fn_exists,
    exists (
      select 1 from integrity_def d
      where d.def ~* $$when\s+p\.kind\s+in\s*\(\s*'refund'\s*,\s*'void'\s*\)\s+then\s+-p\.amount$$
         or d.def ~* $$when\s+p\.kind\s+in\s*\(\s*'void'\s*,\s*'refund'\s*\)\s+then\s+-p\.amount$$
    ) as nets_void_as_offset,
    exists (
      select 1 from integrity_def d
      -- refund-remaining sum must include void (not refund-only)
      where d.def ~* $$p\.kind\s+in\s*\(\s*'refund'\s*,\s*'void'\s*\)$$
        and d.def ~* $$into\s+v_refunded$$
    ) as refund_counts_void
)
select
  case
    when related_ok.ok
     and offset_ok.fn_exists
     and offset_ok.nets_void_as_offset
     and offset_ok.refund_counts_void
    then 'READY'
    else 'NOT_READY'
  end as result,
  related_ok.ok as related_allows_void,
  offset_ok.fn_exists as integrity_exists,
  offset_ok.nets_void_as_offset as integrity_nets_void_as_offset,
  offset_ok.refund_counts_void as integrity_refund_counts_void
from related_ok, offset_ok;
