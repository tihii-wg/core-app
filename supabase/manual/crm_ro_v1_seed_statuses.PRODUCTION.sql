-- =====================================================================
-- Core App: первичные статусы и переходы (Приложение Г, docs/ro-app-migration.md).
--
-- Запускать ПОСЛЕ crm_ro_v1.PRODUCTION.sql (или 20261031000000_orders_custom_status.PRODUCTION.sql).
-- Бэкап обязателен; сначала применить на копии базы.
--
-- Что делает:
--   * для каждого неудалённого рабочего пространства и каждой сущности
--     (order, estimate, lead, invoice, transfer, task) вставляет статусы,
--     ТОЛЬКО если у этой сущности в пространстве ещё нет ни одного
--     неудалённого статуса (иначе пропускает сущность целиком, включая переходы,
--     чтобы не перезаписать настройки владельца);
--   * вставляет status_transitions: «все остальные» = переходы в каждый другой статус
--     той же сущности; «нет» = без строк; иначе только перечисленные имена;
--   * для заказов заполняет system_status (значения OrderStatus Core App).
--
-- Чего не делает: не меняет и не удаляет существующие статусы, не трогает orders,
-- не заполняет status_role_permissions и status_print_templates
-- (нет строки = доступно всем ролям / всем шаблонам по умолчанию, см. Приложение Б.2/Г).
--
-- Идемпотентно: повторный запуск ничего не вставит.
--
-- Допущения по system_status заказов (OrderStatus: new | in-progress | waiting-parts
-- | completed | paid | cancelled; статуса pending в типе нет):
--   Новый              -> new
--   В работе           -> in-progress
--   На согласовании    -> in-progress  (открытый, pending в Core App отсутствует)
--   Ждет запчасть      -> waiting-parts
--   Ждём ОПЛАТЫ        -> in-progress  (открытый; работа ещё не закрыта оплатой)
--   Готов              -> completed
--   !!! НЕ ОПЛАЧЕНЫ !!!-> completed
--   Закрыт             -> completed    (приложение ставит paid, если оплачен полностью)
--   Отказ              -> cancelled
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.status_definitions') is null or to_regclass('public.status_transitions') is null then
    raise exception 'Нет public.status_definitions / public.status_transitions: сначала примените crm_ro_v1.PRODUCTION.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Данные из Приложения Г.
-- next_names: {'*'} = все остальные, {} = нет, иначе список имён.
-- ---------------------------------------------------------------------
create temp table crm_seed_statuses (
  entity text not null,
  sort_order integer not null,
  name text not null,
  color text not null,
  status_group text not null,
  system_status text,
  next_names text[] not null,
  show_overdue_badge boolean not null default false,
  adds_to_backorders boolean not null default false,
  require_on_enter text
) on commit drop;

insert into crm_seed_statuses
  (entity, sort_order, name, color, status_group, system_status, next_names, show_overdue_badge, adds_to_backorders, require_on_enter)
values
  -- Заказы
  ('order', 1, 'Новый',               '#2563EB', 'new',         'new',           array['*'],                                         true,  false, null),
  ('order', 2, 'В работе',            '#16A34A', 'in_progress', 'in-progress',   array['*'],                                         true,  true,  null),
  ('order', 3, 'На согласовании',     '#F59E0B', 'pending',     'in-progress',   array['*'],                                         true,  true,  null),
  ('order', 4, 'Ждет запчасть',       '#F59E0B', 'pending',     'waiting-parts', array['*'],                                         true,  true,  null),
  ('order', 5, 'Ждём ОПЛАТЫ',         '#F59E0B', 'pending',     'in-progress',   array['*'],                                         false, true,  null),
  ('order', 6, 'Готов',               '#404040', 'done',        'completed',     array['*'],                                         false, false, null),
  ('order', 7, '!!! НЕ ОПЛАЧЕНЫ !!!', '#404040', 'done',        'completed',     array['*'],                                         true,  false, null),
  ('order', 8, 'Закрыт',              '#737373', 'closed',      'completed',     array['Ждём ОПЛАТЫ'],                               false, false, null),
  ('order', 9, 'Отказ',               '#A3A3A3', 'dropped_off', 'cancelled',     array['!!! НЕ ОПЛАЧЕНЫ !!!', 'Ждём ОПЛАТЫ'],        false, false, null),

  -- Сметы
  ('estimate', 1, 'Черновик',     '#2563EB', 'new',         null, array['*'], true,  false, null),
  ('estimate', 2, 'В работе',     '#16A34A', 'in_progress', null, array['*'], true,  false, null),
  ('estimate', 3, 'В ожидании',   '#F59E0B', 'pending',     null, array['*'], true,  false, null),
  ('estimate', 4, 'Отправлен',    '#06B6D4', 'delivery',    null, array['*'], true,  false, null),
  ('estimate', 5, 'Принят',       '#404040', 'done',        null, array['*'], false, false, null),
  ('estimate', 6, 'Заказ создан', '#737373', 'closed',      null, array[]::text[], false, false, null),
  ('estimate', 7, 'Отменен',      '#A3A3A3', 'dropped_off', null, array[]::text[], false, false, null),
  ('estimate', 8, 'Отклонен',     '#A3A3A3', 'dropped_off', null, array[]::text[], false, false, null),

  -- Заявки
  ('lead', 1, 'Новое обращение',     '#2563EB', 'new',         null, array['*'], false, false, null),
  ('lead', 2, 'В работе',            '#16A34A', 'in_progress', null,
     array['Успешный заказ', 'Успешная продажа', 'Дорого', 'Передумал', 'Ошибочное обращение'], false, false, null),
  ('lead', 3, 'Успешный заказ',      '#737373', 'closed',      null, array[]::text[], false, false, 'order'),
  ('lead', 4, 'Успешная продажа',    '#737373', 'closed',      null, array[]::text[], false, false, 'sale'),
  ('lead', 5, 'Дорого',              '#A3A3A3', 'dropped_off', null, array[]::text[], false, false, null),
  ('lead', 6, 'Передумал',           '#A3A3A3', 'dropped_off', null, array[]::text[], false, false, null),
  ('lead', 7, 'Ошибочное обращение', '#A3A3A3', 'dropped_off', null, array[]::text[], false, false, null),

  -- Счета
  ('invoice', 1, 'Черновик',  '#2563EB', 'new',         null, array['*'], false, false, null),
  ('invoice', 2, 'Выставлен', '#F59E0B', 'in_progress', null, array['*'], false, false, null),
  ('invoice', 3, 'Оплачено',  '#16A34A', 'paid',        null, array['*'], false, false, null),
  ('invoice', 4, 'Отменен',   '#737373', 'canceled',    null, array['*'], false, false, null),

  -- Перемещения (названия на английском, как в Приложении Г)
  ('transfer', 1, 'Draft',         '#1973e1', 'new',         null, array['*'], false, false, null),
  ('transfer', 2, 'Ready to ship', '#099b49', 'in_progress', null, array['*'], false, false, null),
  ('transfer', 3, 'In transit',    '#5bc0de', 'delivery',    null, array['*'], false, false, null),
  ('transfer', 4, 'Received',      '#53585c', 'done',        null, array['*'], false, false, null),
  ('transfer', 5, 'Completed',     '#737373', 'closed',      null, array['*'], false, false, null),
  ('transfer', 6, 'Canceled',      '#c9cbcc', 'canceled',    null, array['*'], false, false, null),

  -- Задачи
  ('task', 1, 'К выполнению', '#737373', 'new',         null, array['*'], false, false, null),
  ('task', 2, 'В работе',     '#2563eb', 'in_progress', null, array['*'], false, false, null),
  ('task', 3, 'Отложенные',   '#f59e0b', 'pending',     null, array['*'], false, false, null),
  ('task', 4, 'Готово',       '#16a34a', 'done',        null, array['*'], false, false, null);

-- ---------------------------------------------------------------------
-- Проверка списков «следующих статусов»: каждое имя должно существовать в той же сущности.
-- ---------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s: «%s» -> «%s»', s.entity, s.name, n.next_name), '; ')
  into v_bad
  from crm_seed_statuses s
  cross join lateral unnest(s.next_names) as n(next_name)
  where n.next_name <> '*'
    and not exists (
      select 1 from crm_seed_statuses t where t.entity = s.entity and t.name = n.next_name
    );
  if v_bad is not null then
    raise exception 'Seed: переход в несуществующий статус: %', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Вставка по рабочим пространствам.
-- ---------------------------------------------------------------------
do $$
declare
  v_workspace uuid;
  v_entity text;
  v_statuses integer := 0;
  v_transitions integer := 0;
  v_count integer;
begin
  for v_workspace in
    select w.id from public.workspaces w where w.deleted_at is null order by w.created_at, w.id
  loop
    for v_entity in
      select distinct entity from crm_seed_statuses order by 1
    loop
      if exists (
        select 1 from public.status_definitions d
        where d.workspace_id = v_workspace and d.entity = v_entity and d.deleted_at is null
      ) then
        continue;
      end if;

      insert into public.status_definitions (
        workspace_id, entity, name, color, status_group, system_status,
        show_overdue_badge, require_on_enter, adds_to_backorders,
        sort_order, is_default, is_active
      )
      select
        v_workspace, s.entity, s.name, s.color, s.status_group, s.system_status,
        s.show_overdue_badge, s.require_on_enter, s.adds_to_backorders,
        s.sort_order, s.sort_order = 1, true
      from crm_seed_statuses s
      where s.entity = v_entity
      order by s.sort_order;
      get diagnostics v_count = row_count;
      v_statuses := v_statuses + v_count;

      insert into public.status_transitions (workspace_id, status_id, next_status_id)
      select v_workspace, f.id, t.id
      from crm_seed_statuses s
      join public.status_definitions f
        on f.workspace_id = v_workspace and f.entity = s.entity and f.name = s.name and f.deleted_at is null
      join public.status_definitions t
        on t.workspace_id = v_workspace and t.entity = s.entity and t.deleted_at is null and t.id <> f.id
      where s.entity = v_entity
        and (
          s.next_names = array['*']::text[]
          or t.name = any (s.next_names)
        )
      on conflict (status_id, next_status_id) do nothing;
      get diagnostics v_count = row_count;
      v_transitions := v_transitions + v_count;
    end loop;
  end loop;

  raise notice 'Seed statuses: inserted % statuses and % transitions', v_statuses, v_transitions;
end $$;

commit;

-- Проверка после применения (необязательно):
-- select entity, count(*) from public.status_definitions where deleted_at is null group by 1 order by 1;
-- select d.entity, d.name, count(t.next_status_id) as next_count
--   from public.status_definitions d
--   left join public.status_transitions t on t.status_id = d.id
--  where d.deleted_at is null group by d.entity, d.name, d.sort_order order by d.entity, d.sort_order;
