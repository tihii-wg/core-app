-- Hardening: employees.profile_id must be NULL or an active member of the employee's workspace,
-- and a workspace user can be linked to at most one employee in that workspace.
--
-- Depends only on 20260929000000_production_baseline.sql (public.employees,
-- public.workspace_members, public.workspaces, public.is_workspace_member(uuid)).
--
-- Unchanged on purpose: who may link employees (any active member, via the existing employees
-- policies), employees_profile_id_fkey, employees_prevent_workspace_change and every other grant.
-- Links are validated when written; removing a member does not clear existing links.

-- -------------------------------------------------------------------------------------------
-- Existing data must already satisfy both invariants. Rows are never modified here.
-- -------------------------------------------------------------------------------------------

do $$
declare
  duplicate_links integer;
  non_member_links integer;
begin
  select count(*) into duplicate_links
  from (
    select 1
    from public.employees e
    where e.profile_id is not null
    group by e.workspace_id, e.profile_id
    having count(*) > 1
  ) duplicates;

  select count(*) into non_member_links
  from public.employees e
  where e.profile_id is not null
    and not exists (
      select 1
      from public.workspace_members wm
      join public.workspaces w on w.id = wm.workspace_id
      where wm.workspace_id = e.workspace_id
        and wm.user_id = e.profile_id
        and wm.deleted_at is null
        and w.deleted_at is null
    );

  if duplicate_links > 0 or non_member_links > 0 then
    raise exception 'employees.profile_id data must be repaired before applying this migration'
      using errcode = '23514',
            detail = format('%s (workspace_id, profile_id) pairs are linked to more than one employee; %s employees are linked to a user who is not an active member of their workspace.', duplicate_links, non_member_links);
  end if;
end $$;

-- -------------------------------------------------------------------------------------------
-- Validation trigger function
-- -------------------------------------------------------------------------------------------

-- The caller check runs before the target lookup and raises the same error RLS would, so a
-- caller outside the workspace cannot learn whether any user exists or belongs to it.
create or replace function public.validate_employee_profile_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.profile_id is not distinct from old.profile_id
     and new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;

  if (select auth.uid()) is not null
     and not public.is_workspace_member(new.workspace_id) then
    raise exception 'new row violates row-level security policy for table "employees"'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.profile_id
      and wm.deleted_at is null
      and w.deleted_at is null
  ) then
    raise exception 'Selected user is not an active member of this workspace'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_employee_profile_id() from public, anon, authenticated, service_role;

-- -------------------------------------------------------------------------------------------
-- One employee per linked user per workspace
-- -------------------------------------------------------------------------------------------

create unique index employees_workspace_profile_unique
on public.employees (workspace_id, profile_id)
where profile_id is not null;

-- -------------------------------------------------------------------------------------------
-- Trigger (fires after employees_prevent_workspace_change: same timing, later name)
-- -------------------------------------------------------------------------------------------

create or replace trigger employees_validate_profile_id
before insert or update of profile_id, workspace_id
on public.employees
for each row
execute function public.validate_employee_profile_id();
