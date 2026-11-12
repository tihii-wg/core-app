-- =============================================================================
-- Keep orders.service / service_id (text summary of service lines) in sync for line RPCs
-- Script: 20261112150000_order_service_summary_sync.PRODUCTION.sql
-- MAIN only. Do NOT run against TEST. Manual apply after review.
-- Requires: 20261112140000_order_line_rpcs.PRODUCTION.sql (crm_recalc_order_line_totals).
-- =============================================================================
-- 1) crm_recalc_order_line_totals now also writes orders.service / service_id, so adding or deleting a
--    service through the order card no longer leaves a stale «Услуга: …» text and stale list subtitle.
-- 2) One-time repair of OPEN orders whose summary drifted:
--    - orders that have service lines → summary rebuilt from the lines;
--    - orders with no service lines but a recorded service_removed event → summary cleared
--      (legacy orders that only ever had the text field are left untouched).
--    Closed / cancelled orders are not touched.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regprocedure('public.crm_recalc_order_line_totals(uuid)') is null then
    raise exception 'order_service_summary_sync preflight: apply 20261112140000_order_line_rpcs first';
  end if;
end;
$preflight$;

create or replace function public.crm_recalc_order_line_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_gross numeric := 0;
  v_discount numeric := 0;
  v_total numeric;
  v_has_discount_total boolean;
  v_service_summary text;
  v_first_service_id uuid;
begin
  with lines as (
    select round(coalesce(s.price, 0)::numeric * coalesce(s.quantity, 0)::numeric, 2) as gross,
           to_jsonb(s) ->> 'discount_type' as dt,
           nullif(to_jsonb(s) ->> 'discount_value', '')::numeric as dv
    from public.order_services s
    where s.order_id = p_order_id
    union all
    select round(coalesce(m.price, 0)::numeric * coalesce(m.quantity, 0)::numeric, 2),
           to_jsonb(m) ->> 'discount_type',
           nullif(to_jsonb(m) ->> 'discount_value', '')::numeric
    from public.order_materials m
    where m.order_id = p_order_id
  ),
  priced as (
    select gross,
           case
             when dt = 'percent' and dv > 0 and gross > 0
               then least(gross, round(gross * least(dv, 100) / 100, 2))
             when dt = 'amount' and dv > 0 and gross > 0
               then least(gross, round(dv, 2))
             else 0
           end as disc
    from lines
  )
  select coalesce(sum(gross), 0), coalesce(sum(disc), 0)
    into v_gross, v_discount
  from priced;
  v_total := greatest(0, round(v_gross - v_discount, 2));

  select exists (
    select 1 from pg_attribute
    where attrelid = 'public.orders'::regclass and attname = 'discount_total' and not attisdropped
  ) into v_has_discount_total;

  -- Text summary of the service lines (orders.service / service_id): shown in the orders list and as the
  -- fallback on the order card. Kept in sync here exactly like the full order save does.
  select string_agg(coalesce(s.service_name, ''), ', ' order by s.created_at, s.id),
         (array_agg(s.service_id order by s.created_at, s.id))[1]
    into v_service_summary, v_first_service_id
  from public.order_services s
  where s.order_id = p_order_id;

  update public.orders
     set total_price = v_total,
         service = nullif(v_service_summary, ''),
         service_id = v_first_service_id::text,
         updated_at = now()
   where id = p_order_id;
  if v_has_discount_total then
    execute 'update public.orders set discount_total = $2 where id = $1'
      using p_order_id, round(v_discount, 2);
  end if;
end;
$fn$;

revoke all on function public.crm_recalc_order_line_totals(uuid) from public, anon;
grant execute on function public.crm_recalc_order_line_totals(uuid) to authenticated;

-- One-time repair (open orders only).
with summary as (
  select s.order_id,
         string_agg(coalesce(s.service_name, ''), ', ' order by s.created_at, s.id) as names,
         (array_agg(s.service_id order by s.created_at, s.id))[1] as first_id
  from public.order_services s
  group by s.order_id
)
update public.orders o
   set service = nullif(summary.names, ''),
       service_id = summary.first_id::text
  from summary
 where summary.order_id = o.id
   and o.closed_at is null
   and o.status not in ('closed', 'cancelled')
   and (o.service is distinct from nullif(summary.names, '') or o.service_id::text is distinct from summary.first_id::text);

update public.orders o
   set service = null,
       service_id = null
 where o.closed_at is null
   and o.status not in ('closed', 'cancelled')
   and o.service is not null
   and not exists (select 1 from public.order_services s where s.order_id = o.id)
   and exists (
     select 1 from public.order_events e
      where e.order_id = o.id and e.event_type = 'service_removed'
   );

commit;
