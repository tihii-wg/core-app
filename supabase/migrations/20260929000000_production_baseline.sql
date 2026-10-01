-- Production baseline: the Core App schema exactly as it exists in production.
--
-- Reconstructed from the read-only production snapshot captured 2026-09-29T20:29:26.179046+00:00
-- (Postgres 17.6). It reproduces the current state only: no hardening,
-- no speculative changes. Security fixes live in the later migrations of this folder.
--
-- NEVER run this file against production: production already has every object below.
-- It is for new databases (the dedicated test project). If the Supabase CLI is adopted for
-- production later, record it there as applied instead:
--   supabase migration repair --status applied 20260929000000
--
-- Requires a Supabase project (auth.users, auth.uid(), storage.buckets, storage.objects,
-- storage.foldername()). Supabase-managed objects are not recreated: extensions, roles,
-- schemas, storage/auth internals, event triggers and default privileges. Every grant below is
-- explicit (revoke all, then grant), so the result does not depend on default privileges.
--
-- Written for a fresh database: plain CREATE statements fail on a database that already has
-- these objects, which aborts the whole migration instead of silently merging.

-- -------------------------------------------------------------------------------------------
-- Tables (columns, primary keys, check and unique constraints)
-- -------------------------------------------------------------------------------------------

create table public.industries (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  description text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint industries_pkey PRIMARY KEY (id)
);

alter table public.industries
  add constraint industries_slug_key UNIQUE (slug);

create table public.workspaces (
  id uuid default gen_random_uuid() not null,
  name text not null,
  owner_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  industry_id uuid,
  avatar_path text,
  inventory_markup numeric(5,2) default 0 not null,
  language text default 'en'::text not null,
  timezone text default 'Europe/Chisinau'::text not null,
  date_format text default 'DD.MM.YYYY'::text not null,
  currency text default 'MDL'::text not null,
  constraint workspaces_pkey PRIMARY KEY (id),
  constraint workspaces_date_format_check CHECK (date_format = ANY (ARRAY['DD.MM.YYYY'::text, 'MM/DD/YYYY'::text, 'YYYY-MM-DD'::text])),
  constraint workspaces_language_check CHECK (language = ANY (ARRAY['en'::text, 'ro'::text, 'ru'::text]))
);

create table public.profiles (
  id uuid default auth.uid() not null,
  full_name text,
  avatar text default ''::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  email text default ''::text,
  phone text default ''::text,
  active_workspace_id uuid,
  theme text default 'system'::text not null,
  constraint profiles_pkey PRIMARY KEY (id),
  constraint profiles_theme_check CHECK (theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text]))
);

create table public.workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  created_at timestamp with time zone default now(),
  deleted_at timestamp with time zone,
  constraint workspace_members_pkey PRIMARY KEY (workspace_id, user_id)
);

alter table public.workspace_members
  add constraint workspace_members_user_workspace_unique UNIQUE (workspace_id, user_id);

create table public.clients (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  balance numeric default 0,
  added_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  client_type text default 'individual'::text not null,
  tax_id text,
  contact_person text,
  constraint clients_pkey PRIMARY KEY (id),
  constraint clients_client_type_check CHECK (client_type = ANY (ARRAY['individual'::text, 'organization'::text]))
);

create table public.employees (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  profile_id uuid,
  name text not null,
  role text default 'employee'::text,
  status text default 'active'::text,
  phone text,
  email text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint employees_pkey PRIMARY KEY (id)
);

create table public.services (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  service_name text not null,
  created_at timestamp with time zone default now() not null,
  service_price smallint,
  category text,
  status text,
  description text,
  constraint services_pkey PRIMARY KEY (id)
);

create table public.orders (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  client_id uuid not null,
  number text not null,
  device text,
  service text,
  status text default 'new'::text,
  assigned_to uuid default auth.uid(),
  deadline timestamp with time zone,
  total_price numeric default 0,
  is_paid boolean default false,
  description text,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  employee_id text,
  name text,
  service_id text,
  vin text,
  car_number text,
  constraint orders_pkey PRIMARY KEY (id)
);

alter table public.orders
  add constraint orders_number_key UNIQUE (number);

create table public.order_services (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  service_id uuid not null,
  service_name text not null,
  price numeric(10,2) not null,
  quantity integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  constraint order_services_pkey PRIMARY KEY (id)
);

create table public.inventory_items (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  name text not null,
  sku text,
  description text,
  category text,
  quantity numeric(12,2) default 0 not null,
  min_quantity numeric(12,2) default 0 not null,
  unit text default 'pcs'::text not null,
  purchase_price numeric(12,2),
  selling_price numeric(12,2),
  supplier text,
  location text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint inventory_items_pkey PRIMARY KEY (id),
  constraint inventory_items_min_quantity_check CHECK (min_quantity >= 0::numeric),
  constraint inventory_items_purchase_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0::numeric),
  constraint inventory_items_quantity_check CHECK (quantity >= 0::numeric),
  constraint inventory_items_selling_price_check CHECK (selling_price IS NULL OR selling_price >= 0::numeric)
);

create table public.inventory (
  id bigint generated by default as identity,
  sku text not null,
  item_name text not null,
  supplier text not null,
  qty integer not null,
  status text not null,
  cost integer not null,
  price integer not null,
  constraint inventory_pkey PRIMARY KEY (id, sku, item_name, supplier, qty, status, cost, price)
);


-- -------------------------------------------------------------------------------------------
-- Foreign keys
-- -------------------------------------------------------------------------------------------

alter table public.workspaces
  add constraint workspaces_industry_id_fkey FOREIGN KEY (industry_id) REFERENCES public.industries(id) ON DELETE SET NULL;

alter table public.workspaces
  add constraint workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id);

alter table public.profiles
  add constraint profiles_active_workspace_id_fkey FOREIGN KEY (active_workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

alter table public.profiles
  add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.workspace_members
  add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.workspace_members
  add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

alter table public.clients
  add constraint clients_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id);

alter table public.clients
  add constraint clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

alter table public.employees
  add constraint employees_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.employees
  add constraint employees_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

alter table public.services
  add constraint services_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

alter table public.orders
  add constraint orders_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);

alter table public.orders
  add constraint orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

alter table public.orders
  add constraint orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table public.orders
  add constraint orders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

alter table public.order_services
  add constraint order_services_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

alter table public.order_services
  add constraint order_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);

alter table public.inventory_items
  add constraint inventory_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


-- -------------------------------------------------------------------------------------------
-- Indexes that do not back a constraint
-- -------------------------------------------------------------------------------------------

CREATE INDEX clients_workspace_client_type_idx ON public.clients USING btree (workspace_id, client_type);
CREATE INDEX idx_industries_is_active ON public.industries USING btree (is_active);
CREATE INDEX idx_inventory_items_category ON public.inventory_items USING btree (category);
CREATE INDEX idx_inventory_items_is_active ON public.inventory_items USING btree (is_active);
CREATE INDEX idx_inventory_items_name ON public.inventory_items USING btree (name);
CREATE INDEX idx_inventory_items_sku ON public.inventory_items USING btree (sku);
CREATE INDEX idx_inventory_items_workspace_id ON public.inventory_items USING btree (workspace_id);
CREATE UNIQUE INDEX idx_inventory_items_workspace_sku_unique ON public.inventory_items USING btree (workspace_id, sku) WHERE (sku IS NOT NULL);
CREATE UNIQUE INDEX services_workspace_name_unique ON public.services USING btree (workspace_id, lower(service_name));
CREATE UNIQUE INDEX services_workspace_service_name_unique ON public.services USING btree (workspace_id, lower(TRIM(BOTH FROM service_name)));
CREATE UNIQUE INDEX workspace_members_one_owner_per_workspace ON public.workspace_members USING btree (workspace_id) WHERE (role = 'owner'::text);
CREATE INDEX workspace_members_user_workspace_idx ON public.workspace_members USING btree (user_id, workspace_id) WHERE (deleted_at IS NULL);
CREATE INDEX workspace_members_workspace_active_idx ON public.workspace_members USING btree (workspace_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON public.workspace_members USING btree (workspace_id, user_id);
CREATE INDEX idx_workspaces_industry_id ON public.workspaces USING btree (industry_id);

-- -------------------------------------------------------------------------------------------
-- Functions (definitions as captured; SQL functions are created after the tables they read)
-- -------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        where wm.workspace_id = target_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.deleted_at is null
          and w.deleted_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_role(target_workspace uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select wm.role::text
  from public.workspace_members wm
  join public.workspaces w
    on w.id = wm.workspace_id
  where wm.workspace_id = target_workspace
    and wm.user_id = (select auth.uid())
    and wm.deleted_at is null
    and w.deleted_at is null
  order by
    case wm.role::text
      when 'owner' then 0
      when 'admin' then 1
      when 'manager' then 2
      when 'member' then 3
      else 4
    end
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_is_owner(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.role::text = 'owner'
          and wm.deleted_at is null
          and w.deleted_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_is_admin(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    select exists (
        select 1
        from public.workspace_members wm
        join public.workspaces w
          on w.id = wm.workspace_id
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.role::text in ('owner', 'admin')
          and wm.deleted_at is null
          and w.deleted_at is null
    );
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_can_manage(target_workspace uuid, target_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case (select public.workspace_member_role(target_workspace))
    when 'owner'
      then target_role in ('admin', 'manager', 'member')

    when 'admin'
      then target_role in ('manager', 'member')

    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_can_manage(p_workspace_id uuid, p_target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members actor
        JOIN public.workspace_members target
          ON target.workspace_id = actor.workspace_id
        WHERE actor.workspace_id = p_workspace_id
          AND actor.user_id = auth.uid()
          AND actor.deleted_at IS NULL

          AND target.workspace_id = p_workspace_id
          AND target.user_id = p_target_user_id
          AND target.deleted_at IS NULL

          AND (
              (
                  actor.role = 'owner'
                  AND target.role IN ('admin', 'manager', 'member')
              )
              OR
              (
                  actor.role = 'admin'
                  AND target.role IN ('manager', 'member')
              )
          )
    );
$function$;

CREATE OR REPLACE FUNCTION public.workspace_member_can_bootstrap(target_workspace uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
  and not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
  );
$function$;

CREATE OR REPLACE FUNCTION public.soft_delete_workspace(target_workspace uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

  if not (
    select public.workspace_member_role(target_workspace) = 'owner'
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

CREATE OR REPLACE FUNCTION public.prevent_workspace_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

    if new.workspace_id is distinct from old.workspace_id then
        raise exception
            'workspace_id cannot be changed'
            using errcode = '42501';
    end if;

    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_workspace_member_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

    if new.workspace_id is distinct from old.workspace_id then
        raise exception
            'workspace_id cannot be changed'
            using errcode = '42501';
    end if;

    if new.user_id is distinct from old.user_id then
        raise exception
            'user_id cannot be changed'
            using errcode = '42501';
    end if;

    return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.protect_workspace_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

    if tg_op = 'INSERT' then

        if new.role::text = 'owner' then

            if new.user_id <> (select auth.uid()) then
                raise exception
                    'Only the authenticated workspace owner can create the owner membership'
                    using errcode = '42501';
            end if;

            if not exists (
                select 1
                from public.workspaces w
                where w.id = new.workspace_id
                  and w.owner_id = (select auth.uid())
                  and w.deleted_at is null
            ) then
                raise exception
                    'Authenticated user is not the workspace owner'
                    using errcode = '42501';
            end if;

        end if;

        return new;
    end if;


    if tg_op = 'UPDATE' then

        if old.role::text = 'owner' then

            -- Owner role itself can never be changed.
            if new.role is distinct from old.role then
                raise exception
                    'Workspace owner role cannot be changed'
                    using errcode = '42501';
            end if;

            -- Owner membership may only be soft-deleted as part
            -- of deleting the entire workspace.
            if new.deleted_at is distinct from old.deleted_at then

                if not exists (
                    select 1
                    from public.workspaces w
                    where w.id = old.workspace_id
                      and w.deleted_at is not null
                ) then
                    raise exception
                        'Workspace owner cannot be deleted'
                        using errcode = '42501';
                end if;

            end if;

        end if;

        return new;
    end if;


    if tg_op = 'DELETE' then

        if old.role::text = 'owner' then
            raise exception
                'Workspace owner cannot be deleted'
                using errcode = '42501';
        end if;

        return old;
    end if;


    return new;

end;
$function$;

CREATE OR REPLACE FUNCTION public.update_inventory_items_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$;


-- -------------------------------------------------------------------------------------------
-- View
-- -------------------------------------------------------------------------------------------

create view public.inventory_items_with_status with (security_invoker = true) as
 SELECT id,
    workspace_id,
    name,
    sku,
    description,
    category,
    quantity,
    min_quantity,
    unit,
    purchase_price,
    selling_price,
    supplier,
    location,
    is_active,
    created_at,
    updated_at,
        CASE
            WHEN quantity <= 0::numeric THEN 'out_of_stock'::text
            WHEN quantity <= min_quantity THEN 'low_stock'::text
            ELSE 'in_stock'::text
        END AS stock_status
   FROM public.inventory_items i;


-- -------------------------------------------------------------------------------------------
-- Triggers
-- -------------------------------------------------------------------------------------------

CREATE TRIGGER clients_prevent_workspace_change BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER employees_prevent_workspace_change BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER inventory_items_prevent_workspace_change BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER inventory_items_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_inventory_items_updated_at();
CREATE TRIGGER orders_prevent_workspace_change BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER services_prevent_workspace_change BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_change();
CREATE TRIGGER protect_workspace_member_identity BEFORE UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_member_identity();
CREATE TRIGGER protect_workspace_owner BEFORE INSERT OR DELETE OR UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_owner();

-- -------------------------------------------------------------------------------------------
-- Row level security
-- -------------------------------------------------------------------------------------------

alter table public.clients enable row level security;
alter table public.employees enable row level security;
alter table public.industries enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_items enable row level security;
alter table public.order_services enable row level security;
alter table public.orders enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspaces enable row level security;

-- -------------------------------------------------------------------------------------------
-- Policies (public tables and storage.objects)
-- -------------------------------------------------------------------------------------------

create policy "Members can create workspace clients"
  on public.clients
  as permissive
  for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Members can delete workspace clients"
  on public.clients
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can update workspace clients"
  on public.clients
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Members can view workspace clients"
  on public.clients
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can create workspace employees"
  on public.employees
  as permissive
  for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Members can delete workspace employees"
  on public.employees
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can update workspace employees"
  on public.employees
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Members can view workspace employees"
  on public.employees
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Authenticated users can view active industries"
  on public.industries
  as permissive
  for select
  to authenticated
  using ((is_active = true));

create policy "Users can create workspace inventory"
  on public.inventory_items
  as permissive
  for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Users can delete workspace inventory"
  on public.inventory_items
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Users can update workspace inventory"
  on public.inventory_items
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Users can view workspace inventory"
  on public.inventory_items
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can create order services"
  on public.order_services
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_services.order_id) AND public.is_workspace_member(o.workspace_id)))));

create policy "Members can view order services"
  on public.order_services
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_services.order_id) AND public.is_workspace_member(o.workspace_id)))));

create policy "Members can create workspace orders"
  on public.orders
  as permissive
  for insert
  to authenticated
  with check (public.is_workspace_member(workspace_id));

create policy "Members can delete workspace orders"
  on public.orders
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can update workspace orders"
  on public.orders
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Members can view workspace orders"
  on public.orders
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Enable insert for users based on user_id"
  on public.profiles
  as permissive
  for insert
  to authenticated
  with check ((( SELECT auth.uid() AS uid) = id));

create policy "Enable read access for all users"
  on public.profiles
  as permissive
  for select
  to authenticated
  using ((( SELECT auth.uid() AS uid) = id));

create policy "Users can update their own profile"
  on public.profiles
  as permissive
  for update
  to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

create policy "Members can delete workspace services"
  on public.services
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can update workspace services"
  on public.services
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

create policy "Members can view workspace services"
  on public.services
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Owners and admins can create services"
  on public.services
  as permissive
  for insert
  to authenticated
  with check (public.workspace_member_is_admin(workspace_id));

create policy "team_members_insert"
  on public.workspace_members
  as permissive
  for insert
  to authenticated
  with check (((deleted_at IS NULL) AND (((user_id <> ( SELECT auth.uid() AS uid)) AND ( SELECT public.workspace_member_can_manage(workspace_members.workspace_id, workspace_members.role) AS workspace_member_can_manage)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND ( SELECT public.workspace_member_can_bootstrap(workspace_members.workspace_id) AS workspace_member_can_bootstrap)))));

create policy "team_members_select"
  on public.workspace_members
  as permissive
  for select
  to authenticated
  using ((((deleted_at IS NULL) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.workspace_member_role(workspace_members.workspace_id) AS workspace_member_role) IS NOT NULL))) OR ((deleted_at IS NOT NULL) AND (user_id <> ( SELECT auth.uid() AS uid)) AND ( SELECT public.workspace_member_can_manage(workspace_members.workspace_id, workspace_members.role) AS workspace_member_can_manage))));

create policy "team_members_update"
  on public.workspace_members
  as permissive
  for update
  to authenticated
  using (((user_id <> ( SELECT auth.uid() AS uid)) AND ( SELECT public.workspace_member_can_manage(workspace_members.workspace_id, workspace_members.role) AS workspace_member_can_manage)))
  with check (((user_id <> ( SELECT auth.uid() AS uid)) AND ( SELECT public.workspace_member_can_manage(workspace_members.workspace_id, workspace_members.role) AS workspace_member_can_manage)));

create policy "Allow insert active workspace"
  on public.workspaces
  as permissive
  for insert
  to authenticated
  with check (((auth.uid() = owner_id) AND (deleted_at IS NULL)));

create policy "Allow update active workspace"
  on public.workspaces
  as permissive
  for update
  to authenticated
  using (((auth.uid() = owner_id) AND (deleted_at IS NULL)))
  with check (((auth.uid() = owner_id) AND (deleted_at IS NULL)));

create policy "Owners can view active workspace"
  on public.workspaces
  as permissive
  for select
  to authenticated
  using (((auth.uid() = owner_id) AND (deleted_at IS NULL)));

create policy "Workspace members can delete workspace logos"
  on storage.objects
  as permissive
  for delete
  to authenticated
  using (((bucket_id = 'workspace'::text) AND (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (((wm.workspace_id)::text = (storage.foldername(objects.name))[1]) AND (wm.user_id = auth.uid()) AND (wm.deleted_at IS NULL))))));

create policy "Workspace members can update workspace logos"
  on storage.objects
  as permissive
  for update
  to authenticated
  using (((bucket_id = 'workspace'::text) AND (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (((wm.workspace_id)::text = (storage.foldername(objects.name))[1]) AND (wm.user_id = auth.uid()) AND (wm.deleted_at IS NULL))))))
  with check (((bucket_id = 'workspace'::text) AND (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (((wm.workspace_id)::text = (storage.foldername(objects.name))[1]) AND (wm.user_id = auth.uid()) AND (wm.deleted_at IS NULL))))));

create policy "Workspace members can upload workspace logos"
  on storage.objects
  as permissive
  for insert
  to authenticated
  with check (((bucket_id = 'workspace'::text) AND (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (((wm.workspace_id)::text = (storage.foldername(objects.name))[1]) AND (wm.user_id = auth.uid()) AND (wm.deleted_at IS NULL))))));

create policy "Workspace members can view workspace logos"
  on storage.objects
  as permissive
  for select
  to authenticated
  using (((bucket_id = 'workspace'::text) AND (EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE (((wm.workspace_id)::text = (storage.foldername(objects.name))[1]) AND (wm.user_id = auth.uid()) AND (wm.deleted_at IS NULL))))));


-- -------------------------------------------------------------------------------------------
-- Table, view and sequence privileges (revoke all, then grant exactly what production has; postgres is the owner)
-- -------------------------------------------------------------------------------------------

revoke all on table public.clients from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.clients to service_role;

revoke all on table public.employees from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.employees to service_role;

revoke all on table public.industries from public, anon, authenticated, service_role;
grant select on table public.industries to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.industries to service_role;

revoke all on table public.inventory from public, anon, authenticated, service_role;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.inventory to service_role;

revoke all on sequence public.inventory_id_seq from public, anon, authenticated, service_role;
grant select, update, usage on sequence public.inventory_id_seq to anon;
grant select, update, usage on sequence public.inventory_id_seq to authenticated;
grant select, update, usage on sequence public.inventory_id_seq to service_role;

revoke all on table public.inventory_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.inventory_items to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.inventory_items to service_role;

revoke all on table public.inventory_items_with_status from public, anon, authenticated, service_role;
grant select, maintain on table public.inventory_items_with_status to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.inventory_items_with_status to service_role;

revoke all on table public.order_services from public, anon, authenticated, service_role;
grant select, insert on table public.order_services to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.order_services to service_role;

revoke all on table public.orders from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.orders to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.orders to service_role;

revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.profiles to service_role;

revoke all on table public.services from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.services to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.services to service_role;

revoke all on table public.workspace_members from public, anon, authenticated, service_role;
grant select on table public.workspace_members to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.workspace_members to service_role;

revoke all on table public.workspaces from public, anon, authenticated, service_role;
grant select, insert, update on table public.workspaces to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.workspaces to service_role;


-- -------------------------------------------------------------------------------------------
-- Column privileges
-- -------------------------------------------------------------------------------------------

grant update (role, deleted_at) on table public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role) on table public.workspace_members to authenticated;

-- -------------------------------------------------------------------------------------------
-- Function privileges (revoke all, then grant exactly what production has)
-- -------------------------------------------------------------------------------------------

revoke all on function public.is_workspace_member(target_workspace_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_workspace_member(target_workspace_id uuid) to authenticated, service_role;

revoke all on function public.workspace_member_role(target_workspace uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_role(target_workspace uuid) to authenticated, service_role;

revoke all on function public.workspace_member_is_owner(p_workspace_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_is_owner(p_workspace_id uuid) to authenticated, service_role;

revoke all on function public.workspace_member_is_admin(p_workspace_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_is_admin(p_workspace_id uuid) to authenticated, service_role;

revoke all on function public.workspace_member_can_manage(target_workspace uuid, target_role text) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_can_manage(target_workspace uuid, target_role text) to authenticated, service_role;

revoke all on function public.workspace_member_can_manage(p_workspace_id uuid, p_target_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_can_manage(p_workspace_id uuid, p_target_user_id uuid) to service_role;

revoke all on function public.workspace_member_can_bootstrap(target_workspace uuid) from public, anon, authenticated, service_role;
grant execute on function public.workspace_member_can_bootstrap(target_workspace uuid) to authenticated, service_role;

revoke all on function public.soft_delete_workspace(target_workspace uuid) from public, anon, authenticated, service_role;
grant execute on function public.soft_delete_workspace(target_workspace uuid) to authenticated, service_role;

revoke all on function public.prevent_workspace_change() from public, anon, authenticated, service_role;
grant execute on function public.prevent_workspace_change() to service_role;

revoke all on function public.protect_workspace_member_identity() from public, anon, authenticated, service_role;
grant execute on function public.protect_workspace_member_identity() to service_role;

revoke all on function public.protect_workspace_owner() from public, anon, authenticated, service_role;
grant execute on function public.protect_workspace_owner() to service_role;

revoke all on function public.update_inventory_items_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.update_inventory_items_updated_at() to public, anon, authenticated, service_role;


-- -------------------------------------------------------------------------------------------
-- Storage bucket (configuration as captured; files are never part of a migration)
-- -------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace', 'workspace', false, null, null)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------------------------------
-- Reference data: industries (the 8 production rows; ids and created_at are not captured)
-- -------------------------------------------------------------------------------------------

-- created_at is spaced 1 ms apart so getIndustries() (ordered by created_at) keeps production's order.
insert into public.industries (name, slug, is_active, created_at)
select v.name, v.slug, v.is_active, now() + v.ord * interval '1 millisecond'
from (values
  (0, 'Auto Repair & Service', 'auto_repair', true),
  (1, 'Phone & Electronics Repair', 'phone_electronics_repair', true),
  (2, 'Computer Repair', 'computer_repair', true),
  (3, 'Appliance Repair', 'appliance_repair', true),
  (4, 'Equipment Repair', 'equipment_repair', true),
  (5, 'Electrical Services', 'electrical_services', true),
  (6, 'Home Services', 'home_services', true),
  (7, 'Other', 'other', true)
) as v (ord, name, slug, is_active)
on conflict (slug) do update
set name = excluded.name,
    is_active = excluded.is_active;

notify pgrst, 'reload schema';
