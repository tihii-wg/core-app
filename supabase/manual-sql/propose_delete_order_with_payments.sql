-- =============================================================================
-- PROPOSAL ONLY — DO NOT APPLY without explicit operator review.
-- This file was NOT executed against any database by the authoring process.
-- It is not a migration. Do not auto-run it.
--
-- Why this is required
-- --------------------
-- public.payments is append-only for authenticated clients (SELECT/INSERT only;
-- see harden_payment_ledger.sql preflight and local-validate fixtures).
-- Client-side DELETE FROM payments cannot work under that model and would risk
-- partial deletes if paired with a separate orders DELETE.
--
-- This SECURITY DEFINER RPC deletes, in one transaction:
--   1) payment rows with order_id = p_order_id AND workspace_id = p_workspace_id
--      (refunds / related_payment_id rows first — ON DELETE RESTRICT safe)
--   2) the order row in that workspace
-- It never deletes invoices, clients, or payments for other orders.
--
-- Column names match src/services/apiPayments.ts / local fixtures:
--   payments: id, workspace_id, order_id, invoice_id, related_payment_id, …
--   orders: id, workspace_id, …
--   invoices: id, workspace_id, order_id, …
-- Auth: public.is_workspace_member(uuid) (baseline).
-- Order DELETE policy for members: is_workspace_member(workspace_id).
--
-- After review, paste into the Supabase SQL Editor. Then the app RPC
-- delete_order_with_payments becomes available.
-- =============================================================================

begin;

create or replace function public.delete_order_with_payments(
  p_workspace_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_payment_count integer := 0;
  v_order_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'order_delete:not_authenticated'
      using errcode = '42501';
  end if;

  if p_workspace_id is null or p_order_id is null then
    raise exception 'order_delete:not_found'
      using errcode = 'P0002';
  end if;

  -- Same membership gate as order RLS (Members can delete workspace orders).
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'order_delete:not_member'
      using errcode = '42501';
  end if;

  select o.id
    into v_order_id
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if v_order_id is null then
    raise exception 'order_delete:not_found'
      using errcode = 'P0002';
  end if;

  -- Keep invoice restriction: abort entire transaction if any invoice links here.
  if exists (
    select 1
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.order_id = p_order_id
  ) then
    raise exception 'order_delete:has_invoice'
      using errcode = '23514';
  end if;

  select count(*)::integer
    into v_payment_count
  from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id;

  -- related_payment_id → payments(id) may be ON DELETE RESTRICT: remove dependents first.
  delete from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id
    and p.related_payment_id is not null;

  delete from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id;

  delete from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id;

  if not found then
    raise exception 'order_delete:not_found'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payments_deleted', v_payment_count
  );
end;
$function$;

comment on function public.delete_order_with_payments(uuid, uuid) is
  'managed-object: core-app/delete_order_with_payments@v1 — DEV convenience: atomically delete an order and its order_id-linked payment rows after membership + invoice checks. Review before apply.';

revoke all on function public.delete_order_with_payments(uuid, uuid) from public;
revoke all on function public.delete_order_with_payments(uuid, uuid) from anon;
revoke all on function public.delete_order_with_payments(uuid, uuid) from authenticated;
revoke all on function public.delete_order_with_payments(uuid, uuid) from service_role;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated;
grant execute on function public.delete_order_with_payments(uuid, uuid) to service_role;

commit;
