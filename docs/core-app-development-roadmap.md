# Core App — Development roadmap (post–P0.4 refresh)

**Date:** 2026-11-01 (refreshed)  
**Goal:** Fast, integrity-first feature completion on Core App against **MAIN** only (`pundggjzzaqzbvykbxvo`).  
**TEST** (`hnfvrlgcnpykncixxqha`) stays inactive until explicitly authorized.  
**Basis:** `docs/core-app-feature-audit.md`.

Principles:

1. Prefer finishing wired PARTIAL features that protect **stock and money** over new surface area.
2. Owner SQL cutover unlocks many PARTIAL→COMPLETE transitions without UI rewrites.
3. Do **not** enable real SMS/email/Telegram/WhatsApp until providers + consent + rate limits are chosen.
4. Do **not** enable Import Apply without sandbox RPC + TEST authorization.
5. No TEST project work, env flips, or deploys unless requested.

---

## Closed / completed

| # | Feature | Outcome |
| --- | --- | --- |
| **P0.4** | Password recovery | **COMPLETE** — real Auth flow + localized reset route + security marker; **owner real-world verified** (email → reset → login with new password). Do not reopen. |

---

## Next 3–5 concrete development tasks (recommended order)

### 1. P0.1 — Soft-deleted workspace RLS (security)

| | |
| --- | --- |
| **Priority** | P0 |
| **Status** | PARTIAL (SQL prepared; MAIN apply **UNVERIFIED**) |
| **Business value** | Prevents access to soft-deleted workspaces — multi-tenant safety. |
| **Implement** | Owner apply `…010000_crm_permitted_workspaces_deleted_at`; smoke membership for deleted WS. |
| **Files** | SQL 2.1a; workspace membership queries |
| **Deps** | Owner MAIN access |
| **Class** | **C** (database) |
| **Acceptance** | Deleted workspace not reachable via permitted-workspaces helper; members cannot select it. |
| **Risks** | Mis-apply could lock legitimate members — follow cutover notes. |

### 2. P0.2 — Confirm MAIN schema / cutover inventory (ops)

| | |
| --- | --- |
| **Priority** | P0 |
| **Status** | Process gap |
| **Business value** | Stops “ghost COMPLETE” claims; unblocks all warehouse/CRM PARTIAL features. |
| **Implement** | Inventory which cutover scripts are already on MAIN; list gaps vs `MIGRATION_CUTOVER.md`. |
| **Files** | Cutover guide; matrix |
| **Class** | **C** (ops / SQL apply as needed) — not an app coding task |
| **Acceptance** | Written checklist: applied vs missing for 2.1* RPCs + `crm_ro_v1` + seeds. |
| **Risks** | Applying wrong script order; use transactional scripts only with owner approval. |

### 3. P0.3 + P1.1 — Warehouse stock integrity (receipt/transfer/write-off + order issue/return)

| | |
| --- | --- |
| **Priority** | P0 / P1 |
| **Status** | PARTIAL |
| **Business value** | Daily shop ops: stock must move only through successful posts; orders must deplete the correct warehouse. |
| **Implement** | Ensure `crm_post_*` + `issue_order_materials_from_warehouse` / `return_order_materials_to_warehouse` on MAIN; remove reliance on silent global fallback for warehouse-scoped flows (or fail closed with clear UX). |
| **Files** | `apiWarehouseOps.ts`, `apiWarehouse.ts`, `OrderWarehouseActions.tsx`, WarehouseOps UI, SQL 2.1c/h/j |
| **Deps** | P0.2, `crm_ro_v1`, warehouses |
| **Class** | **B+C** (SQL required for happy path; app already wired) |
| **Acceptance** | Receipt increases stock only after post; issue decreases chosen warehouse; return restores it; MissingRpc does not pretend warehouse-scoped success. |
| **Risks** | Concurrent ops; fallback to global issue can diverge `warehouse_stock` vs `inventory_items.quantity`. |

### 4. P1.9 — Payments → cash accounts / finance_transactions

| | |
| --- | --- |
| **Priority** | P1 |
| **Status** | PARTIAL |
| **Business value** | Cash drawer balances must match payment history. |
| **Implement** | On payment create/refund (and transfer), write/link `finance_transactions` so account balances move; confirm tables on MAIN. |
| **Files** | `apiPayments.ts`, `apiFinanceAccounts.ts`, Finance UI |
| **Deps** | `finance_accounts` / `finance_transactions` (crm_ro_v1 or equivalent) |
| **Class** | **B+C** (may need column/RPC if missing) |
| **Acceptance** | Payment with account updates running balance; transfer moves between accounts; reports/balances reconcile. |
| **Risks** | Double-posting if both client and trigger write; void remains BLOCKED. |

### 5. P1.3 — Public order links (mint + status)

| | |
| --- | --- |
| **Priority** | P1 |
| **Status** | PARTIAL (runtime blocked without RPC) |
| **Business value** | Clients check order status without accounts. |
| **Implement** | Apply 2.1i + 2.1k; smoke mint + anon status page. |
| **Files** | `apiPublicLinks.ts`, `PublicOrderPage.tsx`, OrderActionsMenu |
| **Deps** | P0.2 |
| **Class** | **B+C** |
| **Acceptance** | Copy link works; public page shows whitelisted fields; missing RPC surfaces unavailable (not crash). |
| **Risks** | Token leakage; rate limiting still MISSING (P3 infra). |

**While waiting for owner SQL (app-only options, lower than stock/money):**

| Task | Notes | Class |
| --- | --- | --- |
| P1.12 Client settlement vs payments ledger | Prefer ledger over `orders.is_paid` where possible | **A** (mostly) |
| P2.9 ComingModules honesty | Remove stale “planned” badges | **A** |
| P1.11 Lead/estimate → order | Only if CRM tables already on MAIN | **A/B** |

---

## Full priority backlog (updated)

### P0 — Critical

| # | Feature | Status | Class | Notes |
| --- | --- | --- | --- | --- |
| P0.1 | Soft-deleted workspace RLS | PARTIAL | C | Next security SQL |
| P0.2 | MAIN schema inventory | Process | C | Prerequisite |
| P0.3 | Warehouse stock post RPCs | PARTIAL | C | Integrity |
| ~~P0.4~~ | ~~Password recovery~~ | **COMPLETE** | — | Closed |
| P0.5 | Subscription write gates | Ongoing | A | Continuous |

### P1 — Essential business

| # | Feature | Status | Class | SQL? |
| --- | --- | --- | --- | --- |
| P1.1 | Order issue/return from warehouse | PARTIAL | B+C | Yes (2.1h/j) |
| P1.2 | Material line discounts RPC | PARTIAL | B+C | Yes (2.1g) |
| P1.3 | Public order links | PARTIAL | B+C | Yes (2.1i/k) |
| P1.4 | Order events write RPC | PARTIAL | B+C | Yes (2.1d) |
| P1.5–P1.8 | Roles / statuses / locations / message seeds | PARTIAL | C | Seeds 2.2–2.5 |
| P1.9 | Finance accounts + payment linkage | PARTIAL | B+C | Maybe |
| P1.10 | Expenses table on MAIN | PARTIAL | C | If missing |
| P1.11 | Lead / estimate → order | MISSING | A/B | Maybe |
| P1.12 | Client mutual settlement depth | PARTIAL | A/B | Maybe |

### P2 — Medium

Categories tree, stock history UI, invoice line polish, VAT persist, reports export depth, activity writers, vehicles warranty, attachments, ComingModules sync, notification rules editor.

### P3 — Deferred / blocked

| # | Feature | Notes |
| --- | --- | --- |
| P3.1 | Real SMS/email/Telegram/WhatsApp | **D** + policy; dry-run only today |
| P3.2 | Import Apply | **BLOCKED** until sandbox RPC + TEST |
| P3.3 | Online payment providers | **D** |
| P3.4 | Full RO report designer | Large |
| P3.5 | Sales/calls/messages modules | Optional |
| P3.6 | Order types / custom forms | Docs-heavy |
| P3.7 | Public link rate limiting | Infra |
| P3.8 | MFA project confirmation | Ops |
| P3.9 | TEST project cutover | Explicit auth only |
| — | Payment void | **BLOCKED** (`PAYMENT_VOID_SCHEMA_SUPPORTED = false`) |

---

## Sequence diagram

```
P0.4 password recovery ✅ DONE
P0.1 soft-delete RLS (SQL)
   └─► P0.2 MAIN schema inventory / apply missing cutover
          ├─► P0.3 + P1.1 warehouse integrity     ─┐
          ├─► P1.9 payments ↔ cash accounts         │ parallel after P0.2
          ├─► P1.3 public links                     │
          ├─► P1.2 / P1.4 discounts + events        │
          └─► P1.5–P1.8 seeds                       ─┘
App-only parallel (lower priority): P1.12 settlement, P2.9 ComingModules
P3.* gated / deferred
```

---

## Definition: feature completion

1. UI + service path used in routes/menus.  
2. Required tables/RPCs exist on **MAIN** (owner-confirmed) when the happy path needs them.  
3. Workspace isolation and role/subscription guards on writes.  
4. No silent MissingRpc success for warehouse-scoped stock.  
5. EN/RO/RU for user-facing strings.

---

## Immediate recommendation

1. **Owner:** P0.1 + P0.2 (SQL/ops).  
2. **Dev after schema known:** **P0.3 + P1.1 warehouse stock integrity** (highest daily business risk).  
3. **Then:** P1.9 cash-ledger linkage, then P1.3 public links.

Do not reopen P0.4. Do not start messaging providers or Import Apply without explicit authorization.
