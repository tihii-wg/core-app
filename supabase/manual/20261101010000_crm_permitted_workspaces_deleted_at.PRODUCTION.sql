-- =====================================================================
-- Core App — crm_permitted_workspaces(): also require workspaces.deleted_at IS NULL
-- (manual ADDITIVE PATCH, PREP ONLY).
--
-- PROBLEM: crm_ro_v1.PRODUCTION.sql defines public.crm_permitted_workspaces(text) with
-- a check on workspace_members.deleted_at only. It does NOT look at workspaces.deleted_at,
-- so after a workspace is soft-deleted its (still active) members keep read/write access
-- to ALL crm_ro_v1 tables through RLS ("workspace_id in (select crm_permitted_workspaces())").
-- The baseline helpers is_workspace_member / workspace_member_is_admin / workspace_member_is_owner
-- already filter w.deleted_at is null; this patch makes crm_ro_v1 consistent with them.
--
-- WHEN TO RUN: right after crm_ro_v1.PRODUCTION.sql (Phase 2, step 2.1a), TEST first, then PROD.
-- If crm_ro_v1.PRODUCTION.sql is later edited to include this filter, this file becomes a harmless no-op.
--
-- WHAT IT DOES (nothing else):
--   * CREATE OR REPLACE of ONE function, same signature (text) -> setof uuid, same
--     security definer / stable / empty search_path, same permission logic.
--     The ONLY change: join public.workspaces w and require w.deleted_at is null.
--   * re-asserts the same revoke/grant as crm_ro_v1 (authenticated + service_role only).
--   No table, policy, column or data is touched. public.crm_has_permission() and every RLS
--   policy call this function, so they pick the change up automatically.
--
-- ROLLBACK: re-run the function definition from crm_ro_v1.PRODUCTION.sql, section
-- "14. Функции доступа и триггеры".
-- Idempotent: safe to re-run.
-- =====================================================================

begin;

do $$
begin
  if to_regprocedure('public.crm_permitted_workspaces(text)') is null then
    raise exception 'Нет public.crm_permitted_workspaces(text): сначала примените crm_ro_v1.PRODUCTION.sql';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspaces' and column_name = 'deleted_at'
  ) then
    raise exception 'Нет колонки public.workspaces.deleted_at: патч не нужен/не применим';
  end if;
end $$;

-- Рабочие пространства текущего пользователя, где у него есть право.
-- Без аргумента: все, где он активный участник.
-- ИЗМЕНЕНИЕ относительно crm_ro_v1: join public.workspaces + "w.deleted_at is null".
create or replace function public.crm_permitted_workspaces(p_permission text default null)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id          -- NEW
  left join public.member_roles mr on mr.workspace_id = m.workspace_id and mr.user_id = m.user_id
  where m.user_id = (select auth.uid())
    and m.deleted_at is null
    and w.deleted_at is null                                  -- NEW: soft-deleted workspaces grant nothing
    and (
      p_permission is null
      or m.role::text = 'owner'
      or (mr.role_id is null and m.role::text = 'admin')
      or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = mr.role_id and rp.workspace_id = m.workspace_id and rp.permission = p_permission
      )
    )
$$;

revoke all on function public.crm_permitted_workspaces(text) from public, anon;
grant execute on function public.crm_permitted_workspaces(text) to authenticated, service_role;

-- VERIFY (read-only): the function body must now mention workspaces.deleted_at.
select
  position('w.deleted_at is null' in pg_get_functiondef('public.crm_permitted_workspaces(text)'::regprocedure)) > 0
    as filters_deleted_workspaces;

commit;
