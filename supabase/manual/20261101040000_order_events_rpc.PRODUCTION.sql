-- =====================================================================
-- Core App: order feed events
--
--   crm_record_order_event(p_order_id, p_event_type, p_field_name, p_old_value, p_new_value, p_payload)
--   + AFTER UPDATE trigger on public.orders (status / custom_status_id)
--
-- WHY: `order_events` is write-protected for the browser (crm_ro_v1 RLS:
-- view '*', insert/update/delete '-'). The ONLY writers are SECURITY DEFINER
-- code: this RPC (called by the app on status moves) and the optional trigger
-- below (catches changes from any other writer: imports, SQL editor, other apps).
--
-- REQUIRES: crm_ro_v1.PRODUCTION.sql (step 2.1 of MIGRATION_CUTOVER.md).
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- IDEMPOTENT: safe to re-run. One transaction; nothing is changed on failure.
-- NOT applied automatically by the app or CI.
--
-- Rules
--   * RPC: caller must be authenticated and hold `orders.edit` in the order's workspace.
--   * Actor is always derived from the JWT (auth.uid() + user_metadata.full_name / email);
--     the browser cannot spoof it.
--   * workspace_id is always taken from the order row, never from the caller.
--   * Duplicate guard: an identical status_changed event (same order, field, old, new, actor)
--     written within the last 10 seconds is not inserted again. This lets the app RPC and the
--     trigger coexist without double entries, in either order.
--   * For field_name = 'custom_status_id' the status names are added to payload
--     (old_name / new_name) when missing, so the feed stays readable after renames/deletes.
--
-- OPTIONAL TRIGGER: drop it with
--   drop trigger if exists crm_orders_status_event on public.orders;
-- and the app keeps working (it records via the RPC itself).
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.order_events') is null or to_regclass('public.orders') is null then
    raise exception 'Preflight failed: public.order_events / public.orders missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise exception 'Preflight failed: public.crm_has_permission(uuid, text) is missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'custom_status_id'
  ) then
    raise exception 'Preflight failed: public.orders.custom_status_id is missing. Apply crm_ro_v1.PRODUCTION.sql (or 20261031000000_orders_custom_status.PRODUCTION.sql) first.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- Internal writer (not callable by clients)
-- ---------------------------------------------------------------------
create or replace function public.crm_order_event_insert(
  p_workspace_id uuid,
  p_order_id uuid,
  p_event_type text,
  p_field_name text,
  p_old_value text,
  p_new_value text,
  p_payload jsonb,
  p_actor_user_id uuid,
  p_actor_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_old_name text;
  v_new_name text;
begin
  if p_event_type = 'status_changed' and exists (
    select 1 from public.order_events e
    where e.order_id = p_order_id
      and e.event_type = p_event_type
      and e.field_name is not distinct from p_field_name
      and e.old_value is not distinct from p_old_value
      and e.new_value is not distinct from p_new_value
      and e.actor_user_id is not distinct from p_actor_user_id
      and e.created_at > now() - interval '10 seconds'
  ) then
    return null;
  end if;

  if p_field_name = 'custom_status_id' and to_regclass('public.status_definitions') is not null then
    if p_old_value is not null and not (v_payload ? 'old_name') then
      select d.name into v_old_name from public.status_definitions d
       where d.id::text = p_old_value and d.workspace_id = p_workspace_id;
      if v_old_name is not null then v_payload := v_payload || jsonb_build_object('old_name', v_old_name); end if;
    end if;
    if p_new_value is not null and not (v_payload ? 'new_name') then
      select d.name into v_new_name from public.status_definitions d
       where d.id::text = p_new_value and d.workspace_id = p_workspace_id;
      if v_new_name is not null then v_payload := v_payload || jsonb_build_object('new_name', v_new_name); end if;
    end if;
  end if;

  insert into public.order_events (
    workspace_id, order_id, event_type, field_name, old_value, new_value, payload, actor_user_id, actor_name
  ) values (
    p_workspace_id, p_order_id, p_event_type, p_field_name, p_old_value, p_new_value, v_payload, p_actor_user_id, p_actor_name
  ) returning id into v_id;

  return v_id;
end $$;

revoke all on function public.crm_order_event_insert(uuid, uuid, text, text, text, text, jsonb, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public RPC
-- ---------------------------------------------------------------------
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
  v_jwt jsonb;
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

  begin
    v_jwt := coalesce((select auth.jwt()), '{}'::jsonb);
  exception when others then
    v_jwt := '{}'::jsonb;
  end;
  v_actor_name := coalesce(
    nullif(btrim(v_jwt -> 'user_metadata' ->> 'full_name'), ''),
    nullif(btrim(v_jwt -> 'user_metadata' ->> 'name'), ''),
    nullif(btrim(v_jwt ->> 'email'), '')
  );

  return public.crm_order_event_insert(
    v_order_workspace, p_order_id, p_event_type,
    nullif(btrim(p_field_name), ''), p_old_value, p_new_value,
    coalesce(p_payload, '{}'::jsonb), v_uid, v_actor_name
  );
end $$;

revoke all on function public.crm_record_order_event(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.crm_record_order_event(uuid, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Optional trigger: status / custom status changes on orders
-- ---------------------------------------------------------------------
create or replace function public.crm_orders_status_event()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor_name text;
  v_jwt jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  begin
    v_jwt := coalesce((select auth.jwt()), '{}'::jsonb);
  exception when others then
    v_jwt := '{}'::jsonb;
  end;
  v_actor_name := coalesce(
    nullif(btrim(v_jwt -> 'user_metadata' ->> 'full_name'), ''),
    nullif(btrim(v_jwt -> 'user_metadata' ->> 'name'), ''),
    nullif(btrim(v_jwt ->> 'email'), '')
  );

  if new.status is distinct from old.status then
    perform public.crm_order_event_insert(
      new.workspace_id, new.id, 'status_changed', 'status', old.status::text, new.status::text,
      jsonb_build_object('source', 'trigger'), v_uid, v_actor_name
    );
  end if;

  if new.custom_status_id is distinct from old.custom_status_id then
    perform public.crm_order_event_insert(
      new.workspace_id, new.id, 'status_changed', 'custom_status_id', old.custom_status_id::text, new.custom_status_id::text,
      jsonb_build_object('source', 'trigger'), v_uid, v_actor_name
    );
  end if;

  return new;
end $$;

revoke all on function public.crm_orders_status_event() from public, anon, authenticated;

drop trigger if exists crm_orders_status_event on public.orders;
create trigger crm_orders_status_event
  after update of status, custom_status_id on public.orders
  for each row
  when (new.status is distinct from old.status or new.custom_status_id is distinct from old.custom_status_id)
  execute function public.crm_orders_status_event();

-- PostgREST picks up new functions after a schema reload.
notify pgrst, 'reload schema';

commit;
