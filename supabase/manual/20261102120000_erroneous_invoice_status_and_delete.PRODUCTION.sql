-- Erroneous invoice status + invoice-only delete RPC.
-- Target: MAIN (pundggjzzaqzbvykbxvo) when the owner explicitly authorizes APPLY.
-- Do NOT run against TEST. Do NOT auto-apply.
--
-- What this does:
--   1) Extends public.invoices.status CHECK to allow 'erroneous' ("Sent in error").
--   2) Adds SECURITY DEFINER RPC public.delete_erroneous_invoice(p_invoice_id)
--      that deletes ONLY that invoice (invoice_items CASCADE) when:
--        - caller is authenticated and a member of the invoice workspace
--        - invoice.status = 'erroneous'
--        - no payments.invoice_id rows exist for it
--        - no finance_transactions.invoice_id rows exist for it
--        - no credit_notes.invoice_id rows exist for it
--      The associated order is NEVER deleted or updated.
--
-- Invoice numbers are not reused (unique constraint + number counter stay intact).
-- invoice_orders junction rows (if present) CASCADE with the invoice only.

begin;

-- ---------------------------------------------------------------------------
-- 1. Status check: allow 'erroneous'
-- ---------------------------------------------------------------------------
alter table public.invoices
  drop constraint if exists invoices_status_check;

alter table public.invoices
  add constraint invoices_status_check
  check (status = any (array[
    'draft'::text,
    'sent'::text,
    'paid'::text,
    'overdue'::text,
    'erroneous'::text
  ]));

-- ---------------------------------------------------------------------------
-- 2. delete_erroneous_invoice — invoice only, never the order
-- ---------------------------------------------------------------------------
create or replace function public.delete_erroneous_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_payment_count bigint := 0;
  v_finance_count bigint := 0;
  v_credit_count bigint := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  if p_invoice_id is null then
    raise exception 'Invoice id is required'
      using errcode = '22023';
  end if;

  select * into v_invoice
  from public.invoices i
  where i.id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice was not found or you do not have permission to change it.'
      using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_invoice.workspace_id) then
    raise exception 'Invoice was not found or you do not have permission to change it.'
      using errcode = '42501';
  end if;

  if v_invoice.status is distinct from 'erroneous' then
    raise exception 'Only invoices marked as sent in error can be deleted.'
      using errcode = 'P0001';
  end if;

  -- Payments: never silently drop or detach ledger history.
  if to_regclass('public.payments') is not null then
    execute
      'select count(*)::bigint from public.payments p where p.invoice_id = $1'
      into v_payment_count
      using p_invoice_id;
    if v_payment_count > 0 then
      raise exception
        'Cannot delete invoice %: % payment ledger row(s) still reference it. Refund or reassign those payments first; the order is unchanged.',
        v_invoice.number, v_payment_count
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.finance_transactions') is not null then
    execute
      'select count(*)::bigint from public.finance_transactions t where t.invoice_id = $1 and t.deleted_at is null'
      into v_finance_count
      using p_invoice_id;
    if v_finance_count > 0 then
      raise exception
        'Cannot delete invoice %: % finance transaction(s) still reference it. Resolve those transactions first; the order is unchanged.',
        v_invoice.number, v_finance_count
        using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.credit_notes') is not null then
    execute
      'select count(*)::bigint from public.credit_notes c where c.invoice_id = $1 and c.deleted_at is null'
      into v_credit_count
      using p_invoice_id;
    if v_credit_count > 0 then
      raise exception
        'Cannot delete invoice %: % credit note(s) still reference it. Detach or cancel those credit notes first; the order is unchanged.',
        v_invoice.number, v_credit_count
        using errcode = 'P0001';
    end if;
  end if;

  -- invoice_items CASCADE; invoice_orders CASCADE if present. orders table is not touched.
  delete from public.invoices i
  where i.id = p_invoice_id
    and i.workspace_id = v_invoice.workspace_id
    and i.status = 'erroneous';

  if not found then
    raise exception 'Invoice was not found or you do not have permission to change it.'
      using errcode = 'P0002';
  end if;
end;
$function$;

revoke all on function public.delete_erroneous_invoice(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_erroneous_invoice(uuid) to authenticated;
grant execute on function public.delete_erroneous_invoice(uuid) to service_role;

commit;
