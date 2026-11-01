# RO App → Core App: SQL cutover order (manual)

Ordered list of the files in `supabase/manual/` for the cutover. **Nothing here is applied automatically.**
The owner runs each file by hand in the Supabase SQL Editor.

Canonical project roles (do not delete either project):  
→ full detail: [`docs/supabase-projects.md`](../../docs/supabase-projects.md)

| Role | Supabase project ref | Use |
| --- | --- | --- |
| **MAIN / ACTIVE** | `pundggjzzaqzbvykbxvo` | **Current development backend.** Local app `.env` points here. Authoritative Production release target. |
| **TEST (inactive)** | `hnfvrlgcnpykncixxqha` (`core-app-test`) | **Preserve. Do not use** during the fast-development phase. Future testing only when the owner explicitly authorizes it. |

**Current phase:** prepare SQL locally against the MAIN project story; **do not** execute remote SQL (MAIN or TEST) without explicit owner authorization. Do not connect to TEST or switch the CLI for “cleanup.”

**Future cutover rehearsal (owner-authorized only):** TEST first, then MAIN — only after the owner confirms the Project ID in the Dashboard and starts the testing phase.

### Critical safety (CLI vs app)

- Local Vite `.env` → MAIN (`pundggjzzaqzbvykbxvo`).
- Supabase CLI cache (`supabase/.temp/project-ref`) currently links to TEST (`hnfvrlgcnpykncixxqha`). That link is **not** the app runtime — leave it; do not use it for development commands.
- **Never** execute a script because “the CLI is linked to X.” Read the script header + Dashboard Project ID.
- MAIN and TEST credentials / env vars must never be mixed.
- Each `*.PRODUCTION.sql` (and companion) header must state its intended target; prefer naming the Project ID explicitly before any paste.

Rules that apply to every step:

- Confirm the project ref in the Dashboard URL **before** pasting anything.
- Back up first (MAIN PRODUCTION: point-in-time backup or `pg_dump`; FUTURE TEST: restore a fresh Production copy when rehearsing).
- Run each file **as one complete file**; stop on the first error (all scripts are transactional).
- Do not skip a step's VERIFY/PREFLIGHT companion where one exists.
- RO App import **apply** scripts do not exist yet. Settings → migration offers a **dry-run CSV/JSON preview** only (no writes). RO App is never written to; no SMS/email is sent by any script here.
- Settings → "RO App migration" shows read-only row counts for the active workspace; use it before and after each phase.

## Phase 0 — Read-only checks (safe anywhere)

| # | File | Purpose |
| --- | --- | --- |
| 0.1 | Fresh `information_schema` dump of the target DB | Stage 0 report is still open: confirm `vehicles`, `payments`, `invoice_items`, `inventory_movements`, `order_materials`, `orders.vehicle_id` exist and `id` columns are `uuid`. `crm_ro_v1` aborts if not. |
| 0.2 | `20261018210000_issue_return_rpc_repair.DIAGNOSTICS.sql` | Returns one JSON row: which warehouse objects/RPCs already exist. Decides which of steps 1.2–1.5 are needed. |
| 0.3 | `20261019220000_general_settings.PREFLIGHT.sql` | Must show no BLOCKER rows before step 1.6. |

Migration files without a manual copy (`supabase/migrations/20260929…` baseline through `20261005010000_industries_anon_read.sql`, invoices `20261004*`, `20261018220000_inventory_min_quantity_default.sql`) are assumed already applied; confirm in 0.1.

## Phase 1 — Existing Core App scripts (apply only what is missing)

Each of these may already be applied on a given database. Use phase 0 results; several are **not re-runnable**.

| # | File | Needed when | Re-runnable |
| --- | --- | --- | --- |
| 1.1 | `20261005020000_expenses.PRODUCTION.sql` | `public.expenses` is missing (Finance shows the "apply expenses" banner) | No |
| 1.2 | `20261018170000_order_materials_stock.PRODUCTION.sql` | `public.order_materials` is missing | No |
| 1.3 | `20261018180000_warehouse_issue_return.PRODUCTION.sql` | warehouse ledger / issue-return objects are missing (requires 1.2 first) | No |
| 1.4 | `20261018210000_issue_return_rpc_repair.sql`, then `…repair.VERIFY.sql` | Only the RPCs `issue_order_materials` / `return_order_materials` are missing while `inventory_movements` exists | Yes (functions only) |
| 1.5 | `sync_order_materials_repair.sql` | Only `sync_order_materials` is missing | Yes |
| 1.6 | `20261019220000_general_settings.PRODUCTION.sql`, then `…general_settings.VERIFY.sql` | `legal_entities` / general-settings columns missing. Apply **before** deploying an app build that writes them. Run PREFLIGHT (0.3) first. | See file header |

| 1.7 | `20261101000000_vehicles.PRODUCTION.sql` | Phase 0.1 shows `public.vehicles` or `orders.vehicle_id` missing (the repo has no other DDL for them). Must run **before** 2.1 — `crm_ro_v1` aborts without `vehicles`. | Yes (no-op if both exist; RLS/grants only added when it creates the table; FK is `NOT VALID`) |

Warning: the headers of 1.2 and 1.3 say "MAIN PRODUCTION ref only — do NOT run against core-app-test (FUTURE TEST)". For a FUTURE TEST rehearsal, first check with 0.2 whether that project already has these objects. If it does not, the owner must consciously decide how to prepare FUTURE TEST (for example restore a MAIN PRODUCTION copy, which already contains them). These files were not edited.

## Phase 2 — RO schema (`crm_ro_v1`)

Prerequisites: phase 1 done, so that `order_materials`, `inventory_movements`, `invoice_items`, `vehicles`, `payments` exist (the script checks and aborts with a readable error otherwise).

| # | File | Notes |
| --- | --- | --- |
| 2.0 | `20261031000000_orders_custom_status.PRODUCTION.sql` | **Optional bridge.** Only if you want `orders.custom_status_id` and the simple order fields *before* the full RO schema. Idempotent; creates `status_definitions` tagged so that 2.1 still passes. Skip it if you apply 2.1 right away. |
| 2.1 | `crm_ro_v1.PRODUCTION.sql` | Creates ~111 tables with RLS (incl. `activity_log`, `migration_batches`, `migration_id_map`, `raw_ro_records`) and adds columns to 13 existing tables. Idempotent, one transaction. **TEST first**, run the regression from section 8 of `docs/ro-app-migration.md`, then PROD on the owner's command. |
| 2.1a | `20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql` | **Security patch, run right after 2.1.** Replaces only `crm_permitted_workspaces(text)` so a soft-deleted workspace (`workspaces.deleted_at`) grants no RLS access to the `crm_ro_v1` tables. Idempotent; aborts if 2.1 is not applied. |
| 2.1b | `20261101020000_message_log_dry_run_insert.PRODUCTION.sql` | Optional. Allows Settings → Notification rules → "Log dry-run" to insert `message_log` rows with `provider = dry_run` / `status = skipped`. Without it the button reports no permission (crm_ro_v1 insert = `-`). |
| 2.1c | `20261101030000_warehouse_ops_rpcs.PRODUCTION.sql` | **Warehouse operations (Inventory → Operations).** Run after 2.1 (aborts if `warehouse_stock`, `goods_receipts`, `stock_transfers`, `write_offs` or `crm_has_permission` are missing). `warehouse_stock` / `stock_batches` are read-only for the browser, so posting goes through new SECURITY DEFINER RPCs `crm_post_goods_receipt`, `crm_post_stock_transfer`, `crm_post_write_off` (execute granted to `authenticated`). Also adds `posted_at` to `stock_transfers` / `write_offs` and guard triggers that stop the browser from flipping status/`posted_at` or editing lines of a posted document. Idempotent, one transaction. Without it the Operations section still lists/creates drafts, but Post buttons show "run the SQL file". |
| 2.1d | `20261101040000_order_events_rpc.PRODUCTION.sql` | **Order feed (Orders → order panel → History).** Run after 2.1 (aborts if `order_events`, `orders.custom_status_id` or `crm_has_permission` are missing). `order_events` is write-protected for the browser (insert `-`), so the app records status moves through the new SECURITY DEFINER RPC `crm_record_order_event` (needs `orders.edit`, actor taken from the JWT, execute granted to `authenticated`). Also adds an optional AFTER UPDATE trigger on `orders` (status / `custom_status_id`) so changes from other writers are logged too; a 10-second duplicate guard lets the RPC and the trigger coexist. Drop the trigger with `drop trigger crm_orders_status_event on public.orders;` if unwanted. Idempotent, one transaction. Without it the History section shows existing rows only and the app silently skips writing events. Comments (`order_comments`) need no extra SQL. |
| 2.1e | `20261101050000_order_line_kind.PRODUCTION.sql` | Optional, additive. Adds nullable `order_services.kind` (`labor` \| `service`) only when missing. **crm_ro_v1 already creates this column, so after 2.1 this file is a no-op.** The app probes the column and shows the line-type selector only when it exists; reads/writes retry without it otherwise. |
| 2.1f | `20261101060000_orders_discount_header.PRODUCTION.sql` | Optional, additive. Adds nullable `orders.discount_type` (`percent` \| `amount`) and `orders.discount_value numeric(16,5)` only when missing (crm_ro_v1 defines them only for estimates/invoices, not `orders`). `orders.discount_total` and the line-level `order_services` / `order_materials` `discount_type` / `discount_value` come from **crm_ro_v1**, not from this file. The app persists client discounts into `order_services` / `order_materials` lines, `orders.discount_total` and `orders.total_price` (= subtotal − discount) and probes every column, retrying without the missing ones; the header columns are written only for a single uniform percent. Run after 2.1. Note: the live `sync_order_materials` RPC rewrites `total_price` as the gross sum — the app re-writes the net total right after each call. |
| 2.1g | `20261101070000_order_line_discounts_rpc.PRODUCTION.sql` | **Client product discounts on order materials.** Run after 2.1 (needs the `discount_type` / `discount_value` columns from crm_ro_v1; it installs without them but raises when called). `order_materials` is SELECT-only for the browser, so the app writes material line discounts through the new SECURITY DEFINER RPC `crm_set_order_line_discounts(p_order_id, p_lines jsonb)`. It updates the `order_materials` / `order_services` discount columns that exist, then recalculates `orders.total_price` (gross − discounts over services + materials), `orders.discount_total` and the uniform header percent in the same transaction. Caller must be a workspace member with role owner/admin/manager **or** `orders.edit` (via `crm_has_permission`, i.e. an assigned CRM role; a plain member without a role gets "no permission"). Execute granted to `authenticated`. Idempotent (`create or replace`), one transaction. **Without it, saving an order for a client with a `product_order` discount that has materials fails with a clear "apply this SQL file" error** (create rolls the new order back; update restores the net total of the persisted lines) instead of saving totals that differ from the form preview. |
| 2.1h | `20261101080000_issue_order_materials_warehouse.PRODUCTION.sql` | **Issue materials from a selected warehouse (Orders → order panel → Issue Materials).** Run after 2.1 and after step 1.4 (the 3-arg issue RPC prerequisites). Adds a NEW function `issue_order_materials_from_warehouse(p_order_id, p_lines, p_warehouse_id, p_idempotency_key)`; the existing 3-arg `issue_order_materials` is untouched (still used only when no warehouse is selected). Same permission (owner/admin/manager) and idempotency rules as the 3-arg RPC; additionally validates that the warehouse is active and in the order's workspace, decreases `inventory_items.quantity` **and** `warehouse_stock` of that warehouse (row locks, never negative; no stock row = empty), and records `inventory_movements.warehouse_id` when the column exists. Raises a clear error if `warehouse_stock` is missing. **The app does not fall back to global issue when a warehouse is selected** — without this SQL the UI surfaces `issueFromWarehouseRpcMissing`. Idempotent, one transaction. |
| 2.1i | `20261101090000_public_order_status_rpc.PRODUCTION.sql` | **Public order status page** (`/:locale/public/:token`). Run after 2.1 (needs `public_links`). SECURITY DEFINER RPC `crm_public_order_status(p_token)` returns only whitelisted status fields for a valid non-revoked non-expired order link; missing/invalid tokens are indistinguishable (`NULL`). EXECUTE granted to `anon` and `authenticated`. No writes. Idempotent, one transaction. |
| 2.1j | `20261101100000_return_order_materials_warehouse.PRODUCTION.sql` | **Return materials to a selected warehouse.** Run after 2.1 and 1.4. NEW function `return_order_materials_to_warehouse(...)`; existing `return_order_materials` untouched (global-only when no warehouse selected). Restores `inventory_items.quantity` and `warehouse_stock` (upsert; concurrent-safe). **The app does not fall back to global return when a warehouse is selected.** Idempotent, one transaction. |
| 2.1j-verify | `20261101200000_warehouse_order_stock_integration.VERIFY.sql` | **Read-only.** Confirms warehouse tables, issue/return/ops RPCs, grants, and `inventory_items.quantity = SUM(warehouse_stock.quantity)` mismatches. Safe to re-run; does not change data. |
| 2.1l | `20261101210000_warehouse_batch_fifo_consumption.PRODUCTION.sql` | **FIFO `stock_batches` consumption.** Helpers `crm_consume_batches_fifo` / `crm_restore_or_create_batch`; replaces `crm_post_stock_transfer` / `crm_post_write_off` to consume/recreate batches. After this file, **re-apply 2.1h then 2.1j** so order issue/return call the helpers. See `WAREHOUSE_MODULE_APPLY.md`. |
| 2.1l-verify | `20261101210000_warehouse_batch_fifo_consumption.VERIFY.sql` | **Read-only.** Helper grants + batch vs `warehouse_stock` drift + negative `quantity_left`. |
| 2.1k | `20261101110000_public_order_link_create.PRODUCTION.sql` | **Mint public order links.** Run after 2.1 (and ideally 2.1i). SECURITY DEFINER RPC `crm_create_public_order_link(p_order_id, p_expires_at)` returns `{ id, token, … }` once to callers with `orders.edit` (or owner/admin/manager). Also **revokes SELECT(token)** on `public_links` from `anon`/`authenticated` so table reads cannot leak capability URLs. Idempotent, one transaction. |
| 2.2 | `crm_ro_v1_seed_roles.PRODUCTION.sql` | Engineer / Manager-Receptionist / Full access roles per workspace. Does not assign roles to employees. Show Appendix B.1 to the owner before assigning. |
| 2.3 | `crm_ro_v1_seed_statuses.PRODUCTION.sql` | Initial statuses and transitions. Skips an entity that already has statuses. |
| 2.4 | `crm_ro_v1_seed_locations.PRODUCTION.sql` | One default location per non-deleted workspace that has none (named after the workspace, or `Main`). Never touches workspaces that already have a location. Idempotent. |
| 2.5 | `crm_ro_v1_seed_message_templates.PRODUCTION.sql` | Appendix D.2 message templates (10 external + 2 internal `in_app` copies = 12 rows) per non-deleted workspace. Idempotent by workspace + name + channel (the `in_app` copies share a name with the external ones, so the channel is part of the key). Never edits or deletes existing templates. Channel assignment (e.g. «Для менеджера» → `telegram`, «Изменен статус» → `sms`) is documented in the file header — confirm it with the owner. Does **not** create `notification_rules` and sends nothing. Ends with a read-only VERIFY select (expected: 0 rows). |

After 2.1–2.3 the Settings tabs (Statuses, Locations, Warehouses, Roles, Taxes, Print templates) and Reports → Activity log stop showing "not applied". After 2.5 Settings → Notifications lists the seeded message templates.

## Phase 3 — Data fix (review, then decide)

| # | File | Notes |
| --- | --- | --- |
| 3.1 | `20261031010000_vehicle_id_backfill.PRODUCTION.sql` | Ships ending in `ROLLBACK`: it only reports how many orders would be linked to a vehicle. Review the counts; to apply, replace the final `rollback;` with `commit;`. Needs `orders.vehicle_id` and `vehicles` to exist (step 1.7 creates them if missing). Never overwrites an existing `vehicle_id`. |

## Phase 4 — Not yet available

These do not exist yet and are intentionally not in the list:

- RO App import **apply** RPCs/scripts (idempotent writes into `migration_id_map` / `raw_ro_records`). Browser preview mapping exists; Apply stays disabled.
- Real SMS / email / Telegram providers and the switch that enables them. Today Settings → Notification rules → "Log dry-run" only writes a `message_log` row (`status = skipped`, `provider = dry_run`); nothing is sent. Apply step 2.1b so the dry-run insert is allowed.
- Seeds for warehouses, cash accounts, taxes, payment methods, notification rules and print templates (locations are covered by 2.4, message templates by 2.5).
- Rate limiting for public status tokens (edge/WAF). Link minting is covered by step 2.1k.

## Cutover run order (summary)

**Do not run this remotely during the fast-development phase** unless the owner explicitly authorizes SQL apply / the testing phase. Prepare scripts locally; verify Project ID in the Dashboard before every paste (never trust CLI link alone).

When the owner authorizes remote apply:

1. **TEST** (`hnfvrlgcnpykncixxqha`) — only if testing phase is authorized: back up/restore → Phase 0 → Phase 1 (missing only, incl. 1.7) → Phase 2 (2.1 → 2.1a → 2.1c → 2.1f (optional) → 2.1g → 2.1h → 2.1i → 2.1j → 2.1k → 2.2 → 2.3 → 2.4 → 2.5) → Phase 3 review → regression → counts in Settings.
2. Owner approval of the TEST result.
3. **MAIN** (`pundggjzzaqzbvykbxvo`): back up → Phase 0 → Phase 1 (missing only, incl. 1.7) → Phase 2 (2.1 → 2.1a → 2.1c → 2.1f (optional) → 2.1g → 2.1h → 2.1i → 2.1j → 2.1k → 2.2 → 2.3 → 2.4 → 2.5) → Phase 3 (only after reviewing the counts) → counts in Settings.
4. Deploy the app build after the SQL it depends on (general settings columns first, per 1.6) — only with explicit deploy authorization.
