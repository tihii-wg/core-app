-- =============================================================================
-- PREVIEW ONLY (read-only, changes nothing): what 20261126090000_owner_subscriptions will set.
-- Script: 20261126085900_owner_subscriptions_PREVIEW.sql
--
-- For every workspace: its subscription now → the owner's subscription after the migration
-- (the BEST of the owner's workspaces). «change» = what happens to that workspace:
--   same      — nothing changes
--   upgrade   — gets a better subscription from another workspace of the same owner
-- A downgrade is impossible by construction (best of the owner's rows); the last query proves it.
-- =============================================================================

with ranked as (
  select w.owner_id,
         lower(trim(w.subscription_status::text)) as status,
         w.subscription_started_at as started_at,
         w.subscription_expires_at as expires_at,
         row_number() over (
           partition by w.owner_id
           order by
             (w.deleted_at is not null),
             case
               when lower(trim(w.subscription_status::text)) = 'active'
                    and (w.subscription_expires_at is null or w.subscription_expires_at > now()) then 0
               when lower(trim(w.subscription_status::text)) in ('active', 'trial')
                    and w.subscription_expires_at > now() then 1
               else 2
             end,
             w.subscription_expires_at desc nulls first,
             w.created_at desc
         ) as rn
  from public.workspaces w
  where w.owner_id is not null
),
best as (
  select owner_id, status, started_at, expires_at from ranked where rn = 1
)
select coalesce(nullif(trim(p.email), ''), u.email) as owner_email,
       w.name as workspace,
       w.deleted_at is not null as deleted,
       lower(trim(w.subscription_status::text)) as status_now,
       w.subscription_expires_at as expires_now,
       b.status as status_after,
       b.expires_at as expires_after,
       case
         when (lower(trim(w.subscription_status::text)), w.subscription_expires_at)
              is not distinct from (b.status, b.expires_at) then 'same'
         else 'upgrade'
       end as change
from public.workspaces w
join best b on b.owner_id = w.owner_id
left join public.profiles p on p.id = w.owner_id
left join auth.users u on u.id = w.owner_id
order by owner_email, w.created_at;

-- Owners that have more than one distinct subscription today (the only ones whose workspaces change):
--   select owner_id, count(*) workspaces,
--          count(distinct (lower(trim(subscription_status::text)), subscription_expires_at)) variants
--   from public.workspaces where deleted_at is null
--   group by owner_id having count(distinct (lower(trim(subscription_status::text)), subscription_expires_at)) > 1;
