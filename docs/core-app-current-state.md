# Core App — Current state (post–P0.4 refresh)

**Audit date:** 2026-11-01 (refreshed after password recovery completion)  
**Method:** Source-code + local documentation inspection; password recovery also **owner-verified** via real email.  
**No** remote DB SQL apply, deploy, or app code changes in this documentation pass.  
**Environment rules:** `.cursor/rules/dev-environment.mdc`

## Development environment

| Item | Value |
| --- | --- |
| Active backend | **MAIN** `pundggjzzaqzbvykbxvo` (root `.env` → `VITE_SUPABASE_URL`) |
| TEST project | `hnfvrlgcnpykncixxqha` — **preserve, inactive** (do not connect / SQL / CLI switch until owner authorizes testing) |
| Phase | Fast feature development on MAIN only |
| Remote SQL / deploy / commit | Forbidden unless explicitly authorized |

## What is already implemented

Core App is a working multi-tenant Vite/React/Supabase CRM with:

- **Auth:** login, register, **password recovery (COMPLETE — real-world verified)**, session handling, MFA settings UI, workspaces, team roles, subscription write gating.
- Dashboard, sidebar nav, global search, EN/RO/RU i18n, theme.
- Strong CRUD modules: **Orders** (list/board/calendar, create/edit, vehicles, materials issue/return UI, discounts, comments/events UI, print), **Clients**, **Services**, **Employees**, **Inventory** (items + ops UI), **Invoices**, **Finance** (expenses, payments, accounts/transfer UI), **Reports** (KPIs, charts, CSV).
- Settings: company/regional, profile, security/MFA, team, statuses, locations, warehouses (read-only), roles, print templates, taxes, notifications (dry-run), migration preview, modules.
- Stage-9 CRM: leads, estimates, tasks, bookings (thin CRUD; not full RO parity).
- Public order status + link-mint UI (needs SQL RPCs on DB — **UNVERIFIED** whether applied on MAIN).
- Prepared manual SQL under `supabase/manual/` — **not claimed applied** on MAIN in this audit.

### P0.4 Password recovery — COMPLETE

Verified scenario (owner):

1. Request reset → recovery email received.  
2. Link opens localized reset page.  
3. New password saved.  
4. Old password fails; login with new password succeeds.

Implementation highlights: `resetPasswordForEmail` with `/{locale}/reset-password` `redirectTo`; callback bootstrap if Site URL fallback; user-bound recovery marker; global sign-out after success.

## Audit snapshot (capability rows)

| Status | Count |
| --- | --- |
| COMPLETE | 40 |
| PARTIAL | 50 |
| MISSING | 6 |
| PLACEHOLDER | 8 |
| DOCUMENTATION ONLY | 1 |
| BLOCKED | 5 |
| **Total** | **110** |

Detail: `docs/core-app-feature-audit.md`. Roadmap: `docs/core-app-development-roadmap.md`.

## What remains (highest leverage)

1. **Owner SQL cutover / MAIN schema inventory** — unlock warehouse post RPCs, issue/return-from-warehouse, public links, events, discounts, soft-delete RLS (`supabase/manual/MIGRATION_CUTOVER.md`).
2. **Inventory integrity** — multi-warehouse stock must not rely on global issue fallback; post RPCs required for receipt/transfer/write-off.
3. **Finance integrity** — payments ↔ cash accounts (`finance_transactions`); payment void blocked; settlement still partly `is_paid`-coupled.
4. **CRM depth** — estimate lines, lead/estimate→order, booking edit/calendar.
5. **Integrations** — messaging dry-run only; invoice email = mailto; import apply blocked.

## Critical known limitations

- App **degrades** when RPCs/tables missing (`MissingRpcError`, dry-run, Apply disabled).
- Warehouse/finance multi-ledger guarantees on MAIN are **UNVERIFIED** until cutover confirmed.
- Notifications: dry-run only; invoice email: mailto.
- Import: preview only.
- CLI `.temp` may name TEST — ignore for app runtime.
- Soft-deleted workspace RLS helper SQL prepared; remote apply **unverified**.

## Related docs

- Full inventory: `docs/core-app-feature-audit.md`
- Roadmap: `docs/core-app-development-roadmap.md`
- Migration matrix: `docs/ro-app-migration-implementation-matrix.md`
- Cutover SQL order: `supabase/manual/MIGRATION_CUTOVER.md`
- Project roles: `docs/supabase-projects.md`
