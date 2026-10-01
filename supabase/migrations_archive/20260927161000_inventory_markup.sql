-- Workspace-level markup used to suggest an inventory selling price.

alter table public.workspaces
  add column if not exists inventory_markup_percent numeric not null default 0;

alter table public.workspaces
  drop constraint if exists workspaces_inventory_markup_percent_check;

alter table public.workspaces
  add constraint workspaces_inventory_markup_percent_check
  check (inventory_markup_percent >= 0);
