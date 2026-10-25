-- Negative path inserts must fail with payments_validation:* markers.
select set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', false);

create temporary table _expect_fail (label text primary key, saw boolean not null default false);

insert into _expect_fail(label) values
  ('amount_nonpositive'),
  ('kind_invalid'),
  ('method_invalid'),
  ('currency_format'),
  ('currency_mismatch'),
  ('archived_workspace'),
  ('link_required');

-- amount <= 0
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'payment', 0, 'MDL', 'cash');
    raise exception 'expected amount rejection';
  exception when others then
    if sqlerrm like '%payments_validation:amount_positive%' or sqlerrm like '%payments_amount_positive%' then
      update _expect_fail set saw = true where label = 'amount_nonpositive';
    else
      raise exception 'amount_nonpositive unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- kind invalid
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'adjust', 1, 'MDL', 'cash');
    raise exception 'expected kind rejection';
  exception when others then
    if sqlerrm like '%payments_validation:%' or sqlerrm like '%payments_kind_check%' then
      update _expect_fail set saw = true where label = 'kind_invalid';
    else
      raise exception 'kind_invalid unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- method invalid
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'payment', 1, 'MDL', 'crypto');
    raise exception 'expected method rejection';
  exception when others then
    if sqlerrm like '%payments_validation:method_invalid%' or sqlerrm like '%payments_payment_method_check%' then
      update _expect_fail set saw = true where label = 'method_invalid';
    else
      raise exception 'method_invalid unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- currency format
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'payment', 1, 'md', 'cash');
    raise exception 'expected currency_format rejection';
  exception when others then
    if sqlerrm like '%payments_validation:currency_format%' or sqlerrm like '%payments_currency_code_format%' then
      update _expect_fail set saw = true where label = 'currency_format';
    else
      raise exception 'currency_format unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- currency mismatch vs workspace
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
            'payment', 1, 'EUR', 'cash');
    raise exception 'expected currency_mismatch rejection';
  exception when others then
    if sqlerrm like '%payments_validation:currency_mismatch%' then
      update _expect_fail set saw = true where label = 'currency_mismatch';
    else
      raise exception 'currency_mismatch unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- soft-deleted workspace
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, kind, amount, currency_code, payment_method)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
            'payment', 1, 'MDL', 'cash');
    raise exception 'expected archived_workspace rejection';
  exception when others then
    if sqlerrm like '%payments_validation:workspace%' then
      update _expect_fail set saw = true where label = 'archived_workspace';
    else
      raise exception 'archived_workspace unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

-- link required
do $$
begin
  begin
    insert into public.payments (workspace_id, order_id, invoice_id, kind, amount, currency_code, payment_method)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, null,
            'payment', 1, 'MDL', 'cash');
    raise exception 'expected link_required rejection';
  exception when others then
    if sqlerrm like '%payments_validation:link_required%' then
      update _expect_fail set saw = true where label = 'link_required';
    else
      raise exception 'link_required unexpected: %', sqlerrm;
    end if;
  end;
end;
$$;

do $$
declare
  missing text;
begin
  select string_agg(label, ', ' order by label) into missing
  from _expect_fail where not saw;
  if missing is not null then
    raise exception 'FAIL validation_rejects missing: %', missing;
  end if;
  raise notice 'PASS validation_rejects';
end;
$$;
