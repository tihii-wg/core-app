-- =============================================================================
-- Core App — Order activity timeline extension (payments, create, fields, warranty)
-- MAIN only: pundggjzzaqzbvykbxvo
-- DO NOT auto-apply. Review preflight, then run deliberately in the SQL Editor.
-- =============================================================================
--
-- Extends the existing order_events architecture (no second history system):
--   * 20261101040000_order_events_rpc.PRODUCTION.sql  (crm_order_event_insert)
--   * 20261104210000_order_activity_history.PRODUCTION.sql (services/materials/status)
--
-- WHAT THIS ADDS (canonical DB triggers only — app must not dual-write these):
--   1) payments AFTER INSERT → payment_recorded | payment_refunded | payment_voided
--      (one row per ledger insert; idempotent on payload.payment_id; includes
--       settlement partial|full|balance, remaining_after, method, currency)
--   2) orders AFTER INSERT → order_created
--   3) orders AFTER UPDATE of meaningful non-status fields → order_field_changed
--      (skips status / custom_status_id / closed_at — those stay on status trigger)
--   4) warranty_records INSERT/UPDATE → warranty_activated | warranty_updated
--   5) warranty_order_claims INSERT/UPDATE → warranty_claim_created | warranty_claim_updated
--
-- Deletion audit: order_events.order_id is ON DELETE CASCADE today. delete_order_with_payments
-- already writes activity_log before delete. This script does NOT change that FK.
--
-- IDEMPOTENT. One transaction. Does not rewrite historical rows.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) PREFLIGHT
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.order_events') is null then
    v_problems := v_problems || 'order_events missing; ';
  end if;
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is null then
    v_problems := v_problems || 'crm_order_event_insert missing; ';
  end if;
  if to_regprocedure('public.crm_order_event_resolve_actor(uuid)') is null then
    v_problems := v_problems || 'crm_order_event_resolve_actor missing (apply 20261104210000 first); ';
  end if;
  if v_problems <> '' then
    raise exception 'Preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 2) Payments → order_events (INSERT only; ledger is append-oriented)
-- ---------------------------------------------------------------------------
create or replace function public.crm_payments_order_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_order_id uuid;
  v_workspace uuid;
  v_total numeric := 0;
  v_net numeric := 0;
  v_prior_net numeric := 0;
  v_remaining numeric := 0;
  v_settlement text;
  v_event_type text;
  v_payload jsonb;
  v_signed numeric;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  v_order_id := new.order_id;
  if v_order_id is null and new.invoice_id is not null and to_regclass('public.invoices') is not null then
    select i.order_id into v_order_id
      from public.invoices i
     where i.id = new.invoice_id
       and i.workspace_id = new.workspace_id;
  end if;

  if v_order_id is null then
    return new;
  end if;

  v_workspace := new.workspace_id;

  -- Idempotent: never double-record the same ledger row.
  if exists (
    select 1
      from public.order_events e
     where e.order_id = v_order_id
       and e.workspace_id = v_workspace
       and e.event_type in ('payment_recorded', 'payment_refunded', 'payment_voided')
       and e.payload->>'payment_id' = new.id::text
  ) then
    return new;
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(v_workspace);

  select coalesce(o.total_price, 0) into v_total
    from public.orders o
   where o.id = v_order_id
     and o.workspace_id = v_workspace;

  -- Net ledger contribution for this order (payments +, refund/void −).
  select coalesce(sum(
    case
      when p.kind = 'payment' then p.amount
      when p.kind in ('refund', 'void') then -p.amount
      else 0
    end
  ), 0)
    into v_net
    from public.payments p
   where p.workspace_id = v_workspace
     and p.order_id = v_order_id;

  select coalesce(sum(
    case
      when p.kind = 'payment' then p.amount
      when p.kind in ('refund', 'void') then -p.amount
      else 0
    end
  ), 0)
    into v_prior_net
    from public.payments p
   where p.workspace_id = v_workspace
     and p.order_id = v_order_id
     and p.id is distinct from new.id;

  v_remaining := greatest(0, round((coalesce(v_total, 0) - coalesce(v_net, 0))::numeric, 2));

  if new.kind = 'refund' then
    v_event_type := 'payment_refunded';
    v_settlement := 'refund';
  elsif new.kind = 'void' then
    v_event_type := 'payment_voided';
    v_settlement := 'void';
  else
    v_event_type := 'payment_recorded';
    if v_remaining <= 0.005 then
      if coalesce(v_prior_net, 0) > 0.005 then
        v_settlement := 'balance';
      else
        v_settlement := 'full';
      end if;
    else
      v_settlement := 'partial';
    end if;
  end if;

  v_signed := case
    when new.kind in ('refund', 'void') then -new.amount
    else new.amount
  end;

  v_payload := jsonb_build_object(
    'source', 'trigger',
    'payment_id', new.id,
    'kind', new.kind,
    'amount', new.amount,
    'signed_amount', v_signed,
    'currency_code', new.currency_code,
    'payment_method', new.payment_method,
    'settlement', v_settlement,
    'remaining_after', v_remaining,
    'net_paid_after', round(coalesce(v_net, 0)::numeric, 2),
    'order_total', round(coalesce(v_total, 0)::numeric, 2),
    'paid_at', new.paid_at
  );
  if new.related_payment_id is not null then
    v_payload := v_payload || jsonb_build_object('related_payment_id', new.related_payment_id);
  end if;
  if new.invoice_id is not null then
    v_payload := v_payload || jsonb_build_object('invoice_id', new.invoice_id);
  end if;
  if new.note is not null and length(btrim(new.note)) > 0 then
    v_payload := v_payload || jsonb_build_object('note', btrim(new.note));
  end if;

  perform public.crm_order_event_insert(
    v_workspace,
    v_order_id,
    v_event_type,
    'payments',
    null,
    new.amount::text,
    v_payload,
    v_actor.actor_user_id,
    v_actor.actor_name
  );

  return new;
end;
$fn$;

revoke all on function public.crm_payments_order_activity_event() from public, anon, authenticated;

do $pay_trg$
begin
  if to_regclass('public.payments') is null then
    raise notice 'payments table missing — skip payment activity trigger';
    return;
  end if;

  drop trigger if exists crm_payments_order_activity_event on public.payments;
  create trigger crm_payments_order_activity_event
    after insert on public.payments
    for each row
    execute function public.crm_payments_order_activity_event();

  comment on function public.crm_payments_order_activity_event() is
    'managed-object: core-app/crm_payments_order_activity_event@v1 — one order_events row per payments INSERT linked to an order.';
end;
$pay_trg$;

-- ---------------------------------------------------------------------------
-- 3) Order created
-- ---------------------------------------------------------------------------
create or replace function public.crm_orders_created_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(new.workspace_id);

  perform public.crm_order_event_insert(
    new.workspace_id,
    new.id,
    'order_created',
    'orders',
    null,
    coalesce(new.number::text, new.id::text),
    jsonb_build_object(
      'source', 'trigger',
      'order_number', new.number,
      'status', new.status,
      'client_id', new.client_id,
      'total_price', new.total_price
    ),
    v_actor.actor_user_id,
    v_actor.actor_name
  );
  return new;
end;
$fn$;

revoke all on function public.crm_orders_created_activity_event() from public, anon, authenticated;

drop trigger if exists crm_orders_created_activity_event on public.orders;
create trigger crm_orders_created_activity_event
  after insert on public.orders
  for each row
  execute function public.crm_orders_created_activity_event();

comment on function public.crm_orders_created_activity_event() is
  'managed-object: core-app/crm_orders_created_activity_event@v1 — order_created feed event on INSERT.';

-- ---------------------------------------------------------------------------
-- 4) Meaningful order field changes (not status / lifecycle columns)
-- ---------------------------------------------------------------------------
create or replace function public.crm_orders_field_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_changes jsonb := '{}'::jsonb;
  v_payload jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Lifecycle / status columns are owned by crm_orders_status_event.
  if new.client_id is distinct from old.client_id then
    v_changes := v_changes || jsonb_build_object('client_id', jsonb_build_object('from', old.client_id, 'to', new.client_id));
  end if;
  if new.vehicle_id is distinct from old.vehicle_id then
    v_changes := v_changes || jsonb_build_object('vehicle_id', jsonb_build_object('from', old.vehicle_id, 'to', new.vehicle_id));
  end if;
  if new.employee_id is distinct from old.employee_id then
    v_changes := v_changes || jsonb_build_object('employee_id', jsonb_build_object('from', old.employee_id, 'to', new.employee_id));
  end if;
  if to_jsonb(new) ? 'manager_id' and new.manager_id is distinct from old.manager_id then
    v_changes := v_changes || jsonb_build_object('manager_id', jsonb_build_object('from', old.manager_id, 'to', new.manager_id));
  end if;
  if new.device is distinct from old.device then
    v_changes := v_changes || jsonb_build_object('device', jsonb_build_object('from', old.device, 'to', new.device));
  end if;
  if new.description is distinct from old.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('from', old.description, 'to', new.description));
  end if;
  if new.vin is distinct from old.vin then
    v_changes := v_changes || jsonb_build_object('vin', jsonb_build_object('from', old.vin, 'to', new.vin));
  end if;
  if new.car_number is distinct from old.car_number then
    v_changes := v_changes || jsonb_build_object('car_number', jsonb_build_object('from', old.car_number, 'to', new.car_number));
  end if;
  if to_jsonb(new) ? 'malfunction' and new.malfunction is distinct from old.malfunction then
    v_changes := v_changes || jsonb_build_object('malfunction', jsonb_build_object('from', old.malfunction, 'to', new.malfunction));
  end if;
  if to_jsonb(new) ? 'manager_notes' and new.manager_notes is distinct from old.manager_notes then
    v_changes := v_changes || jsonb_build_object('manager_notes', jsonb_build_object('from', old.manager_notes, 'to', new.manager_notes));
  end if;
  if to_jsonb(new) ? 'technician_notes' and new.technician_notes is distinct from old.technician_notes then
    v_changes := v_changes || jsonb_build_object('technician_notes', jsonb_build_object('from', old.technician_notes, 'to', new.technician_notes));
  end if;
  if to_jsonb(new) ? 'conclusion' and new.conclusion is distinct from old.conclusion then
    v_changes := v_changes || jsonb_build_object('conclusion', jsonb_build_object('from', old.conclusion, 'to', new.conclusion));
  end if;
  if to_jsonb(new) ? 'vehicle_mileage_snapshot'
     and new.vehicle_mileage_snapshot is distinct from old.vehicle_mileage_snapshot then
    v_changes := v_changes || jsonb_build_object(
      'vehicle_mileage_snapshot',
      jsonb_build_object('from', old.vehicle_mileage_snapshot, 'to', new.vehicle_mileage_snapshot)
    );
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(new.workspace_id);
  v_payload := jsonb_build_object('source', 'trigger', 'changes', v_changes);

  perform public.crm_order_event_insert(
    new.workspace_id,
    new.id,
    'order_field_changed',
    'orders',
    null,
    null,
    v_payload,
    v_actor.actor_user_id,
    v_actor.actor_name
  );
  return new;
end;
$fn$;

revoke all on function public.crm_orders_field_activity_event() from public, anon, authenticated;

drop trigger if exists crm_orders_field_activity_event on public.orders;
create trigger crm_orders_field_activity_event
  after update on public.orders
  for each row
  execute function public.crm_orders_field_activity_event();

comment on function public.crm_orders_field_activity_event() is
  'managed-object: core-app/crm_orders_field_activity_event@v1 — one order_field_changed event when meaningful non-status fields change.';

-- ---------------------------------------------------------------------------
-- 5) Warranty records / claims
-- ---------------------------------------------------------------------------
create or replace function public.crm_warranty_records_order_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_order_id uuid;
  v_changes jsonb := '{}'::jsonb;
  v_payload jsonb;
  v_event_type text;
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  if v_order_id is null then
    return coalesce(new, old);
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(coalesce(new.workspace_id, old.workspace_id));

  if tg_op = 'INSERT' then
    -- Idempotent activation: skip if an activation for this record already exists.
    if exists (
      select 1 from public.order_events e
       where e.order_id = v_order_id
         and e.event_type = 'warranty_activated'
         and e.payload->>'warranty_record_id' = new.id::text
    ) then
      return new;
    end if;

    v_payload := jsonb_build_object(
      'source', 'trigger',
      'warranty_record_id', new.id,
      'item_name', new.item_name,
      'starts_on', new.starts_on,
      'ends_on', new.ends_on,
      'mileage_limit', new.mileage_limit
    );
    perform public.crm_order_event_insert(
      new.workspace_id, v_order_id, 'warranty_activated', 'warranty_records',
      null, new.item_name, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.item_name is distinct from old.item_name then
      v_changes := v_changes || jsonb_build_object('item_name', jsonb_build_object('from', old.item_name, 'to', new.item_name));
    end if;
    if new.starts_on is distinct from old.starts_on then
      v_changes := v_changes || jsonb_build_object('starts_on', jsonb_build_object('from', old.starts_on, 'to', new.starts_on));
    end if;
    if new.ends_on is distinct from old.ends_on then
      v_changes := v_changes || jsonb_build_object('ends_on', jsonb_build_object('from', old.ends_on, 'to', new.ends_on));
    end if;
    if new.mileage_limit is distinct from old.mileage_limit then
      v_changes := v_changes || jsonb_build_object('mileage_limit', jsonb_build_object('from', old.mileage_limit, 'to', new.mileage_limit));
    end if;
    if new.notes is distinct from old.notes then
      v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('from', old.notes, 'to', new.notes));
    end if;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'warranty_record_id', new.id,
      'item_name', new.item_name,
      'changes', v_changes
    );
    perform public.crm_order_event_insert(
      new.workspace_id, v_order_id, 'warranty_updated', 'warranty_records',
      old.item_name, new.item_name, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  return coalesce(new, old);
end;
$fn$;

revoke all on function public.crm_warranty_records_order_activity_event() from public, anon, authenticated;

do $wr$
begin
  if to_regclass('public.warranty_records') is null then
    raise notice 'warranty_records missing — skip warranty record activity trigger';
    return;
  end if;
  drop trigger if exists crm_warranty_records_order_activity_event on public.warranty_records;
  create trigger crm_warranty_records_order_activity_event
    after insert or update on public.warranty_records
    for each row
    execute function public.crm_warranty_records_order_activity_event();
end;
$wr$;

create or replace function public.crm_warranty_claims_order_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_order_id uuid;
  v_payload jsonb;
  v_changes jsonb := '{}'::jsonb;
begin
  v_order_id := coalesce(new.warranty_order_id, old.warranty_order_id);
  if v_order_id is null then
    return coalesce(new, old);
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(coalesce(new.workspace_id, old.workspace_id));

  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.order_events e
       where e.order_id = v_order_id
         and e.event_type = 'warranty_claim_created'
         and e.payload->>'warranty_claim_id' = new.id::text
    ) then
      return new;
    end if;
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'warranty_claim_id', new.id,
      'warranty_record_id', new.warranty_record_id,
      'validity_status', new.validity_status
    );
    perform public.crm_order_event_insert(
      new.workspace_id, v_order_id, 'warranty_claim_created', 'warranty_order_claims',
      null, new.validity_status, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.validity_status is distinct from old.validity_status then
      v_changes := v_changes || jsonb_build_object(
        'validity_status', jsonb_build_object('from', old.validity_status, 'to', new.validity_status)
      );
    end if;
    if to_jsonb(new) ? 'is_active' and new.is_active is distinct from old.is_active then
      v_changes := v_changes || jsonb_build_object(
        'is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active)
      );
    end if;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'warranty_claim_id', new.id,
      'warranty_record_id', new.warranty_record_id,
      'validity_status', new.validity_status,
      'changes', v_changes
    );
    perform public.crm_order_event_insert(
      new.workspace_id, v_order_id, 'warranty_claim_updated', 'warranty_order_claims',
      old.validity_status, new.validity_status, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  return coalesce(new, old);
end;
$fn$;

revoke all on function public.crm_warranty_claims_order_activity_event() from public, anon, authenticated;

do $wc$
begin
  if to_regclass('public.warranty_order_claims') is null then
    raise notice 'warranty_order_claims missing — skip warranty claim activity trigger';
    return;
  end if;
  drop trigger if exists crm_warranty_claims_order_activity_event on public.warranty_order_claims;
  create trigger crm_warranty_claims_order_activity_event
    after insert or update on public.warranty_order_claims
    for each row
    execute function public.crm_warranty_claims_order_activity_event();
end;
$wc$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6) POSTFLIGHT
-- ---------------------------------------------------------------------------
do $post$
declare
  v_problems text := '';
begin
  if to_regprocedure('public.crm_orders_created_activity_event()') is null then
    v_problems := v_problems || 'crm_orders_created_activity_event missing; ';
  end if;
  if to_regprocedure('public.crm_orders_field_activity_event()') is null then
    v_problems := v_problems || 'crm_orders_field_activity_event missing; ';
  end if;
  if to_regprocedure('public.crm_payments_order_activity_event()') is null then
    v_problems := v_problems || 'crm_payments_order_activity_event missing; ';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.orders'::regclass
       and not tgisinternal
       and tgname = 'crm_orders_created_activity_event'
  ) then
    v_problems := v_problems || 'orders created trigger missing; ';
  end if;
  if to_regclass('public.payments') is not null
     and not exists (
       select 1 from pg_trigger
        where tgrelid = 'public.payments'::regclass
          and not tgisinternal
          and tgname = 'crm_payments_order_activity_event'
     ) then
    v_problems := v_problems || 'payments activity trigger missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'Postflight failed: %', v_problems;
  end if;
  raise notice 'order activity timeline extension applied';
end;
$post$;

commit;
