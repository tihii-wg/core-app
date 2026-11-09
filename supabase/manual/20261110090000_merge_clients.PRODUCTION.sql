-- =============================================================================
-- Merge clients (crm_merge_clients / crm_merge_clients_preview)
-- Script: 20261110090000_merge_clients.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Prerequisites: clients.deleted_at, orders_closed_content_guard@v2,
--                activity_log, is_workspace_member / crm_is_workspace_member.
-- =============================================================================
-- Adds clients.merged_into_client_id, bumps orders_closed_content_guard to v3
-- with a narrow transaction-local bypass (GUC crm.client_merge=on) that only
-- allows client_id / payer_client_id (+ updated_at) changes on closed orders.
-- Extends crm_guard_receipt_header_immutable so supplier_client_id remaps are
-- allowed under the same GUC.
--
-- Explicit FK edges remapped (also discovered dynamically from pg_constraint):
--   orders.client_id, orders.payer_client_id,
--   vehicles.client_id (composite vehicles_client_workspace_fk),
--   invoices.client_id, invoices.payer_client_id,
--   client_phones / client_addresses / client_discounts / client_balance_entries,
--   warranty_records.client_id,
--   estimates / sales / client_returns / credit_notes / finance_transactions /
--   payment_links / goods_receipts.supplier_client_id / stock_batches /
--   purchase_orders / supplier_returns / inventory_items.supplier_client_id /
--   tasks / leads / bookings / calls / conversations / reviews / message_log,
--   clients.organization_id (self-FK).
-- Unique collision handled: client_discounts (client_id, target) — keep target row.
-- Unhandled unique on a client FK column → raise (fail closed).
-- =============================================================================

begin;

do $preflight$
declare
  v_problems text := '';
  v_fk_count int;
begin
  if to_regclass('public.clients') is null then
    v_problems := v_problems || 'public.clients missing; ';
  end if;
  if to_regprocedure('public.orders_closed_content_guard()') is null then
    v_problems := v_problems || 'orders_closed_content_guard missing; ';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'deleted_at'
  ) then
    v_problems := v_problems || 'clients.deleted_at missing; ';
  end if;
  if to_regclass('public.activity_log') is null then
    v_problems := v_problems || 'activity_log missing; ';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    v_problems := v_problems || 'is_workspace_member(uuid) missing; ';
  end if;

  select count(*) into v_fk_count
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where c.contype = 'f'
    and n.nspname = 'public'
    and c.confrelid = 'public.clients'::regclass;

  if v_fk_count < 1 then
    v_problems := v_problems || 'no FKs to public.clients found; ';
  end if;

  -- Expected core FKs (loud if missing so we notice schema drift)
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_client_id_fkey' and confrelid = 'public.clients'::regclass
  ) then
    v_problems := v_problems || 'orders_client_id_fkey missing; ';
  end if;

  if v_problems <> '' then
    raise exception 'merge_clients preflight failed: %', v_problems;
  end if;

  raise notice 'merge_clients preflight: % FK edge(s) into public.clients', v_fk_count;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- Column: redirect soft-deleted sources to the survivor
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists merged_into_client_id uuid;

do $fk_col$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_merged_into_client_id_fkey'
  ) then
    alter table public.clients
      add constraint clients_merged_into_client_id_fkey
      foreign key (merged_into_client_id) references public.clients(id)
      on delete set null;
  end if;
end;
$fk_col$;

create index if not exists clients_merged_into_client_id_idx
  on public.clients (merged_into_client_id)
  where merged_into_client_id is not null;

comment on column public.clients.merged_into_client_id is
  'When set, this soft-deleted client was merged into the referenced survivor. Detail views should redirect.';

-- ---------------------------------------------------------------------------
-- Closed-order content guard @v3 — narrow client-merge bypass
-- ---------------------------------------------------------------------------
create or replace function public.orders_closed_content_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_allowed text[] := array['status', 'custom_status_id', 'closed_at', 'updated_at', 'status_changed_at'];
  v_merge_extra text[] := array['client_id', 'payer_client_id'];
  v_cols text[];
begin
  if old.closed_at is null then
    return new;
  end if;

  if coalesce(public.crm_owner_may_manage_closed_orders(new.workspace_id), false) then
    return new;
  end if;

  -- Closed-then-cancelled: actual owner may edit business fields on THIS order.
  if new.status is not distinct from 'cancelled'
     and coalesce(public.crm_owner_may_edit_cancelled_order(new.id), false) then
    return new;
  end if;

  -- Transaction-local client merge: only client FK (+ lifecycle allowlist) may change.
  if coalesce(current_setting('crm.client_merge', true), '') = 'on' then
    v_cols := v_allowed || v_merge_extra;
    if (to_jsonb(new) - v_cols) is distinct from (to_jsonb(old) - v_cols) then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
    raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

comment on function public.orders_closed_content_guard() is
  'managed-object: core-app/orders_closed_content_guard@v3 — closed content mutable for manage-closed OR cancelled+owner OR crm.client_merge=on (client_id/payer_client_id only).';

-- ---------------------------------------------------------------------------
-- Posted goods-receipt header: allow supplier_client_id remaps during merge
-- ---------------------------------------------------------------------------
create or replace function public.crm_guard_receipt_header_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if (select auth.uid()) is null
     or coalesce(current_setting('crm.warehouse_posting', true), '') = 'on'
     or coalesce(current_setting('crm.client_merge', true), '') = 'on' then
    return new;
  end if;
  if old.status is distinct from 'posted' then
    return new;
  end if;
  if new.workspace_id is distinct from old.workspace_id
     or new.warehouse_id is distinct from old.warehouse_id
     or new.supplier_client_id is distinct from old.supplier_client_id
     or new.received_at is distinct from old.received_at
     or new.total is distinct from old.total
     or new.status is distinct from old.status
     or (to_jsonb(new) ? 'finance_transaction_id' and (to_jsonb(new)->>'finance_transaction_id') is distinct from (to_jsonb(old)->>'finance_transaction_id'))
     or (to_jsonb(new) ? 'paid_from_account_id' and (to_jsonb(new)->>'paid_from_account_id') is distinct from (to_jsonb(old)->>'paid_from_account_id'))
  then
    raise exception 'Posted goods receipt header fields are immutable' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

comment on function public.crm_guard_receipt_header_immutable() is
  'managed-object: core-app/crm_guard_receipt_header_immutable@v2 — posted header immutable unless warehouse_posting or client_merge GUC.';

-- ---------------------------------------------------------------------------
-- Permission helper: same bar as soft-delete (workspace member who can update)
-- ---------------------------------------------------------------------------
create or replace function public.crm_can_merge_clients(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce(public.is_workspace_member(p_workspace_id), false);
$fn$;

revoke all on function public.crm_can_merge_clients(uuid) from public, anon;
grant execute on function public.crm_can_merge_clients(uuid) to authenticated, service_role;

comment on function public.crm_can_merge_clients(uuid) is
  'managed-object: core-app/crm_can_merge_clients@v1 — workspace member check (same bar as clients UPDATE / soft-delete).';

-- ---------------------------------------------------------------------------
-- Preview (read-only counts)
-- ---------------------------------------------------------------------------
create or replace function public.crm_merge_clients_preview(
  p_workspace_id uuid,
  p_target_client_id uuid,
  p_source_client_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_sources uuid[];
  v_row record;
  v_counts jsonb := '{}'::jsonb;
  v_sql text;
  v_n bigint;
  v_open_orders bigint := 0;
  v_closed_orders bigint := 0;
  v_notes jsonb := '[]'::jsonb;
  v_src record;
begin
  if p_workspace_id is null or p_target_client_id is null then
    raise exception 'merge_clients:invalid_args' using errcode = '22023';
  end if;
  if not public.crm_can_merge_clients(p_workspace_id) then
    raise exception 'merge_clients:forbidden' using errcode = '42501';
  end if;

  v_sources := array(
    select distinct x
    from unnest(coalesce(p_source_client_ids, array[]::uuid[])) as x
    where x is not null and x is distinct from p_target_client_id
  );
  if coalesce(cardinality(v_sources), 0) < 1 then
    raise exception 'merge_clients:sources_required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = p_target_client_id
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
  ) then
    raise exception 'merge_clients:target_not_found' using errcode = 'P0002';
  end if;

  if (
    select count(*) from public.clients c
    where c.id = any(v_sources)
      and c.workspace_id = p_workspace_id
      and c.deleted_at is null
  ) <> cardinality(v_sources) then
    raise exception 'merge_clients:source_not_found' using errcode = 'P0002';
  end if;

  for v_row in
    select
      n.nspname as schema_name,
      rel.relname as table_name,
      a.attname as column_name
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join lateral unnest(c.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confrelid = 'public.clients'::regclass
      and rel.relkind = 'r'
      and not (rel.relname = 'clients' and a.attname = 'merged_into_client_id')
      -- Only columns that map onto clients.id (skip e.g. workspace_id in composite FKs)
      and c.confkey[ck.ord] = (
        select att.attnum from pg_attribute att
        where att.attrelid = 'public.clients'::regclass and att.attname = 'id'
      )
    order by rel.relname, a.attname
  loop
    v_sql := format(
      'select count(*) from %I.%I where %I = any($1)',
      v_row.schema_name, v_row.table_name, v_row.column_name
    );
    execute v_sql into v_n using v_sources;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object(
        v_row.table_name || '.' || v_row.column_name, v_n
      );
    end if;
  end loop;

  select count(*) into v_open_orders
  from public.orders o
  where o.client_id = any(v_sources)
    and o.closed_at is null;

  select count(*) into v_closed_orders
  from public.orders o
  where o.client_id = any(v_sources)
    and o.closed_at is not null;

  for v_src in
    select c.id, c.name, c.phone, c.email
    from public.clients c
    where c.id = any(v_sources)
    order by c.name
  loop
    v_notes := v_notes || jsonb_build_array(jsonb_build_object(
      'id', v_src.id,
      'name', v_src.name,
      'phone', nullif(trim(coalesce(v_src.phone, '')), ''),
      'email', nullif(trim(coalesce(v_src.email, '')), '')
    ));
  end loop;

  return jsonb_build_object(
    'counts', v_counts,
    'ordersOpen', v_open_orders,
    'ordersClosed', v_closed_orders,
    'sourceNotes', v_notes,
    'orders', coalesce((v_counts->>'orders.client_id')::bigint, 0),
    'vehicles', coalesce((v_counts->>'vehicles.client_id')::bigint, 0),
    'invoices', coalesce((v_counts->>'invoices.client_id')::bigint, 0)
      + coalesce((v_counts->>'invoices.payer_client_id')::bigint, 0),
    'payments', 0
  );
end;
$fn$;

revoke all on function public.crm_merge_clients_preview(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.crm_merge_clients_preview(uuid, uuid, uuid[]) to authenticated, service_role;

comment on function public.crm_merge_clients_preview(uuid, uuid, uuid[]) is
  'managed-object: core-app/crm_merge_clients_preview@v1 — read-only merge impact counts.';

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------
create or replace function public.crm_merge_clients(
  p_workspace_id uuid,
  p_target_client_id uuid,
  p_source_client_ids uuid[],
  p_new_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_sources uuid[];
  v_name text;
  v_target public.clients%rowtype;
  v_src public.clients%rowtype;
  v_row record;
  v_uq record;
  v_sql text;
  v_note_lines text := '';
  v_balance numeric := 0;
  v_uid uuid := auth.uid();
  v_locked int;
begin
  if p_workspace_id is null or p_target_client_id is null then
    raise exception 'merge_clients:invalid_args' using errcode = '22023';
  end if;
  v_name := nullif(trim(coalesce(p_new_name, '')), '');
  if v_name is null then
    raise exception 'merge_clients:name_required' using errcode = '22023';
  end if;
  if not public.crm_can_merge_clients(p_workspace_id) then
    raise exception 'merge_clients:forbidden' using errcode = '42501';
  end if;

  v_sources := array(
    select distinct x
    from unnest(coalesce(p_source_client_ids, array[]::uuid[])) as x
    where x is not null and x is distinct from p_target_client_id
  );
  if coalesce(cardinality(v_sources), 0) < 1 then
    raise exception 'merge_clients:sources_required' using errcode = '22023';
  end if;

  -- Fail closed on unhandled UNIQUE constraints that include a clients FK column
  -- (other than client_discounts which we resolve explicitly).
  for v_uq in
    select
      n.nspname as schema_name,
      rel.relname as table_name,
      c.conname as constraint_name,
      array_agg(a.attname order by ck.ord) as columns
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join lateral unnest(c.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
    where c.contype = 'u'
      and n.nspname = 'public'
      and exists (
        select 1
        from pg_constraint fk
        join lateral unnest(fk.conkey) as fkatt(attnum) on true
        where fk.conrelid = c.conrelid
          and fk.contype = 'f'
          and fk.confrelid = 'public.clients'::regclass
          and fkatt.attnum = any (c.conkey)
      )
    group by n.nspname, rel.relname, c.conname
  loop
    if v_uq.table_name = 'client_discounts'
       and v_uq.constraint_name = 'client_discounts_client_id_target_key' then
      continue;
    end if;
    if v_uq.table_name = 'clients' and v_uq.constraint_name like '%id_workspace%' then
      continue;
    end if;
    raise exception 'merge_clients:unhandled_unique:%', v_uq.constraint_name
      using errcode = '0A000';
  end loop;

  -- Lock all involved client rows
  select * into v_target
  from public.clients c
  where c.id = p_target_client_id
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for update;
  if not found then
    raise exception 'merge_clients:target_not_found' using errcode = 'P0002';
  end if;

  -- FOR UPDATE cannot be combined with count(*): lock first, then count.
  perform 1
  from public.clients c
  where c.id = any(v_sources)
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null
  for update;
  select count(*) into v_locked
  from public.clients c
  where c.id = any(v_sources)
    and c.workspace_id = p_workspace_id
    and c.deleted_at is null;
  if v_locked <> cardinality(v_sources) then
    raise exception 'merge_clients:source_not_found' using errcode = 'P0002';
  end if;

  perform set_config('crm.client_merge', 'on', true);

  -- Resolve client_discounts UNIQUE (client_id, target): keep target row, drop source dupes
  if to_regclass('public.client_discounts') is not null then
    delete from public.client_discounts d
    where d.client_id = any(v_sources)
      and exists (
        select 1 from public.client_discounts t
        where t.client_id = p_target_client_id
          and t.target is not distinct from d.target
      );
  end if;

  -- Re-point every FK column referencing clients(id)
  for v_row in
    select
      n.nspname as schema_name,
      rel.relname as table_name,
      a.attname as column_name,
      c.conname as constraint_name
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join lateral unnest(c.conkey) with ordinality as ck(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.attnum
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confrelid = 'public.clients'::regclass
      and rel.relkind = 'r'
      -- Only columns that map onto clients.id (skip e.g. workspace_id in composite FKs)
      and c.confkey[ck.ord] = (
        select att.attnum from pg_attribute att
        where att.attrelid = 'public.clients'::regclass and att.attname = 'id'
      )
    order by
      case when rel.relname = 'orders' then 0 else 1 end,
      rel.relname,
      a.attname
  loop
    -- Open invoices/orders: also refresh denormalized client_name when present
    if v_row.table_name = 'invoices' and v_row.column_name = 'client_id'
       and exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'invoices' and column_name = 'client_name'
       ) then
      -- Closed/historical invoices: leave client_name; open ones get the new name
      execute format(
        'update public.invoices
            set client_id = $1,
                client_name = case
                  when coalesce(status, '''') in (''paid'', ''cancelled'', ''erroneous'') then client_name
                  else $2
                end,
                updated_at = now()
          where client_id = any($3)'
      ) using p_target_client_id, v_name, v_sources;
    elsif v_row.table_name = 'clients' and v_row.column_name = 'organization_id' then
      execute format(
        'update public.clients set organization_id = $1 where organization_id = any($2) and id <> $1'
      ) using p_target_client_id, v_sources;
    else
      v_sql := format(
        'update %I.%I set %I = $1 where %I = any($2)',
        v_row.schema_name, v_row.table_name, v_row.column_name, v_row.column_name
      );
      execute v_sql using p_target_client_id, v_sources;
    end if;
  end loop;

  -- Build notes + fill empty fields from sources (most-orders first already chosen by UI)
  v_balance := coalesce(v_target.balance, 0);
  for v_src in
    select * from public.clients c where c.id = any(v_sources) order by c.created_at
  loop
    v_balance := v_balance + coalesce(v_src.balance, 0);
    v_note_lines := v_note_lines || E'\n'
      || 'Объединён с: ' || coalesce(nullif(trim(v_src.name), ''), v_src.id::text)
      || case when nullif(trim(coalesce(v_src.phone, '')), '') is not null then ', ' || trim(v_src.phone) else '' end
      || case when nullif(trim(coalesce(v_src.email, '')), '') is not null then ', ' || trim(v_src.email) else '' end;

    if nullif(trim(coalesce(v_target.phone, '')), '') is null
       and nullif(trim(coalesce(v_src.phone, '')), '') is not null then
      v_target.phone := v_src.phone;
    end if;
    if nullif(trim(coalesce(v_target.email, '')), '') is null
       and nullif(trim(coalesce(v_src.email, '')), '') is not null then
      v_target.email := v_src.email;
    end if;
    if nullif(trim(coalesce(v_target.address, '')), '') is null
       and nullif(trim(coalesce(v_src.address, '')), '') is not null then
      v_target.address := v_src.address;
    end if;
    if nullif(trim(coalesce(v_target.tax_id, '')), '') is null
       and nullif(trim(coalesce(v_src.tax_id, '')), '') is not null then
      v_target.tax_id := v_src.tax_id;
    end if;
    if nullif(trim(coalesce(v_target.contact_person, '')), '') is null
       and nullif(trim(coalesce(v_src.contact_person, '')), '') is not null then
      v_target.contact_person := v_src.contact_person;
    end if;
  end loop;

  -- Soft-delete sources BEFORE updating the target: the workspace duplicate
  -- phone/email trigger ignores deleted rows, so copying a source phone/email
  -- onto the target must happen after the sources are gone.
  update public.clients
  set
    deleted_at = now(),
    merged_into_client_id = p_target_client_id,
    updated_at = now()
  where id = any(v_sources);

  update public.clients
  set
    name = v_name,
    phone = v_target.phone,
    email = v_target.email,
    address = v_target.address,
    tax_id = v_target.tax_id,
    contact_person = v_target.contact_person,
    balance = v_balance,
    notes = trim(both E'\n' from coalesce(v_target.notes, '') || coalesce(v_note_lines, '')),
    updated_at = now()
  where id = p_target_client_id;

  insert into public.activity_log (
    workspace_id, actor_user_id, actor_name, entity_type, entity_id, event, details
  ) values (
    p_workspace_id,
    v_uid,
    null,
    'client',
    p_target_client_id,
    'clients_merged',
    jsonb_build_object(
      'targetClientId', p_target_client_id,
      'sourceClientIds', to_jsonb(v_sources),
      'newName', v_name
    )
  );

  return p_target_client_id;
end;
$fn$;

revoke all on function public.crm_merge_clients(uuid, uuid, uuid[], text) from public, anon;
grant execute on function public.crm_merge_clients(uuid, uuid, uuid[], text) to authenticated, service_role;

comment on function public.crm_merge_clients(uuid, uuid, uuid[], text) is
  'managed-object: core-app/crm_merge_clients@v1 — merge source clients into target; soft-deletes sources with merged_into_client_id.';

do $postflight$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'merged_into_client_id'
  ) then
    raise exception 'merge_clients postflight: merged_into_client_id missing';
  end if;

  select pg_get_functiondef('public.orders_closed_content_guard()'::regprocedure) into v_def;
  if position('crm.client_merge' in v_def) = 0 then
    raise exception 'merge_clients postflight: orders_closed_content_guard v3 not installed';
  end if;

  if to_regprocedure('public.crm_merge_clients(uuid,uuid,uuid[],text)') is null then
    raise exception 'merge_clients postflight: crm_merge_clients missing';
  end if;
  if to_regprocedure('public.crm_merge_clients_preview(uuid,uuid,uuid[])') is null then
    raise exception 'merge_clients postflight: crm_merge_clients_preview missing';
  end if;
end;
$postflight$;

commit;
