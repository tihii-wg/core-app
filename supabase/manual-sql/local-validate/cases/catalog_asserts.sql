-- Catalog expectations after harden apply.
do $$
declare
  v_comment text;
  v_cfg text;
  v_tgtype int2;
  v_enabled char;
  v_fn oid;
begin
  if to_regprocedure('public.payments_enforce_integrity()') is null then
    raise exception 'FAIL catalog: function missing';
  end if;

  select obj_description(p.oid, 'pg_proc'),
         coalesce(array_to_string(p.proconfig, ','), '')
    into v_comment, v_cfg
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'payments_enforce_integrity'
    and pg_get_function_identity_arguments(p.oid) = '';

  if v_comment is distinct from 'managed-object: core-app/payments_enforce_integrity@v1' then
    raise exception 'FAIL catalog: managed COMMENT missing/wrong: %', v_comment;
  end if;

  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.payments_enforce_integrity()'::regprocedure
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
  ) then
    raise exception 'FAIL catalog: function must be SECURITY DEFINER trigger';
  end if;

  if not exists (
    select 1
    from pg_proc p
    cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) u(cfg)
    where p.oid = 'public.payments_enforce_integrity()'::regprocedure
      and (u.cfg = 'search_path=' or u.cfg = 'search_path=""')
  ) then
    raise exception 'FAIL catalog: empty search_path required (proconfig=%)', v_cfg;
  end if;

  if has_function_privilege('anon', 'public.payments_enforce_integrity()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payments_enforce_integrity()', 'EXECUTE') then
    raise exception 'FAIL catalog: EXECUTE must be revoked from anon/authenticated';
  end if;

  select t.tgtype, t.tgenabled, t.tgfoid
    into v_tgtype, v_enabled, v_fn
  from pg_trigger t
  where t.tgrelid = 'public.payments'::regclass
    and t.tgname = 'payments_enforce_integrity_bi'
    and not t.tgisinternal;

  if v_fn is distinct from 'public.payments_enforce_integrity()'::regprocedure then
    raise exception 'FAIL catalog: trigger binding wrong';
  end if;
  if (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0 or (v_tgtype & 4) = 0 then
    raise exception 'FAIL catalog: trigger must be BEFORE INSERT ROW';
  end if;
  if v_enabled not in ('O', 'A') then
    raise exception 'FAIL catalog: trigger not enabled';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_amount_positive'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'FAIL catalog: payments_amount_positive missing/invalid';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_kind_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'FAIL catalog: payments_kind_check missing/invalid';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_payment_method_check'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'FAIL catalog: payments_payment_method_check missing/invalid';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payments'::regclass
      and conname = 'payments_currency_code_format'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'FAIL catalog: payments_currency_code_format missing/invalid';
  end if;

  raise notice 'PASS catalog_asserts';
end;
$$;
