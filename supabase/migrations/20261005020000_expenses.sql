-- Workspace expenses for the Finance page.
--
-- Depends only on 20260929000000_production_baseline.sql (public.workspaces,
-- public.is_workspace_member(uuid) and public.workspace_member_is_admin(uuid): EXISTS checks over an
-- active membership / active owner-or-admin membership in an active workspace, never NULL).
--
-- Members of the workspace read its expenses; owners and admins create, edit and delete them.
-- Column grants keep workspace_id and created_by out of UPDATE, so an expense cannot be moved to
-- another workspace, and created_by always comes from auth.uid(). Additive: no existing table,
-- policy, grant or function changes.

create table public.expenses (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  expense_date date default current_date not null,
  category text not null,
  description text,
  amount numeric(12,2) not null,
  payment_method text default 'cash'::text not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  constraint expenses_pkey primary key (id),
  constraint expenses_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade,
  constraint expenses_amount_check check (amount > 0),
  constraint expenses_category_check check (char_length(btrim(category)) between 1 and 80),
  constraint expenses_description_check check (description is null or char_length(description) <= 500),
  constraint expenses_payment_method_check check (payment_method = any (array['cash'::text, 'card'::text, 'bank-transfer'::text, 'other'::text]))
);

create index expenses_workspace_date_idx on public.expenses using btree (workspace_id, expense_date desc);

alter table public.expenses enable row level security;

create policy "Members can view workspace expenses"
  on public.expenses
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Owners and admins can create expenses"
  on public.expenses
  as permissive
  for insert
  to authenticated
  with check (public.workspace_member_is_admin(workspace_id) and created_by = auth.uid());

create policy "Owners and admins can update expenses"
  on public.expenses
  as permissive
  for update
  to authenticated
  using (public.workspace_member_is_admin(workspace_id))
  with check (public.workspace_member_is_admin(workspace_id));

create policy "Owners and admins can delete expenses"
  on public.expenses
  as permissive
  for delete
  to authenticated
  using (public.workspace_member_is_admin(workspace_id));

revoke all on table public.expenses from public, anon, authenticated, service_role;
grant select, delete on table public.expenses to authenticated;
grant insert (workspace_id, expense_date, category, description, amount, payment_method) on table public.expenses to authenticated;
grant update (expense_date, category, description, amount, payment_method) on table public.expenses to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.expenses to service_role;
