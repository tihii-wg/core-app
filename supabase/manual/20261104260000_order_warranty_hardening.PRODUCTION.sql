-- =============================================================================
-- Core App — Order warranty hardening @v1 (MAIN only — manual apply)
-- =============================================================================
-- Fixes vs 20261104250000_order_warranty_workflow:
--   1) Exact day-based warranty (no warranty_days / 30 → months conversion)
--   2) Immutable vehicle_mileage_snapshot captured once on first successful close
--   3) activate_order_warranties never falls back to live vehicles.current_mileage
--   4) duration_days on warranty_records; ends_on from months OR exact days
--   5) RLS: replace FOR ALL editor policies (orders.edit must not imply DELETE)
--   5b) warranty_order_claims.is_active + DELETE requires orders.delete (no edit DELETE)
--   6) Snapshot immutability trigger on warranty_records
--   7) orders.warranty_source_order_id FK forced to ON DELETE RESTRICT
--   8) BEFORE DELETE guard calling order_delete_blocked_by_warranty
--   9) apply_order_material_warranties RPC (browser cannot UPDATE order_materials)
--
-- Does NOT execute remotely. Review, then run on MAIN only.
-- Idempotent where practical. Preserves existing warranty_records / claims.
-- Do not reinterpret existing duration_months values as days.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Preflight
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'warranty_records missing (apply 20261104250000 first); ';
  end if;
  if to_regclass('public.warranty_order_claims') is null then
    v_problems := v_problems || 'warranty_order_claims missing (apply 20261104250000 first); ';
  end if;
  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is null then
    v_problems := v_problems || 'activate_order_warranties missing; ';
  end if;
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    v_problems := v_problems || 'close_order_if_settled missing; ';
  end if;
  if to_regprocedure('public.order_delete_blocked_by_warranty(uuid,uuid)') is null then
    v_problems := v_problems || 'order_delete_blocked_by_warranty missing; ';
  end if;
  -- crm_has_permission(uuid, text) — accept either to_regprocedure spacing form.
  if to_regprocedure('public.crm_has_permission(uuid,text)') is null
     and to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  -- Membership helper on MAIN / existing RLS: public.is_workspace_member(uuid).
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if to_regclass('public.warranty_records') is not null
     and not exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.warranty_records'::regclass
         and a.attname = 'activated_on_close' and a.attnum > 0 and not a.attisdropped
     ) then
    v_problems := v_problems || 'warranty_records.activated_on_close missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_warranty_hardening preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Schema: duration_days + ensure line warranty columns
-- ---------------------------------------------------------------------------
alter table public.warranty_records
  add column if not exists duration_days integer;

do $dd$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass
      and conname = 'warranty_records_duration_days_check'
  ) then
    alter table public.warranty_records
      add constraint warranty_records_duration_days_check
      check (duration_days is null or duration_days > 0);
  end if;
end;
$dd$;

comment on column public.warranty_records.duration_days is
  'Exact calendar-day coverage when the source line used warranty_days. Null when duration is month-based or time-unlimited. Never derived by dividing days by 30.';

alter table public.order_services
  add column if not exists warranty_days integer,
  add column if not exists warranty_months integer,
  add column if not exists warranty_km integer;

alter table public.order_materials
  add column if not exists warranty_days integer,
  add column if not exists warranty_months integer,
  add column if not exists warranty_km integer;

alter table public.orders
  add column if not exists vehicle_mileage_snapshot integer;

-- ---------------------------------------------------------------------------
-- 2) Force warranty_source_order_id FK to ON DELETE RESTRICT
-- ---------------------------------------------------------------------------
do $fk$
declare
  v_conname text;
  v_confdeltype char;
begin
  select c.conname, c.confdeltype
    into v_conname, v_confdeltype
  from pg_constraint c
  where c.conrelid = 'public.orders'::regclass
    and c.contype = 'f'
    and pg_get_constraintdef(c.oid) ilike '%warranty_source_order_id%'
  order by case when c.conname = 'orders_warranty_source_order_id_fkey' then 0 else 1 end
  limit 1;

  if v_conname is not null and v_confdeltype is distinct from 'r' then
    execute format('alter table public.orders drop constraint %I', v_conname);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_warranty_source_order_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_warranty_source_order_id_fkey
      foreign key (warranty_source_order_id) references public.orders(id) on delete restrict;
  end if;
end;
$fk$;

-- ---------------------------------------------------------------------------
-- 3) RLS — split FOR ALL editor policies
-- SECURITY: permissive FOR ALL + orders.edit previously OR-granted DELETE to editors.
-- ---------------------------------------------------------------------------
drop policy if exists warranty_records_write_editor on public.warranty_records;
drop policy if exists warranty_records_insert_editor on public.warranty_records;
drop policy if exists warranty_records_update_editor on public.warranty_records;
drop policy if exists warranty_records_delete_editor on public.warranty_records;
drop policy if exists warranty_records_select_member on public.warranty_records;

create policy warranty_records_select_member
  on public.warranty_records for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy warranty_records_insert_editor
  on public.warranty_records for insert to authenticated
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

create policy warranty_records_update_editor
  on public.warranty_records for update to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false))
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

create policy warranty_records_delete_editor
  on public.warranty_records for delete to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.delete'), false));

-- Soft-deactivate flag: editors UPDATE is_active instead of DELETE+INSERT when
-- linking/unlinking covered items. Inactive rows still protect original orders.
alter table public.warranty_order_claims
  add column if not exists is_active boolean not null default true;

comment on column public.warranty_order_claims.is_active is
  'False when the warranty order no longer treats this snapshot as a current claim. Row is retained so originals stay protected from deletion.';

drop policy if exists warranty_order_claims_write_editor on public.warranty_order_claims;
drop policy if exists warranty_order_claims_insert_editor on public.warranty_order_claims;
drop policy if exists warranty_order_claims_update_editor on public.warranty_order_claims;
drop policy if exists warranty_order_claims_delete_editor on public.warranty_order_claims;
drop policy if exists warranty_order_claims_select_member on public.warranty_order_claims;

create policy warranty_order_claims_select_member
  on public.warranty_order_claims for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy warranty_order_claims_insert_editor
  on public.warranty_order_claims for insert to authenticated
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

create policy warranty_order_claims_update_editor
  on public.warranty_order_claims for update to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false))
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

-- SECURITY: orders.edit must NOT delete claims (that would drop history that blocks
-- original-order deletion). Hard DELETE requires orders.delete. App link edits use
-- INSERT/UPDATE + is_active only.
create policy warranty_order_claims_delete_editor
  on public.warranty_order_claims for delete to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.delete'), false));

-- ---------------------------------------------------------------------------
-- 4) Immutability trigger for activated warranty snapshots
-- ---------------------------------------------------------------------------
create or replace function public.warranty_records_reject_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' and coalesce(old.activated_on_close, false) then
    if old.starts_at is distinct from new.starts_at
       or old.starts_on is distinct from new.starts_on
       or old.ends_on is distinct from new.ends_on
       or old.start_mileage is distinct from new.start_mileage
       or old.expires_at_mileage is distinct from new.expires_at_mileage
       or old.duration_months is distinct from new.duration_months
       or old.duration_days is distinct from new.duration_days
       or old.mileage_limit is distinct from new.mileage_limit
       or old.order_id is distinct from new.order_id
       or old.order_service_id is distinct from new.order_service_id
       or old.order_material_id is distinct from new.order_material_id
       or old.workspace_id is distinct from new.workspace_id
    then
      raise exception 'warranty_records:snapshot_immutable'
        using errcode = 'P0001',
              hint = 'Activated warranty snapshots cannot be rewritten.';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_warranty_records_snapshot_immutable on public.warranty_records;
create trigger trg_warranty_records_snapshot_immutable
  before update on public.warranty_records
  for each row
  execute function public.warranty_records_reject_snapshot_mutation();

-- ---------------------------------------------------------------------------
-- 5) BEFORE DELETE on orders — invoke warranty blocker server-side
-- ---------------------------------------------------------------------------
create or replace function public.orders_block_delete_with_warranty()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_block text;
begin
  v_block := public.order_delete_blocked_by_warranty(old.workspace_id, old.id);
  if v_block is not null then
    raise exception '%', v_block using errcode = 'P0001';
  end if;
  return old;
end;
$fn$;

drop trigger if exists trg_orders_block_delete_with_warranty on public.orders;
create trigger trg_orders_block_delete_with_warranty
  before delete on public.orders
  for each row
  execute function public.orders_block_delete_with_warranty();

-- ---------------------------------------------------------------------------
-- 6) activate_order_warranties @v2
-- ---------------------------------------------------------------------------
create or replace function public.activate_order_warranties(
  p_workspace_id uuid,
  p_order_id uuid,
  p_closed_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_order public.orders%rowtype;
  v_start timestamptz;
  v_start_mileage integer;
  v_inserted integer := 0;
  r record;
  v_months integer;
  v_days integer;
  v_km integer;
  v_ends date;
  v_expires_mileage integer;
begin
  if p_workspace_id is null or p_order_id is null or p_closed_at is null then
    return 0;
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id
  for update;

  if not found then
    return 0;
  end if;

  if v_order.status is not distinct from 'cancelled' then
    return 0;
  end if;

  -- Immutable close instant.
  v_start := coalesce(v_order.closed_at, p_closed_at);

  -- Mileage: ONLY orders.vehicle_mileage_snapshot. Never live vehicles.current_mileage.
  v_start_mileage := v_order.vehicle_mileage_snapshot;

  -- Services
  for r in
    select
      s.id,
      s.service_name as item_name,
      case when s.warranty_months is not null and s.warranty_months > 0 then s.warranty_months::integer end as months,
      case
        when (s.warranty_months is null or s.warranty_months <= 0)
         and s.warranty_days is not null and s.warranty_days > 0
        then s.warranty_days::integer
      end as days,
      case when s.warranty_km is not null and s.warranty_km > 0 then s.warranty_km::integer end as km
    from public.order_services s
    where s.order_id = p_order_id
  loop
    v_months := r.months;
    v_days := r.days;
    v_km := r.km;
    if v_months is null and v_days is null and v_km is null then
      continue;
    end if;
    if exists (
      select 1 from public.warranty_records wr
      where wr.order_id = p_order_id and wr.order_service_id = r.id
    ) then
      continue;
    end if;

    v_ends := case
      when v_months is not null then (v_start::date + make_interval(months => v_months))::date
      when v_days is not null then (v_start::date + make_interval(days => v_days))::date
      else null
    end;
    v_expires_mileage := case
      when v_km is not null and v_start_mileage is not null then v_start_mileage + v_km
      else null
    end;

    insert into public.warranty_records (
      workspace_id, order_id, client_id, vehicle_id,
      order_service_id, order_material_id, item_kind, item_name,
      duration_months, duration_days, mileage_limit, starts_at, starts_on, ends_on,
      start_mileage, expires_at_mileage, order_number_snapshot, activated_on_close
    ) values (
      p_workspace_id, p_order_id, v_order.client_id, v_order.vehicle_id,
      r.id, null, 'service', coalesce(nullif(trim(r.item_name), ''), 'Service'),
      v_months, v_days, v_km, v_start, v_start::date, v_ends,
      v_start_mileage, v_expires_mileage, v_order.number, true
    )
    on conflict (order_id, order_service_id) where order_service_id is not null do nothing;

    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  -- Materials
  if to_regclass('public.order_materials') is not null then
    for r in
      select
        m.id,
        m.item_name,
        case when m.warranty_months is not null and m.warranty_months > 0 then m.warranty_months::integer end as months,
        case
          when (m.warranty_months is null or m.warranty_months <= 0)
           and m.warranty_days is not null and m.warranty_days > 0
          then m.warranty_days::integer
        end as days,
        case when m.warranty_km is not null and m.warranty_km > 0 then m.warranty_km::integer end as km
      from public.order_materials m
      where m.order_id = p_order_id
    loop
      v_months := r.months;
      v_days := r.days;
      v_km := r.km;
      if v_months is null and v_days is null and v_km is null then
        continue;
      end if;
      if exists (
        select 1 from public.warranty_records wr
        where wr.order_id = p_order_id and wr.order_material_id = r.id
      ) then
        continue;
      end if;

      v_ends := case
        when v_months is not null then (v_start::date + make_interval(months => v_months))::date
        when v_days is not null then (v_start::date + make_interval(days => v_days))::date
        else null
      end;
      v_expires_mileage := case
        when v_km is not null and v_start_mileage is not null then v_start_mileage + v_km
        else null
      end;

      insert into public.warranty_records (
        workspace_id, order_id, client_id, vehicle_id,
        order_service_id, order_material_id, item_kind, item_name,
        duration_months, duration_days, mileage_limit, starts_at, starts_on, ends_on,
        start_mileage, expires_at_mileage, order_number_snapshot, activated_on_close
      ) values (
        p_workspace_id, p_order_id, v_order.client_id, v_order.vehicle_id,
        null, r.id, 'material', coalesce(nullif(trim(r.item_name), ''), 'Part'),
        v_months, v_days, v_km, v_start, v_start::date, v_ends,
        v_start_mileage, v_expires_mileage, v_order.number, true
      )
      on conflict (order_id, order_material_id) where order_material_id is not null do nothing;

      if found then
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end if;

  return v_inserted;
end;
$fn$;

revoke all on function public.activate_order_warranties(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.activate_order_warranties(uuid, uuid, timestamptz) to authenticated, service_role;

comment on function public.activate_order_warranties(uuid, uuid, timestamptz) is
  'managed-object: core-app/activate_order_warranties@v2 — exact months or days; mileage from immutable order snapshot only; idempotent per line.';

-- ---------------------------------------------------------------------------
-- 7) close_order_if_settled @v3 — capture mileage snapshot once, then activate
-- ---------------------------------------------------------------------------
create or replace function public.close_order_if_settled(
  p_order_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_remaining numeric;
  v_total numeric;
  v_close_status_id uuid;
  v_currency text;
  v_has_ledger boolean;
  v_touch text;
  v_closed_at timestamptz;
  v_warranty_count integer := 0;
  v_mileage integer;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  if v_order.workspace_id is distinct from p_workspace_id then
    raise exception 'order_lifecycle:workspace_mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.payments p
  where p.workspace_id = p_workspace_id
    and (
      p.order_id = p_order_id
      or p.invoice_id in (
        select i.id from public.invoices i
        where i.workspace_id = p_workspace_id and i.order_id = p_order_id
      )
    )
  order by p.id
  for update of p;

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.workspaces'::regclass
      and a.attname = 'currency' and a.attnum > 0 and not a.attisdropped
  ) then
    execute 'select nullif(upper(btrim(w.currency::text)), '''') from public.workspaces w where w.id = $1'
      into v_currency using p_workspace_id;
  end if;

  if v_order.closed_at is not null then
    -- Idempotent close: never rewrite closed_at or mileage snapshot; still fill missing warranty rows.
    if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is not null then
      v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_order.closed_at);
    end if;
    v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'closed_at', v_order.closed_at,
      'custom_status_id', v_order.custom_status_id,
      'remaining', round(v_remaining, 2),
      'currency', coalesce(v_currency, ''),
      'warranties_activated', v_warranty_count
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_lifecycle:cannot_close_cancelled' using errcode = 'P0001';
  end if;

  v_total := coalesce(v_order.total_price, 0);

  select exists (
    select 1 from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id from public.invoices i
          where i.workspace_id = p_workspace_id and i.order_id = p_order_id
        )
      )
      and p.kind in ('payment', 'refund', 'void')
  ) into v_has_ledger;

  if v_total > 0.005 and not v_has_ledger then
    raise exception 'order_lifecycle:ledger_required remaining=% currency=%',
      round(v_total, 2), coalesce(v_currency, '')
      using errcode = 'P0001';
  end if;

  v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);
  if v_remaining > 0.005 then
    raise exception 'order_lifecycle:not_settled remaining=% currency=%',
      round(v_remaining, 2), coalesce(v_currency, '')
      using errcode = 'P0001';
  end if;

  select d.id into v_close_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'close'
  order by d.sort_order, d.name, d.id
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'close', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by, created_at = now();

  -- Capture vehicle mileage exactly once at first successful close (never overwrite later).
  v_mileage := null;
  if v_order.vehicle_id is not null and to_regclass('public.vehicles') is not null then
    select v.current_mileage into v_mileage
    from public.vehicles v
    where v.id = v_order.vehicle_id and v.workspace_id = p_workspace_id;
  end if;

  execute format(
    'update public.orders o
        set status = ''closed'',
            closed_at = coalesce(o.closed_at, now()),
            vehicle_mileage_snapshot = coalesce(o.vehicle_mileage_snapshot, $4),
            custom_status_id = coalesce($1, o.custom_status_id)%s
      where o.id = $2 and o.workspace_id = $3
      returning o.closed_at',
    v_touch
  )
    into v_closed_at
    using v_close_status_id, p_order_id, p_workspace_id, v_mileage;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'close';

  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is not null then
    v_warranty_count := public.activate_order_warranties(p_workspace_id, p_order_id, v_closed_at);
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'closed_at', v_closed_at,
    'custom_status_id', v_close_status_id,
    'remaining', round(v_remaining, 2),
    'currency', coalesce(v_currency, ''),
    'warranties_activated', v_warranty_count
  );
end;
$fn$;

revoke all on function public.close_order_if_settled(uuid, uuid) from public, anon;
grant execute on function public.close_order_if_settled(uuid, uuid) to authenticated, service_role;

comment on function public.close_order_if_settled(uuid, uuid) is
  'managed-object: core-app/close_order_if_settled@v3 — formal close when settled; snapshots mileage once; activates warranties; no payment/inventory changes.';

-- ---------------------------------------------------------------------------
-- 8) apply_order_material_warranties — persist line warranty after materials sync
-- ---------------------------------------------------------------------------
create or replace function public.apply_order_material_warranties(
  p_order_id uuid,
  p_workspace_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_elem jsonb;
  v_line_id uuid;
  v_item_id uuid;
  v_months integer;
  v_days integer;
  v_km integer;
  v_updated integer := 0;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'order_warranty:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_workspace_id is null then
    raise exception 'order_warranty:invalid_args' using errcode = '22023';
  end if;
  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.edit'), false) then
    raise exception 'order_warranty:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_warranty:order_not_found' using errcode = 'P0002';
  end if;

  -- Do not rewrite warranty configuration after formal close (snapshots already taken).
  if v_order.closed_at is not null then
    return 0;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    return 0;
  end if;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id := null;
    v_item_id := null;
    begin
      if (v_elem ? 'line_id') and jsonb_typeof(v_elem -> 'line_id') = 'string' then
        v_line_id := nullif(trim(v_elem ->> 'line_id'), '')::uuid;
      end if;
      if (v_elem ? 'inventory_item_id') and jsonb_typeof(v_elem -> 'inventory_item_id') = 'string' then
        v_item_id := nullif(trim(v_elem ->> 'inventory_item_id'), '')::uuid;
      end if;
    exception when others then
      raise exception 'order_warranty:invalid_line_ref' using errcode = '22P02';
    end;

    v_months := null;
    v_days := null;
    v_km := null;
    if (v_elem ? 'warranty_months') and jsonb_typeof(v_elem -> 'warranty_months') = 'number' then
      v_months := trunc((v_elem ->> 'warranty_months')::numeric)::integer;
      if v_months is not null and v_months <= 0 then v_months := null; end if;
    end if;
    if (v_elem ? 'warranty_days') and jsonb_typeof(v_elem -> 'warranty_days') = 'number' then
      v_days := trunc((v_elem ->> 'warranty_days')::numeric)::integer;
      if v_days is not null and v_days <= 0 then v_days := null; end if;
    end if;
    if (v_elem ? 'warranty_km') and jsonb_typeof(v_elem -> 'warranty_km') = 'number' then
      v_km := trunc((v_elem ->> 'warranty_km')::numeric)::integer;
      if v_km is not null and v_km <= 0 then v_km := null; end if;
    end if;
    -- Explicit JSON null clears the field.
    if (v_elem ? 'warranty_months') and jsonb_typeof(v_elem -> 'warranty_months') = 'null' then
      v_months := null;
    end if;
    if (v_elem ? 'warranty_days') and jsonb_typeof(v_elem -> 'warranty_days') = 'null' then
      v_days := null;
    end if;
    if (v_elem ? 'warranty_km') and jsonb_typeof(v_elem -> 'warranty_km') = 'null' then
      v_km := null;
    end if;

    if v_line_id is not null then
      update public.order_materials m
         set warranty_months = v_months,
             warranty_days = v_days,
             warranty_km = v_km
       where m.id = v_line_id
         and m.order_id = p_order_id;
    elsif v_item_id is not null then
      update public.order_materials m
         set warranty_months = v_months,
             warranty_days = v_days,
             warranty_km = v_km
       where m.order_id = p_order_id
         and m.inventory_item_id = v_item_id;
    else
      continue;
    end if;

    get diagnostics v_n = row_count;
    v_updated := v_updated + v_n;
  end loop;

  return v_updated;
end;
$fn$;

revoke all on function public.apply_order_material_warranties(uuid, uuid, jsonb) from public, anon;
grant execute on function public.apply_order_material_warranties(uuid, uuid, jsonb) to authenticated, service_role;

comment on function public.apply_order_material_warranties(uuid, uuid, jsonb) is
  'managed-object: core-app/apply_order_material_warranties@v1 — sets warranty_months/days/km on order_materials after sync; blocked after close.';

-- Inactive claims still block original-order deletion (history retention).
comment on function public.order_delete_blocked_by_warranty(uuid, uuid) is
  'managed-object: core-app/order_delete_blocked_by_warranty@v1 — blocks delete when child warranty orders or any warranty_order_claims (including is_active=false) reference this original.';

-- ---------------------------------------------------------------------------
-- 9) Post-apply verification
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_problems text := '';
  v_def text;
  v_pol text;
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.warranty_records'::regclass
      and attname = 'duration_days' and attnum > 0 and not attisdropped
  ) then
    v_problems := v_problems || 'duration_days missing; ';
  end if;

  select pg_get_functiondef('public.activate_order_warranties(uuid,uuid,timestamptz)'::regprocedure)
    into v_def;
  if v_def is null then
    v_problems := v_problems || 'activate_order_warranties missing; ';
  else
    if v_def ~* 'greatest\(1,\s*\(.*warranty_days.*/\s*30' then
      v_problems := v_problems || 'activate still converts days/30; ';
    end if;
    if v_def ~* 'from public\.vehicles' and v_def ~* 'current_mileage' then
      v_problems := v_problems || 'activate still reads live vehicle mileage; ';
    end if;
    if v_def !~* 'duration_days' then
      v_problems := v_problems || 'activate does not write duration_days; ';
    end if;
  end if;

  select pg_get_functiondef('public.close_order_if_settled(uuid,uuid)'::regprocedure)
    into v_def;
  if v_def is null or v_def !~* 'vehicle_mileage_snapshot = coalesce' then
    v_problems := v_problems || 'close_order does not coalesce mileage snapshot; ';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'warranty_records'
      and policyname = 'warranty_records_write_editor'
  ) then
    v_problems := v_problems || 'warranty_records_write_editor still present; ';
  end if;

  select string_agg(policyname || ':' || cmd, ', ')
    into v_pol
  from pg_policies
  where schemaname = 'public' and tablename = 'warranty_records';

  if v_pol is null or v_pol !~* 'warranty_records_delete_editor' then
    v_problems := v_problems || 'warranty_records_delete_editor missing; ';
  end if;

  -- Claims DELETE must require orders.delete (not orders.edit).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'warranty_order_claims'
      and policyname = 'warranty_order_claims_delete_editor'
      and cmd = 'DELETE'
      and qual ilike '%orders.delete%'
  ) then
    v_problems := v_problems || 'warranty_order_claims DELETE policy missing orders.delete; ';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'warranty_order_claims'
      and policyname = 'warranty_order_claims_delete_editor'
      and qual ilike '%orders.edit%'
      and qual not ilike '%orders.delete%'
  ) then
    v_problems := v_problems || 'warranty_order_claims DELETE still keyed to orders.edit; ';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'warranty_order_claims'
      and policyname = 'warranty_order_claims_write_editor'
  ) then
    v_problems := v_problems || 'warranty_order_claims_write_editor still present; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.warranty_order_claims'::regclass
      and a.attname = 'is_active' and a.attnum > 0 and not a.attisdropped
  ) then
    v_problems := v_problems || 'warranty_order_claims.is_active missing; ';
  end if;

  if to_regprocedure('public.apply_order_material_warranties(uuid,uuid,jsonb)') is null then
    v_problems := v_problems || 'apply_order_material_warranties missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_orders_block_delete_with_warranty'
      and tgrelid = 'public.orders'::regclass
  ) then
    v_problems := v_problems || 'delete warranty trigger missing; ';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_warranty_records_snapshot_immutable'
      and tgrelid = 'public.warranty_records'::regclass
  ) then
    v_problems := v_problems || 'snapshot immutability trigger missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'order_warranty_hardening post-apply failed: %', v_problems;
  end if;

  raise notice 'order_warranty_hardening @v1 OK. Policies on warranty_records: %', v_pol;
end;
$assert$;

commit;
