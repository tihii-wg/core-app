-- =====================================================================
-- Core App: orders.custom_status_id + простые аддитивные поля заказа
-- (Приложение А, раздел 13 «Новые поля в существующих таблицах»).
--
-- Минимальный вариант для случая, когда crm_ro_v1.PRODUCTION.sql ещё не применён
-- целиком. Если crm_ro_v1 уже применён, скрипт ничего не меняет (всё IF NOT EXISTS).
--
-- Что делает:
--   * если public.status_definitions нет, создаёт её с тем же DDL, что в crm_ro_v1
--     (RLS включён, доступ только у service_role, комментарий таблицы 'crm_ro_v1',
--     чтобы последующий запуск crm_ro_v1.PRODUCTION.sql прошёл проверку имён и
--     выдал политики, триггеры и индексы);
--   * добавляет в public.orders: custom_status_id (FK -> status_definitions, on delete
--     set null) и индекс, а также колонки без зависимостей от новых таблиц:
--     manager_id (-> employees), payer_client_id (-> clients), warranty_source_order_id
--     (-> orders), scheduled_from, scheduled_to, status_changed_at, closed_at,
--     service_type, malfunction, manager_notes, technician_notes, conclusion,
--     estimated_price, advance, discount_total, tax_total, is_urgent, legacy_number.
--
-- Что НЕ добавляется (нужны таблицы из crm_ro_v1, останутся для него):
--   order_type_id, location_id, ad_campaign_id, resource_id, estimate_id.
--
-- Не трогает CHECK/enum orders.status, строки, политики и триггеры orders.
-- Бэкап обязателен. Идемпотентно, одна транзакция.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.workspaces') is null
     or to_regclass('public.employees') is null
     or to_regclass('public.clients') is null then
    raise exception 'Нет одной из таблиц public.orders / workspaces / employees / clients';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. status_definitions (no-op, если уже создана crm_ro_v1)
-- ---------------------------------------------------------------------
create table if not exists public.status_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('order','estimate','lead','invoice','transfer','task')),
  name text not null,
  color text,
  status_group text not null check (status_group in ('new','in_progress','pending','delivery','done','paid','closed','dropped_off','canceled')),
  system_status text,
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  show_overdue_badge boolean not null default false,
  require_on_enter text check (require_on_enter in ('order','sale','comment')),
  moves_device boolean not null default false,
  device_move_data jsonb not null default '{}'::jsonb,
  adds_to_backorders boolean not null default false,
  allow_past_close_date boolean not null default false,
  require_checklist boolean not null default false,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists status_definitions_name_idx
  on public.status_definitions (workspace_id, entity, lower(name)) where deleted_at is null;

-- Только что созданную (не из crm_ro_v1) таблицу закрываем от браузера и помечаем,
-- чтобы crm_ro_v1 принял её как свою. Уже существующую и помеченную не трогаем.
do $$
begin
  if coalesce(obj_description('public.status_definitions'::regclass, 'pg_class'), '') = '' then
    alter table public.status_definitions enable row level security;
    revoke all on public.status_definitions from public, anon, authenticated;
    grant all on public.status_definitions to service_role;
    comment on table public.status_definitions is 'crm_ro_v1';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. orders: custom_status_id
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists custom_status_id uuid references public.status_definitions(id) on delete set null;
create index if not exists orders_custom_status_id_idx on public.orders (custom_status_id);

-- ---------------------------------------------------------------------
-- 3. orders: простые поля из Приложения А (раздел 13)
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists payer_client_id uuid references public.clients(id) on delete set null,
  add column if not exists warranty_source_order_id uuid references public.orders(id) on delete set null,
  add column if not exists scheduled_from timestamptz,
  add column if not exists scheduled_to timestamptz,
  add column if not exists status_changed_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists service_type text,
  add column if not exists malfunction text,
  add column if not exists manager_notes text,
  add column if not exists technician_notes text,
  add column if not exists conclusion text,
  add column if not exists estimated_price numeric(16,2),
  add column if not exists advance numeric(16,2),
  add column if not exists discount_total numeric(16,2),
  add column if not exists tax_total numeric(16,2),
  add column if not exists is_urgent boolean not null default false,
  add column if not exists legacy_number text;

create unique index if not exists orders_legacy_number_idx
  on public.orders (workspace_id, legacy_number) where legacy_number is not null;
create index if not exists orders_manager_id_idx on public.orders (manager_id);
create index if not exists orders_scheduled_from_idx on public.orders (scheduled_from);

commit;

-- Проверка после применения (необязательно):
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'orders' and column_name in
--   ('custom_status_id','manager_id','payer_client_id','service_type','legacy_number','is_urgent')
--  order by 1;
