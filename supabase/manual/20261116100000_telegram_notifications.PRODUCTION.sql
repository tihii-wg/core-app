-- =============================================================================
-- Telegram notifications for staff (personal, per user, per workspace)
-- Script: 20261116100000_telegram_notifications.PRODUCTION.sql
-- MAIN only. Manual apply after review. Idempotent.
--
-- What it adds
--   user_telegram_links         one Telegram chat per Core App user (linked via the bot /start <token>)
--   telegram_link_tokens        short-lived one-time tokens for the deep link
--   notification_subscriptions  per workspace × user × event: enabled + scope ('all' | 'mine')
--   notification_outbox         queue read by the Edge Function "telegram-dispatch"
--   triggers on orders / payments / inventory_items + crm_notify_daily() for deadlines
--
-- Delivery: rows are queued here; "telegram-dispatch" sends them (kicked right after insert via
-- pg_net when available, and every minute by the scheduler script 20261116100100).
-- Triggers never block the business write: every notify path swallows its own errors.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
create table if not exists public.user_telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null,
  username text,
  first_name text,
  is_active boolean not null default true,
  last_error text,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_telegram_links_chat_id_key on public.user_telegram_links (chat_id);

create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists telegram_link_tokens_user_idx on public.telegram_link_tokens (user_id);

create table if not exists public.notification_subscriptions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  enabled boolean not null default true,
  scope text not null default 'all',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, event),
  constraint notification_subscriptions_scope_check check (scope in ('all', 'mine')),
  constraint notification_subscriptions_event_check check (event in (
    'order_created', 'estimate_created', 'order_status_changed', 'order_closed', 'order_cancelled',
    'order_assigned_to_me', 'payment_received', 'payment_stage_due',
    'order_deadline_tomorrow', 'order_overdue', 'inventory_low_stock'
  ))
);
create index if not exists notification_subscriptions_ws_event_idx
  on public.notification_subscriptions (workspace_id, event) where enabled;

create table if not exists public.notification_outbox (
  id bigserial primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
alter table public.notification_outbox add column if not exists claimed_at timestamptz;
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where sent_at is null;
create unique index if not exists notification_outbox_dedupe_key
  on public.notification_outbox (user_id, dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- 2) RLS: users manage only their own link + subscriptions; queue/tokens are server-only
-- ---------------------------------------------------------------------------
alter table public.user_telegram_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

revoke all on public.user_telegram_links, public.telegram_link_tokens,
  public.notification_subscriptions, public.notification_outbox from anon;
revoke all on public.telegram_link_tokens, public.notification_outbox from authenticated;
revoke insert, update on public.user_telegram_links from authenticated;
grant select, delete on public.user_telegram_links to authenticated;
grant select, insert, update, delete on public.notification_subscriptions to authenticated;
grant all on public.user_telegram_links, public.telegram_link_tokens,
  public.notification_subscriptions, public.notification_outbox to service_role;
grant usage, select on sequence public.notification_outbox_id_seq to service_role;

drop policy if exists user_telegram_links_select_own on public.user_telegram_links;
create policy user_telegram_links_select_own on public.user_telegram_links
  for select to authenticated using (user_id = auth.uid());
drop policy if exists user_telegram_links_delete_own on public.user_telegram_links;
create policy user_telegram_links_delete_own on public.user_telegram_links
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists notification_subscriptions_own on public.notification_subscriptions;
create policy notification_subscriptions_own on public.notification_subscriptions
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = notification_subscriptions.workspace_id
        and wm.user_id = auth.uid() and wm.deleted_at is null
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = notification_subscriptions.workspace_id
        and wm.user_id = auth.uid() and wm.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Linking RPCs
-- ---------------------------------------------------------------------------
create or replace function public.crm_telegram_link_token()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'telegram_link:not_authenticated' using errcode = '42501';
  end if;
  delete from public.telegram_link_tokens where user_id = v_uid or expires_at < now();
  -- Telegram /start payload: 1–64 chars of [A-Za-z0-9_-]
  v_token := replace(replace(rtrim(encode(extensions.gen_random_bytes(24), 'base64'), '='), '+', '-'), '/', '_');
  insert into public.telegram_link_tokens (token, user_id, expires_at)
  values (v_token, v_uid, now() + interval '15 minutes');
  return v_token;
end;
$fn$;

create or replace function public.crm_telegram_unlink()
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'telegram_link:not_authenticated' using errcode = '42501';
  end if;
  delete from public.user_telegram_links where user_id = auth.uid();
  delete from public.notification_outbox where user_id = auth.uid() and sent_at is null;
end;
$fn$;

revoke all on function public.crm_telegram_link_token() from public, anon;
revoke all on function public.crm_telegram_unlink() from public, anon;
grant execute on function public.crm_telegram_link_token() to authenticated;
grant execute on function public.crm_telegram_unlink() to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Helpers
-- ---------------------------------------------------------------------------
-- "Mine" = assigned employee, member of the order team, or creator.
create or replace function public.crm_notify_user_on_order(p_user_id uuid, p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select exists (
    select 1
    from public.orders o
    left join public.employees e on e.id = o.employee_id
    where o.id = p_order_id
      and (o.created_by = p_user_id or e.profile_id = p_user_id)
  )
  or exists (
    select 1
    from public.order_employees oe
    join public.employees e on e.id = oe.employee_id
    where oe.order_id = p_order_id and e.profile_id = p_user_id
  );
$fn$;

-- Display data for an order (read via to_jsonb so optional columns never break the trigger).
create or replace function public.crm_notify_order_payload(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_order jsonb;
  v_client text;
  v_status_name text;
begin
  select to_jsonb(o) into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    return '{}'::jsonb;
  end if;
  select c.name into v_client from public.clients c where c.id = nullif(v_order->>'client_id', '')::uuid;
  if nullif(v_order->>'custom_status_id', '') is not null then
    select sd.name into v_status_name
    from public.status_definitions sd
    where sd.id = (v_order->>'custom_status_id')::uuid;
  end if;
  return jsonb_build_object(
    'order_id', p_order_id,
    'number', v_order->>'number',
    'kind', coalesce(v_order->>'kind', 'order'),
    'client', v_client,
    'status', v_order->>'status',
    'status_name', v_status_name,
    'total', v_order->'total_price',
    'deadline', v_order->>'deadline',
    'device', v_order->>'device'
  );
end;
$fn$;

-- Queue one event for every subscribed, linked, active member (actor excluded).
create or replace function public.crm_notify_enqueue(
  p_workspace_id uuid,
  p_event text,
  p_entity_id uuid,
  p_payload jsonb,
  p_actor uuid default null,
  p_dedupe text default null,
  p_only_user uuid default null,
  p_order_scoped boolean default true
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into public.notification_outbox (workspace_id, user_id, event, entity_id, payload, dedupe_key)
  select p_workspace_id, s.user_id, p_event, p_entity_id, coalesce(p_payload, '{}'::jsonb),
         case when p_dedupe is null then null else p_dedupe end
  from public.notification_subscriptions s
  join public.workspace_members wm
    on wm.workspace_id = s.workspace_id and wm.user_id = s.user_id and wm.deleted_at is null
  join public.user_telegram_links l
    on l.user_id = s.user_id and l.is_active
  where s.workspace_id = p_workspace_id
    and s.event = p_event
    and s.enabled
    and (p_actor is null or s.user_id <> p_actor)
    and (p_only_user is null or s.user_id = p_only_user)
    and (
      s.scope = 'all'
      or not p_order_scoped
      or p_entity_id is null
      or public.crm_notify_user_on_order(s.user_id, p_entity_id)
    )
  on conflict do nothing;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5) Triggers
-- ---------------------------------------------------------------------------
create or replace function public.crm_notify_orders_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_assignee_user uuid;
  v_kind text := coalesce(v_new->>'kind', 'order');
begin
  begin
    -- Cheap exit: most order updates (totals, notes, lines) are not notification events.
    if tg_op = 'UPDATE'
       and (v_new->>'status') is not distinct from (v_old->>'status')
       and (v_new->>'custom_status_id') is not distinct from (v_old->>'custom_status_id')
       and (v_new->>'closed_at') is not distinct from (v_old->>'closed_at')
       and (v_new->>'employee_id') is not distinct from (v_old->>'employee_id') then
      return null;
    end if;
    -- Nobody in this workspace subscribed to anything → skip all work.
    if not exists (
      select 1 from public.notification_subscriptions s
      where s.workspace_id = new.workspace_id and s.enabled
    ) then
      return null;
    end if;

    v_payload := public.crm_notify_order_payload(new.id);

    if tg_op = 'INSERT' then
      perform public.crm_notify_enqueue(
        new.workspace_id,
        case when v_kind = 'estimate' then 'estimate_created' else 'order_created' end,
        new.id, v_payload, v_actor
      );
    else
      if nullif(v_old->>'closed_at', '') is null and nullif(v_new->>'closed_at', '') is not null then
        perform public.crm_notify_enqueue(new.workspace_id, 'order_closed', new.id, v_payload, v_actor);
      elsif (v_new->>'status') = 'cancelled' and (v_old->>'status') is distinct from 'cancelled' then
        perform public.crm_notify_enqueue(new.workspace_id, 'order_cancelled', new.id, v_payload, v_actor);
      elsif (v_new->>'status') is distinct from (v_old->>'status')
         or (v_new->>'custom_status_id') is distinct from (v_old->>'custom_status_id') then
        perform public.crm_notify_enqueue(new.workspace_id, 'order_status_changed', new.id, v_payload, v_actor);
      end if;
    end if;

    -- Assigned to me: new order with an assignee, or assignee changed.
    if nullif(v_new->>'employee_id', '') is not null
       and (tg_op = 'INSERT' or (v_new->>'employee_id') is distinct from (v_old->>'employee_id')) then
      select e.profile_id into v_assignee_user
      from public.employees e where e.id = (v_new->>'employee_id')::uuid;
      if v_assignee_user is not null then
        perform public.crm_notify_enqueue(
          new.workspace_id, 'order_assigned_to_me', new.id, v_payload, v_actor, null, v_assignee_user, false
        );
      end if;
    end if;
  exception when others then
    raise warning 'crm_notify_orders_trigger: %', sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists crm_notify_orders on public.orders;
create trigger crm_notify_orders
  after insert or update on public.orders
  for each row execute function public.crm_notify_orders_trigger();

create or replace function public.crm_notify_payments_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_new jsonb := to_jsonb(new);
  v_payload jsonb;
  v_order_id uuid := nullif(v_new->>'order_id', '')::uuid;
begin
  begin
    if coalesce(v_new->>'kind', 'payment') <> 'payment' then
      return null;
    end if;
    v_payload := coalesce(case when v_order_id is not null then public.crm_notify_order_payload(v_order_id) end, '{}'::jsonb)
      || jsonb_build_object(
        'amount', v_new->'amount',
        'currency', v_new->>'currency_code',
        'method', v_new->>'payment_method'
      );
    perform public.crm_notify_enqueue(
      new.workspace_id, 'payment_received', coalesce(v_order_id, new.id), v_payload, auth.uid(),
      null, null, v_order_id is not null
    );
  exception when others then
    raise warning 'crm_notify_payments_trigger: %', sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists crm_notify_payments on public.payments;
create trigger crm_notify_payments
  after insert on public.payments
  for each row execute function public.crm_notify_payments_trigger();

create or replace function public.crm_notify_inventory_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  begin
    if coalesce(new.is_active, true)
       and coalesce(new.min_quantity, 0) > 0
       and coalesce(new.quantity, 0) < new.min_quantity
       and coalesce(old.quantity, 0) >= coalesce(old.min_quantity, 0) then
      perform public.crm_notify_enqueue(
        new.workspace_id, 'inventory_low_stock', new.id,
        jsonb_build_object(
          'item_id', new.id, 'name', new.name, 'sku', new.sku,
          'quantity', new.quantity, 'min_quantity', new.min_quantity, 'unit', new.unit
        ),
        auth.uid(), null, null, false
      );
    end if;
  exception when others then
    raise warning 'crm_notify_inventory_trigger: %', sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists crm_notify_inventory on public.inventory_items;
create trigger crm_notify_inventory
  after update of quantity, min_quantity on public.inventory_items
  for each row execute function public.crm_notify_inventory_trigger();

-- ---------------------------------------------------------------------------
-- 6) Daily reminders (called by the scheduler; dedupe keeps them once per day)
-- ---------------------------------------------------------------------------
create or replace function public.crm_notify_daily()
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ws record;
  v_row record;
  v_today date;
  v_count integer := 0;
begin
  for v_ws in
    select distinct w.id, coalesce(nullif(to_jsonb(w)->>'timezone', ''), 'Europe/Chisinau') as tz
    from public.workspaces w
    join public.notification_subscriptions s on s.workspace_id = w.id and s.enabled
    where s.event in ('order_deadline_tomorrow', 'order_overdue', 'payment_stage_due')
      and coalesce(to_jsonb(w)->>'deleted_at', '') = ''
  loop
    begin
      v_today := (now() at time zone v_ws.tz)::date;
    exception when others then
      v_today := (now() at time zone 'Europe/Chisinau')::date;
    end;

    for v_row in
      select o.id, o.deadline::date as deadline
      from public.orders o
      where o.workspace_id = v_ws.id
        and o.deadline is not null
        and o.deadline::date in (v_today + 1, v_today - 1)
        and coalesce(to_jsonb(o)->>'kind', 'order') = 'order'
        and nullif(to_jsonb(o)->>'closed_at', '') is null
        and coalesce(o.status, '') not in ('closed', 'cancelled', 'completed', 'paid')
    loop
      if v_row.deadline = v_today + 1 then
        perform public.crm_notify_enqueue(v_ws.id, 'order_deadline_tomorrow', v_row.id,
          public.crm_notify_order_payload(v_row.id), null, 'deadline:' || v_row.id || ':' || v_today);
      else
        -- First day overdue only (no daily spam).
        perform public.crm_notify_enqueue(v_ws.id, 'order_overdue', v_row.id,
          public.crm_notify_order_payload(v_row.id), null, 'overdue:' || v_row.id);
      end if;
      v_count := v_count + 1;
    end loop;

    if to_regclass('public.order_payment_stages') is not null then
      for v_row in
        select st.id as stage_id, st.order_id, st.name, st.amount, st.percent
        from public.order_payment_stages st
        join public.orders o on o.id = st.order_id
        where st.workspace_id = v_ws.id
          and st.due_date = v_today + 1
          and coalesce(o.is_paid, false) = false
          and coalesce(o.status, '') not in ('cancelled')
      loop
        perform public.crm_notify_enqueue(v_ws.id, 'payment_stage_due', v_row.order_id,
          public.crm_notify_order_payload(v_row.order_id)
            || jsonb_build_object('stage', v_row.name, 'stage_amount', v_row.amount, 'stage_percent', v_row.percent),
          null, 'stage:' || v_row.stage_id || ':' || v_today);
        v_count := v_count + 1;
      end loop;
    end if;
  end loop;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7) Instant delivery: kick the dispatcher after new rows (best effort, needs pg_net + Vault secrets)
-- ---------------------------------------------------------------------------
create or replace function public.crm_telegram_kick()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_url text;
  v_token text;
begin
  begin
    if to_regnamespace('net') is null or to_regnamespace('vault') is null then
      return null;
    end if;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'telegram_dispatch_url'$q$ into v_url;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'telegram_cron_token'$q$ into v_token;
    if v_url is null or v_token is null then
      return null;
    end if;
    execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 10000)'
      using v_url,
            jsonb_build_object('Content-Type', 'application/json', 'x-telegram-cron-token', v_token),
            jsonb_build_object('mode', 'kick');
  exception when others then
    raise warning 'crm_telegram_kick: %', sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists crm_telegram_kick on public.notification_outbox;
create trigger crm_telegram_kick
  after insert on public.notification_outbox
  for each statement execute function public.crm_telegram_kick();

-- ---------------------------------------------------------------------------
-- 8) Dispatcher claim: concurrent runs (kick + cron) never send the same row twice
-- ---------------------------------------------------------------------------
create or replace function public.crm_notify_claim(p_limit integer default 100)
returns setof public.notification_outbox
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update public.notification_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where sent_at is null
        and attempts < 5
        and created_at > now() - interval '2 days'
        and (claimed_at is null or claimed_at < now() - interval '2 minutes')
      order by id
      limit greatest(1, least(coalesce(p_limit, 100), 500))
      for update skip locked
   )
  returning o.*;
$fn$;

revoke all on function public.crm_notify_claim(integer) from public, anon, authenticated;
grant execute on function public.crm_notify_claim(integer) to service_role;

-- Server-only functions
revoke all on function public.crm_notify_user_on_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_notify_order_payload(uuid) from public, anon, authenticated;
revoke all on function public.crm_notify_enqueue(uuid, text, uuid, jsonb, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.crm_notify_daily() from public, anon, authenticated;
revoke all on function public.crm_notify_orders_trigger() from public, anon, authenticated;
revoke all on function public.crm_notify_payments_trigger() from public, anon, authenticated;
revoke all on function public.crm_notify_inventory_trigger() from public, anon, authenticated;
revoke all on function public.crm_telegram_kick() from public, anon, authenticated;
grant execute on function public.crm_notify_daily() to service_role;

notify pgrst, 'reload schema';

commit;
