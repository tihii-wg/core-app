-- =====================================================================
-- Core App: шаблоны сообщений RO App для каждого рабочего пространства (seed).
-- Приложение Д.2 (docs/ro-app-migration.md).
--
-- Запускать ПОСЛЕ crm_ro_v1.PRODUCTION.sql (нужна public.message_templates).
-- Бэкап обязателен; сначала применить на TEST.
--
-- Что делает:
--   * для каждого неудалённого рабочего пространства (workspaces.deleted_at is null)
--     вставляет 12 шаблонов из Приложения Д.2 (10 внешних + 2 внутренних in_app),
--     ТОЛЬКО если в этом пространстве ещё нет неудалённого шаблона с тем же
--     именем И каналом (идемпотентно по (workspace_id, name, channel));
--   * тексты и переменные (#ЗАКАЗ-НОМЕР, #КЛИЕНТ-ИМЯ, ...) сохраняются как в RO App,
--     подстановка переменных — в Приложении Е.2, здесь ничего не подставляется;
--   * отчёт: сколько шаблонов вставлено.
--
-- Чего не делает:
--   * не меняет и не удаляет существующие шаблоны (правки владельца не затираются);
--   * не создаёт notification_rules (правила Д.1 — отдельный шаг) и не включает
--     отправку: никаких SMS / email / Telegram это не отправляет;
--   * не пишет в RO App.
--
-- Каналы (message_templates.channel) — допущение, проверьте с владельцем:
--   Email для заказчика, Email для исполнителя     -> email
--   SMS - ...  и  SMS для исполнителя              -> sms
--   Изменен статус (клиенту: «Статус вашего заказа») -> sms
--   Для менеджера                                  -> telegram (правило Д.1: менеджер получает Telegram)
--   Добавлен комментарий, Заказ перемещен          -> in_app   (сообщения для сотрудников)
--   «Email для исполнителя» и «Изменен статус» ДОПОЛНИТЕЛЬНО как отдельные in_app-шаблоны
--   (Д.2: внутренние копии с тем же текстом). Поэтому ключ идемпотентности — имя + канал.
--
-- Идемпотентно: повторный запуск ничего не вставит.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.message_templates') is null then
    raise exception 'Нет public.message_templates: сначала примените crm_ro_v1.PRODUCTION.sql';
  end if;
end $$;

create temp table crm_seed_message_templates (
  name text not null,
  channel text not null,
  subject text,
  body text not null
) on commit drop;

insert into crm_seed_message_templates (name, channel, subject, body)
values
  ('Email для заказчика', 'email', 'Email для заказчика',
   $b$#КОМПАНИЯ-НАЗВАНИЕ благодарит вас за доверие И желает вам хорошего дня и настроения!!$b$),
  ('Email для исполнителя', 'email', 'Email для исполнителя',
   $b$Вы назначены исполнителем в заказ №#ЗАКАЗ-URL-ДЛЯ-ИСПОЛНИТЕЛЯ (#ЗАКАЗ-ТИП-ИЗДЕЛИЯ-831040 #ЗАКАЗ-МОДЕЛЬ-831027 - #ЗАКАЗ-НЕИСПРАВНОСТЬ). Клиент: #КЛИЕНТ-ИМЯ #КЛИЕНТ-АДРЕС #КЛИЕНТ-ТЕЛЕФОН!$b$),
  ('SMS - ваш заказ готов к выдачи', 'sms', null,
   $b$Ваш заказ готов к выдачи, с уважением фирма "SANS" SRL Руслан - +37379628111$b$),
  ('SMS для исполнителя', 'sms', null,
   $b$Вы назначены исполнителем в заказ №#ЗАКАЗ-НОМЕР (#ЗАКАЗ-ТИП-ИЗДЕЛИЯ-831040 #ЗАКАЗ-МОДЕЛЬ-831027 - #ЗАКАЗ-НЕИСПРАВНОСТЬ). Клиент: #КЛИЕНТ-ИМЯ #КЛИЕНТ-АДРЕС #КЛИЕНТ-ТЕЛЕФОН!$b$),
  ('SMS - машина готова', 'sms', null,
   $b$Ваша машина готова! Благодарим за доверие. К оплате #К-ОПЛАТЕ #ВАЛЮТА$b$),
  ('SMS - оценка клиента', 'sms', null,
   $b$Пожалуйста оцените качество работы нашего сервисного центра #ЗАКАЗ-URL-ОТЗЫВ-КЛИЕНТА$b$),
  ('Для менеджера', 'telegram', null,
   $b$Вы назначены менеджером в заказ №#ЗАКАЗ-НОМЕР (#ЗАКАЗ-ТИП-ИЗДЕЛИЯ-831040 #ЗАКАЗ-МОДЕЛЬ-831027 - #ЗАКАЗ-НЕИСПРАВНОСТЬ). Клиент: #КЛИЕНТ-ИМЯ #КЛИЕНТ-АДРЕС #КЛИЕНТ-ТЕЛЕФОН! Время исполнения заказа: #ДАТА-ЗАКАЗ-ЗАПЛАНИРОВАН-НА$b$),
  ('Добавлен комментарий', 'in_app', null,
   $b$#КОММЕНТАРИЙ-АВТОР добавил комментарий "#КОММЕНТАРИЙ" в заказ №#ЗАКАЗ-НОМЕР$b$),
  ('Заказ перемещен', 'in_app', null,
   $b$Заказ №#ЗАКАЗ-НОМЕР (#ЗАКАЗ-МОДЕЛЬ-831027) перемещен в мастерскую '#ЛОКАЦИЯ'$b$),
  ('Изменен статус', 'sms', null,
   $b$Статус вашего заказа №#ЗАКАЗ-НОМЕР (#ЗАКАЗ-МОДЕЛЬ-831027) изменен на "#СТАТУС"!$b$),
  -- Внутренние (in_app) копии с тем же текстом, что и внешние (Д.2).
  ('Email для исполнителя', 'in_app', null,
   $b$Вы назначены исполнителем в заказ №#ЗАКАЗ-URL-ДЛЯ-ИСПОЛНИТЕЛЯ (#ЗАКАЗ-ТИП-ИЗДЕЛИЯ-831040 #ЗАКАЗ-МОДЕЛЬ-831027 - #ЗАКАЗ-НЕИСПРАВНОСТЬ). Клиент: #КЛИЕНТ-ИМЯ #КЛИЕНТ-АДРЕС #КЛИЕНТ-ТЕЛЕФОН!$b$),
  ('Изменен статус', 'in_app', null,
   $b$Статус вашего заказа №#ЗАКАЗ-НОМЕР (#ЗАКАЗ-МОДЕЛЬ-831027) изменен на "#СТАТУС"!$b$);

do $$
declare
  v_inserted integer;
begin
  insert into public.message_templates (workspace_id, name, channel, subject, body, is_active)
  select w.id, s.name, s.channel, s.subject, s.body, true
  from public.workspaces w
  cross join crm_seed_message_templates s
  where w.deleted_at is null
    and not exists (
      select 1 from public.message_templates t
      where t.workspace_id = w.id
        and t.deleted_at is null
        and lower(t.name) = lower(s.name)
        and t.channel = s.channel
    );
  get diagnostics v_inserted = row_count;
  raise notice 'message_templates inserted: %', v_inserted;
end $$;

-- VERIFY (read-only; runs after the insert, inside the same transaction): expected 0 rows.
select w.id as workspace_id, s.name, s.channel
from public.workspaces w
cross join (select distinct name, channel from crm_seed_message_templates) s
where w.deleted_at is null
  and not exists (
    select 1 from public.message_templates t
    where t.workspace_id = w.id and t.deleted_at is null and lower(t.name) = lower(s.name) and t.channel = s.channel
  );

commit;
