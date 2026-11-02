# Warehouse module — manual SQL apply order

Apply **by hand** in the Supabase SQL Editor (MAIN only when the owner authorizes).
Do **not** auto-apply from the app or CI. Do **not** run against TEST unless the owner starts that phase.

**Legend**

| Tag | Meaning |
|-----|---------|
| **APPLY** | Mutates schema and/or data. One transaction unless noted. |
| **VERIFY** | Read-only. Never mutates. |
| **Idempotent** | Safe to re-run when prerequisites still hold. |
| **Do not re-run blindly** | Re-running may replace functions or is unnecessary after success. |

Do **not** re-apply `crm_ro_v1.PRODUCTION.sql` if foundation objects already exist with comment `crm_ro_v1`. Re-running it aborts when foreign-owned tables are detected.

---

## Prerequisites (must already exist, or apply once)

| # | File | Type | Purpose |
|---|------|------|---------|
| **0** | `crm_ro_v1.PRODUCTION.sql` | APPLY | Foundation: `locations`, roles, permission helpers, warehouse tables/RLS if not yet present. **Apply only if CRM RO foundation is not already installed.** |
| **0a** | `20261101010000_crm_permitted_workspaces_deleted_at.PRODUCTION.sql` | APPLY · Idempotent | Soft-deleted workspaces stop granting CRM RLS. Run after helpers exist. **Not** embedded in warehouse bootstrap. |
| **0b** | `crm_ro_v1_seed_locations.PRODUCTION.sql` | APPLY · Idempotent | One default location per non-deleted workspace that has **no** non-deleted location. Requires verified `locations_one_default_idx`. Aborts if any workspace remains without a location. |

**Success for 0b:** notice `locations inserted: N` and `workspaces_still_without_location = 0` (otherwise transaction rolled back).

---

## Warehouse create / manage bootstrap

| # | File | Type | Purpose |
|---|------|------|---------|
| **1** | `20261101230000_warehouse_management_bootstrap.PRODUCTION.sql` | APPLY · Idempotent for missing objects | Creates **only missing** warehouse-module tables; validates existing shapes/FKs/indexes; additive movement columns; warehouse RLS ensure; stock write denial; `settings.warehouses` seed from `settings.locations`. **Never** replaces `crm_permitted_workspaces` / `crm_has_permission`. **Never** touches locations/roles RLS. Aborts on ownership or incompatible existing objects. |
| **1a** | `20261101230000_warehouse_management_bootstrap.VERIFY.sql` | VERIFY | Strict readiness. Require `readiness = 'READY'` and **0 failed check rows**. Review `ok_filters_deleted_workspaces` separately. |

Do **not** invent warehouse rows. Create them from the Warehouses UI after VERIFY is READY.

**If step 1 aborts:** read the exception text (exact object/conflict). Fix prerequisite or resolve ownership conflict. Do not force-apply.

---

## Stock ops + order integration (after READY)

| # | File | Type | Purpose |
|---|------|------|---------|
| **2** | `20261018210000_issue_return_rpc_repair.sql` | APPLY · Idempotent | Global `issue_order_materials` / `return_order_materials` |
| **2a** | `20261018210000_issue_return_rpc_repair.VERIFY.sql` | VERIFY | Optional global RPC checks |
| **3** | `20261101030000_warehouse_ops_rpcs.PRODUCTION.sql` | APPLY · Idempotent | `crm_post_goods_receipt` / `crm_post_stock_transfer` / `crm_post_write_off` |
| **4** | `20261101080000_issue_order_materials_warehouse.PRODUCTION.sql` | APPLY · Idempotent (`create or replace`) | `issue_order_materials_from_warehouse` |
| **5** | `20261101100000_return_order_materials_warehouse.PRODUCTION.sql` | APPLY · Idempotent | `return_order_materials_to_warehouse` |
| **6** | `20261101210000_warehouse_batch_fifo_consumption.PRODUCTION.sql` | APPLY · Idempotent | FIFO helpers + batch-aware transfer/write-off |
| **7** | Re-apply **#4 then #5** | APPLY | **Technically required once after #6** so issue/return pick up `crm_consume_batches_fifo` / `crm_restore_or_create_batch`. Further re-runs are harmless. |
| **8** | `20261101200000_warehouse_order_stock_integration.VERIFY.sql` | VERIFY | Ops / invariant checks |
| **9** | `20261101210000_warehouse_batch_fifo_consumption.VERIFY.sql` | VERIFY | Batch FIFO checks |

---

## What APPLY scripts change vs do not change

| Changes | Does not change |
|---------|-----------------|
| Missing warehouse tables (crm_ro_v1 shape) | Existing business rows (orders, stock qty, clients) |
| Missing additive columns (`posted_at`, movement `warehouse_id`/`batch_id`, …) | Permission helper bodies (never replaced by bootstrap) |
| Missing `crm_*` warehouse policies / grants | Foundation locations/roles RLS, policies, triggers |
| Stock tables: revoke browser writes | Unrelated policies (never dropped) |
| `settings.warehouses` permission rows copied from `settings.locations` | Automatic warehouse rows; automatic stock reconciliation |

---

## VERIFY success (bootstrap)

1. Query 1 returns **zero rows** (no failed checks).
2. Query 3 returns `readiness = 'READY'`, `total_checks = 57`, `failed_checks = 0`.
3. Query 2 `ok_filters_deleted_workspaces` should be `true` after step **0a** (security; not part of READY gate).

---

## Notes

- When a warehouse **is** selected in the UI, the app calls **only** warehouse issue/return RPCs (no silent global fallback).
- Global issue/return remain for flows with **no** warehouse selected.
- Browser must not INSERT/UPDATE/DELETE `warehouse_stock` / `stock_batches` / `stock_serials`; stock mutates via SECURITY DEFINER RPCs only.
