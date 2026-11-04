-- =============================================================================
-- Core App — Order lifecycle statuses (semantic actions + close/cancel RPCs)
-- File: supabase/manual/20261104120000_order_lifecycle_statuses.PRODUCTION.sql
--
-- TARGET: MAIN Supabase project ONLY (pundggjzzaqzbvykbxvo).
-- Do NOT run against TEST (hnfvrlgcnpykncixxqha). Do NOT run against any other
-- project. This is the single APPLY script for the order lifecycle feature.
--
-- This script is NOT auto-applied. Review, then paste into the MAIN SQL Editor.
-- The authoring process does not execute this script against any remote database.
--
-- ONE TRANSACTION (begin … commit). Any failed check rolls back everything.
-- RERUNNABLE: safe after a fully rolled-back attempt or a prior successful apply.
--
-- PREVIOUS FAILURE (fixed):
--   Unique index status_definitions_code_uidx failed because several statuses
--   share system_status='in-progress' and were all mapped to code='in_progress'.
--   system_status is NOT unique. Codes are now assigned with a deterministic,
--   collision-safe algorithm and validated BEFORE any unique index is created.
--
-- PRESERVATION GUARANTEE:
--   * All existing status_definitions rows, UUIDs, names, system_status,
--     status_group, colors, sort_order, is_default, is_active are preserved.
--   * orders.custom_status_id links are not changed by this script.
--   * semantic_action is never derived from display names; NULL → 'normal' only.
--   * Default statuses are seeded ONLY for workspaces with ZERO order statuses.
--
-- WHAT IT DOES:
--   0) Preflight (fail closed): tables, functions, columns, void-aware integrity
--   1) status_definitions.code + semantic_action (IF NOT EXISTS)
--   2) Stable code backfill / duplicate repair
--   3) Pre-index diagnostics (duplicate codes / defaults / close / cancel)
--   4) Unique partial indexes (definition-checked if they already exist)
--   5) order_lifecycle_tokens (PK order_id+op; service_role only)
--   6) order_ledger_remaining (service_role only; deduped payment set)
--   7) order_lifecycle_guard trigger (token-only close/cancel/replace; no GUC bypass)
--   8) close_order_if_settled
--   9) cancel_order
--  10) set_order_lifecycle_semantic
--  11) replace_order_status (remaps transitions / role perms / order types /
--      print templates / notification rules / orders, then soft-deletes source)
--  12) ensure_default_order_statuses + workspace insert trigger + empty backfill
--  13) delete_order_with_payments (returns issued materials for cancelled orders)
--  14) Post-apply assertions
--  15) PostgREST schema reload
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) PREFLIGHT — fail closed
-- ---------------------------------------------------------------------------
do $preflight$
declare
  v_problems text := '';
  v_fn_def text;
  v_has_void boolean := false;
  v_tbl text;
  v_col text;
begin
  foreach v_tbl in array array[
    'orders', 'payments', 'invoices', 'status_definitions', 'workspaces', 'workspace_members'
  ]
  loop
    if to_regclass('public.' || v_tbl) is null then
      v_problems := v_problems || format('table public.%s missing; ', v_tbl);
    end if;
  end loop;

  if to_regprocedure('public.crm_has_permission(uuid,text)') is null then
    v_problems := v_problems || 'crm_has_permission(uuid,text) missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;

  if to_regprocedure('public.payments_enforce_integrity()') is null then
    v_problems := v_problems || 'payments_enforce_integrity() missing; ';
  else
    select pg_get_functiondef(to_regprocedure('public.payments_enforce_integrity()')) into v_fn_def;
    v_has_void := coalesce(
      v_fn_def like '%kind in (''refund'', ''void'')%'
      or v_fn_def like '%when p.kind in (''refund'', ''void'')%'
      or v_fn_def like '%p.kind = ''void''%',
      false
    );
    if not v_has_void then
      v_problems := v_problems || 'payments_enforce_integrity does not subtract void — apply void-offset script first; ';
    end if;
  end if;

  -- orders: status_changed_at / updated_at are optional; RPCs touch them only if present.
  if to_regclass('public.orders') is not null then
    foreach v_col in array array['id', 'workspace_id', 'status', 'custom_status_id', 'closed_at', 'total_price']
    loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'orders' and column_name = v_col
      ) then
        v_problems := v_problems || format('orders.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  if to_regclass('public.payments') is not null then
    foreach v_col in array array['id', 'workspace_id', 'order_id', 'invoice_id', 'kind', 'amount', 'related_payment_id']
    loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'payments' and column_name = v_col
      ) then
        v_problems := v_problems || format('payments.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  if to_regclass('public.invoices') is not null then
    foreach v_col in array array['id', 'workspace_id', 'order_id']
    loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'invoices' and column_name = v_col
      ) then
        v_problems := v_problems || format('invoices.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  if to_regclass('public.status_definitions') is not null then
    foreach v_col in array array[
      'id', 'workspace_id', 'entity', 'name', 'system_status', 'sort_order',
      'is_default', 'is_active', 'deleted_at', 'created_at', 'updated_at',
      'color', 'status_group'
    ]
    loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'status_definitions' and column_name = v_col
      ) then
        v_problems := v_problems || format('status_definitions.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  -- workspaces.currency is optional (used only in close error messages).
  if to_regclass('public.workspaces') is not null then
    foreach v_col in array array['id', 'deleted_at']
    loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'workspaces' and column_name = v_col
      ) then
        v_problems := v_problems || format('workspaces.%s missing; ', v_col);
      end if;
    end loop;
  end if;

  if v_problems <> '' then
    raise exception 'PREFLIGHT FAILED (order lifecycle): %', v_problems;
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- 1) Columns: code + semantic_action (idempotent)
-- ---------------------------------------------------------------------------
alter table public.status_definitions
  add column if not exists code text;

alter table public.status_definitions
  add column if not exists semantic_action text;

-- Initialize semantic_action only where NULL. Never overwrite owner-configured values.
update public.status_definitions
set semantic_action = 'normal'
where semantic_action is null;

do $sa_chk$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_catalog.pg_constraint c
  where c.conname = 'status_definitions_semantic_action_check'
    and c.conrelid = 'public.status_definitions'::regclass;

  if v_def is null then
    alter table public.status_definitions
      add constraint status_definitions_semantic_action_check
      check (semantic_action in ('normal', 'close', 'cancel'));
  elsif v_def not like '%normal%' or v_def not like '%close%' or v_def not like '%cancel%' then
    raise exception 'status_definitions_semantic_action_check exists with unexpected definition: %', v_def;
  end if;
end
$sa_chk$;

alter table public.status_definitions
  alter column semantic_action set default 'normal';

alter table public.status_definitions
  alter column semantic_action set not null;

comment on column public.status_definitions.semantic_action is
  'Business action independent of name: normal | close | cancel. Managed via set_order_lifecycle_semantic.';
comment on column public.status_definitions.code is
  'Stable technical key, unique per (workspace_id, entity) among non-deleted rows. Independent of display name and system_status.';

-- ---------------------------------------------------------------------------
-- 2) Stable unique code backfill / repair
--    NEVER treat system_status as unique.
--    Pass A: empty → NULL
--    Pass B: fill NULL codes (preferred from system_status if free, else s_<uuidhex>[_N])
--    Pass C: repair duplicate non-null codes (keep earliest, reassign the rest)
-- ---------------------------------------------------------------------------
do $codes$
declare
  r record;
  v_preferred text;
  v_base text;
  v_candidate text;
  v_n integer;
  v_ids uuid[];
  v_id uuid;
  v_ws uuid;
  v_entity text;
begin
  -- Pass A
  update public.status_definitions
  set code = null
  where code is not null and btrim(code) = '';

  -- Pass B
  for r in
    select d.id, d.workspace_id, d.entity, d.system_status
    from public.status_definitions d
    where d.deleted_at is null
      and d.code is null
    order by d.workspace_id, d.entity, d.sort_order, d.created_at nulls last, d.id
  loop
    -- Canonical preferred codes only (never treat system_status as unique).
    v_preferred := case btrim(coalesce(r.system_status, ''))
      when 'new' then 'new'
      when 'in-progress' then 'in_progress'
      when 'waiting-parts' then 'waiting_parts'
      when 'cancelled' then 'cancelled'
      when 'closed' then 'closed'
      when 'completed' then 'completed'
      when 'paid' then 'paid'
      else null
    end;

    if v_preferred is not null and not exists (
      select 1
      from public.status_definitions x
      where x.workspace_id = r.workspace_id
        and x.entity = r.entity
        and x.deleted_at is null
        and x.code = v_preferred
        and x.id <> r.id
    ) then
      update public.status_definitions
      set code = v_preferred
      where id = r.id and code is null;
      continue;
    end if;

    -- nextAvailable: s_<uuid hex>, then _2, _3, … until free among non-deleted rows.
    v_base := 's_' || replace(lower(r.id::text), '-', '');
    v_candidate := v_base;
    v_n := 1;
    loop
      exit when not exists (
        select 1
        from public.status_definitions x
        where x.workspace_id = r.workspace_id
          and x.entity = r.entity
          and x.deleted_at is null
          and x.code = v_candidate
          and x.id <> r.id
      );
      v_n := v_n + 1;
      v_candidate := v_base || '_' || v_n::text;
    end loop;

    update public.status_definitions
    set code = v_candidate
    where id = r.id and code is null;
  end loop;

  -- Pass C
  for r in
    select d.workspace_id, d.entity, d.code,
           array_agg(d.id order by d.sort_order, d.created_at nulls last, d.id) as ids
    from public.status_definitions d
    where d.deleted_at is null
      and d.code is not null
    group by d.workspace_id, d.entity, d.code
    having count(*) > 1
  loop
    v_ids := r.ids;
    v_ws := r.workspace_id;
    v_entity := r.entity;

    foreach v_id in array v_ids[2:array_length(v_ids, 1)]
    loop
      v_base := 's_' || replace(lower(v_id::text), '-', '');
      v_candidate := v_base;
      v_n := 1;
      loop
        exit when not exists (
          select 1
          from public.status_definitions x
          where x.workspace_id = v_ws
            and x.entity = v_entity
            and x.deleted_at is null
            and x.code = v_candidate
            and x.id <> v_id
        );
        v_n := v_n + 1;
        v_candidate := v_base || '_' || v_n::text;
      end loop;

      update public.status_definitions
      set code = v_candidate
      where id = v_id;
    end loop;
  end loop;
end
$codes$;

-- ---------------------------------------------------------------------------
-- 3) PRE-INDEX DIAGNOSTICS — abort with workspace / entity / ids / names
-- ---------------------------------------------------------------------------
do $diag$
declare
  v_report text := '';
  v_part text;
begin
  select string_agg(
           format('DUPLICATE CODE workspace=%s entity=%s code=%s ids=[%s] names=[%s]',
                  workspace_id, entity, code, id_list, name_list),
           E'\n')
    into v_part
  from (
    select d.workspace_id, d.entity, d.code,
           string_agg(d.id::text, ', ' order by d.id) as id_list,
           string_agg(d.name, ' | ' order by d.id) as name_list
    from public.status_definitions d
    where d.deleted_at is null and d.code is not null
    group by d.workspace_id, d.entity, d.code
    having count(*) > 1
  ) x;
  if v_part is not null then
    v_report := v_report || E'\n' || v_part;
  end if;

  select string_agg(
           format('MULTIPLE ACTIVE DEFAULTS workspace=%s entity=%s ids=[%s] names=[%s]',
                  workspace_id, entity, id_list, name_list),
           E'\n')
    into v_part
  from (
    select d.workspace_id, d.entity,
           string_agg(d.id::text, ', ' order by d.id) as id_list,
           string_agg(d.name, ' | ' order by d.id) as name_list
    from public.status_definitions d
    where d.is_default and d.deleted_at is null and d.is_active
    group by d.workspace_id, d.entity
    having count(*) > 1
  ) x;
  if v_part is not null then
    v_report := v_report || E'\n' || v_part;
  end if;

  select string_agg(
           format('MULTIPLE ACTIVE CLOSE workspace=%s entity=%s ids=[%s] names=[%s]',
                  workspace_id, entity, id_list, name_list),
           E'\n')
    into v_part
  from (
    select d.workspace_id, d.entity,
           string_agg(d.id::text, ', ' order by d.id) as id_list,
           string_agg(d.name, ' | ' order by d.id) as name_list
    from public.status_definitions d
    where d.deleted_at is null and d.is_active and d.semantic_action = 'close'
    group by d.workspace_id, d.entity
    having count(*) > 1
  ) x;
  if v_part is not null then
    v_report := v_report || E'\n' || v_part;
  end if;

  select string_agg(
           format('MULTIPLE ACTIVE CANCEL workspace=%s entity=%s ids=[%s] names=[%s]',
                  workspace_id, entity, id_list, name_list),
           E'\n')
    into v_part
  from (
    select d.workspace_id, d.entity,
           string_agg(d.id::text, ', ' order by d.id) as id_list,
           string_agg(d.name, ' | ' order by d.id) as name_list
    from public.status_definitions d
    where d.deleted_at is null and d.is_active and d.semantic_action = 'cancel'
    group by d.workspace_id, d.entity
    having count(*) > 1
  ) x;
  if v_part is not null then
    v_report := v_report || E'\n' || v_part;
  end if;

  if v_report <> '' then
    raise exception 'PRE-INDEX DIAGNOSTICS FAILED — fix data before apply:%', v_report;
  end if;
end
$diag$;

-- ---------------------------------------------------------------------------
-- 4) Unique partial indexes (after validation)
--    An existing index with the same name must match the expected definition.
--    Comparison: build a throwaway index with the expected definition and
--    compare pg_get_indexdef output (name-normalized), then drop it.
-- ---------------------------------------------------------------------------
do $idx_chk$
declare
  v_names text[] := array[
    'status_definitions_code_uidx',
    'status_definitions_one_default_uidx',
    'status_definitions_one_close_uidx',
    'status_definitions_one_cancel_uidx'
  ];
  v_bodies text[] := array[
    '(workspace_id, entity, code) where deleted_at is null and code is not null',
    '(workspace_id, entity) where is_default and deleted_at is null and is_active',
    '(workspace_id, entity) where deleted_at is null and is_active and semantic_action = ''close''',
    '(workspace_id, entity) where deleted_at is null and is_active and semantic_action = ''cancel'''
  ];
  v_i integer;
  v_name text;
  v_chk text;
  v_existing regclass;
  v_existing_def text;
  v_expected_def text;
  v_valid boolean;
begin
  for v_i in 1 .. array_length(v_names, 1)
  loop
    v_name := v_names[v_i];
    v_existing := to_regclass('public.' || v_name);
    continue when v_existing is null;

    select i.indisvalid into v_valid
    from pg_catalog.pg_index i
    where i.indexrelid = v_existing;

    if v_valid is null then
      raise exception 'INDEX CHECK FAILED: public.% exists but is not an index', v_name;
    end if;
    if not v_valid then
      raise exception 'INDEX CHECK FAILED: public.% exists but is INVALID — drop it manually and rerun', v_name;
    end if;

    v_chk := v_name || '_defchk';
    execute format('drop index if exists public.%I', v_chk);
    execute format('create unique index %I on public.status_definitions %s', v_chk, v_bodies[v_i]);

    v_existing_def := pg_get_indexdef(v_existing);
    v_expected_def := replace(pg_get_indexdef(to_regclass('public.' || v_chk)), v_chk, v_name);

    execute format('drop index public.%I', v_chk);

    if v_existing_def is distinct from v_expected_def then
      raise exception E'INDEX CHECK FAILED: public.% has unexpected definition.\n  existing: %\n  expected: %',
        v_name, v_existing_def, v_expected_def;
    end if;
  end loop;
end
$idx_chk$;

create unique index if not exists status_definitions_code_uidx
  on public.status_definitions (workspace_id, entity, code)
  where deleted_at is null and code is not null;

create unique index if not exists status_definitions_one_default_uidx
  on public.status_definitions (workspace_id, entity)
  where is_default and deleted_at is null and is_active;

create unique index if not exists status_definitions_one_close_uidx
  on public.status_definitions (workspace_id, entity)
  where deleted_at is null and is_active and semantic_action = 'close';

create unique index if not exists status_definitions_one_cancel_uidx
  on public.status_definitions (workspace_id, entity)
  where deleted_at is null and is_active and semantic_action = 'cancel';

-- ---------------------------------------------------------------------------
-- 5) Lifecycle tokens — only SECURITY DEFINER writers may insert.
--    Tokens are inserted and deleted inside the same RPC transaction, so they
--    are never visible to other sessions. Ephemeral: safe to drop/recreate.
-- ---------------------------------------------------------------------------
do $tokens$
declare
  v_rel regclass := to_regclass('public.order_lifecycle_tokens');
  v_pk text[];
  v_op_chk text;
begin
  if v_rel is null then
    return;
  end if;

  select array_agg(a.attname::text order by a.attname::text) into v_pk
  from pg_catalog.pg_index i
  join pg_catalog.pg_attribute a
    on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = v_rel and i.indisprimary;

  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_op_chk
  from pg_catalog.pg_constraint c
  where c.conrelid = v_rel and c.contype = 'c';

  if v_pk is distinct from array['op', 'order_id']
     or coalesce(v_op_chk, '') not like '%replace%' then
    drop table public.order_lifecycle_tokens;
  end if;
end
$tokens$;

create table if not exists public.order_lifecycle_tokens (
  order_id uuid not null references public.orders(id) on delete cascade,
  op text not null check (op in ('close', 'cancel', 'replace')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (order_id, op)
);

alter table public.order_lifecycle_tokens enable row level security;
revoke all on table public.order_lifecycle_tokens from public, anon, authenticated;
grant all on table public.order_lifecycle_tokens to service_role;

comment on table public.order_lifecycle_tokens is
  'Single-use, in-transaction tokens proving close/cancel/replace RPCs authorize a protected orders UPDATE. Not client-writable.';

-- ---------------------------------------------------------------------------
-- 6) Remaining helper — payment − refund − void over a DEDUPED payment set
--    (order_id = X OR invoice belongs to X; each payment id counted once).
--    VOLATILE so re-reads inside close see the locked snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.order_ledger_remaining(p_workspace_id uuid, p_order_id uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_total numeric;
  v_net numeric;
begin
  select o.total_price into v_total
  from public.orders o
  where o.id = p_order_id and o.workspace_id = p_workspace_id;

  if not found then
    raise exception 'order_lifecycle:order_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(
           case
             when s.kind = 'payment' then s.amount
             when s.kind in ('refund', 'void') then -s.amount
             else 0
           end
         ), 0)
    into v_net
  from (
    select distinct p.id, p.kind, p.amount
    from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id
          from public.invoices i
          where i.workspace_id = p_workspace_id
            and i.order_id = p_order_id
        )
      )
  ) s;

  return greatest(coalesce(v_total, 0) - coalesce(v_net, 0), 0);
end;
$fn$;

revoke all on function public.order_ledger_remaining(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_ledger_remaining(uuid, uuid) to service_role;

comment on function public.order_ledger_remaining(uuid, uuid) is
  'max(0, total_price − (payment − refund − void)) over deduped order+invoice payments. Internal; service_role only.';

-- ---------------------------------------------------------------------------
-- 7) Guard: block client bypass of close / cancel / reopen. No GUC bypass.
-- ---------------------------------------------------------------------------
create or replace function public.order_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_close_tok boolean;
  v_cancel_tok boolean;
  v_replace_tok boolean;
  v_new_action text;
  v_target record;
begin
  -- Rule 1: closed_at can never be cleared.
  if old.closed_at is not null and new.closed_at is null then
    raise exception 'order_lifecycle:cannot_clear_closed_at' using errcode = '42501';
  end if;

  select
    coalesce(bool_or(t.op = 'close'), false),
    coalesce(bool_or(t.op = 'cancel'), false),
    coalesce(bool_or(t.op = 'replace'), false)
    into v_close_tok, v_cancel_tok, v_replace_tok
  from public.order_lifecycle_tokens t
  where t.order_id = new.id;

  -- Rule 2: formally closed orders are immutable except idempotent close
  -- or a status replacement that changes custom_status_id ONLY.
  if old.closed_at is not null
     and (new.status is distinct from old.status
          or new.custom_status_id is distinct from old.custom_status_id
          or new.closed_at is distinct from old.closed_at) then
    if v_close_tok then
      null;
    elsif v_replace_tok
          and new.status is not distinct from old.status
          and new.closed_at is not distinct from old.closed_at
          and new.custom_status_id is distinct from old.custom_status_id then
      select d.id, d.semantic_action into v_target
      from public.status_definitions d
      where d.id = new.custom_status_id
        and d.workspace_id = new.workspace_id
        and d.entity = 'order'
        and d.is_active
        and d.deleted_at is null;

      if not found or v_target.semantic_action in ('close', 'cancel') then
        raise exception 'order_lifecycle:replace_target_invalid' using errcode = '42501';
      end if;
      return new;
    else
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
  end if;

  -- Rule 3: closed_at changes only via close.
  if new.closed_at is distinct from old.closed_at and not v_close_tok then
    raise exception 'order_lifecycle:closed_at_via_rpc_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- Rule 4
    if new.status = 'closed' and not v_close_tok then
      raise exception 'order_lifecycle:closed_status_via_rpc_only' using errcode = '42501';
    end if;
    -- Rule 5: always, even when no cancel semantic is configured.
    if new.status = 'cancelled' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_status_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  -- Rule 6: moving to a close/cancel-designated custom status needs the matching token.
  if new.custom_status_id is distinct from old.custom_status_id
     and new.custom_status_id is not null then
    select d.semantic_action into v_new_action
    from public.status_definitions d
    where d.id = new.custom_status_id
      and d.workspace_id = new.workspace_id
      and d.entity = 'order'
      and d.deleted_at is null;

    if v_new_action = 'close' and not v_close_tok then
      raise exception 'order_lifecycle:close_semantic_via_rpc_only' using errcode = '42501';
    elsif v_new_action = 'cancel' and not v_cancel_tok then
      raise exception 'order_lifecycle:cancel_semantic_via_rpc_only' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists orders_lifecycle_guard_bu on public.orders;
create trigger orders_lifecycle_guard_bu
  before update of status, custom_status_id, closed_at on public.orders
  for each row
  execute function public.order_lifecycle_guard();

revoke all on function public.order_lifecycle_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) close_order_if_settled
--    Lock order: ORDER FOR UPDATE → payments (order + its invoices) FOR UPDATE by id.
--    Compatible with payments_enforce_integrity (WORKSPACE→ORDER→INVOICE):
--    concurrent payment inserts wait on the order row lock held here;
--    refund/void wait on the payment-row locks.
--    Never inserts payments and never touches inventory.
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
        select i.id
        from public.invoices i
        where i.workspace_id = p_workspace_id
          and i.order_id = p_order_id
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
      into v_currency
      using p_workspace_id;
  end if;

  if v_order.closed_at is not null then
    v_remaining := public.order_ledger_remaining(p_workspace_id, p_order_id);
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', v_order.id,
      'closed_at', v_order.closed_at,
      'custom_status_id', v_order.custom_status_id,
      'remaining', round(v_remaining, 2),
      'currency', coalesce(v_currency, '')
    );
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_lifecycle:cannot_close_cancelled' using errcode = 'P0001';
  end if;

  v_total := coalesce(v_order.total_price, 0);

  select exists (
    select 1
    from public.payments p
    where p.workspace_id = p_workspace_id
      and (
        p.order_id = p_order_id
        or p.invoice_id in (
          select i.id
          from public.invoices i
          where i.workspace_id = p_workspace_id
            and i.order_id = p_order_id
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

  -- Re-check after all locks are held (stale-balance guard).
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

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'closed_at', v_closed_at,
    'custom_status_id', v_close_status_id,
    'remaining', round(v_remaining, 2),
    'currency', coalesce(v_currency, '')
  );
end;
$fn$;

revoke all on function public.close_order_if_settled(uuid, uuid) from public, anon;
grant execute on function public.close_order_if_settled(uuid, uuid) to authenticated, service_role;

comment on function public.close_order_if_settled(uuid, uuid) is
  'Formal order close when deduped ledger remaining <= 0.005. Requires orders.edit. Sets closed_at once. No payment/inventory changes. Idempotent.';

-- ---------------------------------------------------------------------------
-- 9) cancel_order — never sets closed_at
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(
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
  v_cancel_status_id uuid;
  v_touch text;
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

  if v_order.closed_at is not null then
    raise exception 'order_lifecycle:cannot_cancel_closed' using errcode = 'P0001';
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'order_id', p_order_id,
      'custom_status_id', v_order.custom_status_id,
      'closed_at', null
    );
  end if;

  select d.id into v_cancel_status_id
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active
    and d.semantic_action = 'cancel'
  order by d.sort_order, d.name, d.id
  limit 1;

  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname in ('status_changed_at', 'updated_at')
    and a.attnum > 0 and not a.attisdropped;

  insert into public.order_lifecycle_tokens (order_id, op, created_by)
  values (p_order_id, 'cancel', v_uid)
  on conflict (order_id, op) do update
    set created_by = excluded.created_by, created_at = now();

  execute format(
    'update public.orders o
        set status = ''cancelled'',
            custom_status_id = coalesce($1, o.custom_status_id)%s
      where o.id = $2 and o.workspace_id = $3',
    v_touch
  )
    using v_cancel_status_id, p_order_id, p_workspace_id;

  delete from public.order_lifecycle_tokens
  where order_id = p_order_id and op = 'cancel';

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'order_id', p_order_id,
    'custom_status_id', v_cancel_status_id,
    'closed_at', null
  );
end;
$fn$;

revoke all on function public.cancel_order(uuid, uuid) from public, anon;
grant execute on function public.cancel_order(uuid, uuid) to authenticated, service_role;

comment on function public.cancel_order(uuid, uuid) is
  'Cancels an open order (status=cancelled + cancel semantic status if configured). Requires orders.edit. Never sets closed_at. Idempotent.';

-- ---------------------------------------------------------------------------
-- 10) Designate close/cancel semantic (settings.statuses)
--     Serializes per workspace by locking all order statuses first.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_lifecycle_semantic(
  p_workspace_id uuid,
  p_status_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_row public.status_definitions%rowtype;
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_status_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if p_action is null or p_action not in ('close', 'cancel', 'normal') then
    raise exception 'order_lifecycle:invalid_action' using errcode = '22023';
  end if;

  if not coalesce(public.crm_has_permission(p_workspace_id, 'settings.statuses'), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  perform 1
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
  order by d.id
  for update of d;

  select * into v_row
  from public.status_definitions d
  where d.id = p_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null;

  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  if p_action in ('close', 'cancel') and not v_row.is_active then
    raise exception 'order_lifecycle:inactive_status' using errcode = 'P0001';
  end if;

  if p_action in ('close', 'cancel') then
    update public.status_definitions d
    set semantic_action = 'normal', updated_at = now()
    where d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.deleted_at is null
      and d.semantic_action = p_action
      and d.id <> p_status_id;
  end if;

  update public.status_definitions d
  set semantic_action = p_action, updated_at = now()
  where d.id = p_status_id
    and d.semantic_action is distinct from p_action;

  return jsonb_build_object('ok', true, 'status_id', p_status_id, 'semantic_action', p_action);
end;
$fn$;

revoke all on function public.set_order_lifecycle_semantic(uuid, uuid, text) from public, anon;
grant execute on function public.set_order_lifecycle_semantic(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11) Replace an in-use status: remap dependents, then soft-delete the source.
-- ---------------------------------------------------------------------------
create or replace function public.replace_order_status(
  p_workspace_id uuid,
  p_from_status_id uuid,
  p_to_status_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_from public.status_definitions%rowtype;
  v_to public.status_definitions%rowtype;
  v_moved integer := 0;
  v_order_id uuid;
  v_touch text;
  v_col text;
  v_ot_touch text := '';
begin
  if v_uid is null then
    raise exception 'order_lifecycle:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_from_status_id is null or p_to_status_id is null then
    raise exception 'order_lifecycle:invalid_args' using errcode = '22023';
  end if;

  if not coalesce(public.crm_has_permission(p_workspace_id, 'settings.statuses'), false) then
    raise exception 'order_lifecycle:forbidden' using errcode = '42501';
  end if;

  if p_from_status_id = p_to_status_id then
    raise exception 'order_lifecycle:replace_same' using errcode = '22023';
  end if;

  perform 1
  from public.status_definitions d
  where d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
  order by d.id
  for update of d;

  select * into v_from
  from public.status_definitions d
  where d.id = p_from_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null;
  if not found then
    raise exception 'order_lifecycle:status_not_found' using errcode = 'P0002';
  end if;

  select * into v_to
  from public.status_definitions d
  where d.id = p_to_status_id
    and d.workspace_id = p_workspace_id
    and d.entity = 'order'
    and d.deleted_at is null
    and d.is_active;
  if not found then
    raise exception 'order_lifecycle:replace_target_invalid' using errcode = 'P0002';
  end if;

  if v_to.semantic_action in ('close', 'cancel') then
    raise exception 'order_lifecycle:replace_target_protected' using errcode = 'P0001';
  end if;

  -- Do not silently drop workspace Close/Cancel designations: clear semantic first.
  if v_from.semantic_action in ('close', 'cancel') then
    raise exception 'order_lifecycle:replace_source_has_semantic' using errcode = 'P0001';
  end if;

  -- status_transitions: remap, dropping self-loops and duplicates.
  if to_regclass('public.status_transitions') is not null then
    delete from public.status_transitions t
    where t.workspace_id = p_workspace_id
      and t.status_id = p_from_status_id
      and (
        t.next_status_id = p_to_status_id
        or exists (
          select 1 from public.status_transitions t2
          where t2.status_id = p_to_status_id
            and t2.next_status_id = t.next_status_id
        )
      );

    update public.status_transitions t
    set status_id = p_to_status_id
    where t.workspace_id = p_workspace_id
      and t.status_id = p_from_status_id;

    delete from public.status_transitions t
    where t.workspace_id = p_workspace_id
      and t.next_status_id = p_from_status_id
      and (
        t.status_id = p_to_status_id
        or exists (
          select 1 from public.status_transitions t2
          where t2.status_id = t.status_id
            and t2.next_status_id = p_to_status_id
        )
      );

    update public.status_transitions t
    set next_status_id = p_to_status_id
    where t.workspace_id = p_workspace_id
      and t.next_status_id = p_from_status_id;
  end if;

  -- status_role_permissions: merge (most restrictive wins) or copy, then drop source rows.
  if to_regclass('public.status_role_permissions') is not null then
    update public.status_role_permissions tgt
    set can_view = tgt.can_view and src.can_view,
        can_set = tgt.can_set and src.can_set
    from public.status_role_permissions src
    where src.workspace_id = p_workspace_id
      and src.status_id = p_from_status_id
      and tgt.status_id = p_to_status_id
      and tgt.role_id = src.role_id;

    insert into public.status_role_permissions (workspace_id, status_id, role_id, can_view, can_set)
    select src.workspace_id, p_to_status_id, src.role_id, src.can_view, src.can_set
    from public.status_role_permissions src
    where src.workspace_id = p_workspace_id
      and src.status_id = p_from_status_id
      and not exists (
        select 1 from public.status_role_permissions tgt
        where tgt.status_id = p_to_status_id
          and tgt.role_id = src.role_id
      )
    on conflict do nothing;

    delete from public.status_role_permissions src
    where src.workspace_id = p_workspace_id
      and src.status_id = p_from_status_id;
  end if;

  -- order_types: initial statuses (columns optional).
  if to_regclass('public.order_types') is not null then
    if exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.order_types'::regclass
        and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped
    ) then
      v_ot_touch := ', updated_at = now()';
    end if;

    foreach v_col in array array['initial_status_id', 'initial_estimate_status_id']
    loop
      if exists (
        select 1 from pg_catalog.pg_attribute a
        where a.attrelid = 'public.order_types'::regclass
          and a.attname = v_col and a.attnum > 0 and not a.attisdropped
      ) then
        execute format(
          'update public.order_types ot set %1$I = $1%2$s where ot.workspace_id = $2 and ot.%1$I = $3',
          v_col, v_ot_touch
        )
          using p_to_status_id, p_workspace_id, p_from_status_id;
      end if;
    end loop;
  end if;

  -- status_print_templates: PK (status_id, template_id, location_id).
  if to_regclass('public.status_print_templates') is not null
     and exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.status_print_templates'::regclass
         and a.attname = 'status_id' and a.attnum > 0 and not a.attisdropped
     ) then
    delete from public.status_print_templates s
    where s.workspace_id = p_workspace_id
      and s.status_id = p_from_status_id
      and exists (
        select 1 from public.status_print_templates s2
        where s2.status_id = p_to_status_id
          and s2.template_id = s.template_id
          and s2.location_id = s.location_id
      );

    update public.status_print_templates s
    set status_id = p_to_status_id
    where s.workspace_id = p_workspace_id
      and s.status_id = p_from_status_id;
  end if;

  -- notification_rules: nullable status_id, no uniqueness.
  if to_regclass('public.notification_rules') is not null
     and exists (
       select 1 from pg_catalog.pg_attribute a
       where a.attrelid = 'public.notification_rules'::regclass
         and a.attname = 'status_id' and a.attnum > 0 and not a.attisdropped
     ) then
    update public.notification_rules nr
    set status_id = p_to_status_id
    where nr.workspace_id = p_workspace_id
      and nr.status_id = p_from_status_id;
  end if;

  -- Orders: custom_status_id ONLY (status / closed_at untouched), per-order replace token.
  select coalesce(string_agg(format(', %I = now()', a.attname), '' order by a.attname), '')
    into v_touch
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname = 'updated_at'
    and a.attnum > 0 and not a.attisdropped;

  for v_order_id in
    select o.id
    from public.orders o
    where o.workspace_id = p_workspace_id
      and o.custom_status_id = p_from_status_id
    order by o.id
    for update of o
  loop
    insert into public.order_lifecycle_tokens (order_id, op, created_by)
    values (v_order_id, 'replace', v_uid)
    on conflict (order_id, op) do update
      set created_by = excluded.created_by, created_at = now();

    execute format(
      'update public.orders o set custom_status_id = $1%s where o.id = $2 and o.workspace_id = $3',
      v_touch
    )
      using p_to_status_id, v_order_id, p_workspace_id;

    delete from public.order_lifecycle_tokens
    where order_id = v_order_id and op = 'replace';

    v_moved := v_moved + 1;
  end loop;

  update public.status_definitions
  set
    is_active = false,
    is_default = false,
    semantic_action = 'normal',
    deleted_at = now(),
    updated_at = now()
  where id = p_from_status_id;

  if v_from.is_default and not v_to.is_default then
    update public.status_definitions
    set is_default = true, updated_at = now()
    where id = p_to_status_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'moved', v_moved,
    'from', p_from_status_id,
    'to', p_to_status_id,
    'default_moved', v_from.is_default and not v_to.is_default
  );
end;
$fn$;

revoke all on function public.replace_order_status(uuid, uuid, uuid) from public, anon;
grant execute on function public.replace_order_status(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) Default five statuses for EMPTY workspaces only
-- ---------------------------------------------------------------------------
create or replace function public.ensure_default_order_statuses(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if p_workspace_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_default_order_statuses'), hashtext(p_workspace_id::text));

  if exists (
    select 1
    from public.status_definitions d
    where d.workspace_id = p_workspace_id
      and d.entity = 'order'
      and d.deleted_at is null
  ) then
    return;
  end if;

  insert into public.status_definitions (
    workspace_id, entity, name, color, status_group, system_status,
    code, semantic_action, sort_order, is_default, is_active
  ) values
    (p_workspace_id, 'order', 'New',               '#2563EB', 'new',         'new',           'new',           'normal', 1, true,  true),
    (p_workspace_id, 'order', 'In Progress',       '#16A34A', 'in_progress', 'in-progress',   'in_progress',   'normal', 2, false, true),
    (p_workspace_id, 'order', 'Waiting for Parts', '#F59E0B', 'pending',     'waiting-parts', 'waiting_parts', 'normal', 3, false, true),
    (p_workspace_id, 'order', 'Closed',            '#737373', 'closed',      'closed',        'closed',        'close',  4, false, true),
    (p_workspace_id, 'order', 'Cancelled',         '#A3A3A3', 'dropped_off', 'cancelled',     'cancelled',     'cancel', 5, false, true);
end;
$fn$;

revoke all on function public.ensure_default_order_statuses(uuid) from public, anon, authenticated;
grant execute on function public.ensure_default_order_statuses(uuid) to service_role;

create or replace function public.workspaces_seed_order_statuses()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform public.ensure_default_order_statuses(new.id);
  return new;
end;
$fn$;

drop trigger if exists workspaces_seed_order_statuses_ai on public.workspaces;
create trigger workspaces_seed_order_statuses_ai
  after insert on public.workspaces
  for each row
  execute function public.workspaces_seed_order_statuses();

revoke all on function public.workspaces_seed_order_statuses() from public, anon, authenticated;

-- Backfill ONLY empty workspaces (existing nine-status workspaces are untouched).
do $backfill$
declare
  r record;
begin
  for r in
    select w.id
    from public.workspaces w
    where w.deleted_at is null
      and not exists (
        select 1 from public.status_definitions d
        where d.workspace_id = w.id and d.entity = 'order' and d.deleted_at is null
      )
    order by w.id
  loop
    perform public.ensure_default_order_statuses(r.id);
  end loop;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- 13) delete_order_with_payments
--     * Requires orders.delete.
--     * Blocks when any invoice links to the order.
--     * Outstanding issued materials: only for cancelled, never-closed orders;
--       returned per warehouse via return_order_materials_to_warehouse with a
--       deterministic idempotency key, then verified to zero.
--     * Deletes order payments (dependents first), then the order.
-- ---------------------------------------------------------------------------
create or replace function public.delete_order_with_payments(
  p_workspace_id uuid,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payment_count integer := 0;
  v_rowcount integer;
  v_has_om boolean := false;
  v_outstanding boolean := false;
  v_mismatch text;
  v_bad_wh text;
  v_key text;
  v_returned jsonb := '[]'::jsonb;
  r_wh record;
begin
  if v_uid is null then
    raise exception 'order_delete:not_authenticated' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_order_id is null then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  if not coalesce(public.crm_has_permission(p_workspace_id, 'orders.delete'), false) then
    raise exception 'order_delete:forbidden' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.order_id = p_order_id
  ) then
    raise exception 'order_delete:has_invoice' using errcode = '23514';
  end if;

  v_has_om := to_regclass('public.order_materials') is not null
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.order_materials')
        and a.attname = 'quantity_issued' and a.attnum > 0 and not a.attisdropped
    )
    and exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = to_regclass('public.order_materials')
        and a.attname = 'quantity_returned' and a.attnum > 0 and not a.attisdropped
    );

  if v_has_om then
    select exists (
      select 1
      from public.order_materials om
      where om.order_id = p_order_id
        and coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0) > 0
    ) into v_outstanding;
  end if;

  if v_outstanding then
    if v_order.status is distinct from 'cancelled' or v_order.closed_at is not null then
      raise exception 'order_delete:issued_materials_require_cancelled_order' using errcode = 'P0001';
    end if;

    if to_regprocedure('public.return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text)') is null then
      raise exception 'order_delete:return_rpc_missing — return_order_materials_to_warehouse(uuid,jsonb,uuid,text,text) is required to delete an order with issued materials'
        using errcode = 'P0001';
    end if;

    if to_regclass('public.inventory_movements') is null
       or not exists (
         select 1 from pg_catalog.pg_attribute a
         where a.attrelid = to_regclass('public.inventory_movements')
           and a.attname = 'warehouse_id' and a.attnum > 0 and not a.attisdropped
       ) then
      raise exception 'order_delete:inventory_ledger_missing — inventory_movements.warehouse_id is required to return issued materials'
        using errcode = 'P0001';
    end if;

    perform 1
    from public.order_materials om
    where om.order_id = p_order_id
    order by om.id
    for update of om;

    -- Ledger (issue − return per item) must equal line counters per item.
    select string_agg(
             format('item=%s ledger=%s lines=%s',
                    coalesce(l.item_id, c.item_id), coalesce(l.qty, 0), coalesce(c.qty, 0)),
             '; ')
      into v_mismatch
    from (
      select m.inventory_item_id as item_id,
             sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
      from public.inventory_movements m
      where m.workspace_id = p_workspace_id
        and m.order_id = p_order_id
        and m.movement_type in ('issue', 'return')
      group by m.inventory_item_id
    ) l
    full join (
      select om.inventory_item_id as item_id,
             sum(coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0)) as qty
      from public.order_materials om
      where om.order_id = p_order_id
      group by om.inventory_item_id
    ) c on c.item_id = l.item_id
    where coalesce(l.qty, 0) <> coalesce(c.qty, 0);

    if v_mismatch is not null then
      raise exception 'order_delete:materials_ledger_mismatch %', v_mismatch using errcode = 'P0001';
    end if;

    select string_agg(
             format('warehouse=%s item=%s qty=%s', coalesce(x.warehouse_id::text, 'NULL'), x.item_id, x.qty),
             '; ')
      into v_bad_wh
    from (
      select m.warehouse_id, m.inventory_item_id as item_id,
             sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
      from public.inventory_movements m
      where m.workspace_id = p_workspace_id
        and m.order_id = p_order_id
        and m.movement_type in ('issue', 'return')
      group by m.warehouse_id, m.inventory_item_id
    ) x
    where x.qty <> 0
      and (x.warehouse_id is null or x.qty < 0);

    if v_bad_wh is not null then
      raise exception 'order_delete:materials_warehouse_unresolved %', v_bad_wh using errcode = 'P0001';
    end if;

    for r_wh in
      select x.warehouse_id,
             jsonb_agg(
               jsonb_build_object('inventory_item_id', x.item_id, 'quantity', x.qty)
               order by x.item_id
             ) as lines
      from (
        select m.warehouse_id, m.inventory_item_id as item_id,
               sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) as qty
        from public.inventory_movements m
        where m.workspace_id = p_workspace_id
          and m.order_id = p_order_id
          and m.movement_type in ('issue', 'return')
        group by m.warehouse_id, m.inventory_item_id
        having sum(case when m.movement_type = 'issue' then m.quantity else -m.quantity end) > 0
      ) x
      group by x.warehouse_id
      order by x.warehouse_id
    loop
      v_key := 'order_delete:' || p_order_id::text || ':' || r_wh.warehouse_id::text;

      perform 1
      from public.return_order_materials_to_warehouse(
        p_order_id, r_wh.lines, r_wh.warehouse_id, 'order_deleted', v_key
      );

      v_returned := v_returned || jsonb_build_array(jsonb_build_object(
        'warehouse_id', r_wh.warehouse_id,
        'lines', r_wh.lines,
        'idempotency_key', v_key
      ));
    end loop;

    if exists (
      select 1
      from public.order_materials om
      where om.order_id = p_order_id
        and coalesce(om.quantity_issued, 0) - coalesce(om.quantity_returned, 0) > 0
    ) then
      raise exception 'order_delete:materials_outstanding_after_return' using errcode = 'P0001';
    end if;
  end if;

  select count(*)::integer into v_payment_count
  from public.payments p
  where p.workspace_id = p_workspace_id
    and p.order_id = p_order_id;

  -- related_payment_id may be ON DELETE RESTRICT: peel leaves (no dependents) until empty.
  loop
    delete from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
      and not exists (
        select 1 from public.payments c
        where c.related_payment_id = p.id
      );
    get diagnostics v_rowcount = row_count;
    exit when v_rowcount = 0;
  end loop;

  if exists (
    select 1 from public.payments p
    where p.workspace_id = p_workspace_id
      and p.order_id = p_order_id
  ) then
    raise exception 'order_delete:payments_referenced_elsewhere' using errcode = '23503';
  end if;

  delete from public.orders o
  where o.id = p_order_id
    and o.workspace_id = p_workspace_id;

  if not found then
    raise exception 'order_delete:not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payments_deleted', v_payment_count,
    'materials_returned', v_returned
  );
end;
$fn$;

comment on function public.delete_order_with_payments(uuid, uuid) is
  'managed-object: core-app/delete_order_with_payments@v2 — orders.delete; blocks invoices; returns outstanding issued materials (cancelled, never-closed orders only) per warehouse; deletes order payments then the order atomically.';

revoke all on function public.delete_order_with_payments(uuid, uuid) from public, anon;
grant execute on function public.delete_order_with_payments(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14) POST-APPLY ASSERTIONS
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_problems text := '';
  v_dup text;
  v_ws uuid;
  v_cnt integer;
  v_fn text;
  v_idx text;
  v_pk text[];
  v_ws_a uuid := '5ed7cd87-5c05-4433-b154-e77c0ae60e62';
  v_ws_b uuid := 'cdbf8d72-28d7-4b94-8b76-738108d4bed1';
  v_ids_a uuid[] := array[
    '7a79eccc-7013-4b09-9a45-428e4f8cd8da',
    '3353cfaa-1122-48ba-942f-1888809f4c4d',
    '6a79c44c-13a2-4d27-a91a-00031aac21ce'
  ]::uuid[];
  v_ids_b uuid[] := array[
    'e65d8579-a9ce-4580-b4b3-a15ea1791864',
    'dae8ae56-22c4-48d2-b34a-37bb683c9665',
    'b7abbd2c-5510-491f-8bed-24f654ce76d9'
  ]::uuid[];
begin
  -- Columns
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'status_definitions'
      and column_name = 'semantic_action' and is_nullable = 'NO'
  ) then
    v_problems := v_problems || 'semantic_action missing or nullable; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'status_definitions' and column_name = 'code'
  ) then
    v_problems := v_problems || 'code missing; ';
  end if;
  if exists (select 1 from public.status_definitions where semantic_action is null) then
    v_problems := v_problems || 'NULL semantic_action rows remain; ';
  end if;
  if exists (select 1 from public.status_definitions where deleted_at is null and code is null) then
    v_problems := v_problems || 'non-deleted rows with NULL code remain; ';
  end if;

  -- RPCs / functions
  foreach v_fn in array array[
    'public.order_ledger_remaining(uuid,uuid)',
    'public.order_lifecycle_guard()',
    'public.close_order_if_settled(uuid,uuid)',
    'public.cancel_order(uuid,uuid)',
    'public.set_order_lifecycle_semantic(uuid,uuid,text)',
    'public.replace_order_status(uuid,uuid,uuid)',
    'public.ensure_default_order_statuses(uuid)',
    'public.workspaces_seed_order_statuses()',
    'public.delete_order_with_payments(uuid,uuid)'
  ]
  loop
    if to_regprocedure(v_fn) is null then
      v_problems := v_problems || format('%s missing; ', v_fn);
    end if;
  end loop;

  -- Indexes
  foreach v_idx in array array[
    'status_definitions_code_uidx',
    'status_definitions_one_default_uidx',
    'status_definitions_one_close_uidx',
    'status_definitions_one_cancel_uidx'
  ]
  loop
    if to_regclass('public.' || v_idx) is null then
      v_problems := v_problems || format('index %s missing; ', v_idx);
    end if;
    if to_regclass('public.' || v_idx || '_defchk') is not null then
      v_problems := v_problems || format('leftover check index %s_defchk; ', v_idx);
    end if;
  end loop;

  -- Triggers
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'orders_lifecycle_guard_bu'
      and tgrelid = 'public.orders'::regclass
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    v_problems := v_problems || 'orders_lifecycle_guard_bu missing or disabled; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'crm_orders_status_event'
      and tgrelid = 'public.orders'::regclass
      and not tgisinternal
  ) then
    v_problems := v_problems || 'crm_orders_status_event missing after apply; ';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'workspaces_seed_order_statuses_ai'
      and tgrelid = 'public.workspaces'::regclass
      and not tgisinternal
  ) then
    v_problems := v_problems || 'workspaces_seed_order_statuses_ai missing; ';
  end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'orders_restore_materials_stock'
      and tgrelid = 'public.orders'::regclass
      and not tgisinternal
  ) then
    v_problems := v_problems || 'legacy orders_restore_materials_stock present (would double-restore stock on delete); ';
  end if;

  -- Guard must not contain a GUC bypass.
  if pg_get_functiondef(to_regprocedure('public.order_lifecycle_guard()')) like '%current_setting%' then
    v_problems := v_problems || 'order_lifecycle_guard still references current_setting (GUC bypass); ';
  end if;

  -- Tokens table shape + privileges
  select array_agg(a.attname::text order by a.attname::text) into v_pk
  from pg_catalog.pg_index i
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = 'public.order_lifecycle_tokens'::regclass and i.indisprimary;
  if v_pk is distinct from array['op', 'order_id'] then
    v_problems := v_problems || 'order_lifecycle_tokens PK must be (order_id, op); ';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.order_lifecycle_tokens'::regclass) then
    v_problems := v_problems || 'order_lifecycle_tokens RLS disabled; ';
  end if;
  if has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'insert')
     or has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'select')
     or has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'update')
     or has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'delete')
     or has_table_privilege('anon', 'public.order_lifecycle_tokens', 'insert') then
    v_problems := v_problems || 'order_lifecycle_tokens must not be accessible to authenticated/anon; ';
  end if;

  -- Function privileges
  if has_function_privilege('authenticated', 'public.order_ledger_remaining(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.order_ledger_remaining(uuid,uuid)', 'execute') then
    v_problems := v_problems || 'order_ledger_remaining must not be executable by authenticated/anon; ';
  end if;
  if has_function_privilege('authenticated', 'public.ensure_default_order_statuses(uuid)', 'execute') then
    v_problems := v_problems || 'ensure_default_order_statuses must not be executable by authenticated; ';
  end if;

  foreach v_fn in array array[
    'public.order_ledger_remaining(uuid,uuid)',
    'public.close_order_if_settled(uuid,uuid)',
    'public.cancel_order(uuid,uuid)',
    'public.set_order_lifecycle_semantic(uuid,uuid,text)',
    'public.replace_order_status(uuid,uuid,uuid)',
    'public.ensure_default_order_statuses(uuid)',
    'public.delete_order_with_payments(uuid,uuid)'
  ]
  loop
    if exists (
      select 1
      from pg_catalog.pg_proc p,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = to_regprocedure(v_fn)
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      v_problems := v_problems || format('%s is executable by PUBLIC; ', v_fn);
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      v_problems := v_problems || format('%s is executable by anon; ', v_fn);
    end if;
  end loop;

  foreach v_fn in array array[
    'public.close_order_if_settled(uuid,uuid)',
    'public.cancel_order(uuid,uuid)',
    'public.set_order_lifecycle_semantic(uuid,uuid,text)',
    'public.replace_order_status(uuid,uuid,uuid)',
    'public.delete_order_with_payments(uuid,uuid)'
  ]
  loop
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      v_problems := v_problems || format('%s must be executable by authenticated; ', v_fn);
    end if;
  end loop;

  -- No duplicate codes
  select string_agg(format('%s/%s/%s', workspace_id, entity, code), ', ')
    into v_dup
  from (
    select workspace_id, entity, code
    from public.status_definitions
    where deleted_at is null and code is not null
    group by workspace_id, entity, code
    having count(*) > 1
  ) x;
  if v_dup is not null then
    v_problems := v_problems || 'duplicate codes: ' || v_dup || '; ';
  end if;

  -- Known workspaces keep >= 9 order statuses.
  foreach v_ws in array array[v_ws_a, v_ws_b]
  loop
    if exists (select 1 from public.workspaces w where w.id = v_ws) then
      select count(*) into v_cnt
      from public.status_definitions d
      where d.workspace_id = v_ws and d.entity = 'order' and d.deleted_at is null;
      if v_cnt < 9 then
        v_problems := v_problems || format('workspace %s lost order statuses (count=%s); ', v_ws, v_cnt);
      end if;
    end if;
  end loop;

  -- Workspace A: each of the three competing in-progress rows MUST exist.
  if exists (select 1 from public.workspaces w where w.id = v_ws_a) then
    if not exists (
      select 1 from public.status_definitions d
      where d.id = '7a79eccc-7013-4b09-9a45-428e4f8cd8da'
        and d.workspace_id = v_ws_a and d.entity = 'order' and d.deleted_at is null
        and d.name = 'В работе' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status 7a79eccc (В работе / A); ';
    end if;
    if not exists (
      select 1 from public.status_definitions d
      where d.id = '3353cfaa-1122-48ba-942f-1888809f4c4d'
        and d.workspace_id = v_ws_a and d.entity = 'order' and d.deleted_at is null
        and d.name = 'На согласовании' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status 3353cfaa (На согласовании / A); ';
    end if;
    if not exists (
      select 1 from public.status_definitions d
      where d.id = '6a79c44c-13a2-4d27-a91a-00031aac21ce'
        and d.workspace_id = v_ws_a and d.entity = 'order' and d.deleted_at is null
        and d.name = 'Ждём ОПЛАТЫ' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status 6a79c44c (Ждём ОПЛАТЫ / A); ';
    end if;

    select count(distinct d.code) into v_cnt
    from public.status_definitions d
    where d.id = any (v_ids_a);
    if v_cnt <> 3 then
      v_problems := v_problems || 'workspace A in-progress trio must have 3 distinct codes; ';
    end if;
  end if;

  -- Workspace B: each of the three competing in-progress rows MUST exist.
  if exists (select 1 from public.workspaces w where w.id = v_ws_b) then
    if not exists (
      select 1 from public.status_definitions d
      where d.id = 'e65d8579-a9ce-4580-b4b3-a15ea1791864'
        and d.workspace_id = v_ws_b and d.entity = 'order' and d.deleted_at is null
        and d.name = 'В работе' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status e65d8579 (В работе / B); ';
    end if;
    if not exists (
      select 1 from public.status_definitions d
      where d.id = 'dae8ae56-22c4-48d2-b34a-37bb683c9665'
        and d.workspace_id = v_ws_b and d.entity = 'order' and d.deleted_at is null
        and d.name = 'На согласовании' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status dae8ae56 (На согласовании / B); ';
    end if;
    if not exists (
      select 1 from public.status_definitions d
      where d.id = 'b7abbd2c-5510-491f-8bed-24f654ce76d9'
        and d.workspace_id = v_ws_b and d.entity = 'order' and d.deleted_at is null
        and d.name = 'Ждём ОПЛАТЫ' and d.system_status = 'in-progress'
        and d.semantic_action = 'normal' and d.code is not null
    ) then
      v_problems := v_problems || 'missing preserved status b7abbd2c (Ждём ОПЛАТЫ / B); ';
    end if;

    select count(distinct d.code) into v_cnt
    from public.status_definitions d
    where d.id = any (v_ids_b);
    if v_cnt <> 3 then
      v_problems := v_problems || 'workspace B in-progress trio must have 3 distinct codes; ';
    end if;
  end if;

  if v_problems <> '' then
    raise exception 'POST-APPLY ASSERT FAILED: %', v_problems;
  end if;
end
$assert$;

-- ---------------------------------------------------------------------------
-- 15) PostgREST schema reload
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;

-- =============================================================================
-- ROLLBACK guidance (manual; after backup):
--   drop trigger if exists orders_lifecycle_guard_bu on public.orders;
--   drop function if exists public.order_lifecycle_guard();
--   drop function if exists public.close_order_if_settled(uuid, uuid);
--   drop function if exists public.cancel_order(uuid, uuid);
--   drop function if exists public.set_order_lifecycle_semantic(uuid, uuid, text);
--   drop function if exists public.replace_order_status(uuid, uuid, uuid);
--   drop trigger if exists workspaces_seed_order_statuses_ai on public.workspaces;
--   drop function if exists public.workspaces_seed_order_statuses();
--   drop function if exists public.ensure_default_order_statuses(uuid);
--   drop function if exists public.order_ledger_remaining(uuid, uuid);
--   drop table if exists public.order_lifecycle_tokens;
--   -- delete_order_with_payments: re-apply supabase/manual-sql/propose_delete_order_with_payments.sql (v1).
--   -- Prefer leaving code/semantic_action columns and indexes in place.
-- =============================================================================
--
-- READ-ONLY VERIFICATION (run separately after APPLY — not part of APPLY):
--
-- -- 1) Both workspaces still have >= 9 order statuses; codes unique; close/cancel counts
-- select workspace_id, count(*) as status_count,
--        count(distinct code) as distinct_codes,
--        count(*) filter (where semantic_action = 'close') as close_n,
--        count(*) filter (where semantic_action = 'cancel') as cancel_n,
--        count(*) filter (where is_default and is_active) as default_n
-- from public.status_definitions
-- where entity = 'order' and deleted_at is null
--   and workspace_id in (
--     '5ed7cd87-5c05-4433-b154-e77c0ae60e62',
--     'cdbf8d72-28d7-4b94-8b76-738108d4bed1'
--   )
-- group by workspace_id;
--
-- -- 2) Duplicate-code probe (must return 0 rows)
-- select workspace_id, entity, code, count(*),
--        array_agg(id order by id) as ids,
--        array_agg(name order by id) as names
-- from public.status_definitions
-- where deleted_at is null and code is not null
-- group by 1, 2, 3 having count(*) > 1;
--
-- -- 3) Six preserved in-progress competitors: same UUIDs, distinct codes, semantic normal
-- select id, workspace_id, name, system_status, code, semantic_action, sort_order, is_default, is_active, deleted_at
-- from public.status_definitions
-- where id in (
--   '7a79eccc-7013-4b09-9a45-428e4f8cd8da',
--   '3353cfaa-1122-48ba-942f-1888809f4c4d',
--   '6a79c44c-13a2-4d27-a91a-00031aac21ce',
--   'e65d8579-a9ce-4580-b4b3-a15ea1791864',
--   'dae8ae56-22c4-48d2-b34a-37bb683c9665',
--   'b7abbd2c-5510-491f-8bed-24f654ce76d9'
-- )
-- order by workspace_id, sort_order, name;
--
-- -- 4) Index definitions
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'status_definitions'
--   and indexname like 'status_definitions_%_uidx';
--
-- -- 5) RPCs: security definer + search_path + grants
-- select p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'close_order_if_settled', 'cancel_order', 'set_order_lifecycle_semantic',
--   'replace_order_status', 'order_ledger_remaining', 'order_lifecycle_guard',
--   'ensure_default_order_statuses', 'workspaces_seed_order_statuses',
--   'delete_order_with_payments'
-- )
-- order by p.proname;
--
-- -- 6) Triggers on orders / workspaces
-- select tgrelid::regclass, tgname, tgenabled
-- from pg_trigger
-- where not tgisinternal
--   and tgname in ('orders_lifecycle_guard_bu', 'crm_orders_status_event', 'workspaces_seed_order_statuses_ai');
--
-- -- 7) Tokens table: PK + privileges (all false expected) + empty
-- select has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'insert') as auth_insert,
--        has_table_privilege('authenticated', 'public.order_lifecycle_tokens', 'select') as auth_select,
--        has_function_privilege('authenticated', 'public.order_ledger_remaining(uuid,uuid)', 'execute') as auth_ledger_exec,
--        (select count(*) from public.order_lifecycle_tokens) as leftover_tokens;
--
-- -- 8) Formally closed orders still consistent (closed_at set ⇒ status closed)
-- select id, workspace_id, status, closed_at, custom_status_id
-- from public.orders
-- where closed_at is not null and status is distinct from 'closed'
-- limit 50;
-- =============================================================================
