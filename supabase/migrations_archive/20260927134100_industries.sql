-- Business industry belongs to a workspace, not a profile.

create table if not exists public.industries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint industries_slug_key unique (slug)
);

alter table public.workspaces
  add column if not exists industry_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspaces_industry_id_fkey'
  ) then
    alter table public.workspaces
      add constraint workspaces_industry_id_fkey
      foreign key (industry_id) references public.industries (id);
  end if;
end $$;

create index if not exists workspaces_industry_id_idx
  on public.workspaces (industry_id);

alter table public.industries enable row level security;

drop policy if exists "Active industries are readable" on public.industries;

create policy "Active industries are readable"
  on public.industries
  for select
  to anon, authenticated
  using (is_active = true);

grant select on public.industries to anon, authenticated;

insert into public.industries (name, slug)
values
  ('Auto Repair & Service', 'auto_repair'),
  ('Phone & Electronics Repair', 'phone_electronics_repair'),
  ('Computer Repair', 'computer_repair'),
  ('Appliance Repair', 'appliance_repair'),
  ('Equipment Repair', 'equipment_repair'),
  ('Electrical Services', 'electrical_services'),
  ('Home Services', 'home_services'),
  ('Other', 'other')
on conflict (slug) do nothing;
