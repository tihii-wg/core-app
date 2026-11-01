# Core App — Feature readiness audit

**Audit date:** 2026-11-01 (refreshed post–P0.4)  
**Scope:** Repository-wide readiness vs RO→Core migration requirements.  
**Evidence basis:** Application source (`src/`), services, prepared SQL (`supabase/manual/`, `supabase/migrations/`), local docs (`docs/ro-app-*.md`), and **owner-confirmed real email recovery test** for password reset.  
**Not done in this audit pass:** Remote Supabase queries, RLS live checks, full Vitest/E2E suite, or any application/SQL/env changes.

**Status key**

| Status | Meaning |
| --- | --- |
| COMPLETE | Essential end-to-end behaviour implemented with real backend paths (and verified where noted). |
| PARTIAL | Meaningful implementation; important business logic, SQL wiring, or edge cases missing. |
| MISSING | Required (or clearly planned) capability absent. |
| PLACEHOLDER | UI exists but operation is mocked, local-only, or not genuinely connected. |
| DOCUMENTATION ONLY | Described in docs/SQL notes; no usable app path. |
| BLOCKED | Cannot ship safely without schema/provider/policy decision. |

> **COMPLETE ≠ “every RO cutover RPC verified on MAIN.”** Features that still need owner SQL are marked PARTIAL/BLOCKED with dependency class A–D below.

**Dependency classes (for unfinished items):** A = app-only · B = existing backend integration · C = DB migration/SQL · D = external service.

Requirement sources: `docs/ro-app-migration.md`, §1 checklist, implementation matrix, cutover guide.

---

## A. Core application

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Login | COMPLETE | `pages/LoginPage`, `features/auth`, `apiAuth` | Email/password via Supabase Auth | Auth (MAIN) |
| Registration | COMPLETE | `RegisterPage`, `RegisterForm` | Creates account + company flow | Auth |
| Password recovery | COMPLETE | `ForgotPasswordPage`, `ResetPasswordPage`, `requestPasswordReset` / `updateRecoveredPassword`, `passwordRecovery.ts`, `AuthSession`, `main.tsx` bootstrap | Real `resetPasswordForEmail` + localized `/{locale}/reset-password` `redirectTo`; user-bound recovery marker; callback rewrite if Site URL fallback; **real-world verified** (email → reset → new password → old fails → login OK) | Auth (MAIN); Dashboard redirect allow-list for path URLs recommended |
| Auth session / invalid session logout | COMPLETE | `AuthSession`, `App.tsx` QueryClient | Signs out on invalid session | Auth |
| MFA (enroll/verify/disable UI) | COMPLETE | `TwoFactorSettings`, `apiMfa`, hooks | Real TOTP enroll/verify/disable in code; project MFA flag still owner-ops | Auth factors |
| User profile edit | COMPLETE | `ProfileSettings`, `apiProfiles` | Name/phone/theme | `profiles` |
| Theme (light/dark/system) | COMPLETE | Appearance settings, profile theme | Persisted | `profiles.theme` |
| Workspaces list / create / delete | COMPLETE | Workspace selector, `apiWorkspaces` | Soft-delete; owner gates | `workspaces` |
| Workspace switch | COMPLETE | Company selector in topbar | Updates active workspace + route | `profiles.active_workspace_id` |
| Company settings | COMPLETE | `CompanySettings` | Name, industry, markup; owner-only | `workspaces` |
| Regional settings (lang/tz/currency/date) | COMPLETE | `RegionalSettings` | Interface language drives URL locale | `workspaces` |
| Logo upload / remove | COMPLETE | Workspace avatar hooks + storage policies in migrations | Storage bucket policies in repo | Storage |
| Team members invite/role/remove | COMPLETE | `TeamSettings`, `apiWorkspaceMembers` | Role hierarchy; subscription write guard | `workspace_members` |
| Employees CRUD | COMPLETE | `Employees`, `apiEmployees` | Linked/unlinked profiles | `employees` |
| Subscription write gating | COMPLETE | `useWorkspaceSubscription`, `useGuardSubscriptionWrite` | Blocks writes when inactive/expired | Workspace subscription fields |
| Roles & permissions (CRM) | PARTIAL | `RolesSettings`, `apiRoles`, `useMyPermissions`, `permissions.ts` | UI assign + gates; needs `crm_ro_v1` + seed roles on DB; legacy fallback if tables absent | SQL 2.1 / 2.2 |
| Soft-deleted workspace RLS helper | PARTIAL | SQL `20261101010000_…`; membership filters in app | Code ready; remote apply unverified | SQL 2.1a |
| Dashboard + quick actions | COMPLETE | `Dashboard`, deadline panels | Create order/client/part dialogs | Core tables |
| Global search | COMPLETE | `GlobalSearch`, hooks | Orders/clients/inventory; industry labels | Core tables |
| Sidebar nav + counts | COMPLETE | `AppSidebar`, `apiNavCounts` | No leads/estimates in sidebar (by design → Settings Modules) | — |
| In-app notification bell | PARTIAL | Topbar notifications UI | Alert chrome present; not a full RO notification center | — |

---

## B. CRM

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Clients list/CRUD | PARTIAL | `Clients`, `apiClients` | Create/update/search strong; no dedicated `deleteClient` API; soft-delete filters on read | `clients` |
| Client detail panel | COMPLETE | `ClientDetailPanel`, cards | Orders history, settlement entry | — |
| Client phones / addresses / extras | PARTIAL | `ClientExtrasSection`, `apiClientExtensions` | Real CRUD when tables exist; degrade unavailable without `crm_ro_v1` | RO extras tables (SQL) |
| Client discounts | PARTIAL | `clientDiscounts`, `apiClientDiscounts` | Fixed-% upsert; materials persist needs RPC; no `price_type` mode UI | SQL 2.1g for materials |
| Client settlement / balance | PARTIAL | `clientSettlement`, dialogs | Advance/balance semantics; still leans on `orders.is_paid`; balance entries mostly read | Payments/invoices |
| Leads list/CRUD | PARTIAL | `Leads`, `apiLeads`, Stage9 | List/create/soft-delete; **no edit** / status change / convert | `leads` (crm_ro_v1) |
| Estimates / quotations | PARTIAL | `Estimates`, `apiEstimates` | Header list/create/delete only; **`estimate_lines` unused in `src/`**; no convert→order | `estimates` |
| Tasks | PARTIAL | `Tasks`, `apiTasks` | List/create/edit/soft-delete; no assignee/order link | `tasks` |
| Bookings / schedule | PARTIAL | `Bookings`, route `schedule` | List/create/soft-delete; **no edit**; schedule ≠ calendar product | `bookings` |
| Public order status page | PARTIAL | `PublicOrderPage`, `apiPublicLinks` | Route coded; runtime **BLOCKED** without `crm_public_order_status` | SQL 2.1i |
| Public link mint (copy URL) | PARTIAL | `OrderActionsMenu`, create RPC client | Mint UI coded; runtime needs `crm_create_public_order_link` | SQL 2.1k |
| Activity history (reports) | PARTIAL | `ActivityLogPanel`, `apiActivityLog` | Read+CSV; writes from board/status when table present | `activity_log` |
| Sales / calls / messages modules | MISSING | Matrix stage 9 | Not in app routes as full modules | SQL may define tables |
| Lead→order / estimate→order conversion | MISSING | — | Not found as first-class flows | — |

---

## C. Orders & service management

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Order list + columns | COMPLETE | `Orders.tsx` | Filters, pagination patterns | `orders` |
| Create / edit order | COMPLETE | `AddNewOrderForm`, `EditOrderForm`, `apiOrders` | Client + ≥1 service required at API | — |
| Order numbering | COMPLETE | `apiOrders` sequence helpers | Per-workspace prefixes | `orders.number` |
| Built-in statuses | COMPLETE | Status badges, update status | Core enum statuses | — |
| Custom statuses + transitions | PARTIAL | `StatusesSettings`, board transitions, seeds | App+tests; needs definitions on DB | SQL 2.0/2.1/2.3 |
| Kanban board + DnD | PARTIAL | `OrdersBoard`, `useMoveOrderOnBoard` | Real DnD + transitions; needs `custom_status_id` / definitions on DB | Status tables |
| Calendar (month/week) | PARTIAL | `OrdersCalendar`, `orderCalendar` | Read-only month/week; no drag-reschedule; no bookings merge | — |
| Technician assignment | COMPLETE | Order forms assignee combobox | Employees list | `employees` |
| Services catalog CRUD | COMPLETE | `Services`, `apiServices` | Owner/admin gates | `services` |
| Order service lines | COMPLETE | Forms + `order_services` | Qty/price | — |
| Line kind (labor/service) | PARTIAL | `OrderServiceKindSelect` | Shown only if column exists | SQL 2.1e / crm_ro_v1 |
| Materials on order | COMPLETE | Materials UI + `apiOrders` materials | Stock changes on issue | `order_materials` |
| Issue materials (warehouse) | PARTIAL | `OrderWarehouseActions`, `apiWarehouse` | Picker+precheck; MissingRpc → global issue | SQL 2.1h |
| Return materials (warehouse) | PARTIAL | same | MissingRpc → global return + warning | SQL 2.1j |
| Comments | COMPLETE | `OrderFeedSection`, `apiOrderComments` | CRUD comments | `order_comments` |
| Order events feed | PARTIAL | `apiOrderEvents` | Read works; write via RPC | SQL 2.1d |
| Discounts (client → order totals) | PARTIAL | `orderTotals`, `apiOrders` discounts | Services path strong; materials need RPC | SQL 2.1f/2.1g |
| Order print templates | PARTIAL | `printTemplate`, Print settings, actions menu | Editor+sanitize+print; seeded acts need DB templates | `document_templates` |
| Vehicles / VIN / mileage | PARTIAL | `OrderVehicleFields`, `apiVehicles`, vehicle page | Linked vehicles for auto industry; serial/warranty on lines incomplete | SQL vehicles / 1.7 |
| Order types / custom forms (В.2–В.3) | MISSING / DOCUMENTATION ONLY | Migration appendix | Thin/absent vs RO | Mostly SQL/docs |
| Auto SMS on “Ready” | BLOCKED | §1 checklist | Policy: dry-run only until providers | Dry-run + seeds |
| Warranty / serial on totals | PARTIAL | Docs warranty plan; limited UX | Not full RO parity | — |
| Attachments | PARTIAL | `apiOrderAttachments` + storage SQL | Present in services; depth vs RO unclear | Storage |

---

## D. Inventory & warehouse

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Inventory items CRUD | COMPLETE | `Inventory`, `apiInventory` | SKU, stock status, markup helpers | `inventory_items` |
| Categories panel | PARTIAL | `CategoriesPanel`, `apiCategories` | **Read-only** list; hides if table missing; items still free-text category | `categories` |
| Warehouses settings | PARTIAL | `WarehousesSettings`, `apiWarehouses` | Explicit **read-only** list of warehouses/bins/stock; **no warehouse CRUD API** | `warehouses` |
| Locations settings | PARTIAL | `LocationsSettings`, `apiLocations` | Create/default/delete; no edit; seed script exists | SQL 2.4 |
| Warehouse stock balances | PARTIAL | `apiWarehouseStock` **SELECT only** | Updates only via RPC post | SQL 2.1c |
| Goods receipts / transfers / write-offs | PARTIAL | `WarehouseOpsPanel`, `apiWarehouseOps` | Draft UI + post; Post needs RPCs | SQL 2.1c |
| Inventory markup | COMPLETE | Workspace markup + inventory editor | — | `workspaces.inventory_markup` |
| Stock movement history | PARTIAL | `inventory_movements` via issue/return | Ops history UX limited vs RO | Movements table |
| Suppliers | PARTIAL | Inventory supplier fields/tests | Not a full supplier module | — |

---

## E. Finance & invoices

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Invoices list/create from order | COMPLETE | `Invoices`, `apiInvoices` | Workspace isolation | `invoices` |
| Invoice numbering | COMPLETE | Invoice counters migration + API | — | Counters |
| Invoice detail / mark paid | COMPLETE | `InvoiceDetailPanel` | Status transitions | — |
| Invoice print / PDF download path | COMPLETE | `InvoicePrint*` | Browser print + PDF download (not server pipeline) | — |
| Invoice email | PLACEHOLDER | `InvoiceEmailDialog` | **mailto + PDF**; no server mailer | No provider |
| Works vs materials on invoice | PARTIAL | Invoice items from order services | Full RO separation extras limited | — |
| VAT / taxes settings | PARTIAL | `TaxesSettings`, `vat.ts`, `useInvoiceVat` | Display helpers; create does not persist `tax_total` | `taxes` |
| Payments ledger (create/refund) | COMPLETE | `apiPayments`, payment dialogs | Append-only create + refund | `payments` |
| Payment void | BLOCKED | `paymentVoid.ts`, `PaymentVoidDialog` | `PAYMENT_VOID_SCHEMA_SUPPORTED = false`; propose SQL do-not-apply | Schema blocked |
| Payment → finance account | PARTIAL | Optional `account_id` + retry | Does **not** write `finance_transactions` → cash balances don’t move | Finance accounts |
| Cash accounts + transfer | PARTIAL | `FinanceAccountsSection`, transfer dialog | Transfer only; **no account CRUD** | SQL/schema |
| Expenses CRUD | PARTIAL | `Finance`, expense dialogs | Soft-unavailable without table; no account link | expenses SQL |
| Client balances / settlements | PARTIAL | Client settlement flows | Mutual settlement RO depth; `is_paid` mismatch | — |
| Online payment providers | PLACEHOLDER | Settings billing copy | Explicitly “not integrated” | Provider choice |
| Financial reports (deep RO) | PARTIAL | Reports module + finance stats | Core charts/CSV; not full RO finance suite | — |

---

## F. Reports & analytics

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| Reports KPIs + period | COMPLETE | `Reports.tsx`, `reportStats` | Revenue from **payments ledger** | Orders/clients/payments |
| Charts (overview/services/employees) | COMPLETE | Recharts sections | Placeholders when empty | — |
| Inventory trends chart | PLACEHOLDER | `Reports.tsx` | Hardcoded stub; no stock-history series | — |
| Quick reports routes | PARTIAL | `QuickReportPage`, `quickReports` | Financial path stubs when expenses/invoices unavailable | — |
| Export dialog / print job | PARTIAL | `ExportReportDialog`, print root | Sections preview; comprehensive export | — |
| Orders summary CSV | COMPLETE | Reports header action, `csvExport` | Formula escape | — |
| Activity log CSV | PARTIAL | Permission-gated | Needs table + permission | `activity_log` |
| Full RO report designer | MISSING | Matrix stage 6 | Not built | — |

---

## G. Settings & localization

| Feature | Status | Sources | Evidence / gaps | DB / integration |
| --- | --- | --- | --- | --- |
| EN / RO / RU | COMPLETE | `i18n/`, regional language | URL segment sync | — |
| Currency / timezone / date format | COMPLETE | Regional settings | — | Workspace fields |
| Notification rules UI | PARTIAL | `NotificationRulesSettings` | List + dry-run button | Rules/templates tables |
| Notification preference toggles | PLACEHOLDER | `Settings.tsx` notifications | Local `useState` only; not persisted | — |
| `emailInvoices` settings toggle | PLACEHOLDER | `Settings.tsx` | Local `useState`; not wired to mailer | — |
| Message templates | PARTIAL | `apiMessageTemplates`, seed SQL | Read lists; seed unapplied | SQL 2.5 |
| Print templates editor | PARTIAL | `PrintTemplatesSettings` | Edit `body_html` only (4 vars); no create/seed in app | Templates table |
| Statuses / locations / warehouses / roles / taxes | PARTIAL | Settings tabs | Mixed: statuses create; warehouses **read-only**; roles assign-only | crm_ro_v1 |
| Migration checklist + counts | PARTIAL | `MigrationSettings` | Local checklist + counts | — |
| Import preview | PARTIAL | `ImportPreviewCard` / migration | Dry-run CSV/JSON | No apply RPC |
| Import demo (`ImportDataDemo`) | PLACEHOLDER | Settings import tab | Explicit demo; never writes Supabase | — |
| Import apply | BLOCKED | `IMPORT_APPLY_AVAILABLE = false` | Intentionally disabled | Needs sandbox RPC |
| Coming modules hub | PLACEHOLDER | `ComingModulesSettings` | “Planned” badges stale; Stage9 routes already mutate | — |

---

## H. Integrations & security extras

| Feature | Status | Sources | Evidence / gaps | Integration class |
| --- | --- | --- | --- | --- |
| SMS / email / Telegram / WhatsApp send | BLOCKED | `apiMessageDispatch` | **Dry-run log only** | Dry-run (3) |
| Invoice outbound email | PLACEHOLDER | `InvoiceEmailDialog` | mailto | Manual (4) |
| Public link rate limiting | MISSING | Security audit | Edge/WAF not in-app | Not implemented (5) |
| File / logo / attachment storage | PARTIAL | Storage policies + APIs | Logo solid; attachments partial | Local+Supabase storage |
| Background jobs / queues | MISSING | — | No worker framework in app | Not implemented |
| RO data import apply | BLOCKED | Migration import | Preview only | Dry-run (3) |
| Supabase Auth providers (OAuth etc.) | DOCUMENTATION ONLY / unknown | — | Email/password path is what code uses | — |

---

## Inventory & financial integrity (code evidence)

| Guarantee | Verdict | Evidence |
| --- | --- | --- |
| Stock ↑ only after successful receiving post | **PARTIAL / UNVERIFIED on MAIN** | App drafts + calls `crm_post_goods_receipt`; client never writes `warehouse_stock` directly (`apiWarehouseOps`). RPC presence on MAIN **unverified**. |
| Stock ↓ only after issue/write-off post | **PARTIAL / UNVERIFIED on MAIN** | Write-off via `crm_post_write_off`; order issue prefers `issue_order_materials_from_warehouse`, falls back to global `issue_order_materials` on `MissingRpcError` (toast warning). |
| Transfers preserve total stock | **PARTIAL / UNVERIFIED on MAIN** | Depends on `crm_post_stock_transfer` semantics in prepared SQL. |
| Returns restore stock | **PARTIAL** | Prefers `return_order_materials_to_warehouse`; global fallback if RPC missing. |
| Concurrent qty safety | **UNVERIFIED** | Relies on server RPC transactions; not re-proven in this audit. |
| Payments reflected in finance | **PARTIAL** | Payments ledger COMPLETE; optional `account_id` does **not** write `finance_transactions` → cash account balances may not move. |
| Refunds / transfers | **PARTIAL** | Refunds append to `payments`; cash transfers UI exists when tables present; void **BLOCKED**. |
| Client advances ≠ customer debt | **PARTIAL** | Settlement logic improved but still interacts with `orders.is_paid` / ledger mismatch risk. |

**Do not mark warehouse/finance workflows COMPLETE for multi-warehouse integrity until owner confirms cutover RPCs on MAIN and cash-ledger linkage is wired.**

---

## Backend / SQL static review

### Prepared but not claimed applied (owner cutover)

See `supabase/manual/MIGRATION_CUTOVER.md`. Critical RPCs for app features:

| Script | Why app needs it | Class |
| --- | --- | --- |
| `crm_ro_v1.PRODUCTION.sql` | RO tables (stock ops, statuses, public_links, activity, etc.) | C |
| `…010000_crm_permitted_workspaces_deleted_at` | Soft-delete WS security | C |
| `…030000_warehouse_ops_rpcs` | Post receipt/transfer/write-off | C |
| `…040000_order_events_rpc` | Event writes | C |
| `…070000_order_line_discounts_rpc` | Material discounts | C |
| `…080000` / `…100000` | Issue/return from warehouse | C |
| `…090000` / `…110000` | Public status + link mint | C |
| Seeds 2.2–2.5 | Roles, statuses, locations, message templates | C |
| Vehicles / expenses / warehouse baseline | Prerequisites for crm_ro_v1 / finance | C |

### App ↔ schema risk patterns (code-confirmed)

- **MissingRpc / MissingTable** handlers: warehouse issue/return, warehouse ops post, public links, discounts — app fails closed or falls back with warnings (not silent corruption for discounts).
- **SELECT-only** client paths for `warehouse_stock` and event inserts (correct).
- **Legacy permission mode** when RO permission tables absent — intentional.
- Live RLS / column presence on MAIN: **unverified** in this audit (except password recovery Auth flow, owner-tested).

### Destructive / conflict notes

- Cutover scripts are designed transactional/idempotent where documented; vehicle backfill ships `ROLLBACK` until owner commits.
- Do not run CLI `db push` against whatever `.temp` links — CLI may name TEST; app uses MAIN.

---

## Counts (this inventory)

Feature rows in sections A–H (primary statuses only; dual labels use the stricter primary):

| Status | Count | Δ vs prior audit (110 rows) |
| --- | --- | --- |
| COMPLETE | 40 | +1 (password recovery) |
| PARTIAL | 50 | — |
| MISSING | 6 | — |
| PLACEHOLDER | 8 | −1 |
| DOCUMENTATION ONLY | 1 | — |
| BLOCKED | 5 | — |
| **Total audited** | **110** | — |

### Changelog vs prior audit

| Item | Was | Now | Evidence |
| --- | --- | --- | --- |
| Password recovery | PLACEHOLDER | **COMPLETE** | Real Auth APIs + localized reset route + security marker; **owner real-world email test succeeded** |
| Warehouse / finance integrity section | (absent) | Added | Explicit UNVERIFIED/PARTIAL matrix |
| P0.4 roadmap task | Open | Closed | See `core-app-development-roadmap.md` |

Historical notes retained: warehouses/categories read-only; estimates header-only; payment void blocked; messaging dry-run; import apply blocked.

---

## Audit integrity

- Source inspected: `src/App.tsx` routes, auth recovery modules, feature modules, `src/services/*`, settings, migration/import, message dispatch, public links, warehouse/orders finance paths.
- Docs cross-checked: implementation matrix, §1 checklist, security audit, cutover.
- Password recovery: source + **owner-confirmed production email flow**.
- Other MAIN schema/RLS claims remain **unverified** remotely.
- This documentation refresh only; **no** application source, SQL, env, remote DB, deploy, commit, or push.
