-- =====================================================================
-- Core App: три стартовые роли и их права (Приложение Б.1, docs/ro-app-migration.md).
--
-- Запускать ПОСЛЕ crm_ro_v1.PRODUCTION.sql. Бэкап обязателен.
--
-- Что делает:
--   * для каждого неудалённого рабочего пространства создаёт роли, если роли с таким
--     именем ещё нет: «Инженер», «Менеджер / Приемщик», «Полный доступ»;
--   * вставляет role_permissions для ключей, отмеченных «+» в таблице Б.1
--     (114 ключей: Инженер 80, Менеджер / Приемщик 69, Полный доступ 111);
--     пары (role_id, permission), которые уже есть, пропускаются.
--
-- Чего не делает:
--   * не удаляет и не меняет существующие роли и права (если роль с таким именем уже
--     есть, недостающие «+» будут ДОБАВЛЕНЫ, лишние права не снимаются);
--   * не заполняет roles.scopes (Б.2 ждёт подтверждения владельца) и не назначает
--     роли сотрудникам (member_roles).
--
-- Ключи «–» у всех трёх ролей (finance.transactions.correct,
-- inventory.purchase_orders.edit, inventory.receipts.edit) не вставляются.
-- Покажите таблицу Б.1 владельцу до назначения ролей сотрудникам.
--
-- Идемпотентно: повторный запуск ничего не вставит.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.roles') is null or to_regclass('public.role_permissions') is null then
    raise exception 'Нет public.roles / public.role_permissions: сначала примените crm_ro_v1.PRODUCTION.sql';
  end if;
end $$;

-- Матрица прав из Приложения Б.1: true = «+».
create temp table crm_seed_permissions (
  permission text primary key,
  engineer boolean not null,
  manager boolean not null,
  full_access boolean not null
) on commit drop;

insert into crm_seed_permissions (permission, engineer, manager, full_access) values
    ('bookings.create',                     true, true, true),
    ('bookings.delete',                     true, true, true),
    ('bookings.edit',                       true, true, true),
    ('bookings.view',                       true, true, true),
    ('calls.use',                           false, false, true),
    ('catalog.bundles.create',              true, false, true),
    ('catalog.bundles.delete',              true, false, true),
    ('catalog.bundles.edit',                true, false, true),
    ('catalog.bundles.view',                true, false, true),
    ('catalog.commissions',                 false, false, true),
    ('catalog.edit_categories',             true, true, true),
    ('catalog.edit_prices',                 true, true, true),
    ('catalog.products.edit',               true, true, true),
    ('contacts.create',                     true, false, true),
    ('contacts.edit',                       true, false, true),
    ('contacts.edit_discounts',             true, false, true),
    ('contacts.view',                       true, false, true),
    ('contacts.view_balances',              false, false, true),
    ('directories.create_items',            true, false, true),
    ('finance.accounts.manage',             false, false, true),
    ('finance.payment_links.create',        true, true, true),
    ('finance.payment_links.delete',        true, true, true),
    ('finance.transactions.correct',        false, false, false),
    ('finance.transactions.delete',         false, false, true),
    ('finance.transactions.expense',        true, true, true),
    ('finance.transactions.income',         true, true, true),
    ('finance.transactions.transfer',       true, true, true),
    ('finance.transactions.view',           true, true, true),
    ('inventory.assets.create',             true, true, true),
    ('inventory.assets.edit',               true, true, true),
    ('inventory.assets.view',               true, true, true),
    ('inventory.assets.write_off',          true, true, true),
    ('inventory.client_returns.create',     true, true, true),
    ('inventory.client_returns.delete',     true, true, true),
    ('inventory.client_returns.view',       true, true, true),
    ('inventory.conversions.create',        true, true, true),
    ('inventory.conversions.view',          true, true, true),
    ('inventory.delete_operations',         true, true, true),
    ('inventory.purchase_orders.create',    true, true, true),
    ('inventory.purchase_orders.delete',    true, true, true),
    ('inventory.purchase_orders.edit',      false, false, false),
    ('inventory.purchase_orders.view',      true, true, true),
    ('inventory.receipts.create',           true, true, true),
    ('inventory.receipts.delete',           true, true, true),
    ('inventory.receipts.edit',             false, false, false),
    ('inventory.receipts.view',             true, true, true),
    ('inventory.reservations.create',       true, true, true),
    ('inventory.reservations.delete',       true, true, true),
    ('inventory.reservations.edit',         true, true, true),
    ('inventory.reservations.view',         true, true, true),
    ('inventory.stock_takes.create',        true, true, true),
    ('inventory.stock_takes.delete',        true, true, true),
    ('inventory.stock_takes.view',          true, true, true),
    ('inventory.supplier_returns.create',   true, true, true),
    ('inventory.supplier_returns.delete',   true, true, true),
    ('inventory.supplier_returns.edit',     true, true, true),
    ('inventory.supplier_returns.view',     true, true, true),
    ('inventory.transfers.create',          true, true, true),
    ('inventory.transfers.edit',            true, true, true),
    ('inventory.transfers.view',            true, true, true),
    ('inventory.write_offs.create',         true, true, true),
    ('inventory.write_offs.delete',         true, true, true),
    ('inventory.write_offs.edit',           true, true, true),
    ('inventory.write_offs.view',           true, true, true),
    ('invoices.create',                     true, true, true),
    ('invoices.delete',                     true, true, true),
    ('invoices.edit',                       true, true, true),
    ('invoices.view',                       true, true, true),
    ('leads.create',                        true, true, true),
    ('leads.delete',                        true, true, true),
    ('leads.edit',                          true, true, true),
    ('leads.view',                          true, true, true),
    ('messages.use',                        true, true, true),
    ('orders.create_estimates',             true, true, true),
    ('orders.delete',                       false, true, true),
    ('orders.edit',                         true, true, true),
    ('orders.shared_filters',               true, true, true),
    ('payroll.accruals.create',             false, false, true),
    ('payroll.accruals.delete',             false, false, true),
    ('payroll.accruals.view',               false, false, true),
    ('reports.activity_log',                false, false, true),
    ('sales.create',                        true, true, true),
    ('sales.delete',                        true, true, true),
    ('settings.api',                        false, false, true),
    ('settings.checklists',                 false, false, true),
    ('settings.directories',                true, false, true),
    ('settings.employees',                  false, false, true),
    ('settings.employees.view_balance',     false, false, true),
    ('settings.finance',                    false, false, true),
    ('settings.forms',                      false, false, true),
    ('settings.general',                    false, false, true),
    ('settings.integrations',               false, false, true),
    ('settings.locations',                  false, false, true),
    ('settings.marketing',                  true, false, true),
    ('settings.notifications',              true, false, true),
    ('settings.payment_methods',            false, true, true),
    ('settings.payroll_rules.create',       false, false, true),
    ('settings.payroll_rules.delete',       false, false, true),
    ('settings.payroll_rules.edit',         false, false, true),
    ('settings.payroll_rules.view',         false, false, true),
    ('settings.prices',                     true, false, true),
    ('settings.print_templates',            false, false, true),
    ('settings.roles',                      false, false, true),
    ('settings.statuses',                   false, false, true),
    ('settings.tags',                       false, false, true),
    ('settings.taxes',                      true, true, true),
    ('settings.warehouses',                 true, true, true),
    ('staff.schedule.edit',                 false, false, true),
    ('staff.schedule.view',                 false, false, true),
    ('staff.timesheets.edit',               false, false, true),
    ('tasks.create',                        true, true, true),
    ('tasks.delete',                        true, true, true),
    ('tasks.edit',                          true, true, true),
    ('tasks.view',                          true, true, true);

do $$
declare
  v_workspace uuid;
  v_role_name text;
  v_role_id uuid;
  v_roles integer := 0;
  v_perms integer := 0;
  v_count integer;
begin
  for v_workspace in
    select w.id from public.workspaces w where w.deleted_at is null order by w.created_at, w.id
  loop
    foreach v_role_name in array array['Инженер', 'Менеджер / Приемщик', 'Полный доступ'] loop
      select r.id into v_role_id
      from public.roles r
      where r.workspace_id = v_workspace and r.name = v_role_name;

      if v_role_id is null then
        insert into public.roles (workspace_id, name)
        values (v_workspace, v_role_name)
        returning id into v_role_id;
        v_roles := v_roles + 1;
      end if;

      insert into public.role_permissions (workspace_id, role_id, permission)
      select v_workspace, v_role_id, p.permission
      from crm_seed_permissions p
      where case v_role_name
              when 'Инженер' then p.engineer
              when 'Менеджер / Приемщик' then p.manager
              else p.full_access
            end
      on conflict (role_id, permission) do nothing;
      get diagnostics v_count = row_count;
      v_perms := v_perms + v_count;
    end loop;
  end loop;

  raise notice 'Seed roles: created % roles, inserted % role_permissions', v_roles, v_perms;
end $$;

commit;

-- Проверка после применения (необязательно):
-- select r.name, count(*) from public.roles r join public.role_permissions rp on rp.role_id = r.id
--  where r.name in ('Инженер','Менеджер / Приемщик','Полный доступ') group by r.name;
-- Ожидается на каждое пространство: Инженер 80, Менеджер / Приемщик 69, Полный доступ 111.
