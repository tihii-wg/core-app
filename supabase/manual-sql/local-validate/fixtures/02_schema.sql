-- Minimal schema sufficient for harden_payment_ledger.sql local validation.
-- Isolated fixtures only — not a Production mirror and not a migration.

create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'local-test',
  currency text not null default 'MDL',
  deleted_at timestamptz null
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  deleted_at timestamptz null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  total_price numeric(12,2) not null default 0
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  total numeric(12,2) not null default 0,
  number text not null default 'INV-PENDING-local'
);

create unique index invoices_order_id_key on public.invoices (order_id) where order_id is not null;

-- Columns required by harden preflight; financial columns NOT NULL (CHECK NULL semantics).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  related_payment_id uuid references public.payments(id) on delete restrict,
  kind text not null,
  amount numeric(12,2) not null,
  currency_code text not null,
  payment_method text not null,
  paid_at timestamptz not null default now(),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Append-only client grants expected by harden preflight (SELECT/INSERT only).
revoke all on table public.payments from public, anon, authenticated;
grant select, insert on table public.payments to authenticated;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.deleted_at is null
      and w.deleted_at is null
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, anon;
