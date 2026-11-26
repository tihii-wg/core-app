-- =============================================================================
-- Subscription belongs to the OWNER (account), shared by all of their workspaces.
-- Script: 20261126090000_owner_subscriptions.PRODUCTION.sql
-- Run 20261126085900_owner_subscriptions_PREVIEW.sql first to see what changes.
--
-- * New table owner_subscriptions (one row per owner) = the source of truth.
-- * workspaces.subscription_* stay and become a synchronized COPY of the owner's row, so everything that
--   reads them keeps working unchanged: workspace_write_allowed() (server write gate), the SPA (trial
--   banner, read-only mode), and the admin app RPCs admin_list_workspaces / admin_get_workspace.
-- * admin_set_subscription(p_workspace_id, …) is NOT changed: setting a subscription on any workspace now
--   sets it for its owner → copied to all of that owner's workspaces.
-- * Backfill: each owner gets the BEST subscription among their workspaces, so no workspace gets a worse
--   subscription than it has today (nobody is switched to read-only by this script).
-- * No orders / clients / payments are touched. Nothing is deleted. Idempotent (safe to re-run).
-- * Supersedes the triggers of 20261119120000_workspace_trial and 20261125223000_subscription_per_owner
--   (they are replaced here; applying those first is not required).
-- =============================================================================

-- 1. Table ------------------------------------------------------------------------------------------
create table if not exists public.owner_subscriptions (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  status text not null,
  started_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.owner_subscriptions enable row level security;
revoke all on public.owner_subscriptions from anon, authenticated;
grant select on public.owner_subscriptions to authenticated;

drop policy if exists owner_subscriptions_select_own on public.owner_subscriptions;
create policy owner_subscriptions_select_own on public.owner_subscriptions
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- 2. Backfill: best subscription of each owner's workspaces (no downgrade) -------------------------------
insert into public.owner_subscriptions (owner_id, status, started_at, expires_at, updated_at)
select owner_id, status, started_at, expires_at, now()
from (
  select w.owner_id,
         coalesce(lower(trim(w.subscription_status::text)), 'trial') as status,
         w.subscription_started_at as started_at,
         w.subscription_expires_at as expires_at,
         row_number() over (
           partition by w.owner_id
           order by
             (w.deleted_at is not null),
             case
               when lower(trim(w.subscription_status::text)) = 'active'
                    and (w.subscription_expires_at is null or w.subscription_expires_at > now()) then 0
               when lower(trim(w.subscription_status::text)) in ('active', 'trial')
                    and w.subscription_expires_at > now() then 1
               else 2
             end,
             w.subscription_expires_at desc nulls first,
             w.created_at desc
         ) as rn
  from public.workspaces w
  where w.owner_id is not null
    and exists (select 1 from auth.users u where u.id = w.owner_id)
) ranked
where rn = 1
on conflict (owner_id) do nothing;

-- 3. Copy the owner's row into their workspaces -------------------------------------------------------
-- crm.sub_mirror = 'on' while copying, so the workspace trigger below does not echo it back.
create or replace function public.crm_mirror_owner_subscription(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text := current_setting('crm.sub_mirror', true);
  v_type text;
begin
  -- subscription_status may be text or an enum: cast to the real column type (as admin_set_subscription).
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.workspaces'::regclass and a.attname = 'subscription_status' and not a.attisdropped;

  perform set_config('crm.sub_mirror', 'on', true);
  execute format(
    'update public.workspaces w
        set subscription_status = s.status::%s,
            subscription_started_at = s.started_at,
            subscription_expires_at = s.expires_at,
            subscription_updated_at = now()
       from public.owner_subscriptions s
      where s.owner_id = $1
        and w.owner_id = $1
        and w.deleted_at is null
        and (lower(trim(w.subscription_status::text)), w.subscription_started_at, w.subscription_expires_at)
            is distinct from (s.status, s.started_at, s.expires_at)',
    v_type
  ) using p_owner_id;
  perform set_config('crm.sub_mirror', coalesce(v_prev, ''), true);
end;
$$;

revoke all on function public.crm_mirror_owner_subscription(uuid) from public, anon, authenticated;

create or replace function public.owner_subscriptions_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.crm_mirror_owner_subscription(new.owner_id);
  return null;
end;
$$;

revoke all on function public.owner_subscriptions_after_change() from public, anon, authenticated;

drop trigger if exists zz_owner_subscriptions_mirror on public.owner_subscriptions;
create trigger zz_owner_subscriptions_mirror
  after insert or update on public.owner_subscriptions
  for each row execute function public.owner_subscriptions_after_change();

-- 4. New workspace: the owner's subscription; first workspace of a new owner → 1-month trial -------------
create or replace function public.workspaces_assign_initial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.owner_subscriptions%rowtype;
begin
  if new.owner_id is null then
    return new;
  end if;

  select * into v_sub from public.owner_subscriptions where owner_id = new.owner_id;
  if not found then
    insert into public.owner_subscriptions (owner_id, status, started_at, expires_at, updated_at)
    values (new.owner_id, 'trial', now(), now() + interval '1 month', now())
    on conflict (owner_id) do nothing;
    select * into v_sub from public.owner_subscriptions where owner_id = new.owner_id;
  end if;

  new.subscription_status := v_sub.status;
  new.subscription_started_at := v_sub.started_at;
  new.subscription_expires_at := v_sub.expires_at;
  new.subscription_updated_at := now();
  return new;
end;
$$;

revoke all on function public.workspaces_assign_initial_subscription() from public, anon, authenticated;

drop trigger if exists zz_workspaces_initial_subscription on public.workspaces;
create trigger zz_workspaces_initial_subscription
  before insert on public.workspaces
  for each row execute function public.workspaces_assign_initial_subscription();

-- 5. Clients (anon / authenticated) cannot change subscription columns ----------------------------------
create or replace function public.workspaces_guard_subscription_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.subscription_status := old.subscription_status;
    new.subscription_started_at := old.subscription_started_at;
    new.subscription_expires_at := old.subscription_expires_at;
    new.subscription_updated_at := old.subscription_updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_workspaces_guard_subscription on public.workspaces;
create trigger zz_workspaces_guard_subscription
  before update on public.workspaces
  for each row execute function public.workspaces_guard_subscription_columns();

-- 6. A subscription set on a workspace (admin_set_subscription, SQL editor) → the owner's subscription;
--    owner change / restore of a workspace → it takes the owner's subscription.
drop trigger if exists zz_workspaces_sync_owner_subscription on public.workspaces;
drop function if exists public.workspaces_sync_owner_subscription();

create or replace function public.workspaces_subscription_to_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('crm.sub_mirror', true), '') = 'on' then
    return null; -- our own copy
  end if;
  if new.owner_id is null then
    return null;
  end if;

  if new.owner_id is distinct from old.owner_id
     or (old.deleted_at is not null and new.deleted_at is null) then
    -- New owner / restored workspace: take the owner's subscription (create it from this row if none).
    insert into public.owner_subscriptions (owner_id, status, started_at, expires_at, updated_at)
    values (new.owner_id, coalesce(lower(trim(new.subscription_status::text)), 'trial'),
            new.subscription_started_at, new.subscription_expires_at, now())
    on conflict (owner_id) do nothing;
    perform public.crm_mirror_owner_subscription(new.owner_id);
    return null;
  end if;

  if new.deleted_at is null
     and (new.subscription_status, new.subscription_started_at, new.subscription_expires_at)
         is distinct from (old.subscription_status, old.subscription_started_at, old.subscription_expires_at) then
    insert into public.owner_subscriptions (owner_id, status, started_at, expires_at, updated_at)
    values (new.owner_id, coalesce(lower(trim(new.subscription_status::text)), 'trial'),
            new.subscription_started_at, new.subscription_expires_at, now())
    on conflict (owner_id) do update
      set status = excluded.status,
          started_at = excluded.started_at,
          expires_at = excluded.expires_at,
          updated_at = now();
    -- The owner_subscriptions trigger copies it to the owner's other workspaces.
  end if;
  return null;
end;
$$;

revoke all on function public.workspaces_subscription_to_owner() from public, anon, authenticated;

drop trigger if exists zz_workspaces_subscription_to_owner on public.workspaces;
create trigger zz_workspaces_subscription_to_owner
  after update of subscription_status, subscription_started_at, subscription_expires_at, owner_id, deleted_at
  on public.workspaces
  for each row execute function public.workspaces_subscription_to_owner();

-- 7. Align existing workspaces with their owner (only upgrades, see the backfill) -------------------------
do $align$
declare
  r record;
begin
  for r in select owner_id from public.owner_subscriptions loop
    perform public.crm_mirror_owner_subscription(r.owner_id);
  end loop;
end;
$align$;

-- Checks ---------------------------------------------------------------------------------------------
--   Every owner's workspaces agree (must return no rows):
--   select owner_id from public.workspaces where deleted_at is null
--   group by owner_id having count(distinct (lower(trim(subscription_status::text)), subscription_expires_at)) > 1;
--
--   select * from public.owner_subscriptions order by updated_at desc;
