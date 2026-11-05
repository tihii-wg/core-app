-- =============================================================================
-- Core App — MANUAL cleanup: duplicate order status history (order_events)
-- MAIN only: pundggjzzaqzbvykbxvo
-- DO NOT auto-apply. Review preflight counts, then run Section 2 deliberately.
-- =============================================================================
--
-- Context
-- -------
-- App-layer `crm_record_order_event` calls historically dual-wrote alongside the
-- DB trigger `crm_orders_status_event`, producing duplicate `status_changed` rows
-- for one logical transition (often one `field_name=status` + one
-- `field_name=custom_status_id`, or two near-identical rows within ~10s).
--
-- App code now relies on the trigger as the sole writer. This script only cleans
-- already-persisted duplicates. It does NOT delete non-status activity, payments,
-- warranties, or unique lifecycle rows.
--
-- Identification (exact / conservative)
-- -------------------------------------
-- A) Exact near-duplicates: same order_id, event_type=status_changed, field_name,
--    old_value, new_value, actor_user_id, created within 10 seconds — keep the
--    earliest row (matches crm_order_event_insert guard semantics).
-- B) Paired status + custom_status_id from the same logical UPDATE: same order_id,
--    event_type=status_changed, one row field_name=status and one
--    field_name=custom_status_id, created_at within 2 seconds, same actor —
--    keep the status row (or the one with payload.lifecycle when present);
--    delete the custom_status_id sibling.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) PREFLIGHT (read-only)
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_exact bigint;
  v_paired bigint;
begin
  if to_regclass('public.order_events') is null then
    raise exception 'Preflight failed: public.order_events missing';
  end if;

  select count(*) into v_exact
  from public.order_events e
  where e.event_type = 'status_changed'
    and exists (
      select 1
      from public.order_events d
      where d.order_id = e.order_id
        and d.event_type = e.event_type
        and d.field_name is not distinct from e.field_name
        and d.old_value is not distinct from e.old_value
        and d.new_value is not distinct from e.new_value
        and d.actor_user_id is not distinct from e.actor_user_id
        and d.id <> e.id
        and d.created_at > e.created_at
        and d.created_at <= e.created_at + interval '10 seconds'
    );

  select count(*) into v_paired
  from public.order_events s
  join public.order_events c
    on c.order_id = s.order_id
   and c.event_type = 'status_changed'
   and c.field_name = 'custom_status_id'
   and s.field_name = 'status'
   and s.event_type = 'status_changed'
   and c.actor_user_id is not distinct from s.actor_user_id
   and c.created_at >= s.created_at - interval '2 seconds'
   and c.created_at <= s.created_at + interval '2 seconds'
   and c.id <> s.id;

  raise notice 'dedupe preflight: exact_near_duplicate_later_rows=% paired_custom_siblings=%', v_exact, v_paired;
end;
$pre$;

-- Preview candidates (optional):
-- select e.* from public.order_events e where ... (same predicates as Section 2);

-- ---------------------------------------------------------------------------
-- 2) APPLY (run only after reviewing preflight)
-- ---------------------------------------------------------------------------
begin;

-- A) Delete later exact near-duplicates; keep the earliest id/created_at.
with ranked as (
  select
    e.id,
    row_number() over (
      partition by
        e.order_id,
        e.event_type,
        e.field_name,
        e.old_value,
        e.new_value,
        e.actor_user_id,
        -- bucket near-simultaneous writes
        date_trunc('second', e.created_at)
      order by e.created_at asc, e.id asc
    ) as rn
  from public.order_events e
  where e.event_type = 'status_changed'
),
to_delete as (
  select r.id
  from ranked r
  where r.rn > 1
    and exists (
      select 1
      from public.order_events keep
      join public.order_events dup on dup.id = r.id
      where keep.order_id = dup.order_id
        and keep.event_type = 'status_changed'
        and keep.field_name is not distinct from dup.field_name
        and keep.old_value is not distinct from dup.old_value
        and keep.new_value is not distinct from dup.new_value
        and keep.actor_user_id is not distinct from dup.actor_user_id
        and keep.id <> dup.id
        and keep.created_at <= dup.created_at
        and dup.created_at <= keep.created_at + interval '10 seconds'
    )
)
delete from public.order_events e
using to_delete d
where e.id = d.id;

-- B) Delete custom_status_id siblings paired with a status row in a 2s window.
with paired as (
  select c.id as custom_id
  from public.order_events s
  join public.order_events c
    on c.order_id = s.order_id
   and c.event_type = 'status_changed'
   and c.field_name = 'custom_status_id'
   and s.event_type = 'status_changed'
   and s.field_name = 'status'
   and c.actor_user_id is not distinct from s.actor_user_id
   and c.created_at >= s.created_at - interval '2 seconds'
   and c.created_at <= s.created_at + interval '2 seconds'
   and c.id <> s.id
)
delete from public.order_events e
using paired p
where e.id = p.custom_id;

-- ---------------------------------------------------------------------------
-- 3) POSTFLIGHT
-- ---------------------------------------------------------------------------
do $post$
declare
  v_exact bigint;
  v_paired bigint;
begin
  select count(*) into v_exact
  from public.order_events e
  where e.event_type = 'status_changed'
    and exists (
      select 1
      from public.order_events d
      where d.order_id = e.order_id
        and d.event_type = e.event_type
        and d.field_name is not distinct from e.field_name
        and d.old_value is not distinct from e.old_value
        and d.new_value is not distinct from e.new_value
        and d.actor_user_id is not distinct from e.actor_user_id
        and d.id <> e.id
        and d.created_at > e.created_at
        and d.created_at <= e.created_at + interval '10 seconds'
    );

  select count(*) into v_paired
  from public.order_events s
  join public.order_events c
    on c.order_id = s.order_id
   and c.event_type = 'status_changed'
   and c.field_name = 'custom_status_id'
   and s.field_name = 'status'
   and s.event_type = 'status_changed'
   and c.actor_user_id is not distinct from s.actor_user_id
   and c.created_at >= s.created_at - interval '2 seconds'
   and c.created_at <= s.created_at + interval '2 seconds'
   and c.id <> s.id;

  if v_exact > 0 or v_paired > 0 then
    raise exception 'Postflight failed: exact_remaining=% paired_remaining=%', v_exact, v_paired;
  end if;

  raise notice 'dedupe postflight ok: no exact near-duplicates or paired status/custom siblings remain';
end;
$post$;

commit;
