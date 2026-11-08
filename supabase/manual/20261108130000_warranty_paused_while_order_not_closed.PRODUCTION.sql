-- =============================================================================
-- Warranty is paused while its source order is not formally closed
-- Script: 20261108130000_warranty_paused_while_order_not_closed.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: 20261104250000_order_warranty_workflow, 20261104260000_order_warranty_hardening
-- =============================================================================
-- Rule: a warranty record (warranty_records) is valid only while its source order is
-- formally closed (status = 'closed' and closed_at is not null). While the order is
-- cancelled, or reopened after a cancel and not closed again, the warranty is PAUSED:
--   * no new / re-activated warranty claim (warranty_order_claims) may reference it;
--   * the app shows it as «Приостановлена» (frontend).
-- When the order is closed again, the same record (same start date and mileage) is valid
-- again — activate_order_warranties keeps existing records (on conflict do nothing).
--
-- Adds: crm_warranty_record_source_closed(record_id) + BEFORE INSERT / UPDATE trigger on
-- warranty_order_claims rejecting active claims for paused warranties.
-- Existing claims are not changed. No data changes. Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.warranty_records') is null or to_regclass('public.warranty_order_claims') is null then
    raise exception 'warranty_paused preflight: warranty_records / warranty_order_claims missing';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'warranty_order_claims' and column_name = 'is_active') then
    raise exception 'warranty_paused preflight: warranty_order_claims.is_active missing (apply 20261104260000 first)';
  end if;
end;
$preflight$;

create or replace function public.crm_warranty_record_source_closed(p_warranty_record_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce((
    select o.status = 'closed' and o.closed_at is not null
    from public.warranty_records w
    join public.orders o on o.id = w.order_id
    where w.id = p_warranty_record_id
  ), false);
$fn$;

revoke all on function public.crm_warranty_record_source_closed(uuid) from public, anon;
grant execute on function public.crm_warranty_record_source_closed(uuid) to authenticated, service_role;

comment on function public.crm_warranty_record_source_closed(uuid) is
  'managed-object: core-app/crm_warranty_record_source_closed@v1 — true when the warranty record''s source order is formally closed (warranty not paused).';

create or replace function public.warranty_order_claims_reject_paused()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if coalesce(new.is_active, true) = false then
    return new;
  end if;
  -- Only new activations are checked; untouched active claims may still be edited.
  if tg_op = 'UPDATE'
     and coalesce(old.is_active, true) = true
     and new.warranty_record_id is not distinct from old.warranty_record_id then
    return new;
  end if;
  if not public.crm_warranty_record_source_closed(new.warranty_record_id) then
    raise exception 'warranty:paused_source_not_closed'
      using errcode = 'P0001',
            hint = 'The original order is cancelled or reopened; its warranty is paused until the order is closed again.';
  end if;
  return new;
end;
$fn$;

revoke all on function public.warranty_order_claims_reject_paused() from public, anon, authenticated;

comment on function public.warranty_order_claims_reject_paused() is
  'managed-object: core-app/warranty_order_claims_reject_paused@v1 — no active claim against a warranty whose source order is not formally closed.';

drop trigger if exists warranty_order_claims_reject_paused_biu on public.warranty_order_claims;
create trigger warranty_order_claims_reject_paused_biu
  before insert or update on public.warranty_order_claims
  for each row
  execute function public.warranty_order_claims_reject_paused();

do $postflight$
begin
  if to_regprocedure('public.crm_warranty_record_source_closed(uuid)') is null then
    raise exception 'warranty_paused postflight: function missing';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgname = 'warranty_order_claims_reject_paused_biu'
                   and tgrelid = 'public.warranty_order_claims'::regclass and not tgisinternal) then
    raise exception 'warranty_paused postflight: trigger missing';
  end if;
end;
$postflight$;

commit;
