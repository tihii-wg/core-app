# Warehouse module — manual SQL apply order

Apply these scripts **by hand** in the Supabase SQL Editor (MAIN only when the owner authorizes).  
Do **not** auto-apply from the app or CI. Do **not** run against TEST unless the owner starts that phase.

## Order

| # | File | Purpose |
|---|------|---------|
| 1 | `crm_ro_v1.PRODUCTION.sql` | Warehouses, `warehouse_stock`, `stock_batches`, movements `warehouse_id`/`batch_id`, RLS |
| 2 | `20261018210000_issue_return_rpc_repair.sql` | Global `issue_order_materials` / `return_order_materials` |
| 3 | `20261101030000_warehouse_ops_rpcs.PRODUCTION.sql` | `crm_post_goods_receipt` / `crm_post_stock_transfer` / `crm_post_write_off` |
| 4 | `20261101080000_issue_order_materials_warehouse.PRODUCTION.sql` | `issue_order_materials_from_warehouse` (+ optional FIFO call) |
| 5 | `20261101100000_return_order_materials_warehouse.PRODUCTION.sql` | `return_order_materials_to_warehouse` (+ optional restore call) |
| 6 | `20261101210000_warehouse_batch_fifo_consumption.PRODUCTION.sql` | FIFO helpers + batch-aware transfer/write-off |
| 7 | **Re-apply #4 then #5** | Ensures issue/return pick up `crm_consume_batches_fifo` / `crm_restore_or_create_batch` |
| 8 | `20261101200000_warehouse_order_stock_integration.VERIFY.sql` | Read-only checks (after apply) |
| 9 | `20261101210000_warehouse_batch_fifo_consumption.VERIFY.sql` | Read-only batch checks |

## Notes

- Steps 4 and 5 are safe to re-run (`create or replace`). After step 6, re-running 4→5 wires batch consume/restore into order issue/return.
- Global issue/return (step 2) stay available when **no** warehouse is selected in the UI.
- When a warehouse **is** selected, the app calls **only** the warehouse RPCs (no silent global fallback).
- No script auto-reconciles legacy `inventory_items.quantity` vs `warehouse_stock`.
