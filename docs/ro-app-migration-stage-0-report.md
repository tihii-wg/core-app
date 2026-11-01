# Этап 0 — Отчёт аудита (RO App → Core App)

Дата: 2026-10-31  
Источник ТЗ: `docs/ro-app-migration.md` (разделы 1–10, Приложение А)  
База для сверки схемы: `supabase/snapshot/production_snapshot.json` (снят **2026-09-29**) + миграции в репозитории + код приложения.  
**Живая Production/TEST БД в этом этапе не изменялась и не опрашивалась.**

---

## 1. Что совпало с разделом 3

| Область | Статус |
|---|---|
| Стек Vite / React / Supabase / Radix / Recharts / i18next | Совпадает с кодом |
| Маршруты `/:locale/:workspaceId/...` | Совпадает (`App.tsx`) |
| Таблицы baseline: workspaces, workspace_members, profiles, clients, employees, services, orders, order_services, inventory_items | Есть в snapshot и baseline |
| RPC soft_delete_workspace, workspace_member_* | Есть в миграциях |
| Статусы заказов в UI/коде | `new`, `in-progress`, `waiting-parts`, `completed`, `paid`, `cancelled` |
| Склад: request в заказе, выдача/возврат через RPC | `sync_order_materials` + `issue_order_materials` / `return_order_materials` |
| Темы light/dark/system | `profiles.theme` + `localStorage['coreapp-theme']` + класс `dark` |
| i18next EN/RO/RU | Используется |

---

## 2. Расхождения (код / миграции / документ / snapshot)

### 2.1. Критично: snapshot Production (29.09) сильно отстаёт от текущего кода

В snapshot **нет** таблиц/объектов, которые приложение уже использует в коде:

| Объект в коде / ТЗ §3 | В snapshot 29.09 | В `supabase/migrations/` |
|---|---|---|
| `vehicles` | нет | **нет SQL** |
| `orders.vehicle_id` | нет | **нет SQL** |
| `expenses` | нет | есть `20261005020000_expenses.sql` |
| `payments` | нет | только manual-sql / harden |
| `invoices` / `invoice_items` | нет | есть миграции 20261004* |
| `order_materials` / `inventory_movements` | нет | есть 20261018* |
| `legal_entities` + General Settings колонки | нет | только `supabase/manual/20261019220000_general_settings.*` |
| `require_tax_invoice_number`, markup и др. на workspaces | частично / нет | mixed manual + archive |

**Вывод:** раздел 3 ТЗ описывает *целевое* / *текущее приложение*, а не гарантированно применённую схему. Перед Приложением А нужна свежая выгрузка `information_schema` с живой БД.

### 2.2. Статусы: дефисы в Core vs подчёркивания в ТЗ

| Core App (код) | ТЗ / Приложение А (`system_status`) |
|---|---|
| `in-progress` | `in_progress` |
| `waiting-parts` | отдельный статус / группа pending |
| `cancelled` | `cancelled` / `canceled` (в status_group — `canceled`) |

`orders.status` в baseline — свободный `text` **без CHECK/enum**. Добавление `pending` возможно без смены типа; нужно согласовать **канонические строки** (`in-progress` vs `in_progress`) до Этапа 1.

### 2.3. `clients.balance`

- Хранится как `numeric`, читается в `apiClients`.
- **Нигде в коде не пересчитывается** из заказов/платежей.
- «Взаиморасчёт» (`clientSettlement.ts`): `finalBalance = storedBalance − outstanding`, где `storedBalance` трактуется как **аванс клиента** (положительный = кредит у бизнеса).
- UI карточки клиента красит `balance > 0` как debt (destructive) — **знак в UI карточки и в settlement расходятся по смыслу**. Не менял; зафиксировать перед Этапом 2 (модуль балансов RO).

### 2.4. Paid

Единственный app-путь: `updateOrderStatus` → при `paid` пишет `{ status: 'paid', is_paid: true }`.  
Блокировка смены Paid для не-owner; tax invoice gate для юрлиц. DB-триггера на paid в репозитории нет.

### 2.5. Тесты

Есть unit/integration вокруг orders, vehicles, finance, soft_delete, payments (local-validate). Отдельного e2e на связку vehicle_id ↔ история машины нет.

---

## 3. SQL в репозитории, но не подтверждённые на snapshot

| Скрипт | Назначение | Признак в UI |
|---|---|---|
| `migrations/20261005020000_expenses.sql` | Таблица expenses + RLS | «Примените миграцию expenses» |
| `manual/20261019220000_general_settings.*` | Юрлица, consents, VIN open-order index, invoice settings | «Требуется SQL-скрипт General Settings» |
| `migrations/202610040*.sql` | Invoices / counters | — |
| `migrations/202610181*.sql` | order_materials + issue/return | — |
| `manual-sql/harden_payment_ledger.sql` | payments ledger | — |
| `manual/20261018210000_issue_return_rpc_repair.*` | Ремонт RPC | — |

**Важно:** DDL для `vehicles` / `orders.vehicle_id` в репозитории **отсутствует**, хотя фича уже в UI. Перед Приложением А нужно либо найти, где это применяли вне git, либо оформить аддитивную миграцию (отдельно от Приложения А).

---

## 4. Миграция expenses (подготовлена, не запускалась)

Файл для владельца:

`supabase/manual/20261005020000_expenses.PRODUCTION.sql`

Содержимое = миграция `20261005020000_expenses.sql` + инструкция.  
Создаёт `public.expenses`, RLS (member read / owner+admin write), grants.

**Не запускал.** Чтобы убрать баннер на Finance, владелец должен применить этот файл в SQL Editor (сначала на копии). После применения критерий «предупреждение о расходах исчезло» можно закрыть.

Проверка после применения:

1. Открыть Finance — нет текста unavailable.
2. Owner/admin: Add expense → строка в ленте.
3. Member: видит расходы, не может создать (RLS).

---

## 5. Баг vehicle_id / «Заказов пока нет» на карточке машины

### Причина (две части)

1. **Разные источники данных**  
   - История клиента: фильтр `orders.client_id`, в строке показываются `device` / `car_number` / `vin` (текст на заказе).  
   - Карточка машины: `getVehicleOrders` → строго `orders.vehicle_id = :id`.  
   Если у заказа заполнен `device` («Lexus …»), но `vehicle_id IS NULL`, клиент видит заказ, машина — «нет заказов».

2. **Гонка в форме**  
   `OrderVehicleFields` очищал `vehicleId`, когда список машин временно пуст (`data ?? []` при ещё не завершённом запросе / ошибке), **оставляя** snapshot device/plate/VIN. Сохранение создавало/обновляло заказ без FK.

### Что сделано в коде (п.4 Этапа 0)

| Файл | Изменение |
|---|---|
| `src/features/vehicles/useGetClientVehicles.ts` | Экспорт `isFetched` |
| `src/features/orders/OrderVehicleFields.tsx` | Очистка selection только после успешного settle (`isFetched && !isError`) |
| `src/features/orders/OrderDetailPanel.tsx` | Assignee update явно передаёт текущий `vehicleId` |

Тесты `OrderVehicleFields` / `OrderDetailPanel` — зелёные.

### Что ещё нужно (не сделано — нужна команда)

- Подтвердить на живых данных Lexus: `select id, device, vehicle_id from orders where …`.  
- Опциональный **backfill** (только после бэкапа), пример идеи:

```sql
-- НЕ ЗАПУСКАТЬ без ревью: сопоставление по VIN + client_id
update public.orders o
set vehicle_id = v.id
from public.vehicles v
where o.vehicle_id is null
  and v.deleted_at is null
  and o.client_id = v.client_id
  and o.workspace_id = v.workspace_id
  and nullif(btrim(o.vin), '') is not null
  and lower(o.vin) = lower(v.vin);
```

- Оформить недостающую миграцию `vehicles` + `orders.vehicle_id`, если её нет на живой БД.

Критерий «заказы видны в карточке машины» для уже созданных строк **не закрыт** без backfill / проверки live.

---

## 6. Три риска для SQL Приложения А

### 6.1. `sync_order_materials` и новые поля строк

Текущая логика (после warehouse migration):  
- update `quantity` у существующей строки по `inventory_item_id`;  
- delete только строк с нулевым issued/returned, которых нет в desired;  
- insert новых.

**Не** пересоздаёт все строки каждый раз. Новые nullable-колонки на `order_materials` при update quantity **сохраняются**. Риск потери — при удалении+повторной вставке той же позиции (новый `id`, дефолты). Для technician_id / warranty / comment на материалах нужна осторожность в UI/RPC на Этапе 2–3.

### 6.2. `payments.order_id` nullable

В `harden_payment_ledger` / local-validate fixtures: `order_id uuid references … on delete set null`, допускает NULL (оплата продаж). Триггер требует order_id **или** invoice_id. Совместимо с Приложением А. На snapshot 29.09 таблицы payments ещё нет — проверить живую БД.

### 6.3. `soft_delete_workspace` vs `crm_permitted_workspaces`

- Сейчас: soft_delete ставит `deleted_at` на `workspaces` и `workspace_members`.  
- `is_workspace_member` проверяет оба `deleted_at IS NULL`.  
- Приложение А: `crm_permitted_workspaces` смотрит только `workspace_members.deleted_at` (**не** `workspaces.deleted_at`).

**Правка к Приложению А (рекомендация):** в SELECT добавить join/exists на `workspaces w … and w.deleted_at is null`, как в текущем `is_workspace_member`. Иначе теоретический доступ к soft-deleted workspace, если membership-строка забыли пометить.

---

## 7. Темы (п.8 Этапа 0) — только описание

| Вопрос | Ответ по коду |
|---|---|
| Приоритет profile vs localStorage | После загрузки профиля побеждает `profiles.theme`; значение кэшируется в `localStorage['coreapp-theme']`. До загрузки — кэш. |
| Другое устройство | Тема приходит из `profiles.theme` после логина. |
| Flash | Inline script в `index.html` ставит `dark` до React. |
| Auth pages | `/`, login, register, forgot-password — скрипт не трогает (всегда светлые). |
| `theme-color` | Жёстко `#f6f7f9` в `index.html` — на тёмной теме полоса браузера светлая (已知 из ТЗ 5.17). |
| Жёсткие цвета | `ReportDocument`, `InvoicePrintDocument` (печать — ок), `Switch`/`slider` `bg-white`, токены в `:root` / `.dark` в CSS. Не перекрашивал. |

---

## 8. Правки к Приложению А (до запуска)

1. **Не запускать**, пока нет свежей сверки живой схемы (особенно `vehicles`, uuid типов, payments, expenses).  
2. Preflight Приложения А требует `vehicles.id` uuid — если таблицы нет, скрипт упадёт (это хорошо). Сначала аддитивно создать vehicles/vehicle_id **или** подтвердить, что они уже на БД.  
3. Согласовать `system_status` строки с Core: `in-progress` / `waiting-parts`, не слепо `in_progress`.  
4. В `crm_permitted_workspaces` учесть `workspaces.deleted_at`.  
5. `status_group` использует `canceled` (одна l); Core — `cancelled` (две l) для order status — развести имена.  
6. Не добавлять pending/cancelled в CHECK, пока не подтверждён тип хранения (сейчас free text — проще).

---

## 9. Уточнённый план этапов (после Этапа 0)

| Этап | Уточнение |
|---|---|
| **0 остаток** | Owner: expenses SQL → проверить Finance. Live schema dump. Backfill vehicle_id по согласованию. Миграция vehicles, если отсутствует. |
| **1** | Только после зелёного preflight на **копии**. Сначала канон статусов. Затем Приложение А → локации/роли/status_definitions/бейджи/темы. |
| **2–8** | Как в ТЗ §9; баланс клиентов не ломать до явной модели RO. |
| **Архитектура** | Без смены стека: React Query, RHF, Radix Sheet, существующие RPC-паттерны. |

---

## 10. Критерии приёмки Этапа 0

| Критерий | Статус |
|---|---|
| Отчёт одобрен владельцем | ⏳ ждёт ревью |
| Предупреждение о расходах исчезло | ⏳ нужен apply `…expenses.PRODUCTION.sql` владельцем |
| Заказы видны в карточке машины | 🟡 гонка в форме исправлена; старые NULL `vehicle_id` — backfill / live check |

---

## 11. Изменённые файлы на Этапе 0

- `docs/ro-app-migration.md` — положен ТЗ  
- `docs/ro-app-migration-stage-0-report.md` — этот отчёт  
- `supabase/manual/20261005020000_expenses.PRODUCTION.sql` — готовый скрипт expenses  
- `src/features/vehicles/useGetClientVehicles.ts`  
- `src/features/orders/OrderVehicleFields.tsx`  
- `src/features/orders/OrderVehicleFields.test.tsx`  
- `src/features/orders/OrderDetailPanel.tsx`  

**Не сделано:** apply SQL, Приложение А, этапы 1+, деплой, commit/push.

---

## Решения владельца (нужны до Этапа 1)

1. Применить expenses на копии, затем на Production?  
2. Дать доступ / свежий schema dump живой БД (есть ли `vehicles`, `payments`, `expenses`, типы uuid)?  
3. Канон статусов: оставить `in-progress` / `waiting-parts`?  
4. Backfill `orders.vehicle_id` по VIN/госномеру?  
5. Контраст токенов из §5.17 — менять или оставить (только показать позже на Этапе 1)?  
6. SMS / Telegram / способ выгрузки RO — по §10, не блокер Этапа 0.  
