-- Invoices created from orders: public.invoices and public.invoice_items.
--
-- Depends on 20260929000000_production_baseline.sql (public.workspaces, public.orders,
-- public.clients and public.is_workspace_member(uuid): an EXISTS over an active membership in an
-- active workspace, never NULL). Additive: no existing table, policy, grant or function changes.
--
-- Matches src/services/apiInvoices.ts:
-- - An invoice is inserted with a temporary number 'INV-PENDING-<uuid>'. The app then reads the
--   created_at stored here, takes its year in workspaces.timezone and sets the final
--   'INV-YYYY-NNN'. That is the only number change allowed (protect_invoice_identity).
-- - Numbers are unique per workspace; an order has at most one invoice (partial unique index), so
--   two simultaneous "Create Invoice" clicks end in one invoice and one 23505.
-- - Members read, create, number and (on a failed creation) delete their workspace's invoices, the
--   same rule as public.orders. invoice_items is SELECT/INSERT only, checked through the invoice;
--   its rows go with the invoice (ON DELETE CASCADE).
-- - An invoice copies the order's values, so later order edits never change it. Deleting the order
--   or the client only clears order_id / client_id.

-- -------------------------------------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------------------------------------

create table public.invoices (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  order_id uuid,
  client_id uuid,
  number text not null,
  status text default 'draft'::text not null,
  client_name text default ''::text not null,
  order_number text,
  device text,
  car_number text,
  vin text,
  description text,
  subtotal numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  due_date date,
  paid_at timestamp with time zone,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint invoices_pkey PRIMARY KEY (id),
  constraint invoices_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  constraint invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL,
  constraint invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL,
  constraint invoices_workspace_id_number_key UNIQUE (workspace_id, number),
  constraint invoices_status_check CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'overdue'::text])),
  constraint invoices_number_check CHECK (number ~ '^INV-(PENDING-.+|[0-9]{4}-[0-9]{3,})$')
);

create unique index invoices_order_id_key on public.invoices using btree (order_id) where (order_id is not null);
create index invoices_client_id_idx on public.invoices using btree (client_id);

create table public.invoice_items (
  id uuid default gen_random_uuid() not null,
  invoice_id uuid not null,
  service_id uuid,
  service_name text not null,
  price numeric(10,2) not null,
  quantity integer default 1 not null,
  position integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint invoice_items_pkey PRIMARY KEY (id),
  constraint invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE,
  constraint invoice_items_quantity_check CHECK (quantity > 0)
);

create index invoice_items_invoice_id_idx on public.invoice_items using btree (invoice_id);

-- -------------------------------------------------------------------------------------------
-- Functions and triggers
-- -------------------------------------------------------------------------------------------

-- workspace_id, order_id, created_at and a final number never change. The number may change once,
-- from 'INV-PENDING-…' to 'INV-YYYY-NNN'. order_id may become NULL only through ON DELETE SET NULL,
-- i.e. when the order it points to no longer exists.
CREATE OR REPLACE FUNCTION public.protect_invoice_identity()
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

    if new.order_id is distinct from old.order_id
       and not (new.order_id is null
                and not exists (select 1 from public.orders o where o.id = old.order_id)) then
        raise exception
            'order_id cannot be changed'
            using errcode = '42501';
    end if;

    if new.created_at is distinct from old.created_at then
        raise exception
            'created_at cannot be changed'
            using errcode = '42501';
    end if;

    if new.number is distinct from old.number
       and not (old.number like 'INV-PENDING-%'
                and new.number ~ '^INV-[0-9]{4}-[0-9]{3,}$') then
        raise exception
            'An invoice number cannot be changed'
            using errcode = '42501';
    end if;

    new.updated_at = now();
    return new;
end;
$function$;

CREATE TRIGGER invoices_protect_identity BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.protect_invoice_identity();

-- -------------------------------------------------------------------------------------------
-- Row level security
-- -------------------------------------------------------------------------------------------

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

-- order_id and client_id must point into the same workspace, so a member cannot attach an invoice
-- to another workspace's order (which would also block that order's own invoice).
create policy "Members can create workspace invoices"
  on public.invoices
  as permissive
  for insert
  to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and (order_id is null or exists (
      select 1 from public.orders o
      where o.id = invoices.order_id and o.workspace_id = invoices.workspace_id))
    and (client_id is null or exists (
      select 1 from public.clients c
      where c.id = invoices.client_id and c.workspace_id = invoices.workspace_id))
  );

create policy "Members can delete workspace invoices"
  on public.invoices
  as permissive
  for delete
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can update workspace invoices"
  on public.invoices
  as permissive
  for update
  to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (
    public.is_workspace_member(workspace_id)
    and (client_id is null or exists (
      select 1 from public.clients c
      where c.id = invoices.client_id and c.workspace_id = invoices.workspace_id))
  );

create policy "Members can view workspace invoices"
  on public.invoices
  as permissive
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "Members can create invoice items"
  on public.invoice_items
  as permissive
  for insert
  to authenticated
  with check ((exists ( select 1
   from public.invoices i
  where ((i.id = invoice_items.invoice_id) and public.is_workspace_member(i.workspace_id)))));

create policy "Members can view invoice items"
  on public.invoice_items
  as permissive
  for select
  to authenticated
  using ((exists ( select 1
   from public.invoices i
  where ((i.id = invoice_items.invoice_id) and public.is_workspace_member(i.workspace_id)))));

-- -------------------------------------------------------------------------------------------
-- Privileges (nothing for anon)
-- -------------------------------------------------------------------------------------------

revoke all on table public.invoices from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.invoices to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.invoices to service_role;

revoke all on table public.invoice_items from public, anon, authenticated, service_role;
grant select, insert on table public.invoice_items to authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain on table public.invoice_items to service_role;

revoke all on function public.protect_invoice_identity() from public, anon, authenticated, service_role;
grant execute on function public.protect_invoice_identity() to service_role;

notify pgrst, 'reload schema';
