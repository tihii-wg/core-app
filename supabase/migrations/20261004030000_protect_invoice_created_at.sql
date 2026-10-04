-- The database sets invoices.created_at; a value sent by the client is ignored.
--
-- Depends on 20261004020000_invoice_number_counters.sql. Until now the column default (now()) applied
-- only when the INSERT left created_at out, so a client could store any created_at it chose and,
-- because the issued number takes its year from created_at, put the invoice into another year's
-- sequence. protect_invoice_identity now overwrites created_at with now() on every INSERT, whatever
-- the role (anon, authenticated, service_role or the table owner) and whatever value was sent.
-- now() is the start time of the inserting transaction, i.e. of the request through PostgREST.
-- Unchanged: the number rules and counters, the UPDATE rules (created_at still cannot be changed),
-- RLS, grants and the trigger itself (still BEFORE INSERT OR UPDATE). Existing rows are not touched,
-- so no stored created_at or invoice number changes.

do $$
begin
    if to_regclass('public.invoice_number_counters') is null then
        raise exception 'Apply 20261004020000_invoice_number_counters.sql before this migration';
    end if;
end;
$$;

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
        new.created_at := now();
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

revoke all on function public.protect_invoice_identity() from public, anon, authenticated, service_role;
grant execute on function public.protect_invoice_identity() to service_role;

notify pgrst, 'reload schema';
