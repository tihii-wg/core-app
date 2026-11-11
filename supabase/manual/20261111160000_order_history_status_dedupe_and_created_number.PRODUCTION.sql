-- =============================================================================
-- Core App — MANUAL: order history duplicates + creation number sync
-- MAIN only: pundggjzzaqzbvykbxvo
-- DO NOT auto-apply. Review, then run in the Supabase SQL Editor.
-- =============================================================================
--
-- Problems observed on MAIN
-- -------------------------
-- 1) `crm_orders_status_event` still writes TWO `status_changed` rows when a single
--    UPDATE changes both `status` and `custom_status_id` (paired duplicates in the
--    feed: system status + custom status name). v2 in
--    20261104230000_cancel_order_clear_stale_custom_status.PRODUCTION.sql was not
--    active on MAIN (function body still dual-writes).
--
-- 2) `createOrder` inserts with temporary `ORD-PENDING-<uuid>`, then assigns the
--    real `ORD-YYYY-NNN`. The AFTER INSERT `order_created` trigger snapshots the
--    pending placeholder into `new_value` / `payload.order_number`, so history
--    shows the internal pending id instead of the human order number.
--
-- This script
-- -----------
-- A) Re-applies crm_orders_status_event@v2 (skip custom_status_id when status
--    also changed on the same UPDATE).
-- B) Adds a sync trigger: when `orders.number` moves from ORD-PENDING-% to a
--    final number, patch the existing `order_created` event snapshot.
-- C) Optional one-time backfill of existing `order_created` rows from live
--    `orders.number` (does not delete any history).
--
-- Does NOT delete historical rows automatically beyond the optional paired
-- cleanup section (commented). Frontend also resolves live order numbers when
-- rendering creation events.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- A) Status trigger v2 — one status_changed per logical UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.crm_orders_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor record;
  v_payload jsonb;
  v_status_changed boolean;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(new.workspace_id);

  v_status_changed := new.status is distinct from old.status;

  if v_status_changed then
    v_payload := jsonb_build_object('source', 'trigger');
    if new.status::text = 'closed' then
      v_payload := v_payload || jsonb_build_object('lifecycle', 'close');
    elsif new.status::text = 'cancelled' then
      v_payload := v_payload || jsonb_build_object('lifecycle', 'cancel');
    elsif old.status::text in ('closed', 'cancelled')
      and new.status::text is distinct from old.status::text then
      v_payload := v_payload || jsonb_build_object('lifecycle', 'reopen');
    end if;

    perform public.crm_order_event_insert(
      new.workspace_id, new.id, 'status_changed', 'status',
      old.status::text, new.status::text,
      v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
  end if;

  -- Skip a second row when custom_status_id changed in the same UPDATE as status.
  if new.custom_status_id is distinct from old.custom_status_id
     and not v_status_changed then
    perform public.crm_order_event_insert(
      new.workspace_id, new.id, 'status_changed', 'custom_status_id',
      old.custom_status_id::text, new.custom_status_id::text,
      jsonb_build_object('source', 'trigger'),
      v_actor.actor_user_id, v_actor.actor_name
    );
  end if;

  return new;
end;
$fn$;

revoke all on function public.crm_orders_status_event() from public, anon, authenticated;

comment on function public.crm_orders_status_event() is
  'managed-object: core-app/crm_orders_status_event@v2 — one status_changed per UPDATE when status changes; custom_status_id-only changes still logged.';

-- ---------------------------------------------------------------------------
-- B) Sync order_created snapshot when ORD-PENDING-… becomes the real number
-- ---------------------------------------------------------------------------
create or replace function public.crm_orders_created_number_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.number is distinct from old.number
     and old.number::text like 'ORD-PENDING-%'
     and new.number is not null
     and new.number::text not like 'ORD-PENDING-%'
  then
    update public.order_events e
       set new_value = new.number::text,
           payload = coalesce(e.payload, '{}'::jsonb) || jsonb_build_object('order_number', new.number)
     where e.order_id = new.id
       and e.event_type = 'order_created'
       and (
         e.new_value like 'ORD-PENDING-%'
         or coalesce(e.payload->>'order_number', '') like 'ORD-PENDING-%'
         or e.new_value is null
       );
  end if;

  return new;
end;
$fn$;

revoke all on function public.crm_orders_created_number_sync() from public, anon, authenticated;

drop trigger if exists crm_orders_created_number_sync on public.orders;
create trigger crm_orders_created_number_sync
  after update of number on public.orders
  for each row
  execute function public.crm_orders_created_number_sync();

comment on function public.crm_orders_created_number_sync() is
  'managed-object: core-app/crm_orders_created_number_sync@v1 — patch order_created event when ORD-PENDING number is finalized.';

-- ---------------------------------------------------------------------------
-- C) Backfill existing order_created rows from live orders.number
-- ---------------------------------------------------------------------------
update public.order_events e
   set new_value = o.number::text,
       payload = coalesce(e.payload, '{}'::jsonb) || jsonb_build_object('order_number', o.number)
  from public.orders o
 where e.order_id = o.id
   and e.event_type = 'order_created'
   and o.number is not null
   and o.number::text not like 'ORD-PENDING-%'
   and (
     e.new_value like 'ORD-PENDING-%'
     or coalesce(e.payload->>'order_number', '') like 'ORD-PENDING-%'
     or e.new_value is null
     or e.new_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   );

commit;

-- ---------------------------------------------------------------------------
-- OPTIONAL (commented): delete paired custom_status_id siblings already stored
-- Uncomment after reviewing counts. Keeps the status row; removes the sibling.
-- ---------------------------------------------------------------------------
-- begin;
-- with paired as (
--   select c.id
--   from public.order_events s
--   join public.order_events c
--     on c.order_id = s.order_id
--    and c.event_type = 'status_changed'
--    and c.field_name = 'custom_status_id'
--    and s.field_name = 'status'
--    and s.event_type = 'status_changed'
--    and c.actor_user_id is not distinct from s.actor_user_id
--    and c.created_at >= s.created_at - interval '2 seconds'
--    and c.created_at <= s.created_at + interval '2 seconds'
--    and c.id <> s.id
-- )
-- delete from public.order_events e
--  using paired p
--  where e.id = p.id;
-- commit;

-- Verify:
-- select pg_catalog.obj_description(to_regprocedure('public.crm_orders_status_event()')::oid, 'pg_proc');
-- select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal;
