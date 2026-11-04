-- =====================================================================
-- Core App: complete Order Activity History (order_events line + stock writers)
--
-- Extends the existing order_events infrastructure from
--   20261101040000_order_events_rpc.PRODUCTION.sql
-- without a second history system.
--
-- WHAT THIS ADDS
--   * crm_order_event_resolve_actor(workspace_id) — prefer linked employee name,
--     then JWT full_name / name / email. Never invents another person.
--   * AFTER INSERT/UPDATE/DELETE triggers on order_services
--       → service_added | service_updated | service_removed
--   * AFTER INSERT/UPDATE/DELETE triggers on order_materials
--       → material_added | material_updated | material_removed
--       → material_issued | material_returned (only when issued/returned counters rise)
--   * Status trigger payload enrichment for closed / cancelled (no duplicate rows)
--
-- WHY TRIGGERS
--   order_events insert is blocked for the browser (RLS write '-').
--   Service lines are written with direct table DML; material lines and warehouse
--   counters are written inside SECURITY DEFINER RPCs. Triggers run in the SAME
--   transaction as those successful writes, so a failed business operation cannot
--   leave a successful history row, and a successful write cannot silently skip
--   history when this script is applied.
--
-- REQUIRES
--   * crm_ro_v1.PRODUCTION.sql (order_events, orders, order_services, order_materials)
--   * 20261101040000_order_events_rpc.PRODUCTION.sql (crm_order_event_insert)
--
-- Apply by hand in the Supabase SQL Editor after review.
-- IDEMPOTENT: safe to re-run. One transaction; nothing commits on failure.
-- NOT applied automatically by the app or CI.
-- Does NOT rewrite existing historical events.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_events') is null then
    raise exception 'Preflight failed: public.order_events missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'Preflight failed: public.orders missing.';
  end if;
  if to_regclass('public.order_services') is null then
    raise exception 'Preflight failed: public.order_services missing.';
  end if;
  if to_regclass('public.order_materials') is null then
    raise exception 'Preflight failed: public.order_materials missing.';
  end if;
  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is null then
    raise exception 'Preflight failed: public.crm_order_event_insert missing. Apply 20261101040000_order_events_rpc.PRODUCTION.sql first.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- Actor resolution (employee display name when linked, else JWT claims)
-- ---------------------------------------------------------------------
create or replace function public.crm_order_event_resolve_actor(p_workspace_id uuid)
returns table(actor_user_id uuid, actor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_jwt jsonb;
  v_name text;
begin
  if v_uid is null then
    actor_user_id := null;
    actor_name := null;
    return next;
    return;
  end if;

  actor_user_id := v_uid;

  if to_regclass('public.employees') is not null and p_workspace_id is not null then
    -- Prefer an active employee linked to this auth user; never fall back to another employee.
    select nullif(btrim(e.name), '')
      into v_name
      from public.employees e
     where e.workspace_id = p_workspace_id
       and e.profile_id = v_uid
       and coalesce(e.status, 'active') = 'active'
     order by e.id asc
     limit 1;
  end if;

  if v_name is null then
    begin
      v_jwt := coalesce((select auth.jwt()), '{}'::jsonb);
    exception when others then
      v_jwt := '{}'::jsonb;
    end;
    v_name := coalesce(
      nullif(btrim(v_jwt -> 'user_metadata' ->> 'full_name'), ''),
      nullif(btrim(v_jwt -> 'user_metadata' ->> 'name'), ''),
      nullif(btrim(v_jwt ->> 'email'), '')
    );
  end if;

  actor_name := v_name;
  return next;
end
$$;

revoke all on function public.crm_order_event_resolve_actor(uuid) from public, anon, authenticated;

-- Prefer employee name in the public RPC as well (same contract as triggers).
create or replace function public.crm_record_order_event(
  p_order_id uuid,
  p_event_type text,
  p_field_name text default null,
  p_old_value text default null,
  p_new_value text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_order_workspace uuid;
  v_actor_name text;
  v_actor record;
begin
  if v_uid is null then
    raise exception 'crm_record_order_event: not authenticated' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'crm_record_order_event: order id is required' using errcode = '22023';
  end if;
  if p_event_type is null or p_event_type !~ '^[a-z][a-z0-9_.]{0,63}$' then
    raise exception 'crm_record_order_event: invalid event type' using errcode = '22023';
  end if;
  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'crm_record_order_event: payload must be a JSON object' using errcode = '22023';
  end if;

  select o.workspace_id into v_order_workspace from public.orders o where o.id = p_order_id;
  if v_order_workspace is null then
    raise exception 'crm_record_order_event: order not found' using errcode = 'P0002';
  end if;

  if not public.crm_has_permission(v_order_workspace, 'orders.edit') then
    raise exception 'crm_record_order_event: permission denied (orders.edit required)' using errcode = '42501';
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(v_order_workspace);
  v_actor_name := v_actor.actor_name;

  return public.crm_order_event_insert(
    v_order_workspace, p_order_id, p_event_type,
    nullif(btrim(p_field_name), ''), p_old_value, p_new_value,
    coalesce(p_payload, '{}'::jsonb), v_uid, v_actor_name
  );
end $$;

revoke all on function public.crm_record_order_event(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.crm_record_order_event(uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Status trigger: keep one status_changed row; enrich closed/cancelled payload
-- ---------------------------------------------------------------------
create or replace function public.crm_orders_status_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor record;
  v_payload jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(new.workspace_id);

  if new.status is distinct from old.status then
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

  if new.custom_status_id is distinct from old.custom_status_id then
    perform public.crm_order_event_insert(
      new.workspace_id, new.id, 'status_changed', 'custom_status_id',
      old.custom_status_id::text, new.custom_status_id::text,
      jsonb_build_object('source', 'trigger'),
      v_actor.actor_user_id, v_actor.actor_name
    );
  end if;

  return new;
end $$;

revoke all on function public.crm_orders_status_event() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- order_services activity
-- ---------------------------------------------------------------------
create or replace function public.crm_order_services_activity_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_order_id uuid;
  v_actor record;
  v_payload jsonb;
  v_kind text;
  v_name text;
  v_changes jsonb := '{}'::jsonb;
  v_has_kind boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_services' and column_name = 'kind'
  );
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id into v_workspace from public.orders o where o.id = v_order_id;
  if v_workspace is null then
    return coalesce(new, old);
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(v_workspace);

  if tg_op = 'INSERT' then
    v_name := coalesce(nullif(btrim(new.service_name), ''), '—');
    if v_has_kind then
      v_kind := new.kind;
    end if;
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'line_id', new.id,
      'item_name', v_name,
      'quantity', new.quantity,
      'price', new.price
    );
    if v_kind is not null then
      v_payload := v_payload || jsonb_build_object('kind', v_kind);
    end if;
    if new.service_id is not null then
      v_payload := v_payload || jsonb_build_object('service_id', new.service_id);
    end if;

    perform public.crm_order_event_insert(
      v_workspace, v_order_id, 'service_added', 'order_services',
      null, v_name, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_name := coalesce(nullif(btrim(old.service_name), ''), '—');
    if v_has_kind then
      v_kind := old.kind;
    end if;
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'line_id', old.id,
      'item_name', v_name,
      'quantity', old.quantity,
      'price', old.price
    );
    if v_kind is not null then
      v_payload := v_payload || jsonb_build_object('kind', v_kind);
    end if;

    perform public.crm_order_event_insert(
      v_workspace, v_order_id, 'service_removed', 'order_services',
      v_name, null, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return old;
  end if;

  -- UPDATE: only meaningful line edits (not no-ops)
  if new.service_name is distinct from old.service_name then
    v_changes := v_changes || jsonb_build_object(
      'name', jsonb_build_object('from', old.service_name, 'to', new.service_name)
    );
  end if;
  if new.quantity is distinct from old.quantity then
    v_changes := v_changes || jsonb_build_object(
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity)
    );
  end if;
  if new.price is distinct from old.price then
    v_changes := v_changes || jsonb_build_object(
      'price', jsonb_build_object('from', old.price, 'to', new.price)
    );
  end if;
  if v_has_kind and new.kind is distinct from old.kind then
    v_changes := v_changes || jsonb_build_object(
      'kind', jsonb_build_object('from', old.kind, 'to', new.kind)
    );
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.service_name), ''), nullif(btrim(old.service_name), ''), '—');
  if v_has_kind then
    v_kind := coalesce(new.kind, old.kind);
  end if;
  v_payload := jsonb_build_object(
    'source', 'trigger',
    'line_id', new.id,
    'item_name', v_name,
    'quantity', new.quantity,
    'price', new.price,
    'changes', v_changes
  );
  if v_kind is not null then
    v_payload := v_payload || jsonb_build_object('kind', v_kind);
  end if;

  perform public.crm_order_event_insert(
    v_workspace, v_order_id, 'service_updated', 'order_services',
    old.service_name, new.service_name,
    v_payload, v_actor.actor_user_id, v_actor.actor_name
  );
  return new;
end $$;

revoke all on function public.crm_order_services_activity_event() from public, anon, authenticated;

drop trigger if exists crm_order_services_activity_event on public.order_services;
create trigger crm_order_services_activity_event
  after insert or update or delete on public.order_services
  for each row
  execute function public.crm_order_services_activity_event();

-- ---------------------------------------------------------------------
-- order_materials activity (line edits vs warehouse counters)
-- ---------------------------------------------------------------------
create or replace function public.crm_order_materials_activity_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_order_id uuid;
  v_actor record;
  v_payload jsonb;
  v_name text;
  v_changes jsonb := '{}'::jsonb;
  v_issued_delta numeric;
  v_returned_delta numeric;
  v_has_issued boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_materials' and column_name = 'quantity_issued'
  );
  v_has_returned boolean := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_materials' and column_name = 'quantity_returned'
  );
begin
  v_order_id := coalesce(new.order_id, old.order_id);
  select o.workspace_id into v_workspace from public.orders o where o.id = v_order_id;
  if v_workspace is null then
    return coalesce(new, old);
  end if;

  select * into v_actor from public.crm_order_event_resolve_actor(v_workspace);

  if tg_op = 'INSERT' then
    v_name := coalesce(nullif(btrim(new.item_name), ''), '—');
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'line_id', new.id,
      'item_name', v_name,
      'quantity', new.quantity,
      'price', new.price
    );
    if new.inventory_item_id is not null then
      v_payload := v_payload || jsonb_build_object('inventory_item_id', new.inventory_item_id);
    end if;

    perform public.crm_order_event_insert(
      v_workspace, v_order_id, 'material_added', 'order_materials',
      null, v_name, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_name := coalesce(nullif(btrim(old.item_name), ''), '—');
    v_payload := jsonb_build_object(
      'source', 'trigger',
      'line_id', old.id,
      'item_name', v_name,
      'quantity', old.quantity,
      'price', old.price
    );

    perform public.crm_order_event_insert(
      v_workspace, v_order_id, 'material_removed', 'order_materials',
      v_name, null, v_payload, v_actor.actor_user_id, v_actor.actor_name
    );
    return old;
  end if;

  -- Warehouse counters first: only when the counter actually increases after a
  -- successful issue/return UPDATE (never invent a success event on failure —
  -- a rolled-back UPDATE never reaches this AFTER trigger).
  if v_has_issued then
    v_issued_delta := coalesce(new.quantity_issued, 0) - coalesce(old.quantity_issued, 0);
    if v_issued_delta > 0 then
      v_name := coalesce(nullif(btrim(new.item_name), ''), nullif(btrim(old.item_name), ''), '—');
      v_payload := jsonb_build_object(
        'source', 'trigger',
        'line_id', new.id,
        'item_name', v_name,
        'quantity', v_issued_delta,
        'price', new.price,
        'quantity_issued', new.quantity_issued,
        'quantity_returned', case when v_has_returned then new.quantity_returned else null end
      );
      perform public.crm_order_event_insert(
        v_workspace, v_order_id, 'material_issued', 'quantity_issued',
        coalesce(old.quantity_issued, 0)::text, coalesce(new.quantity_issued, 0)::text,
        v_payload, v_actor.actor_user_id, v_actor.actor_name
      );
      -- Issued counter change is the warehouse action; do not also emit a line update
      -- for the same statement even if other columns moved.
      return new;
    end if;
  end if;

  if v_has_returned then
    v_returned_delta := coalesce(new.quantity_returned, 0) - coalesce(old.quantity_returned, 0);
    if v_returned_delta > 0 then
      v_name := coalesce(nullif(btrim(new.item_name), ''), nullif(btrim(old.item_name), ''), '—');
      v_payload := jsonb_build_object(
        'source', 'trigger',
        'line_id', new.id,
        'item_name', v_name,
        'quantity', v_returned_delta,
        'price', new.price,
        'quantity_issued', case when v_has_issued then new.quantity_issued else null end,
        'quantity_returned', new.quantity_returned
      );
      perform public.crm_order_event_insert(
        v_workspace, v_order_id, 'material_returned', 'quantity_returned',
        coalesce(old.quantity_returned, 0)::text, coalesce(new.quantity_returned, 0)::text,
        v_payload, v_actor.actor_user_id, v_actor.actor_name
      );
      return new;
    end if;
  end if;

  if new.item_name is distinct from old.item_name then
    v_changes := v_changes || jsonb_build_object(
      'name', jsonb_build_object('from', old.item_name, 'to', new.item_name)
    );
  end if;
  if new.quantity is distinct from old.quantity then
    v_changes := v_changes || jsonb_build_object(
      'quantity', jsonb_build_object('from', old.quantity, 'to', new.quantity)
    );
  end if;
  if new.price is distinct from old.price then
    v_changes := v_changes || jsonb_build_object(
      'price', jsonb_build_object('from', old.price, 'to', new.price)
    );
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  v_name := coalesce(nullif(btrim(new.item_name), ''), nullif(btrim(old.item_name), ''), '—');
  v_payload := jsonb_build_object(
    'source', 'trigger',
    'line_id', new.id,
    'item_name', v_name,
    'quantity', new.quantity,
    'price', new.price,
    'changes', v_changes
  );

  perform public.crm_order_event_insert(
    v_workspace, v_order_id, 'material_updated', 'order_materials',
    old.item_name, new.item_name,
    v_payload, v_actor.actor_user_id, v_actor.actor_name
  );
  return new;
end $$;

revoke all on function public.crm_order_materials_activity_event() from public, anon, authenticated;

drop trigger if exists crm_order_materials_activity_event on public.order_materials;
create trigger crm_order_materials_activity_event
  after insert or update or delete on public.order_materials
  for each row
  execute function public.crm_order_materials_activity_event();

-- PostgREST picks up function signature changes.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Post-apply verification (run manually; read-only)
-- ---------------------------------------------------------------------
-- select to_regprocedure('public.crm_order_event_resolve_actor(uuid)') is not null as actor_resolver_ok;
-- select tgname from pg_trigger
--  where tgrelid = 'public.order_services'::regclass and not tgisinternal;
-- select tgname from pg_trigger
--  where tgrelid = 'public.order_materials'::regclass and not tgisinternal;
-- select event_type, count(*) from public.order_events group by 1 order by 1;
