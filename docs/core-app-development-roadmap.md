# Core App — Development roadmap (post-audit)

**Date:** 2026-11-01  
**Goal:** Fast feature completion on Core App against **MAIN** Supabase only (`pundggjzzaqzbvykbxvo`).  
**TEST** (`hnfvrlgcnpykncixxqha`) stays inactive until explicitly authorized.  
**Basis:** `docs/core-app-feature-audit.md` (source + docs inspection; no remote verification).

Principles:

1. Prefer finishing wired PARTIAL features over new architecture.
2. Owner SQL cutover unlocks many PARTIAL→COMPLETE transitions without large UI rewrites.
3. Do **not** turn on real SMS/email/Telegram until providers + consent + rate limits are chosen.
4. Do **not** enable Import Apply without a sandbox RPC + TEST authorization.
5. No TEST project work, env flips, or deploys unless requested.

---

## P0 — Critical

| # | Feature | Implement | Why | Files / modules | Deps | Scope | SQL? | Order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0.1 | Soft-deleted workspace RLS | Owner apply `crm_permitted_workspaces` fix; smoke membership | Security: deleted WS must not remain accessible | SQL 2.1a; membership queries | Owner MAIN access | Small (SQL + smoke) | Yes | **1st** |
| P0.2 | Confirm MAIN schema baseline | Inventory which cutover scripts already applied; fill gaps | Prevents app “ghost” features and wrong COMPLETE claims | Cutover guide; matrix | Owner | Medium (ops) | Yes (apply missing) | **2nd** |
| P0.3 | Warehouse stock post RPCs | Ensure `crm_post_*` present; fix any MissingRpc paths | Ops UI otherwise cannot post stock safely | `apiWarehouseOps`, SQL 2.1c | crm_ro_v1 | Medium | Yes | After P0.2 |
| P0.4 | Password recovery (real) | Wire `ForgotPasswordPage` → `supabase.auth.resetPasswordForEmail`; remove stub | Auth UX is currently a fake success path | `ForgotPasswordPage.tsx`, `apiAuth.FogotPasword` | Auth email templates on project | Small | No (Auth config) | **Parallel with P0.1** |
| P0.5 | Subscription write gates regression | Keep guards on every new mutate path | Billing/abuse control already designed | `useGuardSubscriptionWrite` | — | Ongoing | No | Continuous |

**Sequence:** P0.1 → P0.2 → P0.3. P0.4 can run in parallel (app-only). P0.5 continuous.

---

## P1 — High (essential business)

| # | Feature | Implement | Why | Modules | Deps | Scope | SQL? | Independent? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1.1 | Order issue/return from warehouse | Apply 2.1h/2.1j; remove reliance on global fallback | Correct stock + order linkage | `apiWarehouse`, OrderWarehouseActions | P0.2, warehouses | Medium | Yes | After P0 |
| P1.2 | Material line discounts RPC | Apply 2.1g; exercise UI path | Parity with service discounts | `apiOrders`, orderTotals | 2.1f optional | Small–med | Yes | After P0.2 |
| P1.3 | Public order links | Apply 2.1i + 2.1k; mint + status page E2E on MAIN | Client self-serve status | `apiPublicLinks`, PublicOrderPage | Token SELECT revoke | Medium | Yes | After P0.2 |
| P1.4 | Order events write RPC | Apply 2.1d; board/status writers | Audit trail integrity | `apiOrderEvents`, feed | — | Small | Yes | Independent after P0.2 |
| P1.5 | Roles seed + gates | Apply 2.2; verify Settings → Roles | Access control for CRM modules | RolesSettings, permissions | crm_ro_v1 | Medium | Yes | After P0.2 |
| P1.6 | Custom statuses seed | Apply 2.3; board transitions | Kanban/custom status happy path | StatusesSettings, board | Status tables | Small | Yes | Independent after P0.2 |
| P1.7 | Locations seed | Apply 2.4 | Warehouse ops locations | LocationsSettings | Warehouses | Small | Yes | Independent |
| P1.8 | Message template seed | Apply 2.5 (templates only) | Dry-run notify needs templates | NotificationRulesSettings | Rules table | Small | Yes | Independent |
| P1.9 | Finance accounts on MAIN | Confirm tables/columns; payment account_id | Cash register / transfers | FinanceAccounts*, apiFinanceAccounts | Schema | Medium | Maybe | Parallel with P1.1 |
| P1.10 | Expenses table on MAIN | Ensure expenses SQL applied | Finance expenses already in UI | Finance, expenses SQL | — | Small | Yes if missing | Parallel |
| P1.11 | Lead / estimate → order | Conversion actions + status | Close CRM funnel gap | Leads, Estimates, apiOrders | CRM tables | Medium–large | Maybe | After CRM tables confirmed |
| P1.12 | Client mutual settlement depth | Align with RO settlement semantics | Money accuracy | clientSettlement* | Payments | Medium | Maybe | Parallel |

**Recommended app-side next after owner SQL batch:** **P1.1 + P1.3** (warehouse issue/return + public links) — highest user-visible unlock for already-built UI.

---

## P2 — Medium

| # | Feature | Implement | Why | Modules | SQL? |
| --- | --- | --- | --- | --- | --- |
| P2.1 | Categories full tree UX | Match RO category management | Inventory | CategoriesPanel | Maybe |
| P2.2 | Stock movement history UI | Ops history browser | Warehouse | WarehouseOps / inventory | No/light |
| P2.3 | Invoice works/materials separation polish | Clearer invoice lines | Invoices | Maybe |
| P2.4 | VAT fiscal packaging | Beyond display helpers | Taxes / invoices | Maybe |
| P2.5 | Reports export depth | Broader CSV/print packs | Reports, csvExport | No |
| P2.6 | Activity log writers completeness | Cover more mutations | apiActivityLog callers | No |
| P2.7 | Vehicles serial/warranty on lines | §1 vehicle depth | Orders, vehicles | Maybe |
| P2.8 | Attachments UX completeness | Upload/list/delete polish | Order attachments | Storage |
| P2.9 | ComingModules copy sync | Remove “planned” where CRUD exists | ComingModulesSettings | No |
| P2.10 | Notification rules editor depth | CRUD rules beyond list/dry-run | Notifications settings | Maybe |

---

## P3 — Low / deferred

| # | Feature | Notes |
| --- | --- | --- |
| P3.1 | Real SMS/email/Telegram/WhatsApp | **Blocked** until provider + consent + rate limit design |
| P3.2 | Import Apply | **Blocked** until sandbox RPC + TEST authorization |
| P3.3 | Online payment providers | Explicitly out of scope until chosen |
| P3.4 | Full RO report designer | Large; keep Core charts/CSV |
| P3.5 | Sales/calls/messages modules | Matrix stage 9 optional |
| P3.6 | Order types / custom forms (В.2–В.3) | Docs-heavy; defer |
| P3.7 | Public link Edge rate limiting | Infra (WAF/Edge), not app-only |
| P3.8 | MFA project-level confirmation | Ops checklist |
| P3.9 | TEST project cutover & CI | Only when explicitly authorized |

---

## Parallel vs sequential

```
P0.1 soft-delete RLS
   └─► P0.2 MAIN schema inventory / apply missing cutover
          ├─► P1.1 issue/return (2.1h/j)     ─┐
          ├─► P1.2 discounts (2.1g)            │ can parallel after P0.2
          ├─► P1.3 public links (2.1i/k)      │
          ├─► P1.4 events (2.1d)               │
          ├─► P1.5–P1.8 seeds (2.2–2.5)      ─┘
          ├─► P1.9–P1.10 finance schema
          └─► P1.11–P1.12 CRM conversion / settlement (app work)
P2.* polish (parallel)
P3.* gated / deferred
```

Independent after schema known: seeds (2.2–2.5), events RPC, public links (vs warehouse), finance accounts (vs warehouse).

Must sequence: soft-delete RLS before trusting multi-tenant QA; warehouse stock RPCs before claiming warehouse COMPLETE; providers before real notify; TEST auth before Import Apply.

---

## Definition: “feature completion” for a module

A feature may be marked COMPLETE in product sense only when:

1. UI + service path exists and is used in routes/menus.  
2. Required tables/RPCs exist on **MAIN** (owner-confirmed).  
3. Workspace isolation and role/subscription guards hold for writes.  
4. No silent MissingRpc fallback that mis-states success.  
5. i18n covers EN/RO/RU for user-facing strings.

This roadmap does **not** start testing/deployment phases; those remain separate instructions.

---

## Suggested immediate next feature (app)

**If owner SQL is not yet available:** implement **P0.4 password recovery** (real Supabase reset) — small, unblocks a critical PLACEHOLDER, no schema cutover required.

**After cutover SQL for warehouse issue/return or public links:** harden **order material issue/return against warehouse RPCs** (P1.1) — UI already exists; largest operational gap for shops using inventory + orders together.

Also queue: payment void stays **BLOCKED** until schema decision (`propose_payment_void.sql` is do-not-apply); do not treat dialog as shippable.
