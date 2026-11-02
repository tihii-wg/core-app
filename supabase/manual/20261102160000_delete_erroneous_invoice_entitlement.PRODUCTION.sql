-- Harden delete_erroneous_invoice: subscription write entitlement + optional invoices.delete.
-- Target: MAIN when owner authorizes APPLY. Do NOT auto-apply. Do NOT run on TEST.
-- Depends on: public.delete_erroneous_invoice (erroneous invoice SQL), public.is_workspace_member.
-- Optional: public.crm_has_permission, public.workspace_member_role, workspaces.subscription_* columns.
--
-- What this does:
--  1) Creates public.workspace_write_allowed(uuid) mirroring SPA hasSubscriptionWriteEntitlement.
--  2) Replaces delete_erroneous_invoice to require membership + write entitlement (+ invoices.delete when CRM perms exist).
--  3) Keeps append-only payment integrity: ANY payments / finance_transactions / credit_notes rows block delete.
--  4) Does not touch orders. Does not hard-delete ledger history.
--
-- Idempotent: create or replace + revoke/grant.

begin;

-- ---------------------------------------------------------------------------
-- 1. workspace_write_allowed — server mirror of SPA subscription write rules
-- ---------------------------------------------------------------------------
create or replace function public.workspace_write_allowed(p_workspace uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_status text;
  v_expires timestamptz;
  v_has_status boolean;
  v_has_expires boolean;
  v_found boolean := false;
begin
  if p_workspace is null then
    return false;
  end if;

  select exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'workspaces' and c.column_name = 'subscription_status'
         ),
         exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'workspaces' and c.column_name = 'subscription_expires_at'
         )
    into v_has_status, v_has_expires;

  -- Without authoritative subscription columns, fail closed (do not widen writes beyond SPA gate).
  if not v_has_status then
    return false;
  end if;

  if v_has_expires then
    execute
      $q$
        select lower(trim(coalesce(w.subscription_status::text, ''))), w.subscription_expires_at, true
        from public.workspaces w
        where w.id = $1
          and w.deleted_at is null
      $q$
      into v_status, v_expires, v_found
      using p_workspace;
  else
    execute
      $q$
        select lower(trim(coalesce(w.subscription_status::text, ''))), null::timestamptz, true
        from public.workspaces w
        where w.id = $1
          and w.deleted_at is null
      $q$
      into v_status, v_expires, v_found
      using p_workspace;
  end if;

  if not coalesce(v_found, false) then
    return false;
  end if;

  -- Past expiry always denies (mirrors SPA hasSubscriptionWriteEntitlement).
  if v_expires is not null and v_expires <= now() then
    return false;
  end if;

  if v_status = 'active' then
    return true;
  end if;
  if v_status = 'trial' then
    return v_expires is not null;
  end if;

  return false;
end;
$function$;

comment on function public.workspace_write_allowed(uuid) is
  'managed-object: core-app/workspace_write_allowed@v1 — mirrors SPA hasSubscriptionWriteEntitlement (active/trial + expiry)';

revoke all on function public.workspace_write_allowed(uuid) from public, anon;
grant execute on function public.workspace_write_allowed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. delete_erroneous_invoice — entitlement + any-payment block
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
  v_allowed boolean := false;
  v_role text;
  v_perm_seeded boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_invoice_id is null then
    raise exception 'Invoice id is required' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices i where i.id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice was not found or you do not have permission to change it.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(v_invoice.workspace_id) then
    raise exception 'Invoice was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  if not public.workspace_write_allowed(v_invoice.workspace_id) then
    raise exception 'Workspace subscription does not allow write operations.' using errcode = '42501';
  end if;

  -- Permission gate: only when CRM permission system is present AND invoices.delete is seeded.
  if to_regprocedure('public.crm_has_permission(uuid, text)') is not null
     and to_regclass('public.role_permissions') is not null then
    execute
      $q$ select exists (select 1 from public.role_permissions rp where rp.permission = 'invoices.delete') $q$
      into v_perm_seeded;
  end if;

  if v_perm_seeded then
    if to_regprocedure('public.workspace_member_role(uuid)') is not null then
      v_role := public.workspace_member_role(v_invoice.workspace_id);
      if v_role in ('owner', 'admin', 'manager') then
        v_allowed := true;
      end if;
    end if;
    if not v_allowed then
      execute 'select public.crm_has_permission($1, $2)'
        into v_allowed
        using v_invoice.workspace_id, 'invoices.delete';
      v_allowed := coalesce(v_allowed, false);
    end if;
    if not v_allowed then
      raise exception 'You do not have permission to delete invoices.' using errcode = '42501';
    end if;
  end if;
  -- else: membership-only (already checked)

  if v_invoice.status is distinct from 'erroneous' then
    raise exception 'Only invoices marked as sent in error can be deleted.' using errcode = 'P0001';
  end if;

  -- Append-only ledger: ANY payment row referencing the invoice blocks delete.
  if to_regclass('public.payments') is not null then
    execute
      'select count(*)::bigint from public.payments p where p.invoice_id = $1'
      into v_payment_count
      using p_invoice_id;
    if v_payment_count > 0 then
      raise exception
        'Cannot delete invoice %: % payment ledger row(s) still reference it. In Finance, resolve or remove those payments first; the order is unchanged.',
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

  delete from public.invoices i
  where i.id = p_invoice_id
    and i.workspace_id = v_invoice.workspace_id
    and i.status = 'erroneous';

  if not found then
    raise exception 'Invoice was not found or you do not have permission to change it.' using errcode = 'P0002';
  end if;
end;
$function$;

comment on function public.delete_erroneous_invoice(uuid) is
  'managed-object: core-app/delete_erroneous_invoice@v3-entitlement — membership + workspace_write_allowed + optional invoices.delete; blocks on any payments/finance_transactions/credit_notes; never touches orders';

revoke all on function public.delete_erroneous_invoice(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_erroneous_invoice(uuid) to authenticated;
grant execute on function public.delete_erroneous_invoice(uuid) to service_role;

commit;
