-- =====================================================================
-- Core App: read-only public order status by token
--
--   crm_public_order_status(p_token text) -> jsonb | null
--
-- WHY: `public_links` (crm_ro_v1) deliberately has NO anon RLS policy
-- (docs/ro-app-migration.md §6 "Публичные страницы"): public pages must read data
-- "по токену из public_links через RPC или Edge Function и отдавать только
-- разрешённые поля". This RPC is that read path for the route
--   /:locale/public/:token      (src/features/public/PublicOrderPage.tsx)
--
-- REQUIRES: crm_ro_v1.PRODUCTION.sql (step 2.1 of MIGRATION_CUTOVER.md).
-- Apply by hand in the Supabase SQL Editor: TEST first, then PROD.
-- IDEMPOTENT: safe to re-run. One transaction; nothing is changed on failure.
-- NOT applied automatically by the app or CI. NOT applied by the agent that wrote it.
--
-- Security model (no bypass of RLS on the tables themselves)
--   * The token is the only credential: ~244 bits from public_links.token (two UUIDs without
--     dashes). The function never lists, enumerates or accepts anything but an exact token.
--   * Only links with entity_type = 'order', revoked_at IS NULL and not expired are served.
--     Missing / revoked / expired / wrong-type tokens are indistinguishable: all return NULL.
--   * The order must belong to the link's workspace (defence in depth).
--   * ONLY these fields are returned: number, system status, custom status name/colour/group,
--     service type, deadline, created_at, updated_at. NEVER returned: client name/phone/email,
--     prices and totals, payments, manager/technician notes, order_comments, order_events,
--     employees, vehicle identifiers, line items.
--   * EXECUTE is granted to anon and authenticated; every other privilege on the function is revoked.
--   * No writes. STABLE, SECURITY DEFINER, search_path = '' (all names schema-qualified).
--   * Rate limiting is NOT implemented here; add it at the edge (Supabase/Cloudflare) if exposed widely.
--
-- Creating links is a separate concern: authenticated users with `orders.edit` can insert into
-- public.public_links through its RLS policy (crm_ro_v1 matrix: view '*', insert/update/delete
-- 'orders.edit'). The app does not create links yet.
-- =====================================================================

begin;

do $preflight$
begin
  if to_regclass('public.public_links') is null or to_regclass('public.orders') is null then
    raise exception 'Preflight failed: public.public_links / public.orders missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if to_regclass('public.status_definitions') is null then
    raise exception 'Preflight failed: public.status_definitions missing. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
  if exists (
    select 1
    from (values ('number'), ('status'), ('deadline'), ('created_at'), ('updated_at'), ('custom_status_id'), ('service_type')) as c(name)
    where not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = c.name
    )
  ) then
    raise exception 'Preflight failed: public.orders lacks one of number/status/deadline/created_at/updated_at/custom_status_id/service_type. Apply crm_ro_v1.PRODUCTION.sql first.';
  end if;
end
$preflight$;

create or replace function public.crm_public_order_status(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_link public.public_links%rowtype;
  v_result jsonb;
begin
  -- Cheap shape check first: the generated token is 64 lowercase hex characters.
  if p_token is null or p_token !~ '^[A-Za-z0-9]{20,128}$' then
    return null;
  end if;

  select * into v_link
    from public.public_links l
   where l.token = p_token
     and l.entity_type = 'order'
     and l.revoked_at is null
     and (l.expires_at is null or l.expires_at > now());
  if not found then
    return null;
  end if;

  select jsonb_build_object(
           'entity_type', 'order',
           'number', o.number,
           'status', o.status::text,
           'status_name', d.name,
           'status_color', d.color,
           'status_group', d.status_group,
           'service_type', o.service_type,
           'deadline', o.deadline,
           'created_at', o.created_at,
           'updated_at', o.updated_at
         )
    into v_result
    from public.orders o
    left join public.status_definitions d
      on d.id = o.custom_status_id
     and d.workspace_id = o.workspace_id
   where o.id = v_link.entity_id
     and o.workspace_id = v_link.workspace_id;

  return v_result;
end $$;

revoke all on function public.crm_public_order_status(text) from public;
grant execute on function public.crm_public_order_status(text) to anon, authenticated;

-- PostgREST picks up new functions after a schema reload.
notify pgrst, 'reload schema';

commit;
