# Core App — Current state (read-only audit)

**Audit date:** 2026-11-01  
**Method:** Source-code + local documentation inspection only. **No** remote DB access, SQL apply, deploy, or tests.  
**Environment rules:** `.cursor/rules/dev-environment.mdc`

## Development environment

| Item | Value |
| --- | --- |
| Active backend | **MAIN** `pundggjzzaqzbvykbxvo` (root `.env` → `VITE_SUPABASE_URL`) |
| TEST project | `hnfvrlgcnpykncixxqha` — **preserve, inactive** (do not connect / SQL / CLI switch until owner authorizes testing) |
| Phase | Fast feature development on MAIN only |
| Remote SQL / deploy / commit | Forbidden unless explicitly authorized |

## What is already implemented (local code)

Core App is a working multi-tenant Vite/React/Supabase CRM with:

- Auth (login, register, forgot password, session, MFA settings UI), workspaces, team roles, subscription write gating.
- Dashboard, sidebar nav, global search, EN/RO/RU i18n, theme.
- Full CRUD-style modules: **Orders** (list/board/calendar, create/edit, vehicles, materials issue/return UI, discounts, comments/events UI, print templates hook-up), **Clients** (extras, discounts, settlement), **Services**, **Employees**, **Inventory** (items + ops UI), **Invoices**, **Finance** (expenses, payments, accounts/transfer UI), **Reports** (KPIs, charts, CSV, activity log gate).
- Settings tabs: company/regional, profile, security/MFA, team, statuses, locations, warehouses, roles, print templates, taxes, notifications (dry-run), migration preview, modules.
- Stage-9 modules with real list/CRUD wiring: leads, estimates, tasks, bookings (routed; not full RO parity).
- Public order status route + link-mint UI (needs SQL RPCs on DB).
- Large set of **prepared** manual SQL under `supabase/manual/` (crm_ro_v1 + RPC patches) — **not verified as applied** on MAIN.

## Audit snapshot (capability rows)

| Status | Count |
| --- | --- |
| COMPLETE | 39 |
| PARTIAL | 50 |
| MISSING | 6 |
| PLACEHOLDER | 9 |
| DOCUMENTATION ONLY | 1 |
| BLOCKED | 5 |
| **Total** | **110** |

Detail: `docs/core-app-feature-audit.md`. Roadmap: `docs/core-app-development-roadmap.md`.  
Reconciled with deep passes: [Audit CRM and orders features](c6b501e3-383a-4cab-8b26-a4ab0bd02f11), [Audit inventory finance reports](6952a190-e6f2-4e7a-8b27-be4c0957e78f).

## What remains

1. **Password recovery is a PLACEHOLDER** (`ForgotPasswordPage` simulates send; `FogotPasword` only logs) — wire real Supabase reset before treating auth complete.
2. **Owner-authorized SQL cutover** on MAIN (see `supabase/manual/MIGRATION_CUTOVER.md`) so warehouse/discount/public/events RPCs and RO tables exist remotely.
3. **RO business parity gaps:** warranty/serial UX, auto SMS on status, full form editor, sales/messages/calls, import **apply**, real message providers, payment providers/void, public rate limiting.
4. **Stage-9 / CRM depth:** leads/estimates lack edit/lines/convert; bookings thin; estimate_lines unused in app.
5. **Live verification** of RLS and schema (explicitly out of scope until testing phase).

**Highest-priority next (app-only):** real password recovery (`P0.4`).  
**Highest-priority next (after cutover SQL):** order material issue/return RPCs (`P1.1`).

## Critical known limitations

- App code **degrades** when RPCs/tables are missing (`MissingRpcError`, dry-run, Apply disabled) — do not treat UI presence as live DB readiness.
- Notifications: **dry-run only** (`apiMessageDispatch`); invoice “email” opens `mailto:` after PDF download.
- Import: browser preview only; **Apply intentionally blocked**.
- CLI `.temp` may still name TEST — ignore for app runtime; do not use during this phase.
- Nothing requiring live RO schema is claimed “remotely verified.”

## Related docs

- Full inventory: `docs/core-app-feature-audit.md`
- Roadmap: `docs/core-app-development-roadmap.md`
- Migration matrix: `docs/ro-app-migration-implementation-matrix.md`
- Cutover SQL order: `supabase/manual/MIGRATION_CUTOVER.md`
- Project roles: `docs/supabase-projects.md`
