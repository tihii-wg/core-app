-- SUPERSEDED by 20261126090000_owner_subscriptions.PRODUCTION.sql (apply that one instead).
-- =============================================================================
-- Subscription belongs to the OWNER's account, not to each workspace.
-- Script: 20261125223000_subscription_per_owner.PRODUCTION.sql
--
-- 1. New workspace (insert trigger, same as 20261119120000_workspace_trial — re-created here so this
--    script alone is enough): the owner's first workspace gets a 1-month trial; any further workspace
--    of the same owner inherits the owner's current subscription (a running trial keeps its end date,
--    an expired trial stays expired, paying stays paying). No fresh trial per new business.
-- 2. Clients (anon / authenticated) cannot change subscription_* columns.
-- 3. NEW: when a workspace's subscription changes (admin panel / SQL editor / payment), every other
--    non-deleted workspace of the same owner gets the same subscription — one owner, one subscription.
-- 4. Members are unaffected by their own account: access to a workspace follows that workspace's
--    (= its owner's) subscription; a member's own trial is created only when they create a workspace
--    of their own, and only once.
--
-- Existing rows are NOT changed by this script. See the optional block at the end.
-- Idempotent.
-- =============================================================================

-- 1. Initial subscription on insert ---------------------------------------------------------------
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
    new.subscription_status := v_prev.subscription_status;
    new.subscription_started_at := coalesce(v_prev.subscription_started_at, now());
    new.subscription_expires_at := v_prev.subscription_expires_at;
  else
    new.subscription_status := 'trial';
    new.subscription_started_at := now();
    new.subscription_expires_at := now() + interval '1 month';
  end if;
  new.subscription_updated_at := now();
  return new;
end;
$$;

revoke all on function public.workspaces_assign_initial_subscription() from public, anon, authenticated;

drop trigger if exists zz_workspaces_initial_subscription on public.workspaces;
create trigger zz_workspaces_initial_subscription
  before insert on public.workspaces
  for each row execute function public.workspaces_assign_initial_subscription();

-- 2. Clients cannot edit subscription columns -------------------------------------------------------
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

-- 3. One owner, one subscription: copy a change to the owner's other workspaces ---------------------
create or replace function public.workspaces_sync_owner_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Our own propagation UPDATEs fire this trigger again: stop there.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.deleted_at is not null or new.owner_id is null then
    return null;
  end if;
  if (new.subscription_status, new.subscription_started_at, new.subscription_expires_at)
     is not distinct from
     (old.subscription_status, old.subscription_started_at, old.subscription_expires_at) then
    return null;
  end if;

  update public.workspaces w
  set subscription_status = new.subscription_status,
      subscription_started_at = new.subscription_started_at,
      subscription_expires_at = new.subscription_expires_at,
      subscription_updated_at = now()
  where w.owner_id = new.owner_id
    and w.id <> new.id
    and w.deleted_at is null
    and (w.subscription_status, w.subscription_started_at, w.subscription_expires_at)
        is distinct from
        (new.subscription_status, new.subscription_started_at, new.subscription_expires_at);

  return null;
end;
$$;

revoke all on function public.workspaces_sync_owner_subscription() from public, anon, authenticated;

drop trigger if exists zz_workspaces_sync_owner_subscription on public.workspaces;
create trigger zz_workspaces_sync_owner_subscription
  after update of subscription_status, subscription_started_at, subscription_expires_at on public.workspaces
  for each row execute function public.workspaces_sync_owner_subscription();

-- -------------------------------------------------------------------------------------------------
-- Checks
--   select tgname from pg_trigger where tgrelid = 'public.workspaces'::regclass and not tgisinternal;
--
--   Owners whose workspaces disagree (should be empty after the fix below):
--   select owner_id, count(*) as workspaces,
--          count(distinct (subscription_status, subscription_expires_at)) as different_subscriptions
--   from public.workspaces where deleted_at is null
--   group by owner_id having count(distinct (subscription_status, subscription_expires_at)) > 1;
--
--   Details for one owner:
--   select id, name, created_at, subscription_status, subscription_started_at, subscription_expires_at
--   from public.workspaces where owner_id = '<owner uuid>' and deleted_at is null order by created_at;
-- -------------------------------------------------------------------------------------------------

-- OPTIONAL one-time fix (run by hand, after looking at the check above): give all workspaces of ONE
-- owner the subscription of one chosen workspace of theirs.
-- Example — owner tihii-wg (f7133b93-…): «Тест мебель» / «тест телефоны» were created before the trial
-- trigger existed and got 'active' with no end date; align them to «Sans» (trial until 2026-12-22):
--
--   update public.workspaces w
--   set subscription_status     = s.subscription_status,
--       subscription_started_at = s.subscription_started_at,
--       subscription_expires_at = s.subscription_expires_at,
--       subscription_updated_at = now()
--   from public.workspaces s
--   where s.id = 'cdbf8d72-28d7-4b94-8b76-738108d4bed1'
--     and w.owner_id = s.owner_id
--     and w.id <> s.id
--     and w.deleted_at is null;
--
-- Never run it for an owner other than yourself.
