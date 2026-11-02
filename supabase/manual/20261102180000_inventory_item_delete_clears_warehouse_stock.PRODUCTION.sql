-- =====================================================================
-- SUPERSEDED by:
--   supabase/manual/20261102200000_warehouse_integrity_inventory_safety.PRODUCTION.sql
-- Do not apply this file on its own. Kept for history / diff reference only.
-- =====================================================================
--
-- Core App — inventory_items DELETE clears write-denied live stock children
-- (manual ADDITIVE PATCH — APPLY in Supabase SQL Editor after review).
--
-- ROOT CAUSE
--   inventory_items DELETE is allowed for any active workspace member
--   (baseline RLS: public.is_workspace_member(workspace_id)).
--   warehouse_stock / stock_batches / stock_serials reference inventory_items
--   ON DELETE CASCADE, but authenticated has SELECT-only on those tables
--   (warehouse bootstrap / crm_ro_v1 write denial). Postgres runs FK cascade
--   as the calling role → 42501. The app maps that to inventory.errors.permission
--   ("нет прав на изменение склада"). Workspace owner vs member is irrelevant.
--
-- REPOSITORY FACTS (verified in repo SQL; live DB must match for APPLY)
--   * No FK between stock_serials ↔ stock_batches ↔ warehouse_stock.
--   * Each of those three FKs inventory_items(id) ON DELETE CASCADE.
--   * inventory_movements.inventory_item_id ON DELETE RESTRICT.
--   * order_materials.inventory_item_id ON DELETE NO ACTION.
--   * inventory_movements.batch_id → stock_batches ON DELETE SET NULL
--     (batch cleanup does not erase movement history; parent delete still
--     blocked by inventory_item_id RESTRICT when movements exist).
--   * Repo never enables FORCE ROW LEVEL SECURITY on stock tables.
--   * Repo never grants DELETE on stock tables to authenticated.
--
-- LIVE DB (cannot verify from this repo alone)
--   * Exact table/function owners and rolbypassrls.
--   * Whether FORCE RLS was enabled out-of-band.
--   Preflight/post-check below abort if owners diverge or FORCE RLS blocks
--   a safe SECURITY DEFINER write path.
--
-- SOLUTION
--   BEFORE DELETE trigger: as SECURITY DEFINER owned by the common owner of
--   the three stock tables, clear live stock rows for (old.id, old.workspace_id)
--   after the same membership gate as inventory_items DELETE RLS.
--   Does NOT grant DELETE to authenticated. Does NOT weaken RLS.
--   Does NOT touch inventory_movements / order_materials / finance history.
--   Does NOT require workspace role = owner.
--
-- IDEMPOTENT. One transaction; abort rolls everything back.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Preflight
-- ---------------------------------------------------------------------
do $preflight$
declare
  v_missing text;
  v_owners text;
  v_force text;
  v_owner_oid oid;
  v_owner_name name;
  v_bypass boolean;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'inventory_items',
    'warehouse_stock',
    'stock_batches',
    'stock_serials',
    'inventory_movements',
    'order_materials',
    'workspace_members',
    'workspaces'
  ]) as t
  where to_regclass('public.' || t) is null;

  if v_missing is not null then
    raise exception
      'Preflight: missing required table(s): %. Apply warehouse/baseline SQL first.',
      v_missing;
  end if;

  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'Preflight: public.is_workspace_member(uuid) missing';
  end if;

  -- Required columns / types for scoped deletes.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_items'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_items'
      and column_name = 'workspace_id' and udt_name = 'uuid'
  ) then
    raise exception 'Preflight: inventory_items.id / workspace_id (uuid) missing';
  end if;

  foreach v_missing in array array['warehouse_stock', 'stock_batches', 'stock_serials']
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_missing
        and column_name = 'inventory_item_id' and udt_name = 'uuid'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_missing
        and column_name = 'workspace_id' and udt_name = 'uuid'
    ) then
      raise exception 'Preflight: public.% needs inventory_item_id uuid and workspace_id uuid', v_missing;
    end if;
  end loop;

  -- FK shape: inventory_items ON DELETE CASCADE on all three live-stock tables.
  if (
    select count(*) from (
      select distinct c.conrelid::regclass::text as tbl
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_class ref on ref.oid = c.confrelid
      join pg_namespace rn on rn.oid = ref.relnamespace
      where c.contype = 'f'
        and n.nspname = 'public'
        and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
        and a.attname = 'inventory_item_id'
        and rn.nspname = 'public' and ref.relname = 'inventory_items'
        and c.confdeltype = 'c' -- CASCADE
        and c.convalidated
    ) s
  ) is distinct from 3 then
    raise exception
      'Preflight: expected validated ON DELETE CASCADE FKs from warehouse_stock/stock_batches/stock_serials.inventory_item_id → inventory_items';
  end if;

  -- History must remain non-cascading.
  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and rel.relname = 'inventory_movements'
      and a.attname = 'inventory_item_id'
      and rn.nspname = 'public' and ref.relname = 'inventory_items'
      and c.confdeltype = 'r' -- RESTRICT
      and c.convalidated
  ) then
    raise exception
      'Preflight: inventory_movements.inventory_item_id must be ON DELETE RESTRICT → inventory_items';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and rel.relname = 'order_materials'
      and a.attname = 'inventory_item_id'
      and rn.nspname = 'public' and ref.relname = 'inventory_items'
      and c.confdeltype in ('a', 'r') -- NO ACTION or RESTRICT
      and c.convalidated
  ) then
    raise exception
      'Preflight: order_materials.inventory_item_id must be ON DELETE NO ACTION/RESTRICT → inventory_items';
  end if;

  -- No inter-stock FKs that would force a different delete order.
  if exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      and n.nspname = 'public' and rn.nspname = 'public'
      and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
      and ref.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
  ) then
    raise exception
      'Preflight: unexpected FK between stock tables; refusing automatic delete order';
  end if;

  -- Common owner for all three write-denied stock tables (required for one DEFINER).
  select string_agg(format('%s→%s', rel.relname, pg_get_userbyid(rel.relowner)), ', ' order by rel.relname),
         min(rel.relowner)
    into v_owners, v_owner_oid
  from pg_class rel
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relkind = 'r'
    and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials');

  if (
    select count(distinct rel.relowner)
    from pg_class rel
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relkind = 'r'
      and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
  ) is distinct from 1 then
    raise exception
      'Preflight: stock table owners differ (%). Cannot use a single SECURITY DEFINER without unsafe grants.',
      v_owners;
  end if;

  select r.rolname, r.rolbypassrls into v_owner_name, v_bypass
  from pg_roles r where r.oid = v_owner_oid;

  select string_agg(rel.relname, ', ' order by rel.relname) into v_force
  from pg_class rel
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relkind = 'r'
    and rel.relname in ('warehouse_stock', 'stock_batches', 'stock_serials')
    and rel.relforcerowsecurity;

  if v_force is not null and v_bypass is distinct from true then
    raise exception
      'Preflight: FORCE ROW LEVEL SECURITY on (%) and owner % lacks BYPASSRLS. Refusing unsafe DEFINER path.',
      v_force, v_owner_name;
  end if;

  -- authenticated must already lack DELETE (do not "fix" by granting).
  if has_table_privilege('authenticated', 'public.warehouse_stock', 'delete')
     or has_table_privilege('authenticated', 'public.stock_batches', 'delete')
     or has_table_privilege('authenticated', 'public.stock_serials', 'delete') then
    raise exception
      'Preflight: authenticated unexpectedly has DELETE on a protected stock table; refusing to proceed';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------
-- 2. Trigger function
-- ---------------------------------------------------------------------
create or replace function public.inventory_items_clear_denied_stock_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Session JWT user (auth.uid), not the function owner.
  if (select auth.uid()) is null then
    raise exception 'inventory_items_clear_denied_stock_children: not authenticated'
      using errcode = '42501';
  end if;

  if old.workspace_id is null then
    raise exception 'inventory_items_clear_denied_stock_children: inventory item has no workspace_id'
      using errcode = '22023';
  end if;

  -- Same authorization rule as inventory_items DELETE RLS (member, not owner-only).
  if not public.is_workspace_member(old.workspace_id) then
    raise exception 'inventory_items_clear_denied_stock_children: not a workspace member'
      using errcode = '42501';
  end if;

  -- Independent stock tables (no mutual FKs). Order: serials → batches → stock.
  -- Statement is atomic: if inventory_movements / order_materials later block the
  -- parent DELETE, these child deletes roll back with it.
  delete from public.stock_serials
  where inventory_item_id = old.id
    and workspace_id = old.workspace_id;

  delete from public.stock_batches
  where inventory_item_id = old.id
    and workspace_id = old.workspace_id;

  delete from public.warehouse_stock
  where inventory_item_id = old.id
    and workspace_id = old.workspace_id;

  return old;
end;
$$;

comment on function public.inventory_items_clear_denied_stock_children() is
  'BEFORE DELETE on inventory_items: SECURITY DEFINER clears workspace-scoped live stock children so authenticated CASCADE does not 42501. Membership via is_workspace_member. Does not delete movements/order_materials.';

revoke all on function public.inventory_items_clear_denied_stock_children() from public, anon;
grant execute on function public.inventory_items_clear_denied_stock_children() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Ownership = common owner of the three stock tables
-- ---------------------------------------------------------------------
do $owner$
declare
  v_owner name;
begin
  select pg_get_userbyid(rel.relowner) into v_owner
  from pg_class rel
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and rel.relkind = 'r' and rel.relname = 'warehouse_stock';

  if v_owner is null then
    raise exception 'Owner setup: public.warehouse_stock owner unresolved';
  end if;

  execute format(
    'alter function public.inventory_items_clear_denied_stock_children() owner to %I',
    v_owner
  );
end
$owner$;

-- ---------------------------------------------------------------------
-- 4. Trigger (replace only this named trigger)
-- ---------------------------------------------------------------------
drop trigger if exists inventory_items_clear_denied_stock_children on public.inventory_items;

create trigger inventory_items_clear_denied_stock_children
  before delete on public.inventory_items
  for each row
  execute function public.inventory_items_clear_denied_stock_children();

-- ---------------------------------------------------------------------
-- 5. Post-install assertions
-- ---------------------------------------------------------------------
do $post$
declare
  v_definer boolean;
  v_config text[];
  v_fn_owner oid;
  v_stock_owners oid[];
  v_tbl text;
begin
  select p.prosecdef, p.proconfig, p.proowner
    into v_definer, v_config, v_fn_owner
  from pg_proc p
  where p.oid = 'public.inventory_items_clear_denied_stock_children()'::regprocedure;

  if v_definer is distinct from true then
    raise exception 'Post-check: function must be SECURITY DEFINER';
  end if;

  if v_config is distinct from array['search_path='] then
    raise exception 'Post-check: search_path must be exactly empty, got %', v_config;
  end if;

  select array_agg(rel.relowner order by rel.relname) into v_stock_owners
  from pg_class rel
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
    and rel.relkind = 'r'
    and rel.relname in ('stock_batches', 'stock_serials', 'warehouse_stock');

  if cardinality(v_stock_owners) is distinct from 3
     or v_stock_owners[1] is distinct from v_stock_owners[2]
     or v_stock_owners[2] is distinct from v_stock_owners[3]
     or v_fn_owner is distinct from v_stock_owners[1] then
    raise exception
      'Post-check: function owner (%) must equal common stock table owner (%)',
      v_fn_owner::regrole, v_stock_owners;
  end if;

  foreach v_tbl in array array['warehouse_stock', 'stock_batches', 'stock_serials']
  loop
    if not has_table_privilege(v_fn_owner, format('public.%I', v_tbl), 'delete') then
      raise exception 'Post-check: function owner lacks DELETE on public.%', v_tbl;
    end if;
    if has_table_privilege('authenticated', format('public.%I', v_tbl), 'delete') then
      raise exception 'Post-check: authenticated must not have DELETE on public.%', v_tbl;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_items'
      and t.tgname = 'inventory_items_clear_denied_stock_children'
      and not t.tgisinternal
      and pn.nspname = 'public'
      and p.proname = 'inventory_items_clear_denied_stock_children'
      and pg_get_triggerdef(t.oid) ilike '%before delete%'
      and pg_get_triggerdef(t.oid) ilike '%for each row%'
  ) then
    raise exception 'Post-check: BEFORE DELETE FOR EACH ROW trigger missing or miswired';
  end if;

  -- Unrelated baseline triggers must remain.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inventory_items'
      and t.tgname = 'inventory_items_prevent_workspace_change' and not t.tgisinternal
  ) then
    raise exception 'Post-check: unrelated trigger inventory_items_prevent_workspace_change missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inventory_items'
      and t.tgname = 'inventory_items_updated_at' and not t.tgisinternal
  ) then
    raise exception 'Post-check: unrelated trigger inventory_items_updated_at missing';
  end if;
end
$post$;

commit;
