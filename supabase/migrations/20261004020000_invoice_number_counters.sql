-- Invoice numbers are never issued twice, also after the invoice holding one is deleted.
--
-- Depends on 20261004010000_invoices.sql. The app used to pick "highest existing number + 1", which
-- hands out the number of a deleted newest invoice again. The database now issues numbers from a
-- per-workspace, per-year counter that only moves forward:
-- - An invoice is inserted with 'INV-PENDING-<uuid>'; any other number is refused on insert.
-- - It is issued by setting its number to 'INV-NEXT'. protect_invoice_identity then takes the year of
--   the stored created_at in workspaces.timezone (Europe/Chisinau when blank or unknown, as the app
--   did), advances that workspace's counter for the year and stores 'INV-YYYY-NNN'.
-- - The counter row stays locked until the transaction ends, so concurrent issues get different
--   numbers. A statement that fails rolls the counter back with it, so only a stored number is used.
-- - Deleting an invoice does not touch the counter.
-- - Existing invoices keep their numbers; each counter starts at the highest number already issued.
-- No policy or grant on invoices / invoice_items changes. The counter table has RLS enabled, no
-- policies and no grants for anon/authenticated; only the trigger (SECURITY DEFINER) writes it.

-- -------------------------------------------------------------------------------------------
-- Counters
-- -------------------------------------------------------------------------------------------

create table public.invoice_number_counters (
  workspace_id uuid not null,
  year integer not null,
  last_number integer not null,
  constraint invoice_number_counters_pkey PRIMARY KEY (workspace_id, year),
  constraint invoice_number_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  constraint invoice_number_counters_year_check CHECK (year between 0 and 9999),
  constraint invoice_number_counters_last_number_check CHECK (last_number > 0)
);

alter table public.invoice_number_counters enable row level security;

insert into public.invoice_number_counters (workspace_id, year, last_number)
select workspace_id, substring(number from 5 for 4)::integer, max(substring(number from 10)::integer)
from public.invoices
where number ~ '^INV-[0-9]{4}-[0-9]{3,}$'
group by workspace_id, substring(number from 5 for 4)::integer;

-- -------------------------------------------------------------------------------------------
-- Functions and triggers
-- -------------------------------------------------------------------------------------------

-- Same rules as before for workspace_id, order_id and created_at. The number is set only by this
-- function: 'INV-PENDING-…' on insert, then once 'INV-NEXT' -> the next 'INV-YYYY-NNN'.
CREATE OR REPLACE FUNCTION public.protect_invoice_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    v_zone text;
    v_year integer;
    v_sequence integer;
begin

    if tg_op = 'INSERT' then
        if new.number not like 'INV-PENDING-%' then
            raise exception
                'Invoice numbers are assigned by the database'
                using errcode = '42501';
        end if;
        return new;
    end if;

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

    if new.number is distinct from old.number then
        if not (old.number like 'INV-PENDING-%' and new.number = 'INV-NEXT') then
            raise exception
                'An invoice number cannot be changed'
                using errcode = '42501';
        end if;

        select coalesce(nullif(btrim(w.timezone), ''), 'Europe/Chisinau')
        into v_zone
        from public.workspaces w
        where w.id = new.workspace_id;

        begin
            v_year := extract(year from new.created_at at time zone coalesce(v_zone, 'Europe/Chisinau'))::integer;
        exception
            when invalid_parameter_value then
                v_year := extract(year from new.created_at at time zone 'Europe/Chisinau')::integer;
        end;

        loop
            insert into public.invoice_number_counters as c (workspace_id, year, last_number)
            values (new.workspace_id, v_year, 1)
            on conflict (workspace_id, year)
            do update set last_number = c.last_number + 1
            returning c.last_number into v_sequence;

            new.number := 'INV-' || v_year::text || '-' || lpad(v_sequence::text, greatest(3, length(v_sequence::text)), '0');

            exit when not exists (
                select 1 from public.invoices i
                where i.workspace_id = new.workspace_id and i.number = new.number);
        end loop;
    end if;

    new.updated_at = now();
    return new;
end;
$function$;

drop trigger invoices_protect_identity on public.invoices;
CREATE TRIGGER invoices_protect_identity BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.protect_invoice_identity();

-- -------------------------------------------------------------------------------------------
-- Privileges (counters are read-only for service_role, invisible to anon/authenticated)
-- -------------------------------------------------------------------------------------------

revoke all on table public.invoice_number_counters from public, anon, authenticated, service_role;
grant select on table public.invoice_number_counters to service_role;

revoke all on function public.protect_invoice_identity() from public, anon, authenticated, service_role;
grant execute on function public.protect_invoice_identity() to service_role;

notify pgrst, 'reload schema';
