-- Hardening: public.soft_delete_workspace(uuid) is owner-only for every caller.
--
-- Depends only on 20260929000000_production_baseline.sql.
--
-- The baseline guard `if not (select public.workspace_member_role(target_workspace) = 'owner')`
-- is skipped whenever the caller has no active membership in an active workspace: the role is
-- NULL, the condition evaluates to NULL and plpgsql IF treats NULL as false. Any signed-in user
-- could therefore soft-delete any workspace by id, and calls on an already deleted or nonexistent
-- workspace returned success.
--
-- The guard must stay an EXISTS (never NULL). Everything else is unchanged from the baseline:
-- SECURITY DEFINER, empty search_path, the same two soft-delete updates, and the same EXECUTE
-- grants (restated so the final state does not depend on earlier drift).

create or replace function public.soft_delete_workspace(target_workspace uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin

  if not exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w
      on w.id = wm.workspace_id
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.role::text = 'owner'
      and wm.deleted_at is null
      and w.deleted_at is null
  ) then
    raise exception
      'Only the workspace owner can delete this workspace'
      using errcode = '42501';
  end if;

  update public.workspaces
  set deleted_at = now()
  where id = target_workspace
    and deleted_at is null;

  update public.workspace_members
  set deleted_at = now()
  where workspace_id = target_workspace
    and deleted_at is null;

end;
$function$;

revoke all on function public.soft_delete_workspace(target_workspace uuid) from public, anon, authenticated, service_role;
grant execute on function public.soft_delete_workspace(target_workspace uuid) to authenticated, service_role;
