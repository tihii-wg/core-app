-- =============================================================================
-- Order estimates (orders.kind = 'estimate' → same row becomes an order on accept)
-- Script: 20261113090000_order_estimates.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- 1) orders.kind / estimate_status_id / estimate_accepted_*
-- 2) status_definitions.semantic_action += 'accept' (estimate entity only)
-- 3) Seed default estimate statuses per workspace (safe re-run)
-- 4) Stock movement guard for estimates (helper + pg_get_functiondef patches)
-- 5) Exclude estimates from aggregates / public status / payments
-- 6) crm_convert_estimate_to_order + crm_set_estimate_status
-- One DO block. Ends with notify pgrst.
-- =============================================================================

do $order_estimates$
declare
  v_def text;
  v_con text;
  v_names text[];
  r record;
  v_patched int := 0;
  v_skipped int := 0;
  v_marker text := 'estimate_no_stock_v1';
  v_ws record;
  v_lang text;
  v_names_json jsonb;
  v_has_any boolean;
  v_sort int;
  v_id uuid;
begin
  -- -------------------------------------------------------------------------
  -- Preflight
  -- -------------------------------------------------------------------------
  if to_regclass('public.orders') is null then
    raise exception 'order_estimates preflight: public.orders missing';
  end if;
  if to_regclass('public.status_definitions') is null then
    raise exception 'order_estimates preflight: public.status_definitions missing';
  end if;
  if to_regclass('public.workspaces') is null then
    raise exception 'order_estimates preflight: public.workspaces missing';
  end if;
  if to_regprocedure('public.crm_assert_order_line_edit(uuid)') is null then
    raise exception 'order_estimates preflight: crm_assert_order_line_edit(uuid) missing';
  end if;
  if to_regprocedure('public.crm_get_order_full(uuid)') is null then
    raise exception 'order_estimates preflight: crm_get_order_full(uuid) missing';
  end if;
  if to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    raise exception 'order_estimates preflight: issue_order_materials_from_warehouse missing';
  end if;

  -- -------------------------------------------------------------------------
  -- 1) orders columns (WITH defaults — no mass UPDATE; closed-order guards)
  -- -------------------------------------------------------------------------
  alter table public.orders
    add column if not exists kind text not null default 'order';

  alter table public.orders
    add column if not exists estimate_status_id uuid;

  alter table public.orders
    add column if not exists estimate_accepted_at timestamptz;

  alter table public.orders
    add column if not exists estimate_accepted_by uuid;

  -- kind check
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'orders_kind_check'
    and c.conrelid = 'public.orders'::regclass;
  if v_def is null then
    alter table public.orders
      add constraint orders_kind_check check (kind in ('order', 'estimate'));
  elsif position('estimate' in v_def) = 0 then
    alter table public.orders drop constraint orders_kind_check;
    alter table public.orders
      add constraint orders_kind_check check (kind in ('order', 'estimate'));
  end if;

  -- FK estimate_status_id → status_definitions (set null on delete)
  if not exists (
    select 1 from pg_constraint
     where conname = 'orders_estimate_status_id_fkey'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_estimate_status_id_fkey
      foreign key (estimate_status_id) references public.status_definitions(id) on delete set null;
  end if;

  create index if not exists orders_workspace_kind_idx
    on public.orders (workspace_id, kind);

  comment on column public.orders.kind is
    'order = normal work order; estimate = draft quote that converts in place on accept';
  comment on column public.orders.estimate_status_id is
    'status_definitions.id for entity=estimate; null for normal orders';

  -- -------------------------------------------------------------------------
  -- 2) semantic_action: allow 'accept' (estimate only)
  -- -------------------------------------------------------------------------
  select c.conname, pg_get_constraintdef(c.oid)
    into v_con, v_def
  from pg_constraint c
  where c.conrelid = 'public.status_definitions'::regclass
    and c.conname = 'status_definitions_semantic_action_check';

  if v_con is null then
    -- Fallback: find any check on semantic_action
    select c.conname, pg_get_constraintdef(c.oid)
      into v_con, v_def
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.status_definitions'::regclass
      and c.contype = 'c'
      and a.attname = 'semantic_action'
      and not a.attisdropped
    limit 1;
  end if;

  if v_con is not null and position('accept' in coalesce(v_def, '')) = 0 then
    execute format('alter table public.status_definitions drop constraint %I', v_con);
    v_con := null;
  end if;

  if v_con is null then
    alter table public.status_definitions
      add constraint status_definitions_semantic_action_check
      check (semantic_action in ('normal', 'close', 'cancel', 'accept'));
  end if;

  -- accept only valid for entity = estimate
  if not exists (
    select 1 from pg_constraint
     where conname = 'status_definitions_accept_estimate_only'
       and conrelid = 'public.status_definitions'::regclass
  ) then
    alter table public.status_definitions
      add constraint status_definitions_accept_estimate_only
      check (semantic_action is distinct from 'accept' or entity = 'estimate');
  end if;

  -- -------------------------------------------------------------------------
  -- 3) Seed estimate statuses (workspaces with none active)
  -- -------------------------------------------------------------------------
  for v_ws in
    select w.id,
           lower(btrim(coalesce(
             case when exists (
               select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'workspaces' and column_name = 'language'
             ) then (to_jsonb(w) ->> 'language') else null end,
             case when exists (
               select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'workspaces' and column_name = 'document_language'
             ) then (to_jsonb(w) ->> 'document_language') else null end,
             'ru'
           ))) as lang
    from public.workspaces w
    where w.deleted_at is null
  loop
    select exists (
      select 1 from public.status_definitions d
       where d.workspace_id = v_ws.id
         and d.entity = 'estimate'
         and d.deleted_at is null
         and d.is_active
    ) into v_has_any;
    if v_has_any then
      continue;
    end if;

    v_lang := case
      when v_ws.lang like 'ro%' then 'ro'
      when v_ws.lang like 'en%' then 'en'
      else 'ru'
    end;

    v_names_json := case v_lang
      when 'en' then jsonb_build_array(
        jsonb_build_object('name', 'Draft', 'action', 'normal', 'default', true, 'code', 'estimate_draft'),
        jsonb_build_object('name', 'Sent', 'action', 'normal', 'default', false, 'code', 'estimate_sent'),
        jsonb_build_object('name', 'Accepted', 'action', 'accept', 'default', false, 'code', 'estimate_accepted'),
        jsonb_build_object('name', 'Rejected', 'action', 'cancel', 'default', false, 'code', 'estimate_rejected')
      )
      when 'ro' then jsonb_build_array(
        jsonb_build_object('name', 'Ciornă', 'action', 'normal', 'default', true, 'code', 'estimate_draft'),
        jsonb_build_object('name', 'Trimis', 'action', 'normal', 'default', false, 'code', 'estimate_sent'),
        jsonb_build_object('name', 'Acceptat', 'action', 'accept', 'default', false, 'code', 'estimate_accepted'),
        jsonb_build_object('name', 'Respins', 'action', 'cancel', 'default', false, 'code', 'estimate_rejected')
      )
      else jsonb_build_array(
        jsonb_build_object('name', 'Черновик', 'action', 'normal', 'default', true, 'code', 'estimate_draft'),
        jsonb_build_object('name', 'Отправлен', 'action', 'normal', 'default', false, 'code', 'estimate_sent'),
        jsonb_build_object('name', 'Принят', 'action', 'accept', 'default', false, 'code', 'estimate_accepted'),
        jsonb_build_object('name', 'Отклонён', 'action', 'cancel', 'default', false, 'code', 'estimate_rejected')
      )
    end;

    v_sort := 0;
    for r in select val from jsonb_array_elements(v_names_json) as t(val)
    loop
      v_sort := v_sort + 10;
      -- Skip if this code already exists for the workspace (safe re-run)
      if exists (
        select 1 from public.status_definitions d
         where d.workspace_id = v_ws.id
           and d.entity = 'estimate'
           and d.code = (r.val ->> 'code')
           and d.deleted_at is null
      ) then
        continue;
      end if;
      insert into public.status_definitions (
        workspace_id, entity, name, color, status_group, system_status, code,
        semantic_action, sort_order, is_default, is_active, show_overdue_badge, adds_to_backorders
      ) values (
        v_ws.id,
        'estimate',
        r.val ->> 'name',
        case (r.val ->> 'action')
          when 'accept' then '#16a34a'
          when 'cancel' then '#dc2626'
          else '#64748b'
        end,
        -- status_group must be one of the allowed groups (check constraint).
        case (r.val ->> 'action')
          when 'accept' then 'done'
          when 'cancel' then 'canceled'
          else 'new'
        end,
        null,
        r.val ->> 'code',
        r.val ->> 'action',
        v_sort,
        coalesce((r.val ->> 'default')::boolean, false),
        true,
        false,
        false
      );
    end loop;
  end loop;

  -- -------------------------------------------------------------------------
  -- 3b) Workspaces that already had estimate statuses (e.g. RO App import) but none marked «accept»:
  --     mark the existing «Принят / Accepted / Acceptat» (else the first 'done' one) as accept; insert one only if
  --     nothing fits. Dropped/canceled-group statuses still marked normal become «cancel» (rejected).
  -- -------------------------------------------------------------------------
  for v_ws in
    select w.id from public.workspaces w where w.deleted_at is null
  loop
    if not exists (
      select 1 from public.status_definitions d
       where d.workspace_id = v_ws.id and d.entity = 'estimate' and d.deleted_at is null and d.is_active
    ) then
      continue;
    end if;

    if not exists (
      select 1 from public.status_definitions d
       where d.workspace_id = v_ws.id and d.entity = 'estimate' and d.deleted_at is null and d.is_active
         and d.semantic_action = 'accept'
    ) then
      select d.id into v_id
        from public.status_definitions d
       where d.workspace_id = v_ws.id and d.entity = 'estimate' and d.deleted_at is null and d.is_active
         and (lower(btrim(d.name)) in ('принят', 'принято', 'согласован', 'accepted', 'acceptat') or d.status_group = 'done')
       order by case when lower(btrim(d.name)) in ('принят', 'принято', 'согласован', 'accepted', 'acceptat') then 0 else 1 end,
                d.sort_order, d.name
       limit 1;
      if v_id is not null then
        update public.status_definitions set semantic_action = 'accept', updated_at = now() where id = v_id;
      else
        insert into public.status_definitions (
          workspace_id, entity, name, color, status_group, semantic_action, sort_order, is_default, is_active,
          show_overdue_badge, adds_to_backorders
        ) values (
          v_ws.id, 'estimate', 'Принят', '#16a34a', 'done', 'accept',
          coalesce((select max(d.sort_order) from public.status_definitions d
                     where d.workspace_id = v_ws.id and d.entity = 'estimate'), 0) + 10,
          false, true, false, false
        );
      end if;
      v_id := null;
    end if;

    -- Only ONE cancel status per workspace/entity (unique index status_definitions_one_cancel_uidx):
    -- mark the best match only when none is marked yet.
    if not exists (
      select 1 from public.status_definitions d
       where d.workspace_id = v_ws.id and d.entity = 'estimate' and d.deleted_at is null
         and d.semantic_action = 'cancel'
    ) then
      select d.id into v_id
        from public.status_definitions d
       where d.workspace_id = v_ws.id and d.entity = 'estimate' and d.deleted_at is null and d.is_active
         and coalesce(d.semantic_action, 'normal') = 'normal'
         and (d.status_group in ('dropped_off', 'canceled')
              or lower(btrim(d.name)) in ('отклонен', 'отклонён', 'rejected', 'respins'))
       order by case when lower(btrim(d.name)) in ('отклонен', 'отклонён', 'rejected', 'respins') then 0 else 1 end,
                d.sort_order, d.name
       limit 1;
      if v_id is not null then
        update public.status_definitions set semantic_action = 'cancel', updated_at = now() where id = v_id;
      end if;
      v_id := null;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 4) Stock guard helper + patches
  -- -------------------------------------------------------------------------
  create or replace function public.crm_assert_order_allows_stock(p_order_id uuid)
  returns void
  language plpgsql
  stable
  security definer
  set search_path = public
  as $fn$
  declare
    v_kind text;
  begin
    if p_order_id is null then
      return;
    end if;
    select o.kind into v_kind from public.orders o where o.id = p_order_id;
    if v_kind = 'estimate' then
      raise exception 'estimate:no_stock_movement' using errcode = '42501';
    end if;
  end;
  $fn$;

  revoke all on function public.crm_assert_order_allows_stock(uuid) from public, anon;
  grant execute on function public.crm_assert_order_allows_stock(uuid) to authenticated, service_role;

  v_names := array[
    'issue_order_materials_from_warehouse',
    'return_order_materials_to_warehouse',
    'issue_order_materials',
    'return_order_materials',
    'crm_add_and_issue_order_catalog_material',
    'add_and_issue_order_catalog_material'
  ];

  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (v_names)
  loop
    v_def := pg_get_functiondef(r.oid);
    if position(v_marker in v_def) > 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    -- Inject right after the first BEGIN of the function body
    if position(E'\nbegin\n' in lower(v_def)) = 0 and position(E'\nbegin\r\n' in lower(v_def)) = 0 then
      raise exception 'order_estimates: cannot find begin in %', r.proname;
    end if;
    -- Case-preserving replace of first "begin" after as $...$
    v_def := regexp_replace(
      v_def,
      '(?i)(\nas\s+\$[a-zA-Z0-9_]*\$\s*)(begin)',
      E'\\1begin\n  -- ' || v_marker || E'\n  perform public.crm_assert_order_allows_stock(p_order_id);',
      1
    );
    if position(v_marker in v_def) = 0 then
      -- Fallback: after bare begin
      v_def := regexp_replace(
        v_def,
        '(?i)(\n\s*)(begin)(\s*\n)',
        E'\\1begin\\3  -- ' || v_marker || E'\n  perform public.crm_assert_order_allows_stock(p_order_id);\n',
        1
      );
    end if;
    if position(v_marker in v_def) = 0 then
      raise exception 'order_estimates: failed to patch stock guard into %', r.proname;
    end if;
    execute v_def;
    v_patched := v_patched + 1;
  end loop;

  raise notice 'order_estimates stock guards: patched %, already patched %', v_patched, v_skipped;

  -- crm_change_order_material_quantity (also used by crm_update_order_material_line): on an estimate a catalog
  -- line changes quantity WITHOUT stock — it takes the existing no-stock branch (freeform), totals still recalc.
  if to_regprocedure('public.crm_change_order_material_quantity(uuid,uuid,numeric)') is not null then
    v_def := pg_get_functiondef('public.crm_change_order_material_quantity(uuid,uuid,numeric)'::regprocedure);
    if position('estimate_qty_no_stock_v1' in v_def) = 0 then
      if position('if v_supply = ''catalog'' and v_line.inventory_item_id is not null then' in v_def) = 0 then
        raise exception 'order_estimates: catalog branch not found in crm_change_order_material_quantity';
      end if;
      v_def := replace(
        v_def,
        'if v_supply = ''catalog'' and v_line.inventory_item_id is not null then',
        'if v_supply = ''catalog'' and v_line.inventory_item_id is not null
     and not exists (select 1 from public.orders eo where eo.id = p_order_id and eo.kind = ''estimate'') then -- estimate_qty_no_stock_v1'
      );
      execute v_def;
    end if;
  end if;

  -- delete_order_with_payments: an estimate never moved stock or money, so it can be deleted in any
  -- estimate status (no "cancel first" step). Orders keep the cancelled-first rule unchanged.
  if to_regprocedure('public.delete_order_with_payments(uuid,uuid)') is not null then
    v_def := pg_get_functiondef('public.delete_order_with_payments(uuid,uuid)'::regprocedure);
    if position('estimate_delete_any_v1' in v_def) = 0 then
      if position('v_is_cancelled := (v_order.status is not distinct from ''cancelled'');' in v_def) = 0 then
        raise exception 'order_estimates: cancelled-first check not found in delete_order_with_payments';
      end if;
      v_def := replace(
        v_def,
        'v_is_cancelled := (v_order.status is not distinct from ''cancelled'');',
        'v_is_cancelled := (v_order.status is not distinct from ''cancelled'')
    or (v_order.kind is not distinct from ''estimate''); -- estimate_delete_any_v1'
      );
      execute v_def;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 5) Exclude estimates from aggregates / public status / payments
  -- -------------------------------------------------------------------------

  -- payments: reject inserts linked to an estimate
  create or replace function public.crm_payments_reject_estimate()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_kind text;
  begin
    if new.order_id is null then
      return new;
    end if;
    select o.kind into v_kind from public.orders o where o.id = new.order_id;
    if v_kind = 'estimate' then
      raise exception 'estimate:no_payments' using errcode = '42501';
    end if;
    return new;
  end;
  $fn$;

  drop trigger if exists crm_payments_reject_estimate_bi on public.payments;
  if to_regclass('public.payments') is not null then
    create trigger crm_payments_reject_estimate_bi
      before insert on public.payments
      for each row
      execute function public.crm_payments_reject_estimate();
  end if;

  -- public order status: estimates → not found (null)
  if to_regprocedure('public.crm_public_order_status(text)') is not null then
    v_def := pg_get_functiondef('public.crm_public_order_status(text)'::regprocedure);
    if position('estimate_public_status_v1' in v_def) = 0 then
      -- Replace the final select to require kind = 'order' (or null for legacy)
      if position('where o.id = v_link.entity_id' in v_def) > 0 then
        v_def := replace(
          v_def,
          'where o.id = v_link.entity_id
     and o.workspace_id = v_link.workspace_id;',
          'where o.id = v_link.entity_id
     and o.workspace_id = v_link.workspace_id
     and coalesce(o.kind, ''order'') = ''order''; -- estimate_public_status_v1'
        );
        if position('estimate_public_status_v1' in v_def) = 0 then
          v_def := replace(
            v_def,
            'where o.id = v_link.entity_id
     and o.workspace_id = v_link.workspace_id',
            'where o.id = v_link.entity_id
     and o.workspace_id = v_link.workspace_id
     and coalesce(o.kind, ''order'') = ''order'' -- estimate_public_status_v1'
          );
        end if;
        if position('estimate_public_status_v1' in v_def) > 0 then
          execute v_def;
        else
          raise notice 'order_estimates: could not patch crm_public_order_status (shape changed)';
        end if;
      end if;
    end if;
  end if;

  -- recent active order ids: only kind=order
  if to_regprocedure('public.crm_recent_active_order_ids(uuid, integer)') is not null then
    v_def := pg_get_functiondef('public.crm_recent_active_order_ids(uuid, integer)'::regprocedure);
    if position('estimate_recent_orders_v1' in v_def) = 0 then
      v_def := replace(
        v_def,
        'from public.order_events e
  where e.workspace_id = p_workspace_id',
        'from public.order_events e
  join public.orders o on o.id = e.order_id and coalesce(o.kind, ''order'') = ''order'' -- estimate_recent_orders_v1
  where e.workspace_id = p_workspace_id'
      );
      if position('estimate_recent_orders_v1' in v_def) > 0 then
        execute v_def;
      else
        raise notice 'order_estimates: could not patch crm_recent_active_order_ids';
      end if;
    end if;
  end if;

  -- activate_order_warranties: no-op for estimates
  if to_regprocedure('public.activate_order_warranties(uuid, uuid, timestamptz)') is not null then
    v_def := pg_get_functiondef('public.activate_order_warranties(uuid, uuid, timestamptz)'::regprocedure);
    if position('estimate_no_warranty_v1' in v_def) = 0 then
      v_def := regexp_replace(
        v_def,
        '(?i)(\nas\s+\$[a-zA-Z0-9_]*\$\s*)(begin)',
        E'\\1begin\n  -- estimate_no_warranty_v1\n  if exists (select 1 from public.orders o where o.id = p_order_id and o.kind = ''estimate'') then\n    return 0;\n  end if;',
        1
      );
      if position('estimate_no_warranty_v1' in v_def) > 0 then
        execute v_def;
      end if;
    end if;
  end if;

  -- close_order_if_settled: refuse estimates
  if to_regprocedure('public.close_order_if_settled(uuid, uuid)') is not null then
    v_def := pg_get_functiondef('public.close_order_if_settled(uuid, uuid)'::regprocedure);
    if position('estimate_no_close_v1' in v_def) = 0 then
      v_def := regexp_replace(
        v_def,
        '(?i)(\nas\s+\$[a-zA-Z0-9_]*\$\s*)(begin)',
        E'\\1begin\n  -- estimate_no_close_v1\n  if exists (select 1 from public.orders o where o.id = p_order_id and o.kind = ''estimate'') then\n    raise exception ''estimate:no_close'' using errcode = ''42501'';\n  end if;',
        1
      );
      if position('estimate_no_close_v1' in v_def) > 0 then
        execute v_def;
      end if;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 6) Convert + set estimate status RPCs
  -- -------------------------------------------------------------------------
  create or replace function public.crm_convert_estimate_to_order(p_order_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_uid uuid := auth.uid();
    v_order public.orders%rowtype;
    v_accept_id uuid;
    v_new_status_id uuid;
    v_new_system text := 'new';
    v_line record;
    v_remaining numeric;
    v_available numeric;
    v_qty numeric;
    v_wh uuid;
    v_lines jsonb;
  begin
    if v_uid is null then
      raise exception 'convert_estimate:not_authenticated' using errcode = '42501';
    end if;
    if p_order_id is null then
      raise exception 'convert_estimate:invalid_args' using errcode = '22023';
    end if;

    select * into v_order from public.orders o where o.id = p_order_id for update;
    if not found then
      raise exception 'convert_estimate:order_not_found' using errcode = 'P0002';
    end if;

    perform public.crm_assert_order_line_edit(v_order.workspace_id);

    -- Idempotent: already an order
    if coalesce(v_order.kind, 'order') = 'order' then
      return public.crm_get_order_full(p_order_id);
    end if;

    if v_order.kind is distinct from 'estimate' then
      raise exception 'convert_estimate:not_an_estimate' using errcode = '22023';
    end if;

    select d.id into v_accept_id
    from public.status_definitions d
    where d.workspace_id = v_order.workspace_id
      and d.entity = 'estimate'
      and d.semantic_action = 'accept'
      and d.is_active
      and d.deleted_at is null
    order by d.sort_order, d.name
    limit 1;

    select d.id, d.system_status into v_new_status_id, v_new_system
    from public.status_definitions d
    where d.workspace_id = v_order.workspace_id
      and d.entity = 'order'
      and d.is_active
      and d.deleted_at is null
      and (
        d.is_default
        or lower(coalesce(d.system_status, '')) = 'new'
        or d.semantic_action = 'normal'
      )
    order by d.is_default desc,
             case when lower(coalesce(d.system_status, '')) = 'new' then 0 else 1 end,
             d.sort_order, d.name
    limit 1;

    if v_new_system is null or v_new_system not in ('new', 'in_progress', 'in-progress', 'waiting', 'waiting_for_parts') then
      v_new_system := 'new';
    end if;
    -- Normalize hyphenated legacy
    if v_new_system = 'in-progress' then
      v_new_system := 'in_progress';
    end if;

    update public.orders
       set kind = 'order',
           status = v_new_system,
           custom_status_id = v_new_status_id,
           estimate_status_id = coalesce(v_accept_id, estimate_status_id),
           estimate_accepted_at = coalesce(estimate_accepted_at, now()),
           estimate_accepted_by = coalesce(estimate_accepted_by, v_uid),
           updated_at = now()
     where id = p_order_id;

    -- Issue catalog materials up to available stock (never fail conversion)
    for v_line in
      select om.*
      from public.order_materials om
      where om.order_id = p_order_id
        and om.inventory_item_id is not null
        and coalesce(om.quantity, 0) > coalesce(om.quantity_issued, 0)
    loop
      begin
        v_remaining := coalesce(v_line.quantity, 0) - coalesce(v_line.quantity_issued, 0);
        if v_remaining <= 0 then
          continue;
        end if;
        v_wh := v_line.warehouse_id;
        if v_wh is null then
          -- No warehouse on the line: take the workspace warehouse holding the most of this item.
          select ws.warehouse_id into v_wh
            from public.warehouse_stock ws
           where ws.workspace_id = v_order.workspace_id
             and ws.inventory_item_id = v_line.inventory_item_id
             and coalesce(ws.quantity, 0) > 0
           order by ws.quantity desc
           limit 1;
          if v_wh is null then
            continue;
          end if;
          update public.order_materials set warehouse_id = v_wh where id = v_line.id;
        end if;
        select coalesce(ws.quantity, 0) into v_available
        from public.warehouse_stock ws
        where ws.warehouse_id = v_wh
          and ws.workspace_id = v_order.workspace_id
          and ws.inventory_item_id = v_line.inventory_item_id;
        v_available := coalesce(v_available, 0);
        v_qty := least(v_remaining, v_available);
        if v_qty <= 0 then
          continue;
        end if;
        -- Whole units when the issue RPC requires integers; else pass numeric
        v_lines := jsonb_build_array(jsonb_build_object(
          'inventory_item_id', v_line.inventory_item_id,
          -- Decimal quantities (2 places) are valid: floor to 2 decimals, never to whole units.
          'quantity', trunc(v_qty, 2)
        ));
        if (v_lines -> 0 ->> 'quantity')::numeric <= 0 then
          continue;
        end if;
        perform public.issue_order_materials_from_warehouse(
          p_order_id,
          v_lines,
          v_wh,
          'estimate-convert-' || p_order_id::text || '-' || v_line.id::text
        );
      exception
        when others then
          -- Missing stock / partial / schema quirks must not block conversion
          raise notice 'convert_estimate: skip issue for line %: %', v_line.id, sqlerrm;
      end;
    end loop;

    if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is not null then
      perform public.crm_order_event_insert(
        v_order.workspace_id,
        p_order_id,
        'estimate_converted',
        null, null, null,
        jsonb_build_object('from_kind', 'estimate', 'to_kind', 'order'),
        v_uid,
        null
      );
    end if;

    return public.crm_get_order_full(p_order_id);
  end;
  $fn$;

  revoke all on function public.crm_convert_estimate_to_order(uuid) from public, anon;
  grant execute on function public.crm_convert_estimate_to_order(uuid) to authenticated;

  create or replace function public.crm_set_estimate_status(p_order_id uuid, p_status_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_uid uuid := auth.uid();
    v_order public.orders%rowtype;
    v_status public.status_definitions%rowtype;
    v_old_name text;
  begin
    if v_uid is null then
      raise exception 'set_estimate_status:not_authenticated' using errcode = '42501';
    end if;
    if p_order_id is null or p_status_id is null then
      raise exception 'set_estimate_status:invalid_args' using errcode = '22023';
    end if;

    select * into v_order from public.orders o where o.id = p_order_id for update;
    if not found then
      raise exception 'set_estimate_status:order_not_found' using errcode = 'P0002';
    end if;
    if v_order.kind is distinct from 'estimate' then
      raise exception 'set_estimate_status:not_an_estimate' using errcode = '22023';
    end if;

    perform public.crm_assert_order_line_edit(v_order.workspace_id);

    select * into v_status
    from public.status_definitions d
    where d.id = p_status_id
      and d.workspace_id = v_order.workspace_id
      and d.entity = 'estimate'
      and d.deleted_at is null
      and d.is_active;
    if not found then
      raise exception 'set_estimate_status:invalid_status' using errcode = '22023';
    end if;

    if v_status.semantic_action = 'accept' then
      return public.crm_convert_estimate_to_order(p_order_id);
    end if;

    select d.name into v_old_name
    from public.status_definitions d
    where d.id = v_order.estimate_status_id;

    update public.orders
       set estimate_status_id = p_status_id,
           updated_at = now()
     where id = p_order_id;

    if to_regprocedure('public.crm_order_event_insert(uuid,uuid,text,text,text,text,jsonb,uuid,text)') is not null then
      perform public.crm_order_event_insert(
        v_order.workspace_id,
        p_order_id,
        'estimate_status_changed',
        null, null, null,
        jsonb_build_object(
          'from', coalesce(v_old_name, ''),
          'to', v_status.name,
          'status_id', p_status_id
        ),
        v_uid,
        null
      );
    end if;

    return public.crm_get_order_full(p_order_id);
  end;
  $fn$;

  revoke all on function public.crm_set_estimate_status(uuid, uuid) from public, anon;
  grant execute on function public.crm_set_estimate_status(uuid, uuid) to authenticated;

  comment on function public.crm_convert_estimate_to_order(uuid) is
    'Converts orders.kind=estimate into a normal order in place; issues catalog stock up to available.';
  comment on function public.crm_set_estimate_status(uuid, uuid) is
    'Sets estimate_status_id; accept semantic routes through crm_convert_estimate_to_order.';

  -- -------------------------------------------------------------------------
  -- Postflight
  -- -------------------------------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'kind'
  ) then
    raise exception 'order_estimates postflight: orders.kind missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name = 'estimate_status_id'
  ) then
    raise exception 'order_estimates postflight: orders.estimate_status_id missing';
  end if;
  if to_regprocedure('public.crm_convert_estimate_to_order(uuid)') is null then
    raise exception 'order_estimates postflight: crm_convert_estimate_to_order missing';
  end if;
  if to_regprocedure('public.crm_set_estimate_status(uuid,uuid)') is null then
    raise exception 'order_estimates postflight: crm_set_estimate_status missing';
  end if;
  if to_regprocedure('public.crm_assert_order_allows_stock(uuid)') is null then
    raise exception 'order_estimates postflight: crm_assert_order_allows_stock missing';
  end if;

  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conname = 'status_definitions_semantic_action_check'
    and c.conrelid = 'public.status_definitions'::regclass;
  if v_def is null or position('accept' in v_def) = 0 then
    raise exception 'order_estimates postflight: semantic_action check missing accept';
  end if;

  notify pgrst, 'reload schema';
end;
$order_estimates$;
