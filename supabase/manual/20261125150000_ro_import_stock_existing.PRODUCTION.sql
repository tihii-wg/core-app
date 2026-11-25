-- =====================================================================================
-- RO import: opening stock for parts that already exist in the app
-- Script: 20261125150000_ro_import_stock_existing.PRODUCTION.sql
-- MAIN only. Manual apply after review. Depends on 20261118180000_ro_import.PRODUCTION.sql.
-- =====================================================================================
-- Before: a part matched by name to an existing item got NO stock — only newly created items did.
-- New parameter p_stock_existing (default false = old behaviour). When true, an existing item whose
-- current quantity is 0 also gets the RO "Остаток" (posted by the app as one goods receipt).
-- Items that already have stock are never topped up (no doubling of hand-entered or re-imported
-- stock) and are counted as "stock_skipped".
-- Same name twice in one file: the quantities are summed on the one item.
-- =====================================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.crm_import_catalog(uuid,text,jsonb)') is null
     and to_regprocedure('public.crm_import_catalog(uuid,text,jsonb,boolean)') is null then
    raise exception 'ro_import_stock_existing preflight: apply 20261118180000_ro_import.PRODUCTION.sql first';
  end if;
end;
$preflight$;

-- Replaced by the 4-argument version (a 3-argument overload next to it would make named calls ambiguous).
drop function if exists public.crm_import_catalog(uuid, text, jsonb);

create or replace function public.crm_import_catalog(
  p_workspace_id uuid,
  p_kind text,
  p_rows jsonb,
  p_stock_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_tz text := public.crm_import_begin(p_workspace_id);
  r jsonb;
  v_name text;
  v_key text;
  v_id uuid;
  v_created integer := 0;
  v_linked integer := 0;
  v_skipped integer := 0;
  v_stock_skipped integer := 0;
  v_stock jsonb := '[]'::jsonb;
  v_qty numeric;
  v_months integer;
  v_is_new boolean;
  v_current numeric;
begin
  if p_kind not in ('services', 'materials') then raise exception 'import:invalid_kind' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'import:invalid_rows' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(btrim(r->>'name'), '');
    if v_name is null then v_skipped := v_skipped + 1; continue; end if;
    v_key := lower(v_name);

    if p_kind = 'services' then
      v_id := public.crm_import_map_get(p_workspace_id, 'service', v_key);
      if v_id is not null and exists (select 1 from public.services s where s.id = v_id and s.workspace_id = p_workspace_id) then
        v_skipped := v_skipped + 1; continue;
      end if;
      select s.id into v_id from public.services s
      where s.workspace_id = p_workspace_id and lower(btrim(s.service_name)) = v_key
      order by s.created_at limit 1;
      if v_id is null then
        v_months := public.crm_import_int(r->>'warranty_months');
        insert into public.services (
          workspace_id, service_name, service_price, cost_price, kind, status,
          warranty_type, warranty_months, created_at
        ) values (
          p_workspace_id, v_name, coalesce(public.crm_import_num(r->>'price'), 0),
          public.crm_import_num(r->>'cost'),
          case when r->>'kind' in ('labor', 'service') then r->>'kind' else null end,
          'active',
          case when coalesce(v_months, 0) > 0 then 'duration' else 'none' end,
          nullif(v_months, 0),
          now()
        ) returning id into v_id;
        v_created := v_created + 1;
      else
        v_linked := v_linked + 1;
      end if;
      perform public.crm_import_map_put(p_workspace_id, 'service', v_key, v_id);
    else
      v_qty := public.crm_import_num(r->>'stock');
      v_is_new := false;
      v_id := public.crm_import_map_get(p_workspace_id, 'inventory_item', v_key);
      if v_id is not null and not exists (select 1 from public.inventory_items i where i.id = v_id and i.workspace_id = p_workspace_id) then
        v_id := null;
      end if;
      if v_id is not null then
        v_skipped := v_skipped + 1;
      else
        select i.id into v_id from public.inventory_items i
        where i.workspace_id = p_workspace_id and lower(btrim(i.name)) = v_key
        order by i.created_at limit 1;
        if v_id is null then
          insert into public.inventory_items (
            workspace_id, name, sku, mpn, description, category, unit, quantity, min_quantity,
            purchase_price, selling_price, is_active, created_at, updated_at
          ) values (
            p_workspace_id, v_name,
            -- inventory_items.sku is unique per workspace and RO codes repeat: the first item keeps it.
            case when nullif(btrim(r->>'sku'), '') is not null and not exists (
              select 1 from public.inventory_items i2 where i2.workspace_id = p_workspace_id and i2.sku = btrim(r->>'sku')
            ) then btrim(r->>'sku') else null end,
            nullif(btrim(r->>'mpn'), ''),
            nullif(btrim(concat_ws(' · ', nullif(btrim(r->>'brand'), ''), nullif(btrim(r->>'description'), ''))), ''),
            nullif(btrim(r->>'category'), ''),
            coalesce(nullif(btrim(r->>'unit'), ''), 'шт.'),
            0, 0,
            coalesce(public.crm_import_num(r->>'cost'), 0),
            coalesce(public.crm_import_num(r->>'price'), 0),
            true, now(), now()
          ) returning id into v_id;
          v_created := v_created + 1;
          v_is_new := true;
        else
          v_linked := v_linked + 1;
        end if;
        perform public.crm_import_map_put(p_workspace_id, 'inventory_item', v_key, v_id);
      end if;

      if coalesce(v_qty, 0) > 0 then
        if v_is_new then
          v_stock := v_stock || jsonb_build_object('id', v_id, 'name', v_name, 'qty', v_qty, 'cost', coalesce(public.crm_import_num(r->>'cost'), 0));
        elsif p_stock_existing then
          -- The receipt is posted after the whole file, so "quantity = 0" still holds for a repeated name in
          -- this run: it is summed (client side groups by id). Items that already hold stock are left alone.
          select coalesce(i.quantity, 0) into v_current from public.inventory_items i where i.id = v_id;
          if coalesce(v_current, 0) <= 0 then
            v_stock := v_stock || jsonb_build_object(
              'id', v_id, 'name', v_name, 'qty', v_qty,
              'cost', coalesce(public.crm_import_num(r->>'cost'), (select i.purchase_price from public.inventory_items i where i.id = v_id), 0)
            );
          else
            v_stock_skipped := v_stock_skipped + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'created', v_created, 'linked', v_linked, 'skipped', v_skipped,
    'stock', v_stock, 'stock_skipped', v_stock_skipped
  );
end;
$fn$;

revoke all on function public.crm_import_catalog(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.crm_import_catalog(uuid, text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

do $postflight$
begin
  if to_regprocedure('public.crm_import_catalog(uuid,text,jsonb,boolean)') is null then
    raise exception 'ro_import_stock_existing postflight: function missing';
  end if;
  if to_regprocedure('public.crm_import_catalog(uuid,text,jsonb)') is not null then
    raise exception 'ro_import_stock_existing postflight: old 3-argument overload still present';
  end if;
end;
$postflight$;

commit;
