-- =============================================================================
-- Order line RPCs: one round-trip write + full order JSON
-- Script: 20261112140000_order_line_rpcs.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: public.orders, order_services, order_materials, clients, employees,
--   is_workspace_member(uuid), workspace_member_role(uuid),
--   issue_order_materials_from_warehouse(...), return_order_materials_to_warehouse(...).
-- Optional: order_employees, status_definitions, client_discounts, profiles,
--   crm_has_permission, crm_order_event_insert, crm_get_order_full callers below.
-- =============================================================================
-- Adds / replaces:
--   crm_get_order_full(p_order_id) — full order payload for getOrder / mutations
--   crm_add_order_service_line / crm_update_order_service_line / crm_delete_order_service_line
--   crm_add_and_issue_order_catalog_material — catalog add+issue + full order
--   Extends crm_change_order_material_quantity, crm_delete_order_material,
--     crm_set_order_material_prices to also return order := crm_get_order_full(...)
-- Idempotent create or replace. Grants to authenticated only.
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
begin
  if to_regclass('public.orders') is null then v_problems := v_problems || 'orders missing; '; end if;
  if to_regclass('public.order_services') is null then v_problems := v_problems || 'order_services missing; '; end if;
  if to_regclass('public.order_materials') is null then v_problems := v_problems || 'order_materials missing; '; end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member missing; ';
  end if;
  if to_regprocedure('public.workspace_member_role(uuid)') is null then
    v_problems := v_problems || 'workspace_member_role missing; ';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    v_problems := v_problems || 'issue_order_materials_from_warehouse missing; ';
  end if;
  if to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    v_problems := v_problems || 'return_order_materials_to_warehouse missing; ';
  end if;
  if v_problems <> '' then
    raise exception 'order_line_rpcs preflight failed: %', v_problems;
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Totals helper (per-line discount formula)
-- ---------------------------------------------------------------------------
create or replace function public.crm_recalc_order_line_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_gross numeric := 0;
  v_discount numeric := 0;
  v_total numeric;
  v_has_discount_total boolean;
begin
  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_gross, v_discount
  from priced;
  v_total := greatest(0, round(v_gross - v_discount, 2));

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'discount_total' and not attisdropped
  ) into v_has_discount_total;

  update public.orders
     set total_price = v_total,
         updated_at = now()
   where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1'
      using p_order_id, round(v_discount, 2);
  end if;
end;
$fn$;

revoke all on function public.crm_recalc_order_line_totals(uuid) from public, anon;
grant execute on function public.crm_recalc_order_line_totals(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- crm_get_order_full
-- ---------------------------------------------------------------------------
create or replace function public.crm_get_order_full(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_client jsonb := null;
  v_services jsonb := '[]'::jsonb;
  v_materials jsonb := '[]'::jsonb;
  v_team jsonb := '[]'::jsonb;
  v_employees jsonb := '[]'::jsonb;
  v_member_names jsonb := '{}'::jsonb;
  v_custom_status jsonb := null;
  v_created_by uuid;
  v_assigned_to uuid;
begin
  if v_uid is null then
    raise exception 'crm_get_order_full:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null then
    return null;
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    return null;
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    return null;
  end if;

  if v_order.client_id is not null and to_regclass('public.clients') is not null then
    select jsonb_build_object(
      'name', c.name,
      'client_type', to_jsonb(c) ->> 'client_type',
      'phone', to_jsonb(c) ->> 'phone'
    )
      into v_client
    from public.clients c
    where c.id = v_order.client_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at asc nulls last, s.id), '[]'::jsonb)
    into v_services
  from public.order_services s
  where s.order_id = p_order_id;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at asc nulls last, m.id), '[]'::jsonb)
    into v_materials
  from public.order_materials m
  where m.order_id = p_order_id;

  if to_regclass('public.employees') is not null then
    select coalesce(
      jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'profile_id', to_jsonb(e) -> 'profile_id') order by e.name),
      '[]'::jsonb
    )
      into v_employees
    from public.employees e
    where e.workspace_id = v_order.workspace_id;
  end if;

  if to_regclass('public.order_employees') is not null then
    begin
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'employee_id', oe.employee_id,
            'role', oe.role,
            'name', coalesce(e.name, '')
          )
          order by case when oe.role = 'lead' then 0 else 1 end, e.name
        ),
        '[]'::jsonb
      )
        into v_team
      from public.order_employees oe
      left join public.employees e on e.id = oe.employee_id
      where oe.order_id = p_order_id
        and oe.workspace_id = v_order.workspace_id;
    exception when undefined_table or undefined_column then
      v_team := '[]'::jsonb;
    end;
  end if;

  v_created_by := v_order.created_by;
  begin
    v_assigned_to := nullif(to_jsonb(v_order) ->> 'assigned_to', '')::uuid;
  exception when others then
    v_assigned_to := null;
  end;

  if to_regclass('public.profiles') is not null then
    begin
      select coalesce(
        jsonb_object_agg(
          p.id::text,
          coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.email), ''), p.id::text)
        ),
        '{}'::jsonb
      )
        into v_member_names
      from public.profiles p
      where p.id in (v_created_by, v_assigned_to);
    exception when undefined_table or undefined_column then
      v_member_names := '{}'::jsonb;
    end;
  end if;

  if v_order.custom_status_id is not null and to_regclass('public.status_definitions') is not null then
    begin
      select jsonb_build_object(
        'id', sd.id,
        'name', sd.name,
        'color', to_jsonb(sd) -> 'color'
      )
        into v_custom_status
      from public.status_definitions sd
      where sd.id = v_order.custom_status_id;
    exception when undefined_table or undefined_column then
      v_custom_status := null;
    end;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'client', v_client,
    'services', coalesce(v_services, '[]'::jsonb),
    'materials', coalesce(v_materials, '[]'::jsonb),
    'team', coalesce(v_team, '[]'::jsonb),
    'employees', coalesce(v_employees, '[]'::jsonb),
    'member_names', coalesce(v_member_names, '{}'::jsonb),
    'custom_status', v_custom_status
  );
end;
$fn$;

revoke all on function public.crm_get_order_full(uuid) from public, anon;
grant execute on function public.crm_get_order_full(uuid) to authenticated;

comment on function public.crm_get_order_full(uuid) is
  'managed-object: core-app/crm_get_order_full@v1 — one-shot full order payload for getOrder / line RPCs.';

-- ---------------------------------------------------------------------------
-- Permission helper (same bar as material line RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.crm_assert_order_line_edit(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_role text;
  v_allowed boolean := false;
begin
  if not coalesce(public.is_workspace_member(p_workspace_id), false) then
    raise exception 'order_line:forbidden' using errcode = '42501';
  end if;
  v_role := public.workspace_member_role(p_workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    return;
  end if;
  if to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using p_workspace_id, 'orders.edit';
    if coalesce(v_allowed, false) then
      return;
    end if;
  end if;
  raise exception 'order_line:forbidden' using errcode = '42501';
end;
$fn$;

revoke all on function public.crm_assert_order_line_edit(uuid) from public, anon;
grant execute on function public.crm_assert_order_line_edit(uuid) to authenticated;

-- Sync order_employees from assignee + all line technicians (insert/update/delete).
create or replace function public.crm_sync_order_employees_from_lines(p_order_id uuid, p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_assignee uuid;
  v_desired jsonb := '[]'::jsonb;
  v_id uuid;
  v_role text;
begin
  if to_regclass('public.order_employees') is null then
    return;
  end if;

  select o.employee_id into v_assignee from public.orders o where o.id = p_order_id;

  -- Build desired set: assignee as lead, line technicians as helpers.
  with techs as (
    select distinct os.technician_id as employee_id
    from public.order_services os
    where os.order_id = p_order_id
      and os.technician_id is not null
  ),
  desired as (
    select v_assignee as employee_id, 'lead'::text as role
    where v_assignee is not null
    union
    select t.employee_id, case when t.employee_id = v_assignee then 'lead' else 'helper' end
    from techs t
    where t.employee_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', employee_id, 'role', role)), '[]'::jsonb)
    into v_desired
  from desired;

  -- Delete removed
  delete from public.order_employees oe
  where oe.order_id = p_order_id
    and oe.workspace_id = p_workspace_id
    and not exists (
      select 1 from jsonb_array_elements(v_desired) d
      where (d ->> 'employee_id')::uuid = oe.employee_id
    );

  -- Upsert desired
  for v_id, v_role in
    select (d ->> 'employee_id')::uuid, d ->> 'role'
    from jsonb_array_elements(v_desired) d
  loop
    insert into public.order_employees (workspace_id, order_id, employee_id, role)
    values (p_workspace_id, p_order_id, v_id, coalesce(v_role, 'helper'))
    on conflict (order_id, employee_id) do update
      set role = excluded.role;
  end loop;
end;
$fn$;

revoke all on function public.crm_sync_order_employees_from_lines(uuid, uuid) from public, anon;
grant execute on function public.crm_sync_order_employees_from_lines(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- crm_add_order_service_line
-- ---------------------------------------------------------------------------
create or replace function public.crm_add_order_service_line(
  p_order_id uuid,
  p_service_id uuid,
  p_price numeric,
  p_quantity numeric,
  p_technician_id uuid default null,
  p_warranty_months integer default null,
  p_warranty_days integer default null,
  p_warranty_km integer default null,
  p_kind text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_existing_id uuid;
  v_service_name text;
  v_qty numeric(12,2);
  v_price numeric(12,2);
  v_discount_type text := null;
  v_discount_value numeric := null;
  v_percent numeric;
  v_line_id uuid;
  v_payload jsonb;
  v_has_discount boolean;
  v_has_technician boolean;
  v_has_kind boolean;
  v_has_warranty boolean;
begin
  if v_uid is null then
    raise exception 'add_order_service_line:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_service_id is null then
    raise exception 'add_order_service_line:invalid_args' using errcode = '22023';
  end if;

  v_qty := round(coalesce(nullif(p_quantity, 0), 1), 2);
  if v_qty <= 0 then
    raise exception 'add_order_service_line:invalid_quantity' using errcode = '22023';
  end if;
  v_price := round(coalesce(p_price, 0), 2);
  if v_price < 0 then
    raise exception 'add_order_service_line:invalid_price' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'add_order_service_line:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'add_order_service_line:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'add_order_service_line:cancelled_order_immutable' using errcode = '42501';
  end if;

  select os.id into v_existing_id
  from public.order_services os
  where os.order_id = p_order_id and os.service_id = p_service_id
  limit 1;
  if v_existing_id is not null then
    v_payload := public.crm_get_order_full(p_order_id);
    return coalesce(v_payload, '{}'::jsonb)
      || jsonb_build_object('duplicate', true, 'duplicate_line_id', v_existing_id);
  end if;

  select s.service_name into v_service_name
  from public.services s
  where s.id = p_service_id and s.workspace_id = v_order.workspace_id;
  if v_service_name is null then
    raise exception 'add_order_service_line:service_not_found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.order_services'::regclass and attname = 'discount_type' and not attisdropped
  ) into v_has_discount;

  if v_has_discount and v_order.client_id is not null and to_regclass('public.client_discounts') is not null then
    begin
      select cd.percent into v_percent
      from public.client_discounts cd
      where cd.workspace_id = v_order.workspace_id
        and cd.client_id = v_order.client_id
        and cd.target = 'service_order'
      limit 1;
      if coalesce(v_percent, 0) > 0 then
        v_discount_type := 'percent';
        v_discount_value := v_percent;
      end if;
    exception when undefined_table or undefined_column then
      null;
    end;
  end if;

  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'technician_id' and not attisdropped
  ) into v_has_technician;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'kind' and not attisdropped
  ) into v_has_kind;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'warranty_months' and not attisdropped
  ) into v_has_warranty;

  insert into public.order_services (order_id, service_id, service_name, price, quantity)
  values (p_order_id, p_service_id, v_service_name, v_price, v_qty)
  returning id into v_line_id;

  if v_has_discount and v_discount_type is not null then
    execute 'update public.order_services set discount_type = $2, discount_value = $3 where id = $1'
      using v_line_id, v_discount_type, v_discount_value;
  end if;
  if v_has_technician and p_technician_id is not null then
    execute 'update public.order_services set technician_id = $2 where id = $1'
      using v_line_id, p_technician_id;
  end if;
  if v_has_kind and p_kind is not null and p_kind in ('labor', 'service') then
    execute 'update public.order_services set kind = $2 where id = $1'
      using v_line_id, p_kind;
  end if;
  if v_has_warranty then
    execute $sql$
      update public.order_services
         set warranty_months = $2, warranty_days = $3, warranty_km = $4
       where id = $1
    $sql$ using v_line_id, p_warranty_months, p_warranty_days, p_warranty_km;
  end if;

  if p_technician_id is not null then
    perform public.crm_sync_order_employees_from_lines(p_order_id, v_order.workspace_id);
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);
  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_add_order_service_line(uuid, uuid, numeric, numeric, uuid, integer, integer, integer, text) from public, anon;
grant execute on function public.crm_add_order_service_line(uuid, uuid, numeric, numeric, uuid, integer, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- crm_update_order_service_line
-- ---------------------------------------------------------------------------
create or replace function public.crm_update_order_service_line(
  p_order_id uuid,
  p_line_id uuid,
  p_price numeric default null,
  p_quantity numeric default null,
  p_technician_id uuid default null,
  p_set_technician boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_line public.order_services%rowtype;
  v_has_technician boolean;
begin
  if v_uid is null then
    raise exception 'update_order_service_line:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_line_id is null then
    raise exception 'update_order_service_line:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'update_order_service_line:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'update_order_service_line:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'update_order_service_line:cancelled_order_immutable' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_services os
  where os.id = p_line_id and os.order_id = p_order_id
  for update;
  if not found then
    raise exception 'update_order_service_line:line_not_found' using errcode = 'P0002';
  end if;

  if p_price is not null then
    if p_price < 0 then
      raise exception 'update_order_service_line:invalid_price' using errcode = '22023';
    end if;
    update public.order_services set price = round(p_price, 2) where id = p_line_id;
  end if;
  if p_quantity is not null then
    if p_quantity <= 0 then
      raise exception 'update_order_service_line:invalid_quantity' using errcode = '22023';
    end if;
    update public.order_services set quantity = round(p_quantity, 2) where id = p_line_id;
  end if;

  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_services'::regclass and attname = 'technician_id' and not attisdropped
  ) into v_has_technician;

  if p_set_technician and v_has_technician then
    execute 'update public.order_services set technician_id = $2 where id = $1'
      using p_line_id, p_technician_id;
    perform public.crm_sync_order_employees_from_lines(p_order_id, v_order.workspace_id);
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);
  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_update_order_service_line(uuid, uuid, numeric, numeric, uuid, boolean) from public, anon;
grant execute on function public.crm_update_order_service_line(uuid, uuid, numeric, numeric, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- crm_delete_order_service_line
-- ---------------------------------------------------------------------------
create or replace function public.crm_delete_order_service_line(
  p_order_id uuid,
  p_line_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
begin
  if v_uid is null then
    raise exception 'delete_order_service_line:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_line_id is null then
    raise exception 'delete_order_service_line:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'delete_order_service_line:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'delete_order_service_line:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'delete_order_service_line:cancelled_order_immutable' using errcode = '42501';
  end if;

  delete from public.order_services
  where id = p_line_id and order_id = p_order_id;
  if not found then
    raise exception 'delete_order_service_line:line_not_found' using errcode = 'P0002';
  end if;

  perform public.crm_recalc_order_line_totals(p_order_id);
  return public.crm_get_order_full(p_order_id);
end;
$fn$;

revoke all on function public.crm_delete_order_service_line(uuid, uuid) from public, anon;
grant execute on function public.crm_delete_order_service_line(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- crm_add_and_issue_order_catalog_material
-- ---------------------------------------------------------------------------
create or replace function public.crm_add_and_issue_order_catalog_material(
  p_order_id uuid,
  p_warehouse_id uuid,
  p_inventory_item_id uuid,
  p_quantity numeric,
  p_price numeric default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_role text;
  v_item public.inventory_items%rowtype;
  v_wh_ok boolean := false;
  v_qty numeric(12,2);
  v_price numeric(12,2);
  v_available numeric(12,2);
  v_existing_id uuid;
  v_line public.order_materials%rowtype;
  v_key text;
  v_discount_type text := null;
  v_discount_value numeric := null;
  v_percent numeric;
  v_has_discount boolean;
  v_has_warehouse boolean;
  v_has_supply boolean;
begin
  if v_uid is null then
    raise exception 'add_and_issue_catalog_material:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_warehouse_id is null or p_inventory_item_id is null then
    raise exception 'add_and_issue_catalog_material:invalid_args' using errcode = '22023';
  end if;
  v_qty := round(coalesce(p_quantity, 0), 2);
  if v_qty <= 0 then
    raise exception 'add_and_issue_catalog_material:invalid_quantity' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'add_and_issue_catalog_material:order_not_found' using errcode = 'P0002';
  end if;
  perform public.crm_assert_order_line_edit(v_order.workspace_id);

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'add_and_issue_catalog_material:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'add_and_issue_catalog_material:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin', 'manager') then
    raise exception 'add_and_issue_catalog_material:warehouse_permission' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id
      and w.workspace_id = v_order.workspace_id
      and w.deleted_at is null
      and w.is_active
  ) into v_wh_ok;
  if not coalesce(v_wh_ok, false) then
    raise exception 'add_and_issue_catalog_material:warehouse_required' using errcode = '22023';
  end if;

  select * into v_item
  from public.inventory_items ii
  where ii.id = p_inventory_item_id and ii.workspace_id = v_order.workspace_id
  for update;
  if not found then
    raise exception 'add_and_issue_catalog_material:item_not_found' using errcode = 'P0002';
  end if;

  select om.id into v_existing_id
  from public.order_materials om
  where om.order_id = p_order_id and om.inventory_item_id = p_inventory_item_id
  limit 1;
  if v_existing_id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'duplicate_line_id', v_existing_id,
      'order', public.crm_get_order_full(p_order_id)
    );
  end if;

  select round(coalesce(ws.quantity, 0)::numeric, 2)
    into v_available
  from public.warehouse_stock ws
  where ws.workspace_id = v_order.workspace_id
    and ws.warehouse_id = p_warehouse_id
    and ws.inventory_item_id = p_inventory_item_id
  for update;
  if not found then
    v_available := 0;
  end if;
  if coalesce(v_available, 0) < v_qty then
    raise exception
      'order_material:insufficient_stock available=% requested=%',
      coalesce(v_available, 0), v_qty
      using errcode = 'P0001';
  end if;

  v_price := round(coalesce(p_price, nullif(to_jsonb(v_item) ->> 'selling_price', '')::numeric, 0), 2);

  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'discount_type' and not attisdropped
  ) into v_has_discount;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'warehouse_id' and not attisdropped
  ) into v_has_warehouse;
  select exists (
    select 1 from pg_attribute where attrelid = 'public.order_materials'::regclass and attname = 'supply_source' and not attisdropped
  ) into v_has_supply;

  if v_has_discount and v_order.client_id is not null and to_regclass('public.client_discounts') is not null then
    begin
      select cd.percent into v_percent
      from public.client_discounts cd
      where cd.workspace_id = v_order.workspace_id
        and cd.client_id = v_order.client_id
        and cd.target = 'product_order'
      limit 1;
      if coalesce(v_percent, 0) > 0 then
        v_discount_type := 'percent';
        v_discount_value := v_percent;
      end if;
    exception when others then
      null;
    end;
  end if;

  insert into public.order_materials (
    order_id, inventory_item_id, item_name, price, quantity, quantity_issued, quantity_returned
  ) values (
    p_order_id, p_inventory_item_id, coalesce(v_item.name, ''), v_price, v_qty, 0, 0
  ) returning * into v_line;

  if v_has_warehouse then
    execute 'update public.order_materials set warehouse_id = $2 where id = $1'
      using v_line.id, p_warehouse_id;
  end if;
  if v_has_supply then
    execute 'update public.order_materials set supply_source = $2 where id = $1'
      using v_line.id, 'catalog';
  end if;
  if v_has_discount and v_discount_type is not null then
    execute 'update public.order_materials set discount_type = $2, discount_value = $3 where id = $1'
      using v_line.id, v_discount_type, v_discount_value;
  end if;

  select * into v_line from public.order_materials where id = v_line.id;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'add_iss_' || replace(gen_random_uuid()::text, '-', ''));
  perform public.issue_order_materials_from_warehouse(
    p_order_id,
    jsonb_build_array(jsonb_build_object(
      'inventory_item_id', p_inventory_item_id,
      'quantity', v_qty
    )),
    p_warehouse_id,
    v_key
  );

  select * into v_line from public.order_materials where id = v_line.id;
  perform public.crm_recalc_order_line_totals(p_order_id);

  return jsonb_build_object(
    'material', to_jsonb(v_line),
    'order', public.crm_get_order_full(p_order_id)
  );
end;
$fn$;

revoke all on function public.crm_add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text) from public, anon;
grant execute on function public.crm_add_and_issue_order_catalog_material(uuid, uuid, uuid, numeric, numeric, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Extended material RPCs (full bodies + order key)
-- ---------------------------------------------------------------------------
create or replace function public.crm_change_order_material_quantity(
  p_order_id uuid,
  p_order_material_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_line public.order_materials%rowtype;
  v_role text;
  v_allowed boolean := false;
  v_old_qty numeric(12,2);
  v_new_qty numeric(12,2);
  v_outstanding numeric(12,2);
  v_delta numeric(12,2);
  v_to_return numeric(12,2);
  v_wh_available numeric(12,2);
  v_supply text;
  v_services numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
  v_key text;
  v_actor_name text;
  v_jwt jsonb;
begin
  if v_uid is null then
    raise exception 'change_order_material_quantity:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_order_material_id is null then
    raise exception 'change_order_material_quantity:invalid_args' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'change_order_material_quantity:invalid_quantity' using errcode = '22023';
  end if;
  if p_quantity <> round(p_quantity, 2) then
    raise exception 'change_order_material_quantity:invalid_quantity' using errcode = '22023';
  end if;
  v_new_qty := round(p_quantity, 2);

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'change_order_material_quantity:order_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'change_order_material_quantity:forbidden' using errcode = '42501';
  end if;

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'change_order_material_quantity:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'change_order_material_quantity:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_order.workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'change_order_material_quantity:forbidden' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_materials om
  where om.id = p_order_material_id
    and om.order_id = p_order_id
  for update;
  if not found then
    raise exception 'change_order_material_quantity:line_not_found' using errcode = 'P0002';
  end if;

  v_old_qty := round(coalesce(v_line.quantity, 0)::numeric, 2);
  v_supply := coalesce(nullif(btrim(v_line.supply_source), ''), case when v_line.inventory_item_id is null then 'one_time' else 'catalog' end);
  v_outstanding := round(
    (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0))::numeric,
    2
  );
  if v_outstanding < 0 then
    raise exception 'change_order_material_quantity:counters_inconsistent' using errcode = 'P0001';
  end if;

  if v_new_qty = v_old_qty then
    return jsonb_build_object(
      'changed', false,
      'material', to_jsonb(v_line),
      'total_price', v_order.total_price
    ) || jsonb_build_object('order', public.crm_get_order_full(p_order_id));
  end if;

  if v_supply = 'catalog' and v_line.inventory_item_id is not null then
    if v_line.warehouse_id is null then
      raise exception 'change_order_material_quantity:warehouse_required' using errcode = '22023';
    end if;

    -- Catalog qty changes require warehouse role (same bar as immediate issue RPCs).
    if v_role is null or v_role not in ('owner', 'admin', 'manager') then
      raise exception 'change_order_material_quantity:warehouse_permission' using errcode = '42501';
    end if;

    v_key := 'chg_qty_' || replace(gen_random_uuid()::text, '-', '');

    if v_new_qty > v_old_qty then
      -- Hard stock cap: never write off more than on-hand (row lock prevents races).
      v_delta := round(v_new_qty - v_old_qty, 2);
      select round(coalesce(ws.quantity, 0)::numeric, 2)
        into v_wh_available
      from public.warehouse_stock ws
      where ws.workspace_id = v_order.workspace_id
        and ws.warehouse_id = v_line.warehouse_id
        and ws.inventory_item_id = v_line.inventory_item_id
      for update;
      if not found then
        v_wh_available := 0;
      end if;
      if coalesce(v_wh_available, 0) < v_delta then
        raise exception
          'order_material:insufficient_stock available=% requested=%',
          coalesce(v_wh_available, 0), v_delta
          using errcode = 'P0001';
      end if;

      -- Raise requested qty first so the issue RPC's outstanding ≤ quantity check passes.
      update public.order_materials
         set quantity = v_new_qty
       where id = v_line.id
      returning * into v_line;

      perform public.issue_order_materials_from_warehouse(
        p_order_id,
        jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_line.inventory_item_id,
          'quantity', v_delta
        )),
        v_line.warehouse_id,
        v_key
      );

      select * into v_line from public.order_materials where id = v_line.id;
    else
      -- Shrink: return any outstanding that would exceed the new qty, then collapse
      -- issued/returned by the same amount so badges stay coherent (fully issued stays
      -- fully issued when returned was previously 0).
      if v_new_qty < v_outstanding then
        v_to_return := round(v_outstanding - v_new_qty, 2);
        perform public.return_order_materials_to_warehouse(
          p_order_id,
          jsonb_build_array(jsonb_build_object(
            'inventory_item_id', v_line.inventory_item_id,
            'quantity', v_to_return
          )),
          v_line.warehouse_id,
          'quantity_change',
          v_key
        );

        update public.order_materials
           set quantity = v_new_qty,
               quantity_issued = greatest(0, coalesce(quantity_issued, 0) - v_to_return),
               quantity_returned = greatest(0, coalesce(quantity_returned, 0) - v_to_return)
         where id = v_line.id
        returning * into v_line;
      else
        update public.order_materials
           set quantity = v_new_qty
         where id = v_line.id
        returning * into v_line;
      end if;
    end if;
  else
    -- Freeform / customer-supplied: no stock movement. Still refuse going below outstanding.
    if v_new_qty < v_outstanding then
      raise exception 'change_order_material_quantity:below_outstanding' using errcode = '22023';
    end if;
    update public.order_materials
       set quantity = v_new_qty
     where id = v_line.id
    returning * into v_line;
  end if;

  -- Recalculate from ALL persisted lines with the same per-line discount formula as
  -- crm_set_order_line_discounts: a percent discount scales with the new quantity, so
  -- discount_total must be recomputed, not carried over.
  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_services, v_discount
  from priced;
  v_total := greatest(0, round(v_services - v_discount, 2));

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'discount_total' and not attisdropped
  ) into v_has_discount_total;

  update public.orders
     set total_price = v_total,
         updated_at = now()
   where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1' using p_order_id, round(v_discount, 2);
  end if;

  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is not null then
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
    perform public.crm_order_event_insert(
      v_order.workspace_id,
      p_order_id,
      'material_updated',
      'quantity',
      v_old_qty::text,
      v_new_qty::text,
      jsonb_build_object(
        'item_name', v_line.item_name,
        'line_id', v_line.id,
        'changes', jsonb_build_object('quantity', jsonb_build_object('from', v_old_qty, 'to', v_new_qty))
      ),
      v_uid,
      v_actor_name
    );
  end if;

  return (jsonb_build_object(
    'changed', true,
    'material', to_jsonb(v_line),
    'total_price', v_total,
    'old_quantity', v_old_qty,
    'new_quantity', v_new_qty
  )) || jsonb_build_object('order', public.crm_get_order_full(p_order_id));
end;
$fn$;

create or replace function public.crm_delete_order_material(
  p_order_id uuid,
  p_order_material_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_line public.order_materials%rowtype;
  v_role text;
  v_allowed boolean := false;
  v_outstanding numeric(12,2);
  v_supply text;
  v_services numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
  v_key text;
  v_actor_name text;
  v_jwt jsonb;
  v_item_name text;
  v_qty numeric(12,2);
begin
  if v_uid is null then
    raise exception 'delete_order_material:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null or p_order_material_id is null then
    raise exception 'delete_order_material:invalid_args' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'delete_order_material:order_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.is_workspace_member(v_order.workspace_id), false) then
    raise exception 'delete_order_material:forbidden' using errcode = '42501';
  end if;

  if (v_order.closed_at is not null or v_order.status = 'closed')
     and v_order.status is distinct from 'cancelled' then
    raise exception 'delete_order_material:closed_order_immutable' using errcode = '42501';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'delete_order_material:cancelled_order_immutable' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_order.workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_order.workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'delete_order_material:forbidden' using errcode = '42501';
  end if;

  select * into v_line
  from public.order_materials om
  where om.id = p_order_material_id
    and om.order_id = p_order_id
  for update;
  if not found then
    raise exception 'delete_order_material:line_not_found' using errcode = 'P0002';
  end if;

  v_item_name := coalesce(v_line.item_name, '');
  v_qty := round(coalesce(v_line.quantity, 0)::numeric, 2);
  v_supply := coalesce(nullif(btrim(v_line.supply_source), ''), case when v_line.inventory_item_id is null then 'one_time' else 'catalog' end);
  v_outstanding := round(
    (coalesce(v_line.quantity_issued, 0) - coalesce(v_line.quantity_returned, 0))::numeric,
    2
  );
  if v_outstanding < 0 then
    raise exception 'delete_order_material:counters_inconsistent' using errcode = 'P0001';
  end if;

  if v_supply = 'catalog' and v_line.inventory_item_id is not null then
    if v_role is null or v_role not in ('owner', 'admin', 'manager') then
      raise exception 'delete_order_material:warehouse_permission' using errcode = '42501';
    end if;

    if v_outstanding > 0 then
      if v_line.warehouse_id is null then
        raise exception 'delete_order_material:warehouse_required' using errcode = '22023';
      end if;
      v_key := 'del_mat_' || replace(gen_random_uuid()::text, '-', '');
      perform public.return_order_materials_to_warehouse(
        p_order_id,
        jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_line.inventory_item_id,
          'quantity', v_outstanding
        )),
        v_line.warehouse_id,
        'line_deleted',
        v_key
      );
    end if;
  end if;

  -- Not-yet-activated warranty snapshots may still point at this line; unlink or delete them.
  if to_regclass('public.warranty_records') is not null then
    begin
      execute $sql$
        delete from public.warranty_records wr
         where wr.order_id = $1
           and wr.order_material_id = $2
           and not exists (
             select 1 from public.warranty_order_claims c where c.warranty_record_id = wr.id
           )
      $sql$ using p_order_id, p_order_material_id;
    exception when undefined_table or undefined_column then
      begin
        execute $sql$
          update public.warranty_records
             set order_material_id = null
           where order_id = $1
             and order_material_id = $2
        $sql$ using p_order_id, p_order_material_id;
      exception when others then
        null;
      end;
    end;
  end if;

  delete from public.order_materials
   where id = p_order_material_id
     and order_id = p_order_id;
  if not found then
    raise exception 'delete_order_material:line_not_found' using errcode = 'P0002';
  end if;

  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_services, v_discount
  from priced;
  v_total := greatest(0, round(v_services - v_discount, 2));

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'discount_total' and not attisdropped
  ) into v_has_discount_total;

  update public.orders
     set total_price = v_total,
         updated_at = now()
   where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1' using p_order_id, round(v_discount, 2);
  end if;

  if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is not null then
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
    perform public.crm_order_event_insert(
      v_order.workspace_id,
      p_order_id,
      'material_removed',
      'order_materials',
      v_item_name,
      null,
      jsonb_build_object(
        'item_name', v_item_name,
        'line_id', p_order_material_id,
        'quantity', v_qty,
        'supply_source', v_supply
      ),
      v_uid,
      v_actor_name
    );
  end if;

  return (jsonb_build_object(
    'deleted', true,
    'line_id', p_order_material_id,
    'total_price', v_total,
    'item_name', v_item_name
  )) || jsonb_build_object('order', public.crm_get_order_full(p_order_id));
end;
$fn$;

create or replace function public.crm_set_order_material_prices(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_workspace_id uuid;
  v_role text;
  v_allowed boolean := false;
  v_elem jsonb;
  v_line_id uuid;
  v_price numeric;
  v_updated integer := 0;
  v_n integer;
  v_services numeric := 0;
  v_materials numeric := 0;
  v_discount numeric := 0;
  v_has_discount_total boolean;
  v_total numeric;
begin
  if auth.uid() is null then
    raise exception 'order_material_price:not_authenticated' using errcode = '42501';
  end if;
  if p_order_id is null then
    raise exception 'order_material_price:invalid_args' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('updated', 0)
      || jsonb_build_object('order', public.crm_get_order_full(p_order_id));
  end if;

  select o.workspace_id into v_workspace_id from public.orders o where o.id = p_order_id for update;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'order_material_price:forbidden' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)' into v_allowed using v_workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'order_material_price:forbidden' using errcode = '42501';
  end if;

  for v_elem in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_line_id := nullif(btrim(v_elem ->> 'line_id'), '')::uuid;
      v_price := round((v_elem ->> 'price')::numeric, 2);
    exception when others then
      raise exception 'order_material_price:invalid_line' using errcode = '22023';
    end;
    if v_line_id is null or v_price is null or v_price < 0 or v_price > 100000000 then
      raise exception 'order_material_price:invalid_price' using errcode = '22023';
    end if;

    update public.order_materials m
       set price = v_price
     where m.id = v_line_id
       and m.order_id = p_order_id
       and m.price is distinct from v_price;
    get diagnostics v_n = row_count;

    if v_n = 0 and not exists (select 1 from public.order_materials m where m.id = v_line_id and m.order_id = p_order_id) then
      raise exception 'order_material_price:line_not_found' using errcode = 'P0002';
    end if;
    v_updated := v_updated + v_n;
  end loop;

  -- Recalculate with per-line discount formula (same as crm_change_order_material_quantity).
  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_services, v_discount
  from priced;
  v_total := greatest(0, round(v_services - v_discount, 2));

  select exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass
                 and attname = 'discount_total' and not attisdropped) into v_has_discount_total;
  update public.orders set total_price = v_total, updated_at = now() where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1' using p_order_id, round(v_discount, 2);
  end if;

  return (jsonb_build_object('updated', v_updated, 'total_price', v_total)) || jsonb_build_object('order', public.crm_get_order_full(p_order_id));
end;
$fn$;

-- Keep grants aligned with authenticated-only for the extended RPCs.
revoke all on function public.crm_change_order_material_quantity(uuid, uuid, numeric) from public, anon;
grant execute on function public.crm_change_order_material_quantity(uuid, uuid, numeric) to authenticated;

revoke all on function public.crm_delete_order_material(uuid, uuid) from public, anon;
grant execute on function public.crm_delete_order_material(uuid, uuid) to authenticated;

revoke all on function public.crm_set_order_material_prices(uuid, jsonb) from public, anon;
grant execute on function public.crm_set_order_material_prices(uuid, jsonb) to authenticated;

do $postflight$
begin
  if to_regprocedure('public.crm_get_order_full(uuid)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_get_order_full missing';
  end if;
  if to_regprocedure('public.crm_add_order_service_line(uuid,uuid,numeric,numeric,uuid,integer,integer,integer,text)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_add_order_service_line missing';
  end if;
  if to_regprocedure('public.crm_update_order_service_line(uuid,uuid,numeric,numeric,uuid,boolean)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_update_order_service_line missing';
  end if;
  if to_regprocedure('public.crm_delete_order_service_line(uuid,uuid)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_delete_order_service_line missing';
  end if;
  if to_regprocedure('public.crm_add_and_issue_order_catalog_material(uuid,uuid,uuid,numeric,numeric,text)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_add_and_issue_order_catalog_material missing';
  end if;
  if to_regprocedure('public.crm_change_order_material_quantity(uuid,uuid,numeric)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_change_order_material_quantity missing';
  end if;
  if to_regprocedure('public.crm_delete_order_material(uuid,uuid)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_delete_order_material missing';
  end if;
  if to_regprocedure('public.crm_set_order_material_prices(uuid,jsonb)') is null then
    raise exception 'order_line_rpcs postflight failed: crm_set_order_material_prices missing';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';

commit;
