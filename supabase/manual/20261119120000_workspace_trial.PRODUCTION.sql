-- Workspace trial: every NEW workspace starts with a 1-month trial (full write access);
-- once subscription_expires_at passes, the SPA and workspace_write_allowed() switch it to read-only.
--
-- * The trial belongs to the owner's account, not to each workspace: if the owner already owns
--   (or owned — soft-deleted rows count) another workspace, the new one inherits that owner's
--   best current subscription instead of a fresh trial. No endless trials by re-creating workspaces.
-- * Values are set by the server; whatever the client sends in subscription_* on insert is ignored.
-- * Clients (roles anon / authenticated) can no longer change subscription_* via UPDATE.
--   admin_set_subscription (security definer) and the SQL editor are unaffected.
-- * Existing workspaces are NOT touched.
-- * workspace_restore disables user triggers while it inserts, so restored copies keep the
--   subscription of their source exactly as before.
--
-- Idempotent: safe to run more than once.

-- 1. Initial subscription on insert -------------------------------------------------------------
create or replace function public.workspaces_assign_initial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev record;
begin
  select w.subscription_status, w.subscription_started_at, w.subscription_expires_at
    into v_prev
  from public.workspaces w
  where w.owner_id = new.owner_id
    and w.id is distinct from new.id
  order by
    case
      when lower(w.subscription_status::text) = 'active'
           and (w.subscription_expires_at is null or w.subscription_expires_at > now()) then 0
      when lower(w.subscription_status::text) in ('active', 'trial')
           and w.subscription_expires_at > now() then 1
      else 2
    end,
    w.subscription_expires_at desc nulls last,
    w.created_at desc
  limit 1;

  if found then
    -- Same owner: same entitlement as their other workspace (paying stays paying,
    -- a running trial keeps its end date, an expired trial stays expired).
    new.subscription_status := v_prev.subscription_status;
    new.subscription_started_at := coalesce(v_prev.subscription_started_at, now());
    new.subscription_expires_at := v_prev.subscription_expires_at;
  else
    -- First workspace of this owner: 1-month free trial.
    new.subscription_status := 'trial';
    new.subscription_started_at := now();
    new.subscription_expires_at := now() + interval '1 month';
  end if;
  new.subscription_updated_at := now();
  return new;
end;
$$;

revoke all on function public.workspaces_assign_initial_subscription() from public, anon, authenticated;

-- "zz_" so it runs after any other BEFORE INSERT trigger (triggers fire in name order).
drop trigger if exists zz_workspaces_initial_subscription on public.workspaces;
create trigger zz_workspaces_initial_subscription
  before insert on public.workspaces
  for each row execute function public.workspaces_assign_initial_subscription();

-- 2. Clients cannot edit subscription columns -----------------------------------------------------
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

-- 3. Check ---------------------------------------------------------------------------------------
-- select tgname from pg_trigger where tgrelid = 'public.workspaces'::regclass and not tgisinternal;
