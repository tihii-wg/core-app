-- Overpayment prevention + refund limits (single-session).
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

-- Clean prior ledger rows for these fixtures (disposable DB).
delete from public.payments;

-- Order-only payment within remaining
insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'payment', 30.00, 'MDL', 'cash'
);

-- Overpay order total 50
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'payment', 25.00, 'MDL', 'cash'
    );
    raise exception 'expected order overpay rejection';
  exception when others then
    if sqlerrm not like '%payments_validation:payment_exceeds_remaining%' then
      raise exception 'order overpay unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- Invoice+order path: pay through linked invoice up to 100, then overpay
insert into public.payments (
  workspace_id, order_id, invoice_id, kind, amount, currency_code, payment_method
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'payment', 100.00, 'MDL', 'card'
);

do $$
begin
  begin
    insert into public.payments (
      workspace_id, order_id, invoice_id, kind, amount, currency_code, payment_method
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'payment', 0.01, 'MDL', 'card'
    );
    raise exception 'expected invoice overpay rejection';
  exception when others then
    if sqlerrm not like '%payments_validation:payment_exceeds_remaining%' then
      raise exception 'invoice overpay unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- Refunds against the 100 payment
do $$
declare
  pay_id uuid;
begin
  select id into pay_id
  from public.payments
  where order_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    and kind = 'payment'
  limit 1;

  insert into public.payments (
    workspace_id, order_id, invoice_id, related_payment_id, kind, amount, currency_code, payment_method
  ) values (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    pay_id, 'refund', 40.00, 'MDL', 'cash'
  );

  begin
    insert into public.payments (
      workspace_id, order_id, invoice_id, related_payment_id, kind, amount, currency_code, payment_method
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      pay_id, 'refund', 70.00, 'MDL', 'cash'
    );
    raise exception 'expected refund_exceeds_remaining';
  exception when others then
    if sqlerrm not like '%payments_validation:refund_exceeds_remaining%' then
      raise exception 'refund over-limit unexpected: %', sqlerrm;
    end if;
  end;

  -- Refund against a refund must fail
  begin
    insert into public.payments (
      workspace_id, related_payment_id, kind, amount, currency_code, payment_method
    )
    select
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      id, 'refund', 1.00, 'MDL', 'cash'
    from public.payments
    where kind = 'refund'
    limit 1;
    raise exception 'expected refund_against_refund';
  exception when others then
    if sqlerrm not like '%payments_validation:refund_against_refund%' then
      raise exception 'refund_against_refund unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- After partial refund, a new payment can use freed remaining (60 paid net on 100)
insert into public.payments (
  workspace_id, order_id, invoice_id, kind, amount, currency_code, payment_method
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'payment', 40.00, 'MDL', 'bank_transfer'
);

raise notice 'PASS overpay_and_refunds';
