-- =====================================================================
-- Core App: default location seed for workspaces that have none
--
-- APPLY (mutates). Run AFTER crm_ro_v1.PRODUCTION.sql created public.locations
-- and locations_one_default_idx. Manual SQL Editor only when authorized.
--
-- Intended behavior
--   1. For every workspace with deleted_at IS NULL that has NO non-deleted
--      location, insert exactly one active default location.
--   2. Name = btrim(workspaces.name); if empty/NULL after trim → 'Main'.
--   3. Never modify existing locations (including inactive).
--   4. Never change existing is_default values.
--   5. Never rewrite warehouse / order / notification location_id refs.
--   6. No duplicate defaults; concurrency-safe via partial unique index.
--   7. No RO App / external writes.
--
-- Verified prerequisites (from repository DDL — abort if unmet)
--   * public.locations (crm_ro_v1.PRODUCTION.sql)
--   * public.workspaces.id / name / deleted_at (production baseline)
--   * locations.workspace_id → public.workspaces(id)
--   * UNIQUE INDEX locations_one_default_idx
--       ON public.locations (workspace_id)
--       WHERE is_default AND deleted_at IS NULL
--     Soft-deleted defaults (deleted_at IS NOT NULL) do NOT occupy the index,
--     so a new live default can be inserted for that workspace.
--
-- Idempotent. One transaction; any post-check failure rolls back.
-- =====================================================================

begin;

do $preflight$
declare
  v_problems text[] := array[]::text[];
  v_idxdef text;
  v_pred text;
  v_cols text[];
begin
  if to_regclass('public.locations') is null then
    raise exception 'Preflight failed: public.locations missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if to_regclass('public.workspaces') is null then
    raise exception 'Preflight failed: public.workspaces missing.';
  end if;

  -- workspaces columns (baseline)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'id' and udt_name = 'uuid'
  ) then
    v_problems := v_problems || 'public.workspaces.id (uuid) missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'name' and udt_name = 'text'
  ) then
    v_problems := v_problems || 'public.workspaces.name (text) missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'deleted_at' and udt_name = 'timestamptz'
  ) then
    v_problems := v_problems || 'public.workspaces.deleted_at (timestamptz) missing';
  end if;

  -- locations columns required for this seed (crm_ro_v1)
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'workspace_id' and udt_name = 'uuid' and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'public.locations.workspace_id uuid NOT NULL missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'name' and udt_name = 'text' and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'public.locations.name text NOT NULL missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'is_default' and udt_name = 'bool' and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'public.locations.is_default bool NOT NULL missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'is_active' and udt_name = 'bool' and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'public.locations.is_active bool NOT NULL missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'deleted_at' and udt_name = 'timestamptz' and is_nullable = 'YES'
  ) then
    v_problems := v_problems || 'public.locations.deleted_at timestamptz NULL missing';
  end if;

  -- FK locations.workspace_id → public.workspaces(id)
  if not exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where n.nspname = 'public' and rel.relname = 'locations'
      and c.contype = 'f' and cardinality(c.conkey) = 1
      and a.attname = 'workspace_id'
      and rn.nspname = 'public' and ref.relname = 'workspaces' and ra.attname = 'id'
  ) then
    v_problems := v_problems || 'public.locations.workspace_id missing FK to public.workspaces(id)';
  end if;

  -- Exact partial unique index (name alone is not enough)
  select pg_get_indexdef(i.indexrelid), pg_get_expr(i.indpred, i.indrelid),
         (
           select array_agg(att.attname::text order by ord.ordinality)
           from unnest(i.indkey) with ordinality as ord(attnum, ordinality)
           join pg_attribute att on att.attrelid = i.indrelid and att.attnum = ord.attnum
         )
    into v_idxdef, v_pred, v_cols
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_namespace n on n.oid = ic.relnamespace
  join pg_class tbl on tbl.oid = i.indrelid
  where n.nspname = 'public' and ic.relname = 'locations_one_default_idx' and tbl.relname = 'locations';

  if v_idxdef is null then
    v_problems := v_problems || 'missing index public.locations_one_default_idx';
  else
    if not exists (
      select 1 from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_namespace n on n.oid = ic.relnamespace
      where n.nspname = 'public' and ic.relname = 'locations_one_default_idx' and i.indisunique and i.indisvalid and i.indislive
    ) then
      v_problems := v_problems || 'locations_one_default_idx must be UNIQUE + VALID + LIVE';
    end if;
    if v_cols is distinct from array['workspace_id']::text[] then
      v_problems := v_problems || format(
        'locations_one_default_idx columns %s, expected [workspace_id]', coalesce(v_cols::text, 'null')
      );
    end if;
    -- Predicate must constrain live defaults only (soft-deleted defaults excluded).
    if v_pred is null
       or position('is_default' in lower(v_pred)) = 0
       or position('deleted_at' in lower(v_pred)) = 0
       or position('is null' in lower(v_pred)) = 0 then
      v_problems := v_problems || format(
        'locations_one_default_idx predicate incompatible: %s (expected is_default AND deleted_at IS NULL)',
        coalesce(v_pred, 'NULL')
      );
    end if;
  end if;

  if cardinality(v_problems) > 0 then
    raise exception E'Location seed preflight failed; no changes applied:\n%',
      array_to_string(v_problems, E'\n');
  end if;
end
$preflight$;

-- Serialize concurrent seed runs against locations (transaction-scoped).
lock table public.locations in share row exclusive mode;

do $seed$
declare
  v_inserted integer;
  v_remaining integer;
begin
  insert into public.locations (workspace_id, name, is_default, is_active)
  select
    w.id,
    coalesce(nullif(btrim(w.name), ''), 'Main'),
    true,
    true
  from public.workspaces w
  where w.deleted_at is null
    and not exists (
      select 1
      from public.locations l
      where l.workspace_id = w.id
        and l.deleted_at is null
    )
  -- Conflict target = verified partial unique index (does not swallow unrelated errors).
  on conflict (workspace_id) where (is_default and deleted_at is null)
  do nothing;

  get diagnostics v_inserted = row_count;
  raise notice 'locations inserted: %', v_inserted;

  select count(*)::integer into v_remaining
  from public.workspaces w
  where w.deleted_at is null
    and not exists (
      select 1 from public.locations l
      where l.workspace_id = w.id and l.deleted_at is null
    );

  if v_remaining > 0 then
    raise exception
      'Location seed post-check failed: % non-deleted workspace(s) still have no non-deleted location. Rolling back.',
      v_remaining;
  end if;
end
$seed$;

-- Read-only confirmation inside the same transaction (expected 0).
select count(*) as workspaces_still_without_location
from public.workspaces w
where w.deleted_at is null
  and not exists (
    select 1 from public.locations l
    where l.workspace_id = w.id and l.deleted_at is null
  );

commit;
