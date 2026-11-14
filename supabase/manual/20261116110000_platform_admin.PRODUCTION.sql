-- =============================================================================
-- Platform-owner (SaaS admin) backend for the admin/ panel.
-- Script: 20261116110000_platform_admin.PRODUCTION.sql — apply manually on MAIN.
--
-- * public.platform_admins   — who is a platform owner (managed only via SQL Editor).
-- * public.admin_audit_log   — every admin change (actor, before/after, reason).
-- * RPCs (SECURITY DEFINER, each one rejects callers that are not platform admins):
--     admin_is_platform_owner()                      → boolean (safe for everyone)
--     admin_list_workspaces()                        → business-level rows + counts
--     admin_get_workspace(p_workspace_id)            → jsonb (workspace, members, stats)
--     admin_set_subscription(p_workspace_id, p_status, p_expires_at, p_reason) → jsonb
--     admin_list_audit(p_workspace_id, p_limit)      → audit rows
-- No client PII beyond workspace owner/member name+email, no order contents.
--
-- After applying, grant yourself access (replace the email):
--   insert into public.platform_admins (user_id, note)
--   select id, 'owner' from auth.users where lower(email) = lower('YOUR_EMAIL')
--   on conflict do nothing;
-- =============================================================================

do $preflight$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'subscription_status'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'subscription_expires_at'
  ) then
    raise exception 'platform admin preflight: workspaces.subscription_status / subscription_expires_at columns are missing';
  end if;
end;
$preflight$;

-- Make sure the optional timestamp columns exist (no-op when already present).
alter table public.workspaces add column if not exists subscription_started_at timestamptz;
alter table public.workspaces add column if not exists subscription_updated_at timestamptz;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  workspace_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_workspace_idx on public.admin_audit_log (workspace_id, created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Authorization helpers
-- -----------------------------------------------------------------------------
create or replace function public.admin_is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid());
$$;

create or replace function public.admin_assert_platform_owner()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.admin_is_platform_owner() then
    raise exception 'Platform owner access required' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read: workspace list
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_workspaces()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  deleted_at timestamptz,
  language text,
  currency text,
  owner_id uuid,
  owner_name text,
  owner_email text,
  owner_last_sign_in_at timestamptz,
  subscription_status text,
  subscription_started_at timestamptz,
  subscription_expires_at timestamptz,
  subscription_updated_at timestamptz,
  member_count integer,
  employee_count integer,
  order_count integer,
  orders_last_30d integer,
  last_order_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.admin_assert_platform_owner();

  return query
  with order_stats as (
    select o.workspace_id,
           count(*) filter (where coalesce(to_jsonb(o) ->> 'kind', 'order') <> 'estimate')::int as total,
           count(*) filter (
             where coalesce(to_jsonb(o) ->> 'kind', 'order') <> 'estimate'
               and o.created_at >= now() - interval '30 days'
           )::int as last30,
           max(o.created_at) as last_at
    from public.orders o
    group by o.workspace_id
  ),
  member_stats as (
    select m.workspace_id, count(*)::int as total
    from public.workspace_members m
    where m.deleted_at is null
    group by m.workspace_id
  ),
  employee_stats as (
    select e.workspace_id, count(*)::int as total
    from public.employees e
    where coalesce(e.status, 'active') <> 'inactive'
    group by e.workspace_id
  )
  select w.id,
         w.name,
         w.created_at,
         w.deleted_at,
         w.language,
         w.currency,
         w.owner_id,
         nullif(trim(p.full_name), ''),
         coalesce(nullif(trim(p.email), ''), u.email)::text,
         u.last_sign_in_at,
         lower(trim(w.subscription_status::text)),
         w.subscription_started_at,
         w.subscription_expires_at,
         w.subscription_updated_at,
         coalesce(ms.total, 0),
         coalesce(es.total, 0),
         coalesce(os.total, 0),
         coalesce(os.last30, 0),
         os.last_at
  from public.workspaces w
  left join public.profiles p on p.id = w.owner_id
  left join auth.users u on u.id = w.owner_id
  left join order_stats os on os.workspace_id = w.id
  left join member_stats ms on ms.workspace_id = w.id
  left join employee_stats es on es.workspace_id = w.id
  order by w.created_at desc nulls last;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read: single workspace (business fields, members, aggregates)
-- -----------------------------------------------------------------------------
create or replace function public.admin_get_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_members jsonb;
  v_stats jsonb;
begin
  perform public.admin_assert_platform_owner();

  select to_jsonb(x) into v_row
  from public.admin_list_workspaces() x
  where x.id = p_workspace_id;

  if v_row is null then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id,
           'name', nullif(trim(p.full_name), ''),
           'email', coalesce(nullif(trim(p.email), ''), u.email),
           'role', m.role,
           'joined_at', m.created_at,
           'last_sign_in_at', u.last_sign_in_at
         ) order by (m.role = 'owner') desc, m.created_at), '[]'::jsonb)
  into v_members
  from public.workspace_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.workspace_id = p_workspace_id
    and m.deleted_at is null;

  select jsonb_build_object(
           'clients', (select count(*) from public.clients c where c.workspace_id = p_workspace_id),
           'estimates', (
             select count(*) from public.orders o
             where o.workspace_id = p_workspace_id
               and coalesce(to_jsonb(o) ->> 'kind', 'order') = 'estimate'
           )
         )
  into v_stats;

  return v_row || jsonb_build_object('members', v_members, 'stats', v_stats);
end;
$$;

-- -----------------------------------------------------------------------------
-- Write: subscription status / expiry (also suspend / reactivate)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_subscription(
  p_workspace_id uuid,
  p_status text,
  p_expires_at timestamptz,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_type text;
  v_before jsonb;
  v_after jsonb;
  v_actor_email text;
begin
  perform public.admin_assert_platform_owner();

  if v_status not in ('trial', 'active', 'expired', 'suspended', 'cancelled') then
    raise exception 'Unknown subscription status: %', p_status using errcode = '22023';
  end if;
  if v_status = 'trial' and p_expires_at is null then
    raise exception 'Trial requires an expiration date' using errcode = '22023';
  end if;
  if v_status in ('trial', 'active') and p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiration date must be in the future for an active or trial subscription' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'subscription_status', lower(trim(w.subscription_status::text)),
           'subscription_started_at', w.subscription_started_at,
           'subscription_expires_at', w.subscription_expires_at
         )
  into v_before
  from public.workspaces w
  where w.id = p_workspace_id
  for update;

  if v_before is null then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;

  -- subscription_status may be text or an enum: cast to the real column type.
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.workspaces'::regclass
    and a.attname = 'subscription_status'
    and not a.attisdropped;

  execute format(
    'update public.workspaces
        set subscription_status = $1::%s,
            subscription_expires_at = $2,
            subscription_started_at = case
              when subscription_started_at is null and $1 in (''trial'', ''active'') then now()
              else subscription_started_at
            end,
            subscription_updated_at = now()
      where id = $3',
    v_type
  ) using v_status, p_expires_at, p_workspace_id;

  select jsonb_build_object(
           'subscription_status', lower(trim(w.subscription_status::text)),
           'subscription_started_at', w.subscription_started_at,
           'subscription_expires_at', w.subscription_expires_at
         )
  into v_after
  from public.workspaces w
  where w.id = p_workspace_id;

  select u.email into v_actor_email from auth.users u where u.id = auth.uid();

  insert into public.admin_audit_log (actor_id, actor_email, action, workspace_id, before, after, reason)
  values (auth.uid(), v_actor_email, 'set_subscription', p_workspace_id, v_before, v_after, nullif(trim(p_reason), ''));

  return v_after;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read: audit log
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_audit(p_workspace_id uuid default null, p_limit integer default 200)
returns table (
  id bigint,
  created_at timestamptz,
  actor_email text,
  action text,
  workspace_id uuid,
  workspace_name text,
  before jsonb,
  after jsonb,
  reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.admin_assert_platform_owner();

  return query
  select l.id, l.created_at, l.actor_email, l.action, l.workspace_id, w.name, l.before, l.after, l.reason
  from public.admin_audit_log l
  left join public.workspaces w on w.id = l.workspace_id
  where p_workspace_id is null or l.workspace_id = p_workspace_id
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.admin_is_platform_owner() from public, anon;
revoke all on function public.admin_assert_platform_owner() from public, anon, authenticated;
revoke all on function public.admin_list_workspaces() from public, anon;
revoke all on function public.admin_get_workspace(uuid) from public, anon;
revoke all on function public.admin_set_subscription(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.admin_list_audit(uuid, integer) from public, anon;

grant execute on function public.admin_is_platform_owner() to authenticated;
grant execute on function public.admin_list_workspaces() to authenticated;
grant execute on function public.admin_get_workspace(uuid) to authenticated;
grant execute on function public.admin_set_subscription(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.admin_list_audit(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
