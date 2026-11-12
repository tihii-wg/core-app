-- =============================================================================
-- Per-order line comments (service / material) with workspace visibility
-- Script: 20261112220000_order_line_comments.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- =============================================================================
-- 1) workspaces.line_comments_visibility ('private'|'public', default private)
-- 2) public.order_line_comments — one comment per service or material line
-- 3) RLS SELECT via crm_line_comments_visible; writes only via RPC
-- 4) public.crm_set_order_line_comment(...) upsert / delete
-- One DO block (SQL editor may split statements). Ends with notify pgrst.
-- =============================================================================

do $order_line_comments$
declare
  v_os_id_type text;
  v_om_id_type text;
  v_orders_id_type text;
begin
  if to_regclass('public.workspaces') is null then
    raise exception 'order_line_comments preflight: public.workspaces missing';
  end if;
  if to_regclass('public.orders') is null then
    raise exception 'order_line_comments preflight: public.orders missing';
  end if;
  if to_regclass('public.order_services') is null then
    raise exception 'order_line_comments preflight: public.order_services missing';
  end if;
  if to_regclass('public.order_materials') is null then
    raise exception 'order_line_comments preflight: public.order_materials missing';
  end if;
  if to_regprocedure('public.is_workspace_member(uuid)') is null then
    raise exception 'order_line_comments preflight: is_workspace_member(uuid) missing';
  end if;
  if to_regprocedure('public.crm_is_workspace_owner_id(uuid)') is null then
    raise exception 'order_line_comments preflight: crm_is_workspace_owner_id(uuid) missing';
  end if;
  if to_regprocedure('public.crm_owner_may_manage_closed_orders(uuid)') is null then
    raise exception 'order_line_comments preflight: crm_owner_may_manage_closed_orders(uuid) missing';
  end if;

  select format_type(a.atttypid, a.atttypmod) into v_orders_id_type
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into v_os_id_type
  from pg_attribute a
  where a.attrelid = 'public.order_services'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into v_om_id_type
  from pg_attribute a
  where a.attrelid = 'public.order_materials'::regclass and a.attname = 'id' and not a.attisdropped;

  if v_orders_id_type is distinct from 'uuid'
     or v_os_id_type is distinct from 'uuid'
     or v_om_id_type is distinct from 'uuid' then
    raise exception 'order_line_comments preflight: expected uuid PKs (orders=%, order_services=%, order_materials=%)',
      v_orders_id_type, v_os_id_type, v_om_id_type;
  end if;

  -- Workspace visibility setting. Added WITH its default: Postgres fills existing rows without firing row
  -- triggers (no mass UPDATE over workspaces). Only a column left by an earlier partial run is normalized.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'workspaces' and column_name = 'line_comments_visibility'
  ) then
    alter table public.workspaces
      add column line_comments_visibility text not null default 'private';
  else
    if exists (
      select 1 from public.workspaces
       where line_comments_visibility is null
          or lower(btrim(line_comments_visibility)) not in ('private', 'public')
    ) then
      update public.workspaces
         set line_comments_visibility = 'private'
       where line_comments_visibility is null
          or lower(btrim(line_comments_visibility)) not in ('private', 'public');
    end if;
    alter table public.workspaces alter column line_comments_visibility set default 'private';
    alter table public.workspaces alter column line_comments_visibility set not null;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'workspaces_line_comments_visibility_check'
       and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces
      add constraint workspaces_line_comments_visibility_check
      check (line_comments_visibility in ('private', 'public'));
  end if;

  comment on column public.workspaces.line_comments_visibility is
    'private = owner-only in order card; public = members see and print includes comments';

  -- Comment table
  create table if not exists public.order_line_comments (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    order_id uuid not null references public.orders(id) on delete cascade,
    order_service_id uuid null references public.order_services(id) on delete cascade,
    order_material_id uuid null references public.order_materials(id) on delete cascade,
    body text not null,
    created_by uuid default auth.uid(),
    updated_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint order_line_comments_body_len check (char_length(btrim(body)) between 1 and 500),
    constraint order_line_comments_one_line check (num_nonnulls(order_service_id, order_material_id) = 1),
    constraint order_line_comments_service_unique unique (order_service_id),
    constraint order_line_comments_material_unique unique (order_material_id)
  );

  create index if not exists order_line_comments_workspace_order_idx
    on public.order_line_comments (workspace_id, order_id);

  comment on table public.order_line_comments is
    'Per-order comment on one service or material line. Not copied to catalog or invoices.';

  -- Visibility helper
  create or replace function public.crm_line_comments_visible(p_ws uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public
  as $fn$
  declare
    v_vis text;
  begin
    if p_ws is null then
      return false;
    end if;
    if not public.is_workspace_member(p_ws) then
      return false;
    end if;
    select w.line_comments_visibility into v_vis
    from public.workspaces w
    where w.id = p_ws;
    if v_vis is null then
      return false;
    end if;
    if lower(btrim(v_vis)) = 'public' then
      return true;
    end if;
    return public.crm_is_workspace_owner_id(p_ws);
  end;
  $fn$;

  revoke all on function public.crm_line_comments_visible(uuid) from public, anon;
  grant execute on function public.crm_line_comments_visible(uuid) to authenticated;

  alter table public.order_line_comments enable row level security;

  drop policy if exists order_line_comments_select on public.order_line_comments;
  create policy order_line_comments_select
    on public.order_line_comments
    for select
    to authenticated
    using (public.crm_line_comments_visible(workspace_id));

  revoke all on table public.order_line_comments from public, anon, authenticated;
  grant select on table public.order_line_comments to authenticated;
  grant select, insert, update, delete on table public.order_line_comments to service_role;

  -- Write RPC
  create or replace function public.crm_set_order_line_comment(
    p_order_id uuid,
    p_line_kind text,
    p_line_id uuid,
    p_body text
  )
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare
    v_uid uuid := auth.uid();
    v_order public.orders%rowtype;
    v_kind text;
    v_body text;
    v_id uuid;
    v_exists boolean;
  begin
    if v_uid is null then
      raise exception 'set_order_line_comment:not_authenticated' using errcode = '42501';
    end if;
    if p_order_id is null or p_line_id is null then
      raise exception 'set_order_line_comment:invalid_args' using errcode = '22023';
    end if;

    v_kind := lower(btrim(coalesce(p_line_kind, '')));
    if v_kind not in ('service', 'material') then
      raise exception 'set_order_line_comment:invalid_kind' using errcode = '22023';
    end if;

    select * into v_order from public.orders o where o.id = p_order_id for update;
    if not found then
      raise exception 'set_order_line_comment:order_not_found' using errcode = 'P0002';
    end if;

    if not public.crm_line_comments_visible(v_order.workspace_id) then
      raise exception 'set_order_line_comment:forbidden' using errcode = '42501';
    end if;

    if (v_order.closed_at is not null or v_order.status = 'closed' or v_order.status = 'cancelled')
       and not coalesce(public.crm_owner_may_manage_closed_orders(v_order.workspace_id), false) then
      raise exception 'order_lifecycle:closed_order_immutable' using errcode = '42501';
    end if;

    if v_kind = 'service' then
      select exists (
        select 1 from public.order_services s
         where s.id = p_line_id and s.order_id = p_order_id
      ) into v_exists;
    else
      select exists (
        select 1 from public.order_materials m
         where m.id = p_line_id and m.order_id = p_order_id
      ) into v_exists;
    end if;
    if not v_exists then
      raise exception 'set_order_line_comment:line_not_found' using errcode = 'P0002';
    end if;

    v_body := nullif(btrim(coalesce(p_body, '')), '');

    if v_body is null then
      if v_kind = 'service' then
        delete from public.order_line_comments
         where order_id = p_order_id and order_service_id = p_line_id;
      else
        delete from public.order_line_comments
         where order_id = p_order_id and order_material_id = p_line_id;
      end if;
      return jsonb_build_object('deleted', true, 'line_kind', v_kind, 'line_id', p_line_id);
    end if;

    if char_length(v_body) > 500 then
      raise exception 'set_order_line_comment:body_too_long' using errcode = '22023';
    end if;

    if v_kind = 'service' then
      insert into public.order_line_comments as c (
        workspace_id, order_id, order_service_id, body, created_by, updated_by
      ) values (
        v_order.workspace_id, p_order_id, p_line_id, v_body, v_uid, v_uid
      )
      on conflict (order_service_id) do update
        set body = excluded.body,
            updated_by = v_uid,
            updated_at = now()
      returning c.id into v_id;
    else
      insert into public.order_line_comments as c (
        workspace_id, order_id, order_material_id, body, created_by, updated_by
      ) values (
        v_order.workspace_id, p_order_id, p_line_id, v_body, v_uid, v_uid
      )
      on conflict (order_material_id) do update
        set body = excluded.body,
            updated_by = v_uid,
            updated_at = now()
      returning c.id into v_id;
    end if;

    return jsonb_build_object(
      'id', v_id,
      'line_kind', v_kind,
      'line_id', p_line_id,
      'body', v_body
    );
  end;
  $fn$;

  revoke all on function public.crm_set_order_line_comment(uuid, text, uuid, text) from public, anon;
  grant execute on function public.crm_set_order_line_comment(uuid, text, uuid, text) to authenticated;

  -- Postflight
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'workspaces'
       and column_name = 'line_comments_visibility'
  ) then
    raise exception 'order_line_comments postflight: line_comments_visibility missing';
  end if;
  if to_regclass('public.order_line_comments') is null then
    raise exception 'order_line_comments postflight: order_line_comments missing';
  end if;
  if to_regprocedure('public.crm_line_comments_visible(uuid)') is null then
    raise exception 'order_line_comments postflight: crm_line_comments_visible missing';
  end if;
  if to_regprocedure('public.crm_set_order_line_comment(uuid,text,uuid,text)') is null then
    raise exception 'order_line_comments postflight: crm_set_order_line_comment missing';
  end if;

  notify pgrst, 'reload schema';
end;
$order_line_comments$;
