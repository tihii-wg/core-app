-- =====================================================================
-- Core App: order line discounts RPC
--
--   crm_set_order_line_discounts(p_order_id uuid, p_lines jsonb) returns jsonb
--
-- WHY: `order_materials` is SELECT-only for the browser
-- (20261018170000_order_materials_stock), so the app cannot stamp a client's
-- product discount onto material lines with a plain UPDATE. This SECURITY
-- DEFINER RPC writes the line discounts and recalculates the order totals in
-- one transaction, so the persisted lines and orders.total_price /
-- orders.discount_total can never disagree.
--
-- p_lines: JSON array. Each element addresses exactly ONE line and sets its discount:
--   material line : { "order_material_id": "<uuid>" | "inventory_item_id": "<uuid>",
--                     "discount_type": "percent" | "amount" | null, "discount_value": <number> | null }
--   service line  : { "order_service_id":  "<uuid>" | "service_id": "<uuid>",
--                     "discount_type": "percent" | "amount" | null, "discount_value": <number> | null }
--   * discount_type null / 'none' / '' OR discount_value null / 0  ->  the line discount is cleared (NULL, NULL).
--   * percent: 0 < value <= 100. amount: value > 0 (capped at the line gross when totals are computed).
--   * inventory_item_id / service_id resolve to the single matching line of THIS order; more than one match
--     is rejected (use order_material_id / order_service_id).
--   * The same line may not appear twice.
--
-- Totals (identical rounding to src/features/orders/orderTotals.ts):
--   gross    = round(price * quantity, 2) per line, summed over order_services + order_materials
--   discount = percent: round(gross * least(value,100) / 100, 2) | amount: least(gross, round(value, 2))
--   orders.total_price     = gross - discount
--   orders.discount_total  = discount                         (only when the column exists)
--   orders.discount_type / discount_value = the single uniform percent of all discounted lines, else NULL
--                                                              (only when the columns exist)
--
-- Permission: caller must be a workspace member AND either hold role owner / admin / manager
-- (workspace_member_role, same rule as issue_order_materials) OR hold `orders.edit`
-- (crm_has_permission, when crm_ro_v1 is installed). workspace_id is taken from the order row.
--
-- Discount columns on order_services / order_materials come from crm_ro_v1 (step 2.1 of
-- MIGRATION_CUTOVER.md). The function reads/writes them only when they exist; if a table lacks them the
-- RPC raises a clear error instead of silently doing nothing.
--
-- Locks: orders row FOR UPDATE, then the order's service / material rows (ordered by id).
--
-- IDEMPOTENT: create or replace + re-grant. One transaction. NOT applied automatically by the app or CI.
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.order_services') is null
     or to_regclass('public.order_materials') is null then
    raise exception 'Preflight failed: orders / order_services / order_materials missing. Aborting.';
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null
     or to_regprocedure('public.workspace_member_role(uuid)') is null then
    raise exception 'Preflight failed: workspace helper functions (is_workspace_member / workspace_member_role) missing. Aborting.';
  end if;

  if exists (
    select 1
    from (values
      ('orders', 'id'), ('orders', 'workspace_id'), ('orders', 'total_price'),
      ('order_services', 'id'), ('order_services', 'order_id'), ('order_services', 'service_id'),
      ('order_services', 'price'), ('order_services', 'quantity'),
      ('order_materials', 'id'), ('order_materials', 'order_id'), ('order_materials', 'inventory_item_id'),
      ('order_materials', 'price'), ('order_materials', 'quantity')
    ) as req(table_name, column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = req.table_name and c.column_name = req.column_name
    )
  ) then
    raise exception 'Preflight failed: required order / line columns are missing. Aborting.';
  end if;

  if to_regprocedure('public.crm_has_permission(uuid, text)') is null then
    raise notice 'crm_has_permission(uuid, text) not found (crm_ro_v1 not applied): only owner/admin/manager roles may set discounts.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_materials' and column_name = 'discount_value'
  ) then
    raise notice 'order_materials.discount_value is missing (crm_ro_v1 not applied): the RPC will raise until it is applied.';
  end if;
end
$preflight$;

create or replace function public.crm_set_order_line_discounts(
  p_order_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_workspace_id uuid;
  v_role text;
  v_allowed boolean := false;
  v_elem jsonb;
  v_has_mat_disc boolean;
  v_has_svc_disc boolean;
  v_has_ord_total boolean;
  v_has_ord_header boolean;
  v_mat_id uuid;
  v_item_id uuid;
  v_svc_id uuid;
  v_service_id uuid;
  v_target_id uuid;
  v_kind text;
  v_type_raw text;
  v_type text;
  v_value numeric;
  v_matches integer;
  v_seen text[] := array[]::text[];
  v_seen_key text;
  v_updated integer := 0;
  v_rowcount integer;
  v_gross numeric := 0;
  v_discount numeric := 0;
  v_n_discounted integer := 0;
  v_n_amount integer := 0;
  v_n_pct integer := 0;
  v_pct numeric;
  v_uniform numeric;
begin
  if p_order_id is null then
    raise exception 'order_id is required' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'discount lines must be a non-empty JSON array' using errcode = '22023';
  end if;

  select o.workspace_id into v_workspace_id
  from public.orders o
  where o.id = p_order_id;

  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Order was not found or you do not have permission to change it.' using errcode = '42501';
  end if;

  v_role := public.workspace_member_role(v_workspace_id);
  if v_role in ('owner', 'admin', 'manager') then
    v_allowed := true;
  elsif to_regprocedure('public.crm_has_permission(uuid, text)') is not null then
    execute 'select public.crm_has_permission($1, $2)'
      into v_allowed
      using v_workspace_id, 'orders.edit';
    v_allowed := coalesce(v_allowed, false);
  end if;
  if not v_allowed then
    raise exception 'You do not have permission to edit order discounts.' using errcode = '42501';
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_materials' and column_name = 'discount_type')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_materials' and column_name = 'discount_value')
    into v_has_mat_disc;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_services' and column_name = 'discount_type')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_services' and column_name = 'discount_value')
    into v_has_svc_disc;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_total')
    into v_has_ord_total;
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_type')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'orders' and column_name = 'discount_value')
    into v_has_ord_header;

  -- Lock order: orders row, then the order's lines (ordered by id).
  perform 1 from public.orders o where o.id = p_order_id for update of o;
  perform 1 from public.order_services s where s.order_id = p_order_id order by s.id for update of s;
  perform 1 from public.order_materials m where m.order_id = p_order_id order by m.id for update of m;

  for v_elem in
    select line.value from jsonb_array_elements(p_lines) as line(value)
  loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'Invalid discount line payload' using errcode = '22P02';
    end if;

    begin
      v_mat_id := nullif(v_elem ->> 'order_material_id', '')::uuid;
      v_item_id := nullif(v_elem ->> 'inventory_item_id', '')::uuid;
      v_svc_id := nullif(v_elem ->> 'order_service_id', '')::uuid;
      v_service_id := nullif(v_elem ->> 'service_id', '')::uuid;
    exception
      when others then
        raise exception 'Invalid discount line payload (line ids must be UUIDs)' using errcode = '22P02';
    end;

    if (v_mat_id is not null or v_item_id is not null) = (v_svc_id is not null or v_service_id is not null) then
      raise exception 'Each discount line must reference exactly one material (order_material_id | inventory_item_id) or one service (order_service_id | service_id)'
        using errcode = '22023';
    end if;

    v_type_raw := lower(nullif(btrim(coalesce(v_elem ->> 'discount_type', '')), ''));
    begin
      v_value := nullif(btrim(coalesce(v_elem ->> 'discount_value', '')), '')::numeric;
    exception
      when others then
        raise exception 'Invalid discount_value' using errcode = '22P02';
    end;

    if v_type_raw is null or v_type_raw = 'none' or v_value is null or v_value = 0 then
      v_type := null;
      v_value := null;
    elsif v_type_raw not in ('percent', 'amount') then
      raise exception 'discount_type must be percent or amount' using errcode = '22023';
    else
      v_type := v_type_raw;
      if v_value < 0 then
        raise exception 'discount_value cannot be negative' using errcode = '22023';
      end if;
      if v_type = 'percent' and v_value > 100 then
        raise exception 'A percent discount cannot exceed 100' using errcode = '22023';
      end if;
      if v_value > 99999999999::numeric then
        raise exception 'discount_value is too large' using errcode = '22023';
      end if;
      v_value := round(v_value, 5);
    end if;

    if v_mat_id is not null or v_item_id is not null then
      v_kind := 'material';
      if not v_has_mat_disc then
        raise exception 'order_materials has no discount columns. Apply crm_ro_v1.PRODUCTION.sql first.' using errcode = '42703';
      end if;

      select count(*)::integer, min(m.id::text)::uuid into v_matches, v_target_id
      from public.order_materials m
      where m.order_id = p_order_id
        and (
          (v_mat_id is not null and m.id = v_mat_id)
          or (v_mat_id is null and m.inventory_item_id = v_item_id)
        );
      if v_matches = 0 then
        raise exception 'Material is not on this order' using errcode = 'P0001';
      elsif v_matches > 1 then
        raise exception 'More than one material line matches inventory_item_id; use order_material_id' using errcode = '22023';
      end if;
    else
      v_kind := 'service';
      if not v_has_svc_disc then
        raise exception 'order_services has no discount columns. Apply crm_ro_v1.PRODUCTION.sql first.' using errcode = '42703';
      end if;

      select count(*)::integer, min(s.id::text)::uuid into v_matches, v_target_id
      from public.order_services s
      where s.order_id = p_order_id
        and (
          (v_svc_id is not null and s.id = v_svc_id)
          or (v_svc_id is null and s.service_id = v_service_id)
        );
      if v_matches = 0 then
        raise exception 'Service is not on this order' using errcode = 'P0001';
      elsif v_matches > 1 then
        raise exception 'More than one service line matches service_id; use order_service_id' using errcode = '22023';
      end if;
    end if;

    v_seen_key := v_kind || ':' || v_target_id::text;
    if v_seen_key = any (v_seen) then
      raise exception 'The same order line appears more than once in discount lines' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_seen_key);

    if v_kind = 'material' then
      update public.order_materials
         set discount_type = v_type,
             discount_value = v_value
       where id = v_target_id
         and order_id = p_order_id;
    else
      update public.order_services
         set discount_type = v_type,
             discount_value = v_value
       where id = v_target_id
         and order_id = p_order_id;
    end if;

    get diagnostics v_rowcount = row_count;
    if v_rowcount <> 1 then
      raise exception 'Could not update the % line discount', v_kind using errcode = 'P0001';
    end if;
    v_updated := v_updated + 1;
  end loop;

  -- Recalculate from ALL persisted lines (services + materials). Discount columns are read through
  -- to_jsonb() so a table without them simply counts as "no discount".
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
           dt,
           dv,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0),
         coalesce(sum(disc), 0),
         count(*) filter (where disc > 0 or (dt in ('percent', 'amount') and dv > 0)),
         count(*) filter (where dt = 'amount' and dv > 0),
         count(distinct dv) filter (where dt = 'percent' and dv > 0),
         min(dv) filter (where dt = 'percent' and dv > 0)
    into v_gross, v_discount, v_n_discounted, v_n_amount, v_n_pct, v_pct
  from priced;

  v_gross := round(v_gross, 2);
  v_discount := round(v_discount, 2);
  v_uniform := case when v_n_discounted > 0 and v_n_amount = 0 and v_n_pct = 1 then v_pct else null end;

  update public.orders
     set total_price = round(v_gross - v_discount, 2)
   where id = p_order_id;

  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 1 then
    raise exception 'Could not update the order total' using errcode = 'P0001';
  end if;

  if v_has_ord_total then
    update public.orders set discount_total = v_discount where id = p_order_id;
  end if;
  if v_has_ord_header then
    if v_uniform is not null then
      update public.orders set discount_type = 'percent', discount_value = v_uniform where id = p_order_id;
    else
      update public.orders set discount_type = null, discount_value = null where id = p_order_id;
    end if;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'lines_updated', v_updated,
    'subtotal', v_gross,
    'discount_total', v_discount,
    'total_price', round(v_gross - v_discount, 2)
  );
end;
$function$;

revoke all on function public.crm_set_order_line_discounts(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.crm_set_order_line_discounts(uuid, jsonb)
  to authenticated;

commit;

-- =====================================================================
-- Post-install verification (read-only; run separately after apply)
--
--   select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'crm_set_order_line_discounts';
--   -- expected: 1 row, prosecdef = true, args "p_order_id uuid, p_lines jsonb"
--
--   select has_function_privilege('authenticated', 'public.crm_set_order_line_discounts(uuid, jsonb)', 'execute'),
--          has_function_privilege('anon',          'public.crm_set_order_line_discounts(uuid, jsonb)', 'execute');
--   -- expected: true, false
-- =====================================================================
