-- =============================================================================
-- Core App — READ-ONLY PREFLIGHT for sync_order_materials secure replacement
-- Run on MAIN in Supabase SQL Editor BEFORE APPLY.
--
-- No writes. No TEMP tables. Does not CALL sync_order_materials.
-- Raises an exception on any required failure. Ends with PREFLIGHT PASS notice.
-- =============================================================================

do $preflight_ro$
declare
  v_problems text[] := array[]::text[];
  v_ret text;
  v_missing text;
  v_col record;
  v_idx_ok boolean := false;
  v_idx_name text;
  v_idx_def text;
  v_idx_pred text;
  v_dup_report text;
  v_dup_count integer := 0;
  v_required_cols text[] := array[
    'id', 'order_id', 'inventory_item_id', 'item_name', 'price', 'quantity',
    'quantity_issued', 'quantity_returned', 'supply_source', 'created_at'
  ];
begin
  raise notice 'PREFLIGHT: starting read-only checks for sync_order_materials…';

  ---------------------------------------------------------------------------
  -- 1) Existing function signature / return type
  ---------------------------------------------------------------------------
  if to_regprocedure('public.sync_order_materials(uuid, jsonb)') is null then
    v_problems := array_append(v_problems,
      'public.sync_order_materials(uuid, jsonb) does not exist (restore prior RPC before APPLY)');
  else
    select pg_get_function_result('public.sync_order_materials(uuid, jsonb)'::regprocedure)
      into v_ret;
    if v_ret is distinct from 'SETOF order_materials'
       and v_ret is distinct from 'SETOF public.order_materials' then
      v_problems := array_append(v_problems,
        format('sync_order_materials return type is %s (expected SETOF order_materials)', coalesce(v_ret, '<null>')));
    else
      raise notice 'PREFLIGHT OK: sync_order_materials(uuid, jsonb) returns %', v_ret;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 2) Helper / dependency RPCs (signatures only — not invoked)
  ---------------------------------------------------------------------------
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := array_append(v_problems, 'public.is_workspace_member(uuid) missing');
  else
    raise notice 'PREFLIGHT OK: is_workspace_member(uuid) present';
  end if;

  if to_regprocedure('public.issue_order_materials(uuid, jsonb, text)') is null
     and to_regprocedure('public.issue_order_materials_from_warehouse(uuid, jsonb, uuid, text)') is null then
    v_problems := array_append(v_problems,
      'neither issue_order_materials(uuid, jsonb, text) nor issue_order_materials_from_warehouse(...) found');
  else
    raise notice 'PREFLIGHT OK: at least one issue RPC present';
  end if;

  if to_regprocedure('public.return_order_materials(uuid, jsonb, text, text)') is null
     and to_regprocedure('public.return_order_materials_to_warehouse(uuid, jsonb, uuid, text, text)') is null then
    v_problems := array_append(v_problems,
      'neither return_order_materials(uuid, jsonb, text, text) nor return_order_materials_to_warehouse(...) found');
  else
    raise notice 'PREFLIGHT OK: at least one return RPC present';
  end if;

  ---------------------------------------------------------------------------
  -- 3) order_materials columns / nullability / types
  ---------------------------------------------------------------------------
  if to_regclass('public.order_materials') is null then
    v_problems := array_append(v_problems, 'public.order_materials table missing');
  else
    select string_agg(c, ', ' order by c) into v_missing
    from unnest(v_required_cols) as c
    where not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_materials'
        and column_name = c
    );
    if v_missing is not null then
      v_problems := array_append(v_problems, format('order_materials missing columns: %s', v_missing));
    end if;

    for v_col in
      select column_name, data_type, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_materials'
        and column_name = any (v_required_cols)
    loop
      if v_col.column_name = 'inventory_item_id' and v_col.is_nullable = 'NO' then
        v_problems := array_append(v_problems,
          'order_materials.inventory_item_id is NOT NULL — freeform schema (PART E) not applied');
      end if;
      if v_col.column_name = 'inventory_item_id'
         and v_col.udt_name is distinct from 'uuid' then
        v_problems := array_append(v_problems,
          format('order_materials.inventory_item_id type is %s (expected uuid)', v_col.udt_name));
      end if;
      if v_col.column_name in ('order_id', 'id')
         and v_col.udt_name is distinct from 'uuid' then
        v_problems := array_append(v_problems,
          format('order_materials.%s type is %s (expected uuid)', v_col.column_name, v_col.udt_name));
      end if;
      if v_col.column_name = 'supply_source' and v_col.data_type is distinct from 'text' then
        v_problems := array_append(v_problems,
          format('order_materials.supply_source type is %s (expected text)', v_col.data_type));
      end if;
      if v_col.column_name in ('quantity', 'quantity_issued', 'quantity_returned')
         and v_col.data_type not in ('integer', 'bigint', 'smallint', 'numeric') then
        v_problems := array_append(v_problems,
          format('order_materials.%s type is %s (expected integer/numeric)', v_col.column_name, v_col.data_type));
      end if;
    end loop;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders'
        and column_name in ('id', 'workspace_id', 'total_price')
      group by table_name
      having count(*) = 3
    ) then
      v_problems := array_append(v_problems, 'orders missing id / workspace_id / total_price');
    end if;

    raise notice 'PREFLIGHT OK: order_materials / orders column checks completed';
  end if;

  ---------------------------------------------------------------------------
  -- 4) Catalog uniqueness — exact semantic guarantee
  --    Accept ONLY a unique, valid, ready index on public.order_materials whose
  --    exact key columns are (order_id, inventory_item_id), no extra keys,
  --    no expressions, and either non-partial OR predicate is exactly
  --    inventory_item_id IS NOT NULL (covers every non-null inventory_item_id).
  ---------------------------------------------------------------------------
  select true, c.relname, pg_get_indexdef(i.indexrelid),
         case when i.indpred is null then null
              else regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '\s+', ' ', 'g')
         end
    into v_idx_ok, v_idx_name, v_idx_def, v_idx_pred
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'order_materials'
    and i.indisunique
    and i.indisvalid
    and i.indisready
    and not i.indisexclusion
    and i.indnkeyatts = 2
    and i.indexprs is null
    and i.indkey[0] > 0
    and i.indkey[1] > 0
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[0]) = 'order_id'
    and (select a.attname from pg_attribute a where a.attrelid = t.oid and a.attnum = i.indkey[1]) = 'inventory_item_id'
    and (
      i.indpred is null
      or regexp_replace(lower(pg_get_expr(i.indpred, i.indrelid)), '\s+', ' ', 'g')
         in ('inventory_item_id is not null', '(inventory_item_id is not null)')
    )
  order by
    case when c.relname = 'order_materials_order_catalog_item_uidx' then 0 else 1 end,
    c.relname
  limit 1;

  if not coalesce(v_idx_ok, false) then
    v_problems := array_append(v_problems,
      'No acceptable unique index/constraint on public.order_materials (order_id, inventory_item_id) for every non-null inventory_item_id. Required: unique, valid, ready, exactly those two key columns, no expressions; non-partial OR predicate exactly "inventory_item_id IS NOT NULL". Preferred name: order_materials_order_catalog_item_uidx. This preflight will not create indexes.');
  else
    raise notice 'PREFLIGHT OK: catalog uniqueness via % — % (pred=%)',
      v_idx_name, v_idx_def, coalesce(v_idx_pred, '<none>');
  end if;

  ---------------------------------------------------------------------------
  -- 5) Existing duplicate catalog pairs (fail closed — no auto-repair)
  ---------------------------------------------------------------------------
  select count(*)::integer,
         string_agg(format('%s / %s ×%s', order_id, inventory_item_id, cnt), '; ' order by cnt desc)
    into v_dup_count, v_dup_report
  from (
    select order_id, inventory_item_id, count(*)::integer as cnt
    from public.order_materials
    where inventory_item_id is not null
    group by order_id, inventory_item_id
    having count(*) > 1
    order by count(*) desc
    limit 50
  ) d;

  if coalesce(v_dup_count, 0) > 0 then
    v_problems := array_append(v_problems,
      format('Duplicate catalog pairs exist (%s groups). Resolve manually before APPLY. Samples: %s',
        v_dup_count, coalesce(v_dup_report, '')));
  else
    raise notice 'PREFLIGHT OK: no duplicate (order_id, inventory_item_id) catalog pairs';
  end if;

  ---------------------------------------------------------------------------
  -- Result
  ---------------------------------------------------------------------------
  if cardinality(v_problems) > 0 then
    raise exception 'PREFLIGHT FAIL — do not APPLY:%s', E'\n- ' || array_to_string(v_problems, E'\n- ');
  end if;

  raise notice 'PREFLIGHT PASS — safe to review APPLY script (still requires owner authorization before execution)';
end
$preflight_ro$;
