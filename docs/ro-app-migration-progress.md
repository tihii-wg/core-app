# RO → Core migration progress

Last updated: 2026-11-01 (final local acceptance review).

Canonical honesty matrix: `docs/ro-app-migration-implementation-matrix.md`.  
SQL order: `supabase/manual/MIGRATION_CUTOVER.md`.  
Security notes: `docs/ro-app-security-audit.md`.  
§1 order scenario: `docs/ro-app-section-1-order-checklist.md`.  
Supabase project roles: `docs/supabase-projects.md`.

## Supabase project roles (permanent)

| Role | Project ID | Notes |
| --- | --- | --- |
| **MAIN / ACTIVE** | `pundggjzzaqzbvykbxvo` | **Only** project for current fast development. App `.env` target. |
| **TEST (inactive)** | `hnfvrlgcnpykncixxqha` | Preserve. Do not connect or run SQL until the owner starts the testing phase. |

CLI `supabase/.temp` may still name TEST — **not** the app runtime; leave inactive. Never apply remote SQL without explicit authorization. See `.cursor/rules/dev-environment.mdc`.

## Restrictions observed

- No remote SQL, deploy, commit, or push.
- App `.env` (MAIN PRODUCTION) ≠ CLI-linked project (FUTURE TEST) — documented, not “fixed” by relinking.
- No real SMS/email sends (dry-run only).
- RO App never written to; import Apply disabled.

## Local verification (this pass)

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.app.json` | Pass |
| `vite build` | Pass |
| Focused suite (orders API+UI, discounts, warehouse issue/return, public links, totals, permissions) | **138 passed** |
| Full vitest (earlier this session) | 64 failed / 1328 passed — almost all under `src/tests/integration/*`; many were UX-drift (vehicle picker, draft save label, client-name opens client panel) now fixed in `app.orders` / `api.orders`; remaining full-suite failures need a fresh full run and are largely **pre-existing / harness-load** outside this focused set |
| Live RLS / remote schema | **Not verified** |

## What landed in the acceptance pass

### Warehouse returns (P3 follow-up)
- SQL: `20261101100000_return_order_materials_warehouse.PRODUCTION.sql`
- API: `returnOrderMaterialsToWarehouse` + MissingRpc fallback
- UI: warehouse picker on return; global-only warning
- Tests: `apiWarehouse.toWarehouseReturn.test.ts`

### Public links (security)
- SQL: `20261101110000_public_order_link_create.PRODUCTION.sql` (mint RPC + revoke SELECT(token))
- API: `createPublicOrderLink` / `publicOrderStatusUrl`
- UI: Order actions → Copy public status link
- Timestamps unique through `20261101110000`

### Orders API invariants restored
- createOrder requires client + ≥1 service
- updateOrder rejects empty services before writes
- Integration tests updated for vehicle picker, Save draft order, order-number panel open

### Docs
- Security audit, progress, matrix, cutover (2.1j / 2.1k), §1 checklist

## SQL prepared this migration (not executed)

See cutover Phase 2 steps **2.1a–2.1k** plus seeds. Key new files this pass: `…100000_return_…`, `…110000_public_order_link_create…`.

## Honest stage status

| Stage | Status |
|---|---|
| 0 | Partial — audit + race fix; live acceptances need owner DB |
| 1–2 | Stronger partial — discounts persisted; §1 checklist documented |
| 3 | Stronger partial — ops + **issue/return from warehouse** code+SQL ready |
| 4–6 | Stronger partial — prior finance/reports/docs work |
| 5 | Public status page + **link mint** local; no providers / rate limit |
| 7–8 | Import dry-run preview; apply still owner |
| 9 | Functional CRUD lists |

## Owner actions

1. Current phase: develop on MAIN only; leave TEST inactive. Apply remote cutover SQL only when explicitly authorized (include 2.1j / 2.1k).
2. Vehicle backfill preview → commit only after review.
3. Assign RO roles; enable providers only after dry-run/consent review.
4. Ask for git commit when ready.
5. Start TEST workflow only when the owner explicitly opens the testing phase.
