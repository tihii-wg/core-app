# RO → Core verified implementation matrix

Updated 2026-11-01 after discounts / warehouse-issue / import-preview / security-audit pass.  
Scale: **1** full+verified (incl. live DB) · **2** implemented, not fully verified remotely · **3** partial · **4** UI without backend · **5** SQL prepared, not applied · **6** not implemented · **7** blocked (schema/remote/external).

Remote SQL apply and live RLS regression remain **out of scope** until the owner runs cutover.

## Stage 0

| Requirement | Class | Notes |
|---|---|---|
| Audit report | **1** | `ro-app-migration-stage-0-report.md` |
| Expenses / vehicles DDL | **5** | Manual SQL ready |
| vehicle_id race fix | **2** | Code+tests; live Lexus unverified |
| vehicle_id backfill | **5** | ROLLBACK preview script |
| clients.balance = advance | **2** | UI coloring fixed; settlement advance semantics |

## Stage 1 — Foundation

| Requirement | Class | Notes |
|---|---|---|
| Appendix A + seeds | **5** | `crm_ro_v1*` + cutover guide |
| Theme switch + theme-color + badge | **2** | Implemented |
| Status/location CRUD | **3** | Create/default/delete; no full RO editor |
| Roles assign + permissions | **2** | `member_roles` UI + `useMyPermissions` gates; audit in `ro-app-security-audit.md` |
| Transitions enforced | **2** | Board assert + tests |
| activity_log writes | **2** | Status/board; degrade if missing |
| Order types / directories | **5/6** | SQL mostly; app thin |

## Stage 2 — Orders & clients

| Requirement | Class | Notes |
|---|---|---|
| Board DnD | **2** | Transitions + activity + events RPC wire |
| Calendar | **2** | Month/week; localStorage view |
| Order comments + events | **2** | UI+API; events need RPC SQL |
| Phones/addresses CRUD | **2** | Client extras |
| Discounts | **2** | Client upsert + **persisted** line/header totals; materials via `crm_set_order_line_discounts` (SQL 2.1g) |
| Line kinds | **3** | Selector when column present |
| Full §1 RO order scenario | **3** | Checklist: `ro-app-section-1-order-checklist.md` |

## Stage 3 — Catalog & warehouse

| Requirement | Class | Notes |
|---|---|---|
| Categories / warehouses read | **3** | Read panels |
| Receipts / transfers / write-offs | **2** | UI create+post; **needs RPC SQL 2.1c** |
| warehouse_stock updates | **5→2 code** | Only via RPC; unapplied remotely |
| Issue from chosen warehouse | **2** | UI+API+SQL 2.1h |
| Return to chosen warehouse | **2** | UI+API+SQL 2.1j; MissingRpc → global return + warning |

## Stage 4 — Finance

| Requirement | Class | Notes |
|---|---|---|
| Finance accounts + transfer | **2** | UI+API; needs tables |
| Payment account_id | **2** | Optional column + retry |
| Taxes settings | **2** | CRUD |
| VAT display | **2** | Helper tested; invoice detail line |
| Full RO invoice extras | **3/6** | Baseline invoices + VAT tip |

## Stage 5 — Documents & notifications

| Requirement | Class | Notes |
|---|---|---|
| Template preview/edit/print | **3** | body_html editor; variable subset |
| Message template seed | **5** | `crm_ro_v1_seed_message_templates` |
| Dry-run + consent counts | **2** | No real send |
| Public order status page | **2** | Route + RPC SQL 2.1i |
| Public link mint (copy URL) | **2** | Order menu + RPC SQL 2.1k; SELECT(token) revoked |
| Providers / QR widget | **6/7** | Not built / owner |

## Stage 6 — Settings & reports

| Requirement | Class | Notes |
|---|---|---|
| Activity log + CSV | **2** | Read+export; permission gate |
| Orders summary CSV | **2** | Reports page |
| Form editor / full RO reports | **6** | Not built |

## Stages 7–8 — Migration

| Requirement | Class | Notes |
|---|---|---|
| Checklist + counts | **3** | Settings tab |
| RO import preview | **2** | Dry-run CSV/JSON mapping + validation; Apply disabled |
| RO import apply scripts | **6** | Explicitly absent |
| Cutover guide | **2** | Markdown only (incl. 2.1g–2.1i) |
| Security audit notes | **2** | `ro-app-security-audit.md` (local) |

## Stage 9 — Other modules

| Requirement | Class | Notes |
|---|---|---|
| Leads/Estimates/Tasks/Bookings | **3** | Routed CRUD (not full RO feature set) |
| Sales/messages/calls/checklists | **5/6** | SQL / absent |

## Honest stage labels

| Stage | Label |
|---|---|
| 0 | Partial |
| 1–2 | Stronger partial (not acceptance-complete) |
| 3–5 | Stronger partial — code ready, SQL/RPC unapplied |
| 6 | Partial |
| 7–8 | Preview + prep (apply still owner) |
| 9 | Partial functional stubs→CRUD |

**Nothing is class 1 for features that require applied RO schema on a live project.**
