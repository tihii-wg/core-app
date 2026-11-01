# Workspace permissions & API security audit (local)

Updated: 2026-11-01 (acceptance pass). Scope: code + prepared SQL only. **No remote RLS regression** was run (no remote SQL).

**Supabase projects** (see `docs/supabase-projects.md`, `.cursor/rules/dev-environment.mdc`): MAIN/ACTIVE `pundggjzzaqzbvykbxvo` (app `.env`, current development only); TEST `hnfvrlgcnpykncixxqha` (preserve, inactive until owner authorizes testing). No remote SQL without explicit authorization; never mix MAIN/TEST credentials.

## Model

| Layer | Behaviour |
|---|---|
| Soft-deleted workspaces | `crm_permitted_workspaces` must exclude `workspaces.deleted_at IS NOT NULL` (`20261101010000_…`). App membership lists also filter `deleted_at`. |
| Role resolution | Owner → `*`. Admin without `member_roles` → `*`. Otherwise only `role_permissions` of the assigned role (`permissions.ts` mirrors SQL). |
| Legacy mode | When RO permission tables are absent, UI falls back to existing `canManageWorkspace` / write guards (`hasPermission(…, legacyFallback)`). |
| Write-protected tables | Browser must not UPDATE/INSERT: `warehouse_stock`, `order_events` (write `-`), material discount columns on SELECT-only `order_materials`. Writes go through SECURITY DEFINER RPCs. |

## RPC write paths (required SQL)

| Concern | RPC / file | App behaviour if missing |
|---|---|---|
| Soft-delete workspace RLS | `20261101010000_crm_permitted_workspaces_deleted_at` | Soft-deleted WS may still pass old helper |
| Warehouse post ops | `crm_post_goods_receipt` / `transfer` / `write_off` (`20261101030000_…`) | Draft create only; Post shows apply-SQL message |
| Order events | `crm_record_order_event` (`20261101040000_…`) | Feed read-only; write skipped |
| Material + header discounts | `crm_set_order_line_discounts` (`20261101070000_order_line_discounts_rpc`) | Create/update with product discount **fails loudly** (no silent total mismatch) |
| Issue from warehouse | `issue_order_materials_from_warehouse` (`20261101080000_…`) | Falls back to global `issue_order_materials` + warning |
| Return to warehouse | `return_order_materials_to_warehouse` (`20261101100000_…`) | Falls back to global `return_order_materials` + warning |
| Public order status | `crm_public_order_status` (`20261101090000_…`) | Page shows “not available” |
| Public link mint | `crm_create_public_order_link` (`20261101110000_…`) | Copy-link action shows apply-SQL message; **SELECT(token) revoked** from anon/authenticated |
| Message dry-run | `20261101020000_message_log_dry_run_insert` | Button reports no permission |

## App-side checks (verified in code)

- `apiWarehouseStock`: **SELECT only** — no client writes to `warehouse_stock`.
- `apiOrderEvents`: SELECT for list; INSERT only via `crm_record_order_event` RPC.
- `apiOrders` material discounts: prefer RPC; direct UPDATE is a last resort and throws if RLS returns 0 rows / permission denied.
- `OrderWarehouseActions`: warehouse picker for **issue and return**; stock pre-check on issue; MissingRpc fallback + warning.
- Public route `/:locale/public/:token`: no auth; whitelisted status fields only; `noindex`; token never enumerated.
- Public link create: token returned **once** from SECURITY DEFINER RPC; OrderActionsMenu copies URL; no table SELECT of tokens after 2.1k.
- CSV exports: formula-prefix escape in `csvExport`; activity CSV gated by `reports.activity_log`.
- Import preview: browser-only dry run; Apply disabled; validation/error reporting in-card.
- Notifications: dry-run logger only — no real SMS/email providers.
- createOrder / updateOrder: restore client + at least one service required at API layer.

## UI permission gates (present)

| Gate | Key / fallback |
|---|---|
| Settings → Roles assign | `settings.roles` / manage |
| Statuses create | `settings.statuses` / manage |
| Activity log tab + CSV | `reports.activity_log` / manage |
| Warehouse ops create/post | `inventory.*.create|edit` / manage |

## Residual risks / gaps (honest)

1. **Remote apply pending** — RPCs unapplied on live projects until owner runs cutover.
2. **Public status rate limiting** is not in the RPC; needs edge/WAF if widely exposed.
3. **Plain members without a CRM role** get empty permission lists once RO tables exist (by design).
4. **Import apply** deliberately disabled (no sandbox write RPC).
5. **Column revoke SELECT(token)** (2.1k) must be applied with the create RPC; without it, members can still SELECT tokens via PostgREST if table grants allow.

## Recommended owner verification (FUTURE TEST first)

1. Apply 2.1 → 2.1a → 2.1c → 2.1g → 2.1h → 2.1i → 2.1j → 2.1k per `MIGRATION_CUTOVER.md`.
2. Soft-delete a workspace; confirm member JWT cannot read its RO tables.
3. Assign Engineer role; confirm warehouse Post / roles UI blocked; owner still allowed.
4. Client with `product_order` discount + materials: save order; confirm `discount_total` matches form.
5. Issue then return materials with warehouse selected; confirm `warehouse_stock` moves for that warehouse only.
6. Copy public link → open as anon → only status fields; confirm `select token from public_links` fails for authenticated.
