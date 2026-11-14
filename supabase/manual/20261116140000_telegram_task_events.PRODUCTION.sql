-- =============================================================================
-- Telegram: task events (task_assigned → assignee, task_completed → author).
-- Script: 20261116140000_telegram_task_events.PRODUCTION.sql — apply manually on MAIN
-- AFTER 20261116100000_telegram_notifications and 20261116130000_task_assignment.
--
-- Task events are ON by default (personal and important): a user gets them while linked to Telegram
-- unless they switched the event off in Settings → Notifications (an explicit enabled = false row).
-- Idempotent. Transactional.
-- =============================================================================

begin;

do $preflight$
begin
  if to_regclass('public.notification_outbox') is null or to_regclass('public.notification_subscriptions') is null then
    raise exception 'telegram_task_events preflight: apply 20261116100000_telegram_notifications first';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tasks' and column_name = 'assigned_to') then
    raise exception 'telegram_task_events preflight: apply 20261116130000_task_assignment first';
  end if;
end;
$preflight$;

alter table public.notification_subscriptions drop constraint if exists notification_subscriptions_event_check;
alter table public.notification_subscriptions add constraint notification_subscriptions_event_check check (event in (
  'order_created', 'estimate_created', 'order_status_changed', 'order_closed', 'order_cancelled',
  'order_assigned_to_me', 'payment_received', 'payment_stage_due',
  'order_deadline_tomorrow', 'order_overdue', 'inventory_low_stock',
  'task_assigned', 'task_completed'
));

-- One recipient, default-on: skipped only when that user disabled the event for this workspace.
create or replace function public.crm_notify_enqueue_default_on(
  p_workspace_id uuid,
  p_event text,
  p_entity_id uuid,
  p_payload jsonb,
  p_user uuid,
  p_dedupe text
)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, public as $fn$
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.workspace_members wm
                 where wm.workspace_id = p_workspace_id and wm.user_id = p_user and wm.deleted_at is null) then
    return;
  end if;
  if not exists (select 1 from public.user_telegram_links l where l.user_id = p_user and l.is_active) then
    return;
  end if;
  if exists (select 1 from public.notification_subscriptions s
             where s.workspace_id = p_workspace_id and s.user_id = p_user and s.event = p_event and not s.enabled) then
    return;
  end if;
  insert into public.notification_outbox (workspace_id, user_id, event, entity_id, payload, dedupe_key)
  values (p_workspace_id, p_user, p_event, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict do nothing;
end;
$fn$;
revoke all on function public.crm_notify_enqueue_default_on(uuid, text, uuid, jsonb, uuid, text) from public, anon, authenticated;

create or replace function public.crm_notify_tasks_trigger()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_tz text;
  v_payload jsonb;
begin
  begin
    if new.deleted_at is not null then return null; end if;

    select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), '')) into v_actor_name
    from public.profiles p where p.id = v_actor;
    select coalesce(nullif(w.timezone, ''), 'Europe/Chisinau') into v_tz from public.workspaces w where w.id = new.workspace_id;

    v_payload := jsonb_build_object(
      'task_id', new.id,
      'title', new.title,
      'description', left(coalesce(new.description, ''), 500),
      'due_at', new.due_at,
      'due_text', case when new.due_at is null then null
                       else to_char(new.due_at at time zone v_tz, 'DD.MM.YYYY HH24:MI') end,
      'actor_name', v_actor_name
    );

    -- Assigned (new task, or reassigned to someone else) — not when you assign it to yourself.
    if new.assigned_to is not null
       and new.completed_at is null
       and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
       and new.assigned_to is distinct from v_actor then
      perform public.crm_notify_enqueue_default_on(
        new.workspace_id, 'task_assigned', new.id, v_payload, new.assigned_to,
        'task_assigned:' || new.id || ':' || new.assigned_to);
    end if;

    -- Completed — tell the author (unless the author completed it).
    if tg_op = 'UPDATE' and new.completed_at is not null and old.completed_at is null
       and new.created_by is not null and new.created_by is distinct from v_actor then
      perform public.crm_notify_enqueue_default_on(
        new.workspace_id, 'task_completed', new.id, v_payload, new.created_by,
        'task_completed:' || new.id || ':' || extract(epoch from new.completed_at)::bigint);
    end if;
  exception when others then
    raise warning 'crm_notify_tasks_trigger: %', sqlerrm;
  end;
  return null;
end;
$fn$;

drop trigger if exists crm_notify_tasks on public.tasks;
create trigger crm_notify_tasks after insert or update of assigned_to, completed_at, deleted_at on public.tasks
  for each row execute function public.crm_notify_tasks_trigger();

commit;

notify pgrst, 'reload schema';
