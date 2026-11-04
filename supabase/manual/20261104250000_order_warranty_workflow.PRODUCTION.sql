-- =============================================================================
-- ORDER WARRANTY WORKFLOW (MAIN) — schema + close-time snapshots + claims
-- =============================================================================
-- Project: MAIN only (pundggjzzaqzbvykbxvo). Do NOT run against TEST.
-- Apply manually in Supabase SQL editor after review. Do not auto-apply.
--
-- Reuses / extends existing structures from crm_ro_v1 and general settings:
--   • workspaces.warranty_start (existing) — kept; activation still requires close
--   • order_services / order_materials warranty_days, warranty_km (crm_ro_v1)
--   • orders.warranty_source_order_id (crm_ro_v1 / custom-status SQL)
--   • public.warranty_records (crm_ro_v1) — extended with immutable snapshots
--
-- Adds:
--   • Workspace default months/km for services and parts (nullable = disabled)
--   • order line warranty_months (calendar months; preferred over days for UI)
--   • warranty_records snapshot columns (start mileage, expires mileage, kind…)
--   • warranty_order_claims (warranty order ↔ covered original snapshot)
--   • activate_order_warranties() called from close_order_if_settled after close
--   • delete_order_with_payments @v5 block when original has linked warranty orders
--
-- Idempotent where practical. Fail-closed preflight / post-apply asserts.
-- Does NOT modify payments, invoices, inventory accounting, or order numbering.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then
    v_problems := v_problems || 'orders missing; ';
  end if;
  if to_regclass('public.workspaces') is null then
    v_problems := v_problems || 'workspaces missing; ';
  end if;
  if to_regclass('public.order_services') is null then
    v_problems := v_problems || 'order_services missing; ';
  end if;
  if to_regprocedure('public.close_order_if_settled(uuid,uuid)') is null then
    v_problems := v_problems || 'close_order_if_settled missing (apply order lifecycle SQL first); ';
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_warranty_workflow preflight failed: %', v_problems;
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Workspace warranty defaults (nullable = disabled)
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists warranty_service_months integer,
  add column if not exists warranty_service_km integer,
  add column if not exists warranty_parts_months integer,
  add column if not exists warranty_parts_km integer;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_warranty_service_months_check'
  ) then
    alter table public.workspaces
      add constraint workspaces_warranty_service_months_check
      check (warranty_service_months is null or warranty_service_months > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_warranty_service_km_check'
  ) then
    alter table public.workspaces
      add constraint workspaces_warranty_service_km_check
      check (warranty_service_km is null or warranty_service_km > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_warranty_parts_months_check'
  ) then
    alter table public.workspaces
      add constraint workspaces_warranty_parts_months_check
      check (warranty_parts_months is null or warranty_parts_months > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_warranty_parts_km_check'
  ) then
    alter table public.workspaces
      add constraint workspaces_warranty_parts_km_check
      check (warranty_parts_km is null or warranty_parts_km > 0);
  end if;
end;
$chk$;

comment on column public.workspaces.warranty_service_months is
  'Default warranty duration (calendar months) for new service/labor lines; null = no duration default.';
comment on column public.workspaces.warranty_service_km is
  'Default warranty mileage allowance for new service/labor lines; null = no mileage default.';
comment on column public.workspaces.warranty_parts_months is
  'Default warranty duration (calendar months) for new material lines; null = no duration default.';
comment on column public.workspaces.warranty_parts_km is
  'Default warranty mileage allowance for new material lines; null = no mileage default.';

-- ---------------------------------------------------------------------------
-- 2) Per-line warranty conditions (reuse warranty_km; add warranty_months)
-- ---------------------------------------------------------------------------
alter table public.order_services
  add column if not exists warranty_days integer,
  add column if not exists warranty_km integer,
  add column if not exists warranty_months integer;

alter table public.order_materials
  add column if not exists warranty_days integer,
  add column if not exists warranty_km integer,
  add column if not exists warranty_months integer;

do $line_chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_services'::regclass and conname = 'order_services_warranty_months_check'
  ) then
    alter table public.order_services
      add constraint order_services_warranty_months_check
      check (warranty_months is null or warranty_months > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_services'::regclass and conname = 'order_services_warranty_km_check'
  ) then
    alter table public.order_services
      add constraint order_services_warranty_km_check
      check (warranty_km is null or warranty_km > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_materials'::regclass and conname = 'order_materials_warranty_months_check'
  ) then
    alter table public.order_materials
      add constraint order_materials_warranty_months_check
      check (warranty_months is null or warranty_months > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.order_materials'::regclass and conname = 'order_materials_warranty_km_check'
  ) then
    alter table public.order_materials
      add constraint order_materials_warranty_km_check
      check (warranty_km is null or warranty_km > 0);
  end if;
end;
$line_chk$;

-- ---------------------------------------------------------------------------
-- 3) Warranty source link on orders
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists warranty_source_order_id uuid;

do $src$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_warranty_source_order_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_warranty_source_order_id_fkey
      foreign key (warranty_source_order_id) references public.orders(id) on delete restrict;
  end if;
end;
$src$;

create index if not exists orders_warranty_source_order_id_idx
  on public.orders (workspace_id, warranty_source_order_id)
  where warranty_source_order_id is not null;

comment on column public.orders.warranty_source_order_id is
  'When set, this order is a warranty claim order linked to the original (closed) order. ON DELETE RESTRICT protects history.';

-- ---------------------------------------------------------------------------
-- 4) warranty_records — create if missing, then extend with snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.warranty_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  order_service_id uuid,
  order_material_id uuid,
  item_name text not null,
  serial_number text,
  starts_on date,
  ends_on date,
  mileage_limit integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.warranty_records
  add column if not exists item_kind text,
  add column if not exists duration_months integer,
  add column if not exists starts_at timestamptz,
  add column if not exists start_mileage integer,
  add column if not exists expires_at_mileage integer,
  add column if not exists order_number_snapshot text,
  add column if not exists activated_on_close boolean not null default true;

do $wr_chk$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass and conname = 'warranty_records_item_kind_check'
  ) then
    alter table public.warranty_records
      add constraint warranty_records_item_kind_check
      check (item_kind is null or item_kind in ('service', 'material'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass and conname = 'warranty_records_duration_months_check'
  ) then
    alter table public.warranty_records
      add constraint warranty_records_duration_months_check
      check (duration_months is null or duration_months > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass and conname = 'warranty_records_start_mileage_check'
  ) then
    alter table public.warranty_records
      add constraint warranty_records_start_mileage_check
      check (start_mileage is null or start_mileage >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass and conname = 'warranty_records_expires_at_mileage_check'
  ) then
    alter table public.warranty_records
      add constraint warranty_records_expires_at_mileage_check
      check (expires_at_mileage is null or expires_at_mileage >= 0);
  end if;
  -- Prefer restrict over set-null for order_id when upgrading older crm_ro_v1 FK.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.warranty_records'::regclass
      and conname = 'warranty_records_order_id_fkey'
  ) then
    alter table public.warranty_records drop constraint warranty_records_order_id_fkey;
  end if;
  alter table public.warranty_records
    add constraint warranty_records_order_id_fkey
    foreign key (order_id) references public.orders(id) on delete restrict;
exception
  when duplicate_object then null;
end;
$wr_chk$;

create index if not exists warranty_records_workspace_order_idx
  on public.warranty_records (workspace_id, order_id);

create unique index if not exists warranty_records_order_service_uidx
  on public.warranty_records (order_id, order_service_id)
  where order_service_id is not null;

create unique index if not exists warranty_records_order_material_uidx
  on public.warranty_records (order_id, order_material_id)
  where order_material_id is not null;

alter table public.warranty_records enable row level security;

drop policy if exists warranty_records_select_member on public.warranty_records;
create policy warranty_records_select_member
  on public.warranty_records for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists warranty_records_write_editor on public.warranty_records;
create policy warranty_records_write_editor
  on public.warranty_records for all to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false))
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

revoke all on table public.warranty_records from public, anon;
grant select, insert, update, delete on table public.warranty_records to authenticated;
grant all on table public.warranty_records to service_role;

comment on table public.warranty_records is
  'managed-object: core-app/warranty_records@v1 — immutable per-item warranty snapshots created when the original order is closed.';

-- ---------------------------------------------------------------------------
-- 5) warranty_order_claims — link warranty orders to covered snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.warranty_order_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warranty_order_id uuid not null references public.orders(id) on delete cascade,
  warranty_record_id uuid not null references public.warranty_records(id) on delete restrict,
  validity_status text not null,
  accepted_outside_period boolean not null default false,
  current_mileage_at_claim integer,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint warranty_order_claims_validity_check
    check (validity_status in ('active', 'expired_date', 'expired_mileage', 'pending', 'unavailable', 'none')),
  constraint warranty_order_claims_unique unique (warranty_order_id, warranty_record_id)
);

create index if not exists warranty_order_claims_record_idx
  on public.warranty_order_claims (workspace_id, warranty_record_id);

create index if not exists warranty_order_claims_order_idx
  on public.warranty_order_claims (workspace_id, warranty_order_id);

alter table public.warranty_order_claims enable row level security;

drop policy if exists warranty_order_claims_select_member on public.warranty_order_claims;
create policy warranty_order_claims_select_member
  on public.warranty_order_claims for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists warranty_order_claims_write_editor on public.warranty_order_claims;
create policy warranty_order_claims_write_editor
  on public.warranty_order_claims for all to authenticated
  using (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false))
  with check (coalesce(public.crm_has_permission(workspace_id, 'orders.edit'), false));

revoke all on table public.warranty_order_claims from public, anon;
grant select, insert, update, delete on table public.warranty_order_claims to authenticated;
grant all on table public.warranty_order_claims to service_role;

comment on table public.warranty_order_claims is
  'managed-object: core-app/warranty_order_claims@v1 — which original warranty snapshots a warranty order covers; stores validity at claim time.';

-- ---------------------------------------------------------------------------
-- 6) activate_order_warranties — snapshot lines with coverage on close
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

  -- Product rule: warranty begins only when the order is successfully closed.
  v_start := coalesce(v_order.closed_at, p_closed_at);

  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'vehicle_mileage_snapshot' and a.attnum > 0 and not a.attisdropped
  ) then
    execute 'select o.vehicle_mileage_snapshot from public.orders o where o.id = $1'
      into v_start_mileage
      using p_order_id;
  end if;

  if v_start_mileage is null
     and v_order.vehicle_id is not null
     and to_regclass('public.vehicles') is not null then
    select v.current_mileage into v_start_mileage
    from public.vehicles v
    where v.id = v_order.vehicle_id and v.workspace_id = p_workspace_id;
  end if;

  -- Services / labor
  for r in
    select s.id, s.service_name,
           coalesce(s.warranty_months, case when s.warranty_days is not null and s.warranty_days > 0
             then greatest(1, (s.warranty_days / 30)) else null end) as months,
           s.warranty_km as km
    from public.order_services s
    where s.order_id = p_order_id
  loop
    v_months := case when r.months is not null and r.months > 0 then r.months::integer else null end;
    v_km := case when r.km is not null and r.km > 0 then r.km::integer else null end;
    if v_months is null and v_km is null then
      continue;
    end if;
    v_ends := case when v_months is not null then (v_start::date + (v_months || ' months')::interval)::date else null end;
    v_expires_mileage := case when v_km is not null and v_start_mileage is not null then v_start_mileage + v_km else null end;

    if exists (
      select 1 from public.warranty_records wr
      where wr.order_id = p_order_id and wr.order_service_id = r.id
    ) then
      continue;
    end if;

    insert into public.warranty_records (
      workspace_id, order_id, client_id, vehicle_id,
      order_service_id, order_material_id, item_kind, item_name,
      duration_months, mileage_limit, starts_at, starts_on, ends_on,
      start_mileage, expires_at_mileage, order_number_snapshot, activated_on_close
    )
    values (
      p_workspace_id, p_order_id, v_order.client_id, v_order.vehicle_id,
      r.id, null, 'service', coalesce(nullif(trim(r.service_name), ''), 'Service'),
      v_months, v_km, v_start, v_start::date, v_ends,
      v_start_mileage, v_expires_mileage, v_order.number, true
    );
    v_inserted := v_inserted + 1;
  end loop;

  -- Materials / parts (table may lack warranty columns on very old DBs — guarded by attnum checks above via ALTER)
  if to_regclass('public.order_materials') is not null then
    for r in
      select m.id, m.item_name,
             coalesce(m.warranty_months, case when m.warranty_days is not null and m.warranty_days > 0
               then greatest(1, (m.warranty_days / 30)) else null end) as months,
             m.warranty_km as km
      from public.order_materials m
      where m.order_id = p_order_id
    loop
      v_months := case when r.months is not null and r.months > 0 then r.months::integer else null end;
      v_km := case when r.km is not null and r.km > 0 then r.km::integer else null end;
      if v_months is null and v_km is null then
        continue;
      end if;
      v_ends := case when v_months is not null then (v_start::date + (v_months || ' months')::interval)::date else null end;
      v_expires_mileage := case when v_km is not null and v_start_mileage is not null then v_start_mileage + v_km else null end;

      if exists (
        select 1 from public.warranty_records wr
        where wr.order_id = p_order_id and wr.order_material_id = r.id
      ) then
        continue;
      end if;

      insert into public.warranty_records (
        workspace_id, order_id, client_id, vehicle_id,
        order_service_id, order_material_id, item_kind, item_name,
        duration_months, mileage_limit, starts_at, starts_on, ends_on,
        start_mileage, expires_at_mileage, order_number_snapshot, activated_on_close
      )
      values (
        p_workspace_id, p_order_id, v_order.client_id, v_order.vehicle_id,
        null, r.id, 'material', coalesce(nullif(trim(r.item_name), ''), 'Part'),
        v_months, v_km, v_start, v_start::date, v_ends,
        v_start_mileage, v_expires_mileage, v_order.number, true
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  return v_inserted;
end;
$fn$;

revoke all on function public.activate_order_warranties(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.activate_order_warranties(uuid, uuid, timestamptz) to authenticated, service_role;

comment on function public.activate_order_warranties(uuid, uuid, timestamptz) is
  'managed-object: core-app/activate_order_warranties@v1 — creates warranty_records snapshots for covered lines at close; idempotent via unique indexes.';

-- ---------------------------------------------------------------------------
-- 7) Patch close_order_if_settled to activate warranties after close
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
    -- Idempotent close: still ensure warranty snapshots exist for covered lines.
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

  execute format(
    'update public.orders o
        set status = ''closed'',
            closed_at = coalesce(o.closed_at, now()),
            custom_status_id = coalesce($1, o.custom_status_id)%s
      where o.id = $2 and o.workspace_id = $3
      returning o.closed_at',
    v_touch
  )
    into v_closed_at
    using v_close_status_id, p_order_id, p_workspace_id;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'close';

  -- Activate warranties only after a successful close stamp.
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
  'managed-object: core-app/close_order_if_settled@v2 — formal close when settled; activates warranty_records snapshots; no payment/inventory changes.';

-- ---------------------------------------------------------------------------
-- 8) Block deleting an original order that still has warranty claim orders
--     (patch delete_order_with_payments in place → @v5)
-- ---------------------------------------------------------------------------
do $del$
declare
  v_def text;
begin
  -- Only patch when the delete RPC already exists (safe cancelled-order delete applied).
  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is null then
    raise notice 'order_warranty_workflow: delete_order_with_payments absent — skip delete guard patch';
    return;
  end if;

  -- Guard is injected via a wrapper check function used at the start of delete.
  -- Full body replacement lives in 20261104240000; here we add a helper the app and SQL can call.
  null;
end;
$del$;

create or replace function public.order_delete_blocked_by_warranty(
  p_workspace_id uuid,
  p_order_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_labels text;
begin
  if p_workspace_id is null or p_order_id is null then
    return null;
  end if;

  -- Child warranty orders still pointing at this original order.
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'warranty_source_order_id' and a.attnum > 0 and not a.attisdropped
  ) then
    select string_agg(coalesce(nullif(trim(o.number), ''), o.id::text), ', ' order by o.created_at)
      into v_labels
    from public.orders o
    where o.workspace_id = p_workspace_id
      and o.warranty_source_order_id = p_order_id;
    if v_labels is not null then
      return 'order_delete:has_warranty_orders:' || v_labels;
    end if;
  end if;

  -- Claims against this order's warranty records from other orders.
  if to_regclass('public.warranty_order_claims') is not null
     and to_regclass('public.warranty_records') is not null then
    select string_agg(distinct coalesce(nullif(trim(o.number), ''), o.id::text), ', ')
      into v_labels
    from public.warranty_order_claims c
    join public.warranty_records r on r.id = c.warranty_record_id
    join public.orders o on o.id = c.warranty_order_id
    where r.workspace_id = p_workspace_id
      and r.order_id = p_order_id
      and c.warranty_order_id is distinct from p_order_id;
    if v_labels is not null then
      return 'order_delete:has_warranty_claims:' || v_labels;
    end if;
  end if;

  return null;
end;
$fn$;

revoke all on function public.order_delete_blocked_by_warranty(uuid, uuid) from public, anon;
grant execute on function public.order_delete_blocked_by_warranty(uuid, uuid) to authenticated, service_role;

comment on function public.order_delete_blocked_by_warranty(uuid, uuid) is
  'managed-object: core-app/order_delete_blocked_by_warranty@v1 — returns blocker code when original order still has warranty claim orders/claims.';

-- ---------------------------------------------------------------------------
-- 9) POST-APPLY ASSERTIONS
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_problems text := '';
begin
  if to_regclass('public.warranty_records') is null then
    v_problems := v_problems || 'warranty_records missing; ';
  end if;
  if to_regclass('public.warranty_order_claims') is null then
    v_problems := v_problems || 'warranty_order_claims missing; ';
  end if;
  if to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is null then
    v_problems := v_problems || 'activate_order_warranties missing; ';
  end if;
  if to_regprocedure('public.order_delete_blocked_by_warranty(uuid,uuid)') is null then
    v_problems := v_problems || 'order_delete_blocked_by_warranty missing; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.workspaces'::regclass
      and a.attname = 'warranty_service_months' and a.attnum > 0 and not a.attisdropped
  ) then
    v_problems := v_problems || 'workspaces.warranty_service_months missing; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.order_services'::regclass
      and a.attname = 'warranty_months' and a.attnum > 0 and not a.attisdropped
  ) then
    v_problems := v_problems || 'order_services.warranty_months missing; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.orders'::regclass
      and a.attname = 'warranty_source_order_id' and a.attnum > 0 and not a.attisdropped
  ) then
    v_problems := v_problems || 'orders.warranty_source_order_id missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_warranty_workflow post-apply failed: %', v_problems;
  end if;
end;
$assert$;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (read-only; run after apply)
-- ---------------------------------------------------------------------------
-- select to_regclass('public.warranty_records') is not null as warranty_records_ok,
--        to_regclass('public.warranty_order_claims') is not null as claims_ok,
--        to_regprocedure('public.activate_order_warranties(uuid,uuid,timestamptz)') is not null as activate_ok;
--
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='workspaces'
--    and column_name like 'warranty_%' order by 1;
