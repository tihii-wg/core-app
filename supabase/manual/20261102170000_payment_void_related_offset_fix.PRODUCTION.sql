-- Fix void inserts: related_payment_id CHECK + integrity offsets.
-- Target: MAIN when owner authorizes APPLY. Do NOT auto-apply. Do NOT run on TEST.
-- Depends on: public.payments, public.payments_enforce_integrity (void-aware v2).
--
-- What this does:
--  1) Recreates payments_refund_requires_original so kind=void requires related_payment_id
--     (payment still requires NULL; refund/void require NOT NULL).
--  2) CREATE OR REPLACE payments_enforce_integrity so:
--     a) invoice/order overpayment nets treat void like refund (subtract);
--     b) refund remaining counts prior void rows (voided payment cannot be refunded).
--  Keeps SECURITY DEFINER, search_path '', lock order, and error codes unchanged.
--
-- Idempotent. Does not touch delete_erroneous_invoice / delete_fully_voided_payment.

begin;

-- ---------------------------------------------------------------------------
-- 1. related_payment_id / kind coupling (allow void offsets)
-- ---------------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_refund_requires_original;
alter table public.payments
  add constraint payments_refund_requires_original
  check (
    (kind = 'payment' and related_payment_id is null)
    or (kind in ('refund', 'void') and related_payment_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 2. Integrity trigger — void offsets in nets + refund remaining
-- ---------------------------------------------------------------------------
create or replace function public.payments_enforce_integrity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_peek_order_id uuid;
  v_peek_workspace uuid;
  v_order_id uuid;
  v_invoice_id uuid;
  v_locked_order_id uuid;
  v_order_workspace uuid;
  v_invoice_workspace uuid;
  v_invoice_order uuid;
  v_invoice_total numeric;
  v_order_total numeric;
  v_workspace_currency text;
  v_original public.payments%rowtype;
  v_refunded numeric;
  v_paid numeric;
  v_remaining numeric;
  v_currency_count integer;
  v_existing_currency text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  -- Normalize + format currency
  new.currency_code := upper(trim(coalesce(new.currency_code, '')));
  if new.currency_code !~ '^[A-Z]{3}$' then
    raise exception 'payments_validation:currency_format' using errcode = '23514';
  end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'payments_validation:amount_positive' using errcode = '23514';
  end if;

  -- kind_invalid is distinct from method_invalid so clients do not ask users
  -- to "choose a payment method" when void/kind support is missing.
  if new.kind is null or new.kind not in ('payment', 'refund', 'void') then
    raise exception 'payments_validation:kind_invalid' using errcode = '23514';
  end if;

  if new.payment_method is null
     or new.payment_method not in ('cash', 'card', 'bank_transfer', 'other') then
    raise exception 'payments_validation:method_invalid' using errcode = '23514';
  end if;

  if new.workspace_id is null or not public.is_workspace_member(new.workspace_id) then
    raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
  end if;

  -- Fail closed: workspace must exist, not soft-deleted (deleted_at IS NULL),
  -- and currency must be a normalized three-letter code. Orders/invoices have
  -- no currency column; workspaces.currency is the sole billing currency.
  --
  -- FOR SHARE first (global lock order: WORKSPACE → ORDER → INVOICE). Blocks
  -- concurrent workspace currency UPDATEs for the life of this insert while
  -- still allowing concurrent payment ShareLocks on the same workspace.
  select upper(trim(coalesce(w.currency, ''))) into v_workspace_currency
  from public.workspaces w
  where w.id = new.workspace_id
    and w.deleted_at is null
  for share;

  if not found then
    raise exception 'payments_validation:workspace_currency_invalid' using errcode = '23514';
  end if;
  if v_workspace_currency !~ '^[A-Z]{3}$' then
    raise exception 'payments_validation:workspace_currency_invalid' using errcode = '23514';
  end if;
  if v_workspace_currency is distinct from new.currency_code then
    raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
  end if;

  if new.kind = 'payment' then
    new.related_payment_id := null;

    if new.order_id is null and new.invoice_id is null then
      raise exception 'payments_validation:link_required' using errcode = '23514';
    end if;

    v_order_id := new.order_id;
    v_invoice_id := new.invoice_id;
    v_locked_order_id := null;

    ------------------------------------------------------------------
    -- Lock acquisition (ORDER then INVOICE). Peek is not authoritative.
    -- Workspace ShareLock already held above.
    ------------------------------------------------------------------
    if v_invoice_id is not null and v_order_id is null then
      -- Peek only to discover whether an order must be locked first.
      select i.order_id, i.workspace_id
        into v_peek_order_id, v_peek_workspace
      from public.invoices i
      where i.id = v_invoice_id;

      if not found then
        raise exception 'payments_validation:invoice_not_found' using errcode = '23503';
      end if;
      if v_peek_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;
      v_order_id := v_peek_order_id;
    end if;

    if v_order_id is not null then
      select o.workspace_id, o.total_price
        into v_order_workspace, v_order_total
      from public.orders o
      where o.id = v_order_id
      for update;

      if not found then
        raise exception 'payments_validation:order_not_found' using errcode = '23503';
      end if;
      if v_order_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;
      v_locked_order_id := v_order_id;
      new.order_id := v_order_id;
    end if;

    -- Resolve invoice id for order-only inserts (still before locking invoice).
    if v_invoice_id is null and v_order_id is not null then
      select i.id into v_invoice_id
      from public.invoices i
      where i.workspace_id = new.workspace_id
        and i.order_id = v_order_id;
    end if;

    if v_invoice_id is not null then
      select i.workspace_id, i.order_id, i.total
        into v_invoice_workspace, v_invoice_order, v_invoice_total
      from public.invoices i
      where i.id = v_invoice_id
      for update;

      if not found then
        raise exception 'payments_validation:invoice_not_found' using errcode = '23503';
      end if;
      if v_invoice_workspace is distinct from new.workspace_id then
        raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
      end if;

      -- Re-validate relationship after locks.
      --
      -- Invoice-only race: unlocked peek may have seen order_id IS NULL, so we
      -- did not take the order FOR UPDATE. If the locked invoice now has a
      -- non-null order_id, assigning it without locking that order would skip
      -- serialization against concurrent order payments. Taking the order lock
      -- here would invert the global ORDER → INVOICE order and risk deadlock.
      -- Fail closed with a retryable error so the client can re-submit (peek
      -- will then see the order and lock ORDER then INVOICE correctly).
      if v_invoice_order is not null and v_locked_order_id is null then
        raise exception 'payments_validation:invoice_order_changed_retry' using errcode = '40001';
      end if;
      if v_invoice_order is not null
         and v_locked_order_id is not null
         and v_locked_order_id is distinct from v_invoice_order then
        raise exception 'payments_validation:invoice_order_mismatch' using errcode = '23514';
      end if;
      if v_invoice_order is null and v_locked_order_id is not null then
        raise exception 'payments_validation:invoice_order_mismatch' using errcode = '23514';
      end if;
      if v_invoice_order is not null then
        new.order_id := v_invoice_order;
        v_order_id := v_invoice_order;
      end if;

      new.invoice_id := v_invoice_id;
    end if;

    ------------------------------------------------------------------
    -- Currency consistency on the economic set (no cross-currency sum)
    ------------------------------------------------------------------
    select
      count(distinct upper(trim(p.currency_code))),
      min(upper(trim(p.currency_code)))
    into v_currency_count, v_existing_currency
    from public.payments p
    where p.workspace_id = new.workspace_id
      and (
        (new.invoice_id is not null and p.invoice_id = new.invoice_id)
        or (new.order_id is not null and p.order_id = new.order_id)
        or (
          new.invoice_id is not null
          and new.order_id is not null
          and p.order_id = new.order_id
          and p.invoice_id is null
        )
        or (
          new.order_id is not null
          and exists (
            select 1 from public.invoices i
            where i.id = p.invoice_id
              and i.order_id = new.order_id
              and i.workspace_id = new.workspace_id
          )
        )
      );

    if coalesce(v_currency_count, 0) > 1 then
      -- Historical mixed currencies: leave rows untouched; block further inserts.
      raise exception 'payments_validation:currency_mixed' using errcode = '23514';
    end if;
    if coalesce(v_currency_count, 0) = 1
       and v_existing_currency is distinct from new.currency_code then
      raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
    end if;

    ------------------------------------------------------------------
    -- Overpayment: invoice economic net (invoice rows + order-only legacy)
    ------------------------------------------------------------------
    if new.invoice_id is not null then
      select coalesce(sum(
               case
                 when p.kind = 'payment' then p.amount
                 when p.kind in ('refund', 'void') then -p.amount
                 else 0
               end
             ), 0)
        into v_paid
      from public.payments p
      where p.workspace_id = new.workspace_id
        and (
          p.invoice_id = new.invoice_id
          or (
            new.order_id is not null
            and p.order_id = new.order_id
            and p.invoice_id is null
          )
        );
      -- Currency already enforced consistent above; do not filter by currency
      -- here (would reintroduce multi-currency bypass).

      select i.total into v_invoice_total
      from public.invoices i
      where i.id = new.invoice_id;

      v_remaining := greatest(coalesce(v_invoice_total, 0) - coalesce(v_paid, 0), 0);
      if new.amount > v_remaining + 0.005 then
        raise exception 'payments_validation:payment_exceeds_remaining' using errcode = '23514';
      end if;
    end if;

    ------------------------------------------------------------------
    -- Overpayment: order economic net (order + its invoice links)
    ------------------------------------------------------------------
    if new.order_id is not null then
      select coalesce(sum(
               case
                 when p.kind = 'payment' then p.amount
                 when p.kind in ('refund', 'void') then -p.amount
                 else 0
               end
             ), 0)
        into v_paid
      from public.payments p
      where p.workspace_id = new.workspace_id
        and (
          p.order_id = new.order_id
          or (
            new.invoice_id is not null
            and p.invoice_id = new.invoice_id
          )
          or exists (
            select 1
            from public.invoices i
            where i.id = p.invoice_id
              and i.order_id = new.order_id
              and i.workspace_id = new.workspace_id
          )
        );

      select o.total_price into v_order_total
      from public.orders o
      where o.id = new.order_id;

      v_remaining := greatest(coalesce(v_order_total, 0) - coalesce(v_paid, 0), 0);
      if new.amount > v_remaining + 0.005 then
        raise exception 'payments_validation:payment_exceeds_remaining' using errcode = '23514';
      end if;
    end if;

  elsif new.kind = 'refund' then
    if new.related_payment_id is null then
      raise exception 'payments_validation:refund_invalid_original' using errcode = '23514';
    end if;

    -- Serialize concurrent refunds: lock original BEFORE reading refund totals.
    select *
      into v_original
    from public.payments p
    where p.id = new.related_payment_id
    for update;

    if not found then
      raise exception 'payments_validation:refund_invalid_original' using errcode = '23503';
    end if;

    if v_original.workspace_id is distinct from new.workspace_id then
      raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
    end if;

    if v_original.kind is distinct from 'payment' then
      raise exception 'payments_validation:refund_against_refund' using errcode = '23514';
    end if;

    if upper(trim(v_original.currency_code)) is distinct from new.currency_code then
      raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
    end if;

    -- Retain original payment's order/invoice links (ignore client tampering).
    new.order_id := v_original.order_id;
    new.invoice_id := v_original.invoice_id;

    select coalesce(sum(p.amount), 0)
      into v_refunded
    from public.payments p
    where p.workspace_id = new.workspace_id
      and p.kind in ('refund', 'void')
      and p.related_payment_id = v_original.id;

    v_remaining := greatest(v_original.amount - coalesce(v_refunded, 0), 0);
    if new.amount > v_remaining + 0.005 then
      raise exception 'payments_validation:refund_exceeds_remaining' using errcode = '23514';
    end if;

  elsif new.kind = 'void' then
    if new.related_payment_id is null then
      raise exception 'payments_validation:void_invalid_original' using errcode = '23514';
    end if;

    if new.note is null or length(trim(new.note)) < 8 then
      raise exception 'payments_validation:void_reason_required' using errcode = '23514';
    end if;

    select *
      into v_original
    from public.payments p
    where p.id = new.related_payment_id
    for update;

    if not found then
      raise exception 'payments_validation:void_invalid_original' using errcode = '23503';
    end if;

    if v_original.workspace_id is distinct from new.workspace_id then
      raise exception 'payments_validation:workspace_mismatch' using errcode = '42501';
    end if;

    if v_original.kind is distinct from 'payment' then
      raise exception 'payments_validation:void_against_non_payment' using errcode = '23514';
    end if;

    if upper(trim(v_original.currency_code)) is distinct from new.currency_code then
      raise exception 'payments_validation:currency_mismatch' using errcode = '23514';
    end if;

    new.order_id := v_original.order_id;
    new.invoice_id := v_original.invoice_id;

    select coalesce(sum(p.amount), 0)
      into v_refunded
    from public.payments p
    where p.workspace_id = new.workspace_id
      and p.kind in ('refund', 'void')
      and p.related_payment_id = v_original.id;

    -- Full void only when nothing has been refunded/voided yet, amount equals original.
    if coalesce(v_refunded, 0) > 0.005 then
      raise exception 'payments_validation:void_already_offset' using errcode = '23514';
    end if;

    if abs(new.amount - v_original.amount) > 0.005 then
      raise exception 'payments_validation:void_amount_mismatch' using errcode = '23514';
    end if;

  else
    raise exception 'payments_validation:kind_invalid' using errcode = '23514';
  end if;

  return new;
end;
$function$;


comment on function public.payments_enforce_integrity() is
  'managed-object: core-app/payments_enforce_integrity@v2-void-offsets';

revoke all on function public.payments_enforce_integrity() from public;
revoke all on function public.payments_enforce_integrity() from anon;
revoke all on function public.payments_enforce_integrity() from authenticated;

drop trigger if exists payments_enforce_integrity_bi on public.payments;
create trigger payments_enforce_integrity_bi
  before insert on public.payments
  for each row
  execute function public.payments_enforce_integrity();

commit;
