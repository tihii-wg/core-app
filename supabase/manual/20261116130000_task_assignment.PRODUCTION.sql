-- =============================================================================
-- Tasks assigned to a team member (tasks module).
-- Script: 20261116130000_task_assignment.PRODUCTION.sql — apply manually on MAIN (after crm_ro_v1).
--
-- * tasks.assigned_to — the workspace member (auth user) who must do the task.
-- * Any active member may create a task for any active member of the same workspace.
-- * The author and the assignee always see the task (even without the tasks.* role permissions);
--   the author may edit/delete it; the assignee changes its state through crm_task_set_state().
-- * Existing permission policies (tasks.view/create/edit/delete) keep working for managers.
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.tasks') is null then
    raise exception 'task_assignment preflight: public.tasks missing (apply crm_ro_v1 first)';
  end if;
  if to_regprocedure('public.crm_permitted_workspaces(text)') is null then
    raise exception 'task_assignment preflight: crm_permitted_workspaces(text) missing';
  end if;
end;
$preflight$;

alter table public.tasks add column if not exists assigned_to uuid references auth.users (id) on delete set null;
create index if not exists tasks_open_assignee_idx on public.tasks (workspace_id, assigned_to)
  where deleted_at is null and completed_at is null;
create index if not exists tasks_creator_idx on public.tasks (workspace_id, created_by) where deleted_at is null;

-- Active member of a workspace (security definer: callers cannot read other members directly).
create or replace function public.crm_task_is_member(p_workspace uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace and m.user_id = p_user and m.deleted_at is null
  );
$fn$;
revoke all on function public.crm_task_is_member(uuid, uuid) from public, anon;
grant execute on function public.crm_task_is_member(uuid, uuid) to authenticated, service_role;

-- Author is always the caller; the assignee must be an active member of the same workspace.
create or replace function public.crm_tasks_guard()
returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
    new.workspace_id := old.workspace_id;
  end if;
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not public.crm_task_is_member(new.workspace_id, new.assigned_to) then
    raise exception 'task:assignee_not_member' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;
drop trigger if exists crm_tasks_guard on public.tasks;
create trigger crm_tasks_guard before insert or update on public.tasks
  for each row execute function public.crm_tasks_guard();

-- Extra (permissive) policies on top of the tasks.* permission policies.
drop policy if exists tasks_party_select on public.tasks;
create policy tasks_party_select on public.tasks for select to authenticated using (
  workspace_id in (select public.crm_permitted_workspaces())
  and (created_by = (select auth.uid()) or assigned_to = (select auth.uid()))
);

drop policy if exists tasks_member_insert on public.tasks;
create policy tasks_member_insert on public.tasks for insert to authenticated with check (
  workspace_id in (select public.crm_permitted_workspaces())
);

drop policy if exists tasks_author_update on public.tasks;
create policy tasks_author_update on public.tasks for update to authenticated
  using (workspace_id in (select public.crm_permitted_workspaces()) and created_by = (select auth.uid()))
  with check (workspace_id in (select public.crm_permitted_workspaces()) and created_by = (select auth.uid()));

grant select, insert, update on public.tasks to authenticated;

-- State change for the author, the assignee, or anyone with tasks.edit.
-- p_state: 'todo' | 'in_progress' | 'done' → the workspace's task status of that group (if configured).
create or replace function public.crm_task_set_state(p_task_id uuid, p_state text)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  v_task public.tasks%rowtype;
  v_group text;
  v_status uuid;
begin
  if p_state not in ('todo', 'in_progress', 'done') then
    raise exception 'task:invalid_state' using errcode = '22023';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id and t.deleted_at is null for update;
  if not found or not public.crm_task_is_member(v_task.workspace_id, auth.uid()) then
    raise exception 'task:not_found' using errcode = 'P0002';
  end if;
  if not (
    v_task.assigned_to = auth.uid()
    or v_task.created_by = auth.uid()
    or public.crm_has_permission(v_task.workspace_id, 'tasks.edit')
  ) then
    raise exception 'task:forbidden' using errcode = '42501';
  end if;

  v_group := case p_state when 'todo' then 'new' when 'in_progress' then 'in_progress' else 'done' end;
  select s.id into v_status
  from public.status_definitions s
  where s.workspace_id = v_task.workspace_id and s.entity = 'task' and s.deleted_at is null
    and coalesce(s.is_active, true) and s.status_group = v_group
  order by (p_state = 'todo' and s.is_default) desc, s.sort_order nulls last, s.created_at
  limit 1;

  update public.tasks t
     set status_id = coalesce(v_status, t.status_id),
         completed_at = case when p_state = 'done' then coalesce(t.completed_at, now()) else null end
   where t.id = p_task_id;

  return jsonb_build_object('id', p_task_id, 'state', p_state, 'status_id', v_status);
end;
$fn$;
revoke all on function public.crm_task_set_state(uuid, text) from public, anon;
grant execute on function public.crm_task_set_state(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
