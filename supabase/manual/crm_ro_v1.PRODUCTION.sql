-- =====================================================================
-- Core App: таблицы, поля и RLS для функций из RO App. Версия 1.
--
-- Схема Core App восстановлена по приложению и JS-бандлу, без доступа к базе.
-- Перед запуском сделай бэкап и сначала примени на копии базы.
--
-- Что делает скрипт:
--   * проверяет схему и прерывается с понятной ошибкой, если она не совпадает;
--   * создаёт новые таблицы и закрывает их RLS;
--   * добавляет в существующие таблицы новые поля.
--
-- Чего не делает:
--   * не удаляет и не меняет существующие строки, колонки, политики и триггеры;
--   * не трогает CHECK и enum статусов (их меняем после аудита, отдельно);
--   * не создаёт бизнес-данные: локации, склады, роли, статусы.
--
-- Скрипт выполняется в одной транзакции, его можно запускать повторно.
--
-- Правила RLS:
--   * доступ есть только у активных участников рабочего пространства;
--   * владелец может всё; администратор без назначенной роли тоже;
--   * остальным права выдаются через member_roles и role_permissions;
--   * у anon нет доступа ни к одной новой таблице. Публичные страницы работают
--     только через RPC или Edge Function по токену из public_links;
--   * политики не фильтруют deleted_at, иначе мягкое удаление через UPDATE
--     упадёт с ошибкой RLS. Скрывай удалённые записи в запросах приложения;
--   * таблицы журналов и остатков пишутся только из RPC и триггеров.
--     RPC с security definer обходят RLS и обязаны сами вызывать crm_has_permission.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Проверка схемы
-- ---------------------------------------------------------------------

create or replace function pg_temp.crm_tables() returns text[]
language sql immutable as $$
  select array[
    'locations','roles','role_permissions','member_roles','activity_log','module_settings','numbering_templates',
    'status_definitions','status_role_permissions','status_transitions','order_types','custom_field_definitions','custom_field_values',
    'directories','directory_items','ad_campaigns','tags','taggings','resource_types','resources',
    'employee_groups','employee_group_members',
    'categories','price_types','price_type_defaults','role_price_types','item_prices','product_barcodes','bundles','bundle_items',
    'warehouses','bin_locations','warehouse_stock','goods_receipts','goods_receipt_lines','stock_batches','stock_serials',
    'stock_transfers','stock_transfer_lines','write_offs','write_off_lines','stock_takes','stock_take_lines',
    'purchase_orders','purchase_order_lines','sales','sale_lines','client_returns','client_return_lines',
    'supplier_returns','supplier_return_lines','stock_reservations','company_assets','stock_conversions',
    'order_events','order_comments','saved_filters','estimates','estimate_lines','vehicle_mileage_log','warranty_records',
    'checklists','checklist_items','order_checklist_items',
    'client_phones','client_addresses','client_discounts','client_balance_entries',
    'currencies','finance_accounts','finance_account_access','cashflow_categories','payment_methods','finance_transactions',
    'taxes','tax_groups','tax_group_items','tax_rules','invoice_orders','credit_notes','credit_note_lines','payment_links',
    'message_templates','message_template_translations','notification_rules','message_log','staff_notifications',
    'document_templates','status_print_templates','public_links','reviews','integration_connections','conversations','conversation_messages',
    'tasks','task_assignees','leads','bookings','booking_services','calls',
    'work_schedules','timesheet_entries','employee_balance_entries','payroll_rules','payroll_accruals','item_commission_rules',
    'api_keys','webhook_endpoints','migration_batches','migration_id_map','raw_ro_records'
  ]::text[]
$$;

do $$
declare
  v_problems text[] := '{}';
  v_item text;
  v_table text;
  v_column text;
  v_type text;
begin
  foreach v_item in array array[
    'workspaces.id','workspace_members.workspace_id','workspace_members.user_id',
    'clients.id','clients.workspace_id','vehicles.id','vehicles.workspace_id',
    'services.id','services.workspace_id','employees.id','employees.workspace_id',
    'orders.id','orders.workspace_id','order_services.id','order_materials.id','order_attachments.id',
    'inventory_items.id','inventory_items.workspace_id','invoices.id','invoices.workspace_id',
    'payments.id','payments.workspace_id'
  ] loop
    v_table := split_part(v_item, '.', 1);
    v_column := split_part(v_item, '.', 2);
    select data_type into v_type from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name = v_column;
    if not found then
      v_problems := v_problems || format('нет колонки public.%s', v_item);
    elsif v_type <> 'uuid' then
      v_problems := v_problems || format('public.%s имеет тип %s, ожидался uuid', v_item, v_type);
    end if;
  end loop;

  foreach v_item in array array[
    'workspace_members.role','workspace_members.deleted_at','invoice_items.id','inventory_movements.id'
  ] loop
    v_table := split_part(v_item, '.', 1);
    v_column := split_part(v_item, '.', 2);
    perform 1 from information_schema.columns
    where table_schema = 'public' and table_name = v_table and column_name = v_column;
    if not found then
      v_problems := v_problems || format('нет колонки public.%s', v_item);
    end if;
  end loop;

  if to_regprocedure('auth.uid()') is null then
    v_problems := v_problems || 'нет функции auth.uid()'::text;
  end if;

  -- Таблица с таким именем, созданная не этим скриптом, значит конфликт имён.
  foreach v_table in array pg_temp.crm_tables() loop
    if to_regclass(format('public.%I', v_table)) is not null
       and coalesce(obj_description(to_regclass(format('public.%I', v_table)), 'pg_class'), '') <> 'crm_ro_v1' then
      v_problems := v_problems || format('таблица public.%s уже существует и создана не этим скриптом', v_table);
    end if;
  end loop;

  if cardinality(v_problems) > 0 then
    raise exception E'Схема не совпадает, изменения не применены:\n%', array_to_string(v_problems, E'\n');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Основа: локации, роли, журнал, настройки
-- ---------------------------------------------------------------------

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  color text,
  code text,
  legal_entity_id uuid,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists locations_one_default_idx
  on public.locations (workspace_id) where is_default and deleted_at is null;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  -- Области видимости из блока Access роли RO App: см. Приложение Б. RLS их не применяет.
  scopes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.role_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, permission)
);

-- Отдельная таблица, а не workspace_members.role_id: политики workspace_members неизвестны,
-- и поле роли в этой таблице могло бы дать участнику повышение прав.
create table if not exists public.member_roles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  entity_type text not null,
  entity_id uuid,
  event text not null,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_workspace_created_idx on public.activity_log (workspace_id, created_at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);

create table if not exists public.module_settings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, key)
);

create table if not exists public.numbering_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('lead','order','estimate','invoice','credit_note','sale','goods_receipt','purchase_order','stock_transfer','write_off','stock_take','client_return','supplier_return')),
  location_id uuid references public.locations(id) on delete cascade,
  template text not null,
  next_value bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists numbering_templates_scope_idx
  on public.numbering_templates (workspace_id, entity, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------
-- 2. Статусы, формы, справочники
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

create table if not exists public.status_role_permissions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status_id uuid not null references public.status_definitions(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  can_view boolean not null default true,
  can_set boolean not null default true,
  primary key (status_id, role_id)
);

-- Разрешённые переходы. Нет строк у статуса значит, что из него никуда нельзя перейти.
create table if not exists public.status_transitions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status_id uuid not null references public.status_definitions(id) on delete cascade,
  next_status_id uuid not null references public.status_definitions(id) on delete cascade,
  primary key (status_id, next_status_id),
  check (status_id <> next_status_id)
);

create table if not exists public.order_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  is_warranty boolean not null default false,
  initial_status_id uuid references public.status_definitions(id) on delete set null,
  initial_estimate_status_id uuid references public.status_definitions(id) on delete set null,
  is_manager_required boolean not null default false,
  is_assignee_required boolean not null default false,
  location_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists public.directories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('vehicle_tree','product_attribute','service_type','custom')),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.directory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  directory_id uuid not null references public.directories(id) on delete cascade,
  parent_id uuid references public.directory_items(id) on delete cascade,
  level text not null default 'value' check (level in ('group','brand','model','modification','value')),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null check (entity in ('order','estimate','lead','client_person','client_organization','product','vehicle')),
  order_type_id uuid references public.order_types(id) on delete set null,
  field_key text not null,
  label text not null,
  field_type text not null check (field_type in ('header','text','textarea','number','date','datetime','select','checkbox','directory')),
  options jsonb not null default '[]'::jsonb,
  directory_id uuid references public.directories(id) on delete set null,
  -- Для дат значение по умолчанию задаётся смещением в минутах от текущего момента.
  default_value jsonb,
  template_variable text,
  is_system boolean not null default false,
  is_required boolean not null default false,
  show_on_card boolean not null default false,
  read_only_after_create boolean not null default false,
  location_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists custom_field_definitions_key_idx
  on public.custom_field_definitions (workspace_id, entity, coalesce(order_type_id, '00000000-0000-0000-0000-000000000000'::uuid), field_key)
  where deleted_at is null;

create table if not exists public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  definition_id uuid not null references public.custom_field_definitions(id) on delete cascade,
  entity_id uuid not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (definition_id, entity_id)
);
create index if not exists custom_field_values_entity_idx on public.custom_field_values (entity_id);

-- ---------------------------------------------------------------------
-- 3. Маркетинг, теги, ресурсы, группы сотрудников
-- ---------------------------------------------------------------------

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  cost numeric(16,2),
  location_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('payment','contact')),
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tags_name_idx on public.tags (workspace_id, scope, lower(name));

create table if not exists public.taggings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tag_id, entity_id)
);
create index if not exists taggings_entity_idx on public.taggings (entity_id);

create table if not exists public.resource_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  resource_type_id uuid references public.resource_types(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.employee_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_group_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_id uuid not null references public.employee_groups(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  primary key (group_id, employee_id)
);

-- ---------------------------------------------------------------------
-- 4. Каталог
-- ---------------------------------------------------------------------

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('service','product','bundle')),
  parent_id uuid references public.categories(id) on delete set null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.price_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('service','product')),
  name text not null,
  markup_percent numeric(8,3),
  location_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.price_type_defaults (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type text not null check (document_type in ('order','sale','invoice')),
  scope text not null check (scope in ('service','product')),
  location_id uuid references public.locations(id) on delete cascade,
  price_type_id uuid not null references public.price_types(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create unique index if not exists price_type_defaults_scope_idx
  on public.price_type_defaults (workspace_id, document_type, scope, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.role_price_types (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  price_type_id uuid not null references public.price_types(id) on delete cascade,
  primary key (role_id, price_type_id)
);

create table if not exists public.item_prices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  price_type_id uuid not null references public.price_types(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  price numeric(16,5) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(service_id, inventory_item_id) = 1),
  unique (price_type_id, service_id),
  unique (price_type_id, inventory_item_id)
);

create table if not exists public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  barcode text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, barcode)
);

create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  image_path text,
  barcodes text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.bundle_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bundle_id uuid not null references public.bundles(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null default 1,
  price numeric(16,5),
  position integer not null default 0
);

-- ---------------------------------------------------------------------
-- 5. Склад и продажи
-- ---------------------------------------------------------------------

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  warehouse_type text not null default 'location' check (warehouse_type in ('location','company')),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists warehouses_one_default_idx
  on public.warehouses (workspace_id) where is_default and deleted_at is null;

create table if not exists public.bin_locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (warehouse_id, name)
);

create table if not exists public.warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  bin_location_id uuid references public.bin_locations(id) on delete set null,
  quantity numeric(14,3) not null default 0,
  min_quantity numeric(14,3),
  max_quantity numeric(14,3),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, inventory_item_id)
);

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  legacy_number text,
  location_id uuid references public.locations(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  supplier_client_id uuid references public.clients(id) on delete set null,
  supplier_invoice_number text,
  supplier_invoice_date date,
  status text not null default 'posted' check (status in ('draft','posted')),
  comment text,
  total numeric(16,2) not null default 0,
  received_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  expires_on date,
  position integer not null default 0
);

create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
  supplier_client_id uuid references public.clients(id) on delete set null,
  unit_cost numeric(16,5) not null default 0,
  quantity_received numeric(14,3) not null default 0,
  quantity_left numeric(14,3) not null default 0,
  expires_on date,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.stock_serials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
  order_material_id uuid references public.order_materials(id) on delete set null,
  serial_number text not null,
  status text not null default 'in_stock' check (status in ('in_stock','issued','returned','written_off')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, inventory_item_id, serial_number)
);

create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  status_id uuid references public.status_definitions(id) on delete set null,
  status_deadline timestamptz,
  from_warehouse_id uuid references public.warehouses(id) on delete set null,
  to_warehouse_id uuid references public.warehouses(id) on delete set null,
  comment text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.write_offs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  reason text,
  comment text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.write_off_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  write_off_id uuid not null references public.write_offs(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  write_off_id uuid references public.write_offs(id) on delete set null,
  goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','in_progress','completed','canceled')),
  comment text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.stock_take_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stock_take_id uuid not null references public.stock_takes(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  expected_quantity numeric(14,3) not null default 0,
  actual_quantity numeric(14,3),
  unit_cost numeric(16,5) not null default 0
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  status text not null default 'draft' check (status in ('draft','ordered','partially_received','received','canceled')),
  supplier_client_id uuid references public.clients(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  ordered_at timestamptz not null default now(),
  supplier_invoice_number text,
  supplier_invoice_date date,
  expected_on date,
  comment text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  order_material_id uuid references public.order_materials(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  legacy_number text,
  location_id uuid references public.locations(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  ad_campaign_id uuid references public.ad_campaigns(id) on delete set null,
  price_type_id uuid references public.price_types(id) on delete set null,
  comment text,
  subtotal numeric(16,2) not null default 0,
  discount_total numeric(16,2) not null default 0,
  tax_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  kind text not null check (kind in ('labor','service','product')),
  service_id uuid references public.services(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null default 1,
  price numeric(16,5) not null default 0,
  cost_price numeric(16,5),
  discount_type text check (discount_type in ('percent','amount')),
  discount_value numeric(16,5),
  tax_rate numeric(7,3),
  amount numeric(16,2) not null default 0,
  comment text,
  position integer not null default 0
);

create table if not exists public.client_returns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  client_id uuid references public.clients(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  comment text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.client_return_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_return_id uuid not null references public.client_returns(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  price numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  supplier_client_id uuid references public.clients(id) on delete set null,
  goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  comment text,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_return_id uuid not null references public.supplier_returns(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null,
  unit_cost numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  quantity numeric(14,3) not null,
  expires_at timestamptz,
  comment text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  name text not null,
  asset_type text,
  serial_number text,
  status text not null default 'active' check (status in ('active','written_off')),
  cost numeric(16,2),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.stock_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  direction text not null check (direction in ('product_to_asset','asset_to_product')),
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  company_asset_id uuid references public.company_assets(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  quantity numeric(14,3) not null default 1,
  comment text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Заказы и сметы
-- ---------------------------------------------------------------------

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  field_name text,
  old_value text,
  new_value text,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_created_idx on public.order_events (order_id, created_at desc);

create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  author_user_id uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text,
  body text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity text not null,
  name text not null,
  filter jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  location_id uuid references public.locations(id) on delete set null,
  order_type_id uuid references public.order_types(id) on delete set null,
  status_id uuid references public.status_definitions(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  payer_client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  assignee_id uuid references public.employees(id) on delete set null,
  converted_order_id uuid references public.orders(id) on delete set null,
  due_at timestamptz,
  malfunction text,
  manager_notes text,
  conclusion text,
  subtotal numeric(16,2) not null default 0,
  discount_total numeric(16,2) not null default 0,
  tax_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  kind text not null check (kind in ('labor','service','product')),
  service_id uuid references public.services(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  technician_id uuid references public.employees(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null default 1,
  price numeric(16,5) not null default 0,
  cost_price numeric(16,5),
  discount_type text check (discount_type in ('percent','amount')),
  discount_value numeric(16,5),
  tax_rate numeric(7,3),
  warranty_days integer,
  warranty_km integer,
  comment text,
  position integer not null default 0
);

create table if not exists public.vehicle_mileage_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  mileage integer not null check (mileage >= 0),
  recorded_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);

create table if not exists public.warranty_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  order_service_id uuid references public.order_services(id) on delete set null,
  order_material_id uuid references public.order_materials(id) on delete set null,
  item_name text not null,
  serial_number text,
  starts_on date,
  ends_on date,
  mileage_limit integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  checklist_id uuid not null references public.checklists(id) on delete cascade,
  title text not null,
  is_required boolean not null default false,
  position integer not null default 0
);

create table if not exists public.order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  checklist_item_id uuid references public.checklist_items(id) on delete set null,
  title text not null,
  is_done boolean not null default false,
  done_by uuid references auth.users(id) on delete set null,
  done_at timestamptz
);

-- ---------------------------------------------------------------------
-- 7. Клиенты
-- ---------------------------------------------------------------------

-- Телефон не уникален: один телефон у нескольких контактов автопарка, как в RO App.
create table if not exists public.client_phones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  phone text not null,
  label text,
  is_primary boolean not null default false,
  has_whatsapp boolean not null default false,
  allow_sms boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_phones_workspace_phone_idx on public.client_phones (workspace_id, phone);

create table if not exists public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text,
  address text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_discounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  target text not null check (target in ('service_order','service_sale','product_order','product_sale')),
  mode text not null default 'fixed' check (mode in ('fixed','price_type')),
  percent numeric(7,3),
  price_type_id uuid references public.price_types(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (client_id, target)
);

create table if not exists public.client_balance_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  amount numeric(16,2) not null,
  currency_code text not null default 'MDL',
  document_type text,
  document_id uuid,
  description text,
  is_adjustment boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. Финансы и счета
-- ---------------------------------------------------------------------

create table if not exists public.currencies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  symbol text,
  symbol_position text not null default 'after' check (symbol_position in ('before','after')),
  rate numeric(18,8) not null default 1,
  is_base boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null,
  icon text,
  scope text not null default 'company' check (scope in ('company','location')),
  account_type text not null check (account_type in ('cash','cashless','card')),
  is_virtual boolean not null default false,
  currency_code text not null default 'MDL',
  opening_balance numeric(16,2) not null default 0,
  include_fees boolean not null default false,
  fee_percent numeric(7,3),
  fee_fixed numeric(16,2),
  allow_view_balance boolean not null default true,
  allow_view_transactions boolean not null default true,
  allow_income boolean not null default true,
  allow_transfer_in boolean not null default true,
  allow_expense boolean not null default true,
  allow_transfer_out boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Вкладка Access кассы: сотрудники, которым она доступна. Нет строк значит доступна всем.
create table if not exists public.finance_account_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid not null references public.finance_accounts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  primary key (account_id, employee_id)
);

create table if not exists public.cashflow_categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid references public.cashflow_categories(id) on delete set null,
  name text not null,
  direction text not null default 'both' check (direction in ('income','expense','both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete set null,
  name text not null,
  category text not null check (category in ('cash','card','bank_transfer','other')),
  merchant text,
  fiscalization_enabled boolean not null default false,
  location_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('income','expense','transfer')),
  account_id uuid references public.finance_accounts(id) on delete set null,
  transfer_to_account_id uuid references public.finance_accounts(id) on delete set null,
  amount numeric(16,2) not null check (amount > 0),
  currency_code text not null default 'MDL',
  exchange_rate numeric(18,8),
  occurred_at timestamptz not null default now(),
  comment text,
  order_id uuid references public.orders(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  cashflow_category_id uuid references public.cashflow_categories(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);
create index if not exists finance_transactions_workspace_date_idx on public.finance_transactions (workspace_id, occurred_at desc);
create index if not exists finance_transactions_account_date_idx on public.finance_transactions (account_id, occurred_at desc);

alter table public.goods_receipts
  add column if not exists paid_from_account_id uuid references public.finance_accounts(id) on delete set null,
  add column if not exists finance_transaction_id uuid references public.finance_transactions(id) on delete set null;

create table if not exists public.taxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  rate numeric(7,3) not null,
  is_included boolean not null default true,
  location_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tax_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tax_group_items (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tax_group_id uuid not null references public.tax_groups(id) on delete cascade,
  tax_id uuid not null references public.taxes(id) on delete cascade,
  primary key (tax_group_id, tax_id)
);

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  applies_to text not null check (applies_to in ('sale','purchase')),
  target_type text not null default 'all' check (target_type in ('all','service','product','category')),
  target_id uuid,
  tax_id uuid references public.taxes(id) on delete set null,
  tax_group_id uuid references public.tax_groups(id) on delete set null,
  priority integer not null default 0,
  is_exception boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_orders (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  primary key (invoice_id, order_id)
);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  invoice_id uuid references public.invoices(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  payer_client_id uuid references public.clients(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  legal_entity_id uuid,
  issue_date date,
  due_date date,
  comment text,
  reason text,
  status text not null default 'draft' check (status in ('draft','issued','canceled')),
  subtotal numeric(16,2) not null default 0,
  tax_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null default 1,
  price numeric(16,5) not null default 0,
  tax_rate numeric(7,3),
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  amount numeric(16,2) not null,
  currency_code text not null default 'MDL',
  provider text,
  provider_reference text,
  url text,
  status text not null default 'created' check (status in ('created','paid','expired','canceled')),
  expires_at timestamptz,
  paid_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 9. Уведомления, документы, публичные страницы, каналы связи
-- ---------------------------------------------------------------------

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('sms','email','telegram','whatsapp','in_app')),
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.message_template_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id uuid not null references public.message_templates(id) on delete cascade,
  locale text not null,
  subject text,
  body text not null,
  unique (template_id, locale)
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  audience text not null check (audience in ('client','staff')),
  entity text not null check (entity in ('lead','booking','order','estimate','client','task')),
  event text not null,
  recipient_role text,
  status_id uuid references public.status_definitions(id) on delete set null,
  channel text not null check (channel in ('sms','email','telegram','whatsapp','in_app')),
  template_id uuid references public.message_templates(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  delay_minutes integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel text not null check (channel in ('sms','email','telegram','whatsapp','in_app')),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  status text not null default 'queued' check (status in ('queued','delayed','sent','delivered','failed','skipped')),
  recipient text not null,
  client_id uuid references public.clients(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  template_id uuid references public.message_templates(id) on delete set null,
  rule_id uuid references public.notification_rules(id) on delete set null,
  body text,
  error text,
  provider text,
  provider_message_id text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists message_log_workspace_created_idx on public.message_log (workspace_id, created_at desc);

create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_notifications_unread_idx on public.staff_notifications (user_id, created_at desc) where read_at is null;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  document_type text not null,
  body_html text not null default '',
  width_mm numeric(7,2),
  height_mm numeric(7,2),
  show_cents boolean not null default true,
  is_available_to_all boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Какие шаблоны доступны для печати в статусе и на локации.
create table if not exists public.status_print_templates (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status_id uuid not null references public.status_definitions(id) on delete cascade,
  template_id uuid not null references public.document_templates(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  primary key (status_id, template_id, location_id)
);

-- Токен около 244 бит случайности. Без anon-политик: читать только через RPC или Edge Function.
create table if not exists public.public_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('order','estimate','review')),
  entity_id uuid not null,
  token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- Секреты провайдеров сюда не писать: только переменные окружения или Vault.
create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  is_enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  assigned_employee_id uuid references public.employees(id) on delete set null,
  channel text not null,
  external_id text,
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('outbound','inbound')),
  body text,
  attachments jsonb not null default '[]'::jsonb,
  sender_user_id uuid references auth.users(id) on delete set null,
  external_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 10. Задачи, заявки, записи, звонки
-- ---------------------------------------------------------------------

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) <= 256),
  description text,
  status_id uuid references public.status_definitions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.task_assignees (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  primary key (task_id, employee_id)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  number text,
  lead_type text not null default 'inquiry' check (lead_type in ('inquiry','missed_call')),
  location_id uuid references public.locations(id) on delete set null,
  status_id uuid references public.status_definitions(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  manager_id uuid references public.employees(id) on delete set null,
  ad_campaign_id uuid references public.ad_campaigns(id) on delete set null,
  converted_order_id uuid references public.orders(id) on delete set null,
  converted_sale_id uuid references public.sales(id) on delete set null,
  contact_name text,
  phone text,
  email text,
  address text,
  comment text,
  manager_notes text,
  is_urgent boolean not null default false,
  due_at timestamptz,
  lost_reason text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  resource_id uuid references public.resources(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','confirmed','completed','canceled','no_show')),
  source text not null default 'manual' check (source in ('manual','online')),
  comment text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.booking_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  item_name text not null,
  quantity numeric(14,3) not null default 1,
  price numeric(16,5) not null default 0,
  amount numeric(16,2) not null default 0,
  position integer not null default 0
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  status text not null check (status in ('answered','missed','busy','failed')),
  phone text,
  client_id uuid references public.clients(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  started_at timestamptz not null default now(),
  duration_seconds integer,
  recording_path text,
  transcript text,
  provider text,
  provider_call_id text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 11. Персонал и зарплата
-- ---------------------------------------------------------------------

create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  day_type text not null default 'work' check (day_type in ('work','vacation','sick','day_off')),
  starts_at time,
  ends_at time,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table if not exists public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  hours numeric(5,2) not null default 0,
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table if not exists public.employee_balance_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric(16,2) not null,
  document_type text,
  document_id uuid,
  description text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  name text not null,
  base_salary numeric(16,2),
  rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_accruals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  accrual_type text not null check (accrual_type in ('salary','commission','bonus','penalty')),
  period_from date,
  period_to date,
  amount numeric(16,2) not null,
  comment text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.item_commission_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid references public.services(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete cascade,
  payroll_rule_id uuid references public.payroll_rules(id) on delete cascade,
  commission_type text not null default 'percent' check (commission_type in ('percent','amount')),
  commission_value numeric(16,5) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(service_id, inventory_item_id) = 1)
);

-- ---------------------------------------------------------------------
-- 12. API и перенос данных
-- ---------------------------------------------------------------------

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  url text not null,
  events text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source text not null default 'ro_app',
  entity text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  stats jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.migration_id_map (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity text not null,
  source_id text not null,
  target_id uuid not null,
  batch_id uuid references public.migration_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, entity, source_id)
);

create table if not exists public.raw_ro_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  batch_id uuid references public.migration_batches(id) on delete cascade,
  entity text not null,
  source_id text not null,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (workspace_id, entity, source_id)
);

-- ---------------------------------------------------------------------
-- 13. Новые поля в существующих таблицах
-- Все поля nullable или с default. FK только SET NULL, чтобы
-- delete_order_with_payments и другие удаления работали как раньше.
-- ---------------------------------------------------------------------

alter table public.orders
  add column if not exists order_type_id uuid references public.order_types(id) on delete set null,
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists payer_client_id uuid references public.clients(id) on delete set null,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists ad_campaign_id uuid references public.ad_campaigns(id) on delete set null,
  add column if not exists custom_status_id uuid references public.status_definitions(id) on delete set null,
  add column if not exists resource_id uuid references public.resources(id) on delete set null,
  add column if not exists estimate_id uuid references public.estimates(id) on delete set null,
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
create index if not exists orders_location_id_idx on public.orders (location_id);
create index if not exists orders_custom_status_id_idx on public.orders (custom_status_id);
create index if not exists orders_scheduled_from_idx on public.orders (scheduled_from);

alter table public.order_services
  add column if not exists kind text check (kind in ('labor','service')),
  add column if not exists technician_id uuid references public.employees(id) on delete set null,
  add column if not exists mileage integer,
  add column if not exists discount_type text check (discount_type in ('percent','amount')),
  add column if not exists discount_value numeric(16,5),
  add column if not exists tax_rate numeric(7,3),
  add column if not exists cost_price numeric(16,5),
  add column if not exists warranty_days integer,
  add column if not exists warranty_km integer,
  add column if not exists comment text,
  add column if not exists position integer;

alter table public.order_materials
  add column if not exists technician_id uuid references public.employees(id) on delete set null,
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists mileage integer,
  add column if not exists discount_type text check (discount_type in ('percent','amount')),
  add column if not exists discount_value numeric(16,5),
  add column if not exists tax_rate numeric(7,3),
  add column if not exists cost_price numeric(16,5),
  add column if not exists warranty_days integer,
  add column if not exists warranty_km integer,
  add column if not exists comment text,
  add column if not exists position integer,
  add column if not exists is_backorder boolean not null default false;

alter table public.order_attachments
  add column if not exists comment_id uuid references public.order_comments(id) on delete set null,
  add column if not exists is_public boolean not null default false;

alter table public.clients
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists is_supplier boolean not null default false,
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists organization_id uuid references public.clients(id) on delete set null,
  add column if not exists ad_campaign_id uuid references public.ad_campaigns(id) on delete set null,
  add column if not exists birthday date,
  add column if not exists balance_currency text,
  add column if not exists invoice_due_days integer,
  add column if not exists discount_card_number text;
create index if not exists clients_manager_id_idx on public.clients (manager_id);
create index if not exists clients_organization_id_idx on public.clients (organization_id);
create index if not exists clients_suppliers_idx on public.clients (workspace_id) where is_supplier;

alter table public.vehicles
  add column if not exists notes text;

alter table public.services
  add column if not exists kind text check (kind in ('labor','service')),
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists code text,
  add column if not exists barcodes text[] not null default '{}',
  add column if not exists image_path text,
  add column if not exists warranty_days integer,
  add column if not exists warranty_unit text check (warranty_unit in ('days','months')),
  add column if not exists warranty_km integer,
  add column if not exists duration_minutes integer,
  add column if not exists unit_of_measure text,
  add column if not exists cost_price numeric(16,5),
  add column if not exists price_from_cost boolean not null default false,
  add column if not exists online_booking boolean not null default false,
  add column if not exists booking_employee_ids uuid[] not null default '{}',
  add column if not exists required_resource_type_ids uuid[] not null default '{}';

alter table public.inventory_items
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists supplier_client_id uuid references public.clients(id) on delete set null,
  add column if not exists product_type text,
  add column if not exists internal_code text,
  add column if not exists mpn text,
  add column if not exists image_path text,
  add column if not exists length_cm numeric(10,2),
  add column if not exists width_cm numeric(10,2),
  add column if not exists height_cm numeric(10,2),
  add column if not exists weight_kg numeric(10,3),
  add column if not exists warranty_days integer,
  add column if not exists track_expiration boolean not null default false,
  add column if not exists expiration_days integer,
  add column if not exists track_serials boolean not null default false,
  add column if not exists parent_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists variant_attributes jsonb not null default '{}'::jsonb;

alter table public.inventory_movements
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists batch_id uuid references public.stock_batches(id) on delete set null,
  add column if not exists document_type text,
  add column if not exists document_id uuid,
  add column if not exists unit_cost numeric(16,5);

alter table public.invoices
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists payer_client_id uuid references public.clients(id) on delete set null,
  add column if not exists manager_id uuid references public.employees(id) on delete set null,
  add column if not exists status_id uuid references public.status_definitions(id) on delete set null,
  add column if not exists payment_method_id uuid references public.payment_methods(id) on delete set null,
  add column if not exists legal_entity_id uuid,
  add column if not exists issue_date date,
  add column if not exists status_deadline timestamptz,
  add column if not exists comment text,
  add column if not exists discount_total numeric(16,2),
  add column if not exists tax_total numeric(16,2),
  add column if not exists invoicing_system text,
  add column if not exists e_invoice_status text,
  add column if not exists display_mode text check (display_mode in ('detailed','simplified','one_line')),
  add column if not exists legacy_number text;
create unique index if not exists invoices_legacy_number_idx
  on public.invoices (workspace_id, legacy_number) where legacy_number is not null;

alter table public.invoice_items
  add column if not exists kind text check (kind in ('labor','service','product')),
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists discount_type text check (discount_type in ('percent','amount')),
  add column if not exists discount_value numeric(16,5),
  add column if not exists tax_rate numeric(7,3);

alter table public.payments
  add column if not exists account_id uuid references public.finance_accounts(id) on delete set null,
  add column if not exists payment_method_id uuid references public.payment_methods(id) on delete set null,
  add column if not exists finance_transaction_id uuid references public.finance_transactions(id) on delete set null,
  add column if not exists sale_id uuid references public.sales(id) on delete set null,
  add column if not exists location_id uuid references public.locations(id) on delete set null;

alter table public.employees
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists hire_date date,
  add column if not exists position_title text,
  add column if not exists public_name text,
  add column if not exists note text,
  add column if not exists telegram_chat_id text;

-- legal_entities может ещё не существовать: в Core App не все SQL-скрипты применены.
do $$
declare
  v_item text;
  v_table text;
begin
  if to_regclass('public.legal_entities') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'legal_entities' and column_name = 'id' and data_type = 'uuid'
     ) then
    foreach v_table in array array['locations','invoices','credit_notes'] loop
      v_item := v_table || '_legal_entity_id_fkey';
      if not exists (select 1 from pg_constraint where conname = v_item and conrelid = format('public.%I', v_table)::regclass) then
        execute format(
          'alter table public.%I add constraint %I foreign key (legal_entity_id) references public.legal_entities(id) on delete set null',
          v_table, v_item
        );
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 14. Функции доступа и триггеры
-- ---------------------------------------------------------------------

-- Рабочие пространства текущего пользователя, где у него есть право.
-- Без аргумента: все, где он активный участник.
create or replace function public.crm_permitted_workspaces(p_permission text default null)
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id
  from public.workspace_members m
  left join public.member_roles mr on mr.workspace_id = m.workspace_id and mr.user_id = m.user_id
  where m.user_id = (select auth.uid())
    and m.deleted_at is null
    and (
      p_permission is null
      or m.role::text = 'owner'
      or (mr.role_id is null and m.role::text = 'admin')
      or exists (
        select 1 from public.role_permissions rp
        where rp.role_id = mr.role_id and rp.workspace_id = m.workspace_id and rp.permission = p_permission
      )
    )
$$;

-- Для проверок внутри RPC.
create or replace function public.crm_has_permission(p_workspace uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_workspace in (select public.crm_permitted_workspaces(p_permission))
$$;

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Не даёт сослаться на запись другого рабочего пространства.
-- Аргументы триггера: пары "колонка, таблица-родитель".
create or replace function public.crm_assert_same_workspace()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_index integer := 0;
  v_column text;
  v_parent text;
  v_parent_id uuid;
  v_matches boolean;
begin
  while v_index < tg_nargs loop
    v_column := tg_argv[v_index];
    v_parent := tg_argv[v_index + 1];
    v_index := v_index + 2;
    v_parent_id := (v_row ->> v_column)::uuid;
    if v_parent_id is not null then
      execute format('select exists (select 1 from public.%I where id = $1 and workspace_id = $2)', v_parent)
        into v_matches using v_parent_id, (v_row ->> 'workspace_id')::uuid;
      if not v_matches then
        raise exception 'crm: % ссылается на запись другого рабочего пространства', v_column using errcode = '23503';
      end if;
    end if;
  end loop;
  return new;
end $$;

revoke all on function public.crm_permitted_workspaces(text) from public, anon;
revoke all on function public.crm_has_permission(uuid, text) from public, anon;
revoke all on function public.crm_touch_updated_at() from public, anon, authenticated;
revoke all on function public.crm_assert_same_workspace() from public, anon, authenticated;
grant execute on function public.crm_permitted_workspaces(text) to authenticated, service_role;
grant execute on function public.crm_has_permission(uuid, text) to authenticated, service_role;

do $$
declare
  v_table text;
  v_column text;
  v_args text;
begin
  foreach v_table in array pg_temp.crm_tables() loop
    execute format('comment on table public.%I is %L', v_table, 'crm_ro_v1');

    for v_column in
      select distinct a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.conrelid = format('public.%I', v_table)::regclass
        and c.contype = 'f' and cardinality(c.conkey) = 1
    loop
      execute format('create index if not exists %I on public.%I (%I)', v_table || '_' || v_column || '_idx', v_table, v_column);
    end loop;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table and column_name = 'updated_at'
    ) then
      execute format('drop trigger if exists crm_touch_updated_at on public.%I', v_table);
      execute format(
        'create trigger crm_touch_updated_at before update on public.%I for each row execute function public.crm_touch_updated_at()',
        v_table
      );
    end if;

    select string_agg(format('%L, %L', a.attname, parent.relname), ', ' order by a.attname)
    into v_args
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_class parent on parent.oid = c.confrelid
    where c.conrelid = format('public.%I', v_table)::regclass
      and c.contype = 'f' and cardinality(c.conkey) = 1
      and parent.relnamespace = 'public'::regnamespace
      and exists (
        select 1 from pg_attribute w
        where w.attrelid = parent.oid and w.attname = 'workspace_id' and not w.attisdropped
      );

    execute format('drop trigger if exists crm_same_workspace on public.%I', v_table);
    if v_args is not null then
      execute format(
        'create trigger crm_same_workspace before insert or update on public.%I for each row execute function public.crm_assert_same_workspace(%s)',
        v_table, v_args
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 15. RLS
-- ---------------------------------------------------------------------

-- Значение права: '*' = любой активный участник, '-' = нет доступа из браузера,
-- иначе ключ права из role_permissions.
create or replace function pg_temp.crm_apply_rls(
  p_table text, p_select text, p_insert text, p_update text, p_delete text
) returns void
language plpgsql as $$
declare
  v_op text;
  v_permission text;
  v_rule text;
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('revoke all on public.%I from public, anon, authenticated', p_table);
  execute format('grant all on public.%I to service_role', p_table);

  foreach v_op in array array['select','insert','update','delete'] loop
    v_permission := case v_op
      when 'select' then p_select when 'insert' then p_insert
      when 'update' then p_update else p_delete end;
    execute format('drop policy if exists %I on public.%I', 'crm_' || v_op, p_table);
    continue when v_permission = '-';

    v_rule := case when v_permission = '*'
      then 'workspace_id in (select public.crm_permitted_workspaces())'
      else format('workspace_id in (select public.crm_permitted_workspaces(%L))', v_permission) end;

    execute format('grant %s on public.%I to authenticated', v_op, p_table);
    execute format('create policy %I on public.%I for %s to authenticated %s',
      'crm_' || v_op, p_table, v_op,
      case v_op
        when 'insert' then format('with check (%s)', v_rule)
        when 'update' then format('using (%1$s) with check (%1$s)', v_rule)
        else format('using (%s)', v_rule)
      end);
  end loop;
end $$;

select pg_temp.crm_apply_rls(t, s, i, u, d) from (values
  -- основа
  ('locations',                     '*', 'settings.locations', 'settings.locations', 'settings.locations'),
  ('roles',                         '*', 'settings.roles', 'settings.roles', 'settings.roles'),
  ('role_permissions',              '*', 'settings.roles', 'settings.roles', 'settings.roles'),
  ('member_roles',                  '*', 'settings.roles', 'settings.roles', 'settings.roles'),
  ('activity_log',                  'reports.activity_log', '-', '-', '-'),
  ('module_settings',               '*', 'settings.general', 'settings.general', 'settings.general'),
  ('numbering_templates',           '*', 'settings.general', 'settings.general', 'settings.general'),
  -- статусы, формы, справочники
  ('status_definitions',            '*', 'settings.statuses', 'settings.statuses', 'settings.statuses'),
  ('status_role_permissions',       '*', 'settings.statuses', 'settings.statuses', 'settings.statuses'),
  ('status_transitions',            '*', 'settings.statuses', 'settings.statuses', 'settings.statuses'),
  ('status_print_templates',        '*', 'settings.statuses', 'settings.statuses', 'settings.statuses'),
  ('order_types',                   '*', 'settings.forms', 'settings.forms', 'settings.forms'),
  ('custom_field_definitions',      '*', 'settings.forms', 'settings.forms', 'settings.forms'),
  ('custom_field_values',           '*', '*', '*', '*'),
  ('directories',                   '*', 'settings.directories', 'settings.directories', 'settings.directories'),
  ('directory_items',               '*', 'directories.create_items', 'settings.directories', 'settings.directories'),
  -- маркетинг, теги, ресурсы, группы
  ('ad_campaigns',                  '*', 'settings.marketing', 'settings.marketing', 'settings.marketing'),
  ('tags',                          '*', 'settings.tags', 'settings.tags', 'settings.tags'),
  ('taggings',                      '*', '*', '-', '*'),
  ('resource_types',                '*', 'settings.general', 'settings.general', 'settings.general'),
  ('resources',                     '*', 'settings.general', 'settings.general', 'settings.general'),
  ('employee_groups',               '*', 'settings.employees', 'settings.employees', 'settings.employees'),
  ('employee_group_members',        '*', 'settings.employees', 'settings.employees', 'settings.employees'),
  -- каталог
  ('categories',                    '*', 'catalog.edit_categories', 'catalog.edit_categories', 'catalog.edit_categories'),
  ('price_types',                   '*', 'settings.prices', 'settings.prices', 'settings.prices'),
  ('price_type_defaults',           '*', 'settings.prices', 'settings.prices', 'settings.prices'),
  ('role_price_types',              '*', 'settings.roles', 'settings.roles', 'settings.roles'),
  ('item_prices',                   '*', 'catalog.edit_prices', 'catalog.edit_prices', 'catalog.edit_prices'),
  ('product_barcodes',              '*', 'catalog.products.edit', 'catalog.products.edit', 'catalog.products.edit'),
  ('bundles',                       'catalog.bundles.view', 'catalog.bundles.create', 'catalog.bundles.edit', 'catalog.bundles.delete'),
  ('bundle_items',                  'catalog.bundles.view', 'catalog.bundles.create', 'catalog.bundles.edit', 'catalog.bundles.delete'),
  -- склад: остатки, партии и серийные номера меняются только через RPC
  ('warehouses',                    '*', 'settings.warehouses', 'settings.warehouses', 'settings.warehouses'),
  ('bin_locations',                 '*', 'settings.warehouses', 'settings.warehouses', 'settings.warehouses'),
  ('warehouse_stock',               '*', '-', '-', '-'),
  ('stock_batches',                 '*', '-', '-', '-'),
  ('stock_serials',                 '*', '-', '-', '-'),
  ('goods_receipts',                'inventory.receipts.view', 'inventory.receipts.create', 'inventory.receipts.edit', 'inventory.receipts.delete'),
  ('goods_receipt_lines',           'inventory.receipts.view', 'inventory.receipts.create', 'inventory.receipts.edit', 'inventory.receipts.delete'),
  ('stock_transfers',               'inventory.transfers.view', 'inventory.transfers.create', 'inventory.transfers.edit', 'inventory.delete_operations'),
  ('stock_transfer_lines',          'inventory.transfers.view', 'inventory.transfers.create', 'inventory.transfers.edit', 'inventory.delete_operations'),
  ('write_offs',                    'inventory.write_offs.view', 'inventory.write_offs.create', 'inventory.write_offs.edit', 'inventory.write_offs.delete'),
  ('write_off_lines',               'inventory.write_offs.view', 'inventory.write_offs.create', 'inventory.write_offs.edit', 'inventory.write_offs.delete'),
  ('stock_takes',                   'inventory.stock_takes.view', 'inventory.stock_takes.create', 'inventory.stock_takes.create', 'inventory.stock_takes.delete'),
  ('stock_take_lines',              'inventory.stock_takes.view', 'inventory.stock_takes.create', 'inventory.stock_takes.create', 'inventory.stock_takes.delete'),
  ('purchase_orders',               'inventory.purchase_orders.view', 'inventory.purchase_orders.create', 'inventory.purchase_orders.edit', 'inventory.purchase_orders.delete'),
  ('purchase_order_lines',          'inventory.purchase_orders.view', 'inventory.purchase_orders.create', 'inventory.purchase_orders.edit', 'inventory.purchase_orders.delete'),
  ('client_returns',                'inventory.client_returns.view', 'inventory.client_returns.create', 'inventory.client_returns.create', 'inventory.client_returns.delete'),
  ('client_return_lines',           'inventory.client_returns.view', 'inventory.client_returns.create', 'inventory.client_returns.create', 'inventory.client_returns.delete'),
  ('supplier_returns',              'inventory.supplier_returns.view', 'inventory.supplier_returns.create', 'inventory.supplier_returns.edit', 'inventory.supplier_returns.delete'),
  ('supplier_return_lines',         'inventory.supplier_returns.view', 'inventory.supplier_returns.create', 'inventory.supplier_returns.edit', 'inventory.supplier_returns.delete'),
  ('stock_reservations',            'inventory.reservations.view', 'inventory.reservations.create', 'inventory.reservations.edit', 'inventory.reservations.delete'),
  ('company_assets',                'inventory.assets.view', 'inventory.assets.create', 'inventory.assets.edit', 'inventory.assets.write_off'),
  ('stock_conversions',             'inventory.conversions.view', 'inventory.conversions.create', '-', '-'),
  -- продажи
  ('sales',                         '*', 'sales.create', 'sales.create', 'sales.delete'),
  ('sale_lines',                    '*', 'sales.create', 'sales.create', 'sales.delete'),
  -- заказы: лента событий пишется только триггерами и RPC
  ('order_events',                  '*', '-', '-', '-'),
  ('order_comments',                '*', '*', 'orders.edit', 'orders.edit'),
  ('estimates',                     '*', 'orders.create_estimates', 'orders.edit', 'orders.delete'),
  ('estimate_lines',                '*', 'orders.create_estimates', 'orders.edit', 'orders.delete'),
  ('vehicle_mileage_log',           '*', '*', '-', '-'),
  ('warranty_records',              '*', 'orders.edit', 'orders.edit', 'orders.delete'),
  ('checklists',                    '*', 'settings.checklists', 'settings.checklists', 'settings.checklists'),
  ('checklist_items',               '*', 'settings.checklists', 'settings.checklists', 'settings.checklists'),
  ('order_checklist_items',         '*', '*', '*', 'orders.edit'),
  -- клиенты: движения баланса пишутся только через RPC
  ('client_phones',                 '*', 'contacts.create', 'contacts.edit', 'contacts.edit'),
  ('client_addresses',              '*', 'contacts.create', 'contacts.edit', 'contacts.edit'),
  ('client_discounts',              '*', 'contacts.edit_discounts', 'contacts.edit_discounts', 'contacts.edit_discounts'),
  ('client_balance_entries',        'contacts.view_balances', '-', '-', '-'),
  -- финансы
  ('currencies',                    '*', 'settings.finance', 'settings.finance', 'settings.finance'),
  ('finance_accounts',              '*', 'finance.accounts.manage', 'finance.accounts.manage', 'finance.accounts.manage'),
  ('finance_account_access',        '*', 'finance.accounts.manage', 'finance.accounts.manage', 'finance.accounts.manage'),
  ('cashflow_categories',           '*', 'settings.finance', 'settings.finance', 'settings.finance'),
  ('payment_methods',               '*', 'settings.payment_methods', 'settings.payment_methods', 'settings.payment_methods'),
  ('finance_transactions',          'finance.transactions.view', '-', 'finance.transactions.correct', 'finance.transactions.delete'),
  ('taxes',                         '*', 'settings.taxes', 'settings.taxes', 'settings.taxes'),
  ('tax_groups',                    '*', 'settings.taxes', 'settings.taxes', 'settings.taxes'),
  ('tax_group_items',               '*', 'settings.taxes', 'settings.taxes', 'settings.taxes'),
  ('tax_rules',                     '*', 'settings.taxes', 'settings.taxes', 'settings.taxes'),
  ('invoice_orders',                'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete'),
  ('credit_notes',                  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete'),
  ('credit_note_lines',             'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete'),
  ('payment_links',                 '*', 'finance.payment_links.create', '-', 'finance.payment_links.delete'),
  -- коммуникации
  ('message_templates',             '*', 'settings.notifications', 'settings.notifications', 'settings.notifications'),
  ('message_template_translations', '*', 'settings.notifications', 'settings.notifications', 'settings.notifications'),
  ('notification_rules',            '*', 'settings.notifications', 'settings.notifications', 'settings.notifications'),
  ('message_log',                   'contacts.view', '-', '-', '-'),
  ('document_templates',            '*', 'settings.print_templates', 'settings.print_templates', 'settings.print_templates'),
  ('public_links',                  '*', 'orders.edit', 'orders.edit', 'orders.edit'),
  ('reviews',                       '*', '-', '-', '-'),
  ('integration_connections',       'settings.integrations', 'settings.integrations', 'settings.integrations', 'settings.integrations'),
  ('conversations',                 'messages.use', 'messages.use', 'messages.use', '-'),
  ('conversation_messages',         'messages.use', 'messages.use', '-', '-'),
  -- задачи, заявки, записи, звонки
  ('tasks',                         'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete'),
  ('task_assignees',                'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.edit'),
  ('leads',                         'leads.view', 'leads.create', 'leads.edit', 'leads.delete'),
  ('bookings',                      'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.delete'),
  ('booking_services',              'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.delete'),
  ('calls',                         'calls.use', '-', 'calls.use', '-'),
  -- персонал
  ('work_schedules',                'staff.schedule.view', 'staff.schedule.edit', 'staff.schedule.edit', 'staff.schedule.edit'),
  ('timesheet_entries',             'staff.schedule.view', 'staff.timesheets.edit', 'staff.timesheets.edit', 'staff.timesheets.edit'),
  ('employee_balance_entries',      'settings.employees.view_balance', '-', '-', '-'),
  ('payroll_rules',                 'settings.payroll_rules.view', 'settings.payroll_rules.create', 'settings.payroll_rules.edit', 'settings.payroll_rules.delete'),
  ('payroll_accruals',              'payroll.accruals.view', 'payroll.accruals.create', 'payroll.accruals.create', 'payroll.accruals.delete'),
  ('item_commission_rules',         'catalog.commissions', 'catalog.commissions', 'catalog.commissions', 'catalog.commissions'),
  -- API
  ('api_keys',                      'settings.api', 'settings.api', 'settings.api', 'settings.api'),
  ('webhook_endpoints',             'settings.api', 'settings.api', 'settings.api', 'settings.api'),
  -- перенос данных: только service_role
  ('migration_batches',             '-', '-', '-', '-'),
  ('migration_id_map',              '-', '-', '-', '-'),
  ('raw_ro_records',                '-', '-', '-', '-')
) as v(t, s, i, u, d);

-- Приход, расход и перевод управляются разными правами.
drop policy if exists crm_insert on public.finance_transactions;
create policy crm_insert on public.finance_transactions for insert to authenticated with check (
  (transaction_type = 'income' and workspace_id in (select public.crm_permitted_workspaces('finance.transactions.income')))
  or (transaction_type = 'expense' and workspace_id in (select public.crm_permitted_workspaces('finance.transactions.expense')))
  or (transaction_type = 'transfer' and workspace_id in (select public.crm_permitted_workspaces('finance.transactions.transfer')))
);
grant insert on public.finance_transactions to authenticated;

-- Личные фильтры видит владелец, общие все. Для общих нужно отдельное право.
select pg_temp.crm_apply_rls('saved_filters', '-', '-', '-', '-');
create policy crm_select on public.saved_filters for select to authenticated using (
  workspace_id in (select public.crm_permitted_workspaces())
  and (is_shared or owner_user_id = (select auth.uid()))
);
create policy crm_insert on public.saved_filters for insert to authenticated with check (
  owner_user_id = (select auth.uid())
  and workspace_id in (select public.crm_permitted_workspaces(case when is_shared then 'orders.shared_filters' end))
);
create policy crm_update on public.saved_filters for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    and workspace_id in (select public.crm_permitted_workspaces())
  )
  with check (
    owner_user_id = (select auth.uid())
    and workspace_id in (select public.crm_permitted_workspaces(case when is_shared then 'orders.shared_filters' end))
  );
create policy crm_delete on public.saved_filters for delete to authenticated using (
  owner_user_id = (select auth.uid())
  and workspace_id in (select public.crm_permitted_workspaces())
);
grant select, insert, update, delete on public.saved_filters to authenticated;

-- Уведомления сотрудника видит только он сам. Создаются сервером.
select pg_temp.crm_apply_rls('staff_notifications', '-', '-', '-', '-');
create policy crm_select on public.staff_notifications for select to authenticated using (
  user_id = (select auth.uid()) and workspace_id in (select public.crm_permitted_workspaces())
);
create policy crm_update on public.staff_notifications for update to authenticated
  using (user_id = (select auth.uid()) and workspace_id in (select public.crm_permitted_workspaces()))
  with check (user_id = (select auth.uid()) and workspace_id in (select public.crm_permitted_workspaces()));
create policy crm_delete on public.staff_notifications for delete to authenticated using (
  user_id = (select auth.uid()) and workspace_id in (select public.crm_permitted_workspaces())
);
grant select, update, delete on public.staff_notifications to authenticated;

drop function pg_temp.crm_apply_rls(text, text, text, text, text);
drop function pg_temp.crm_tables();

commit;
