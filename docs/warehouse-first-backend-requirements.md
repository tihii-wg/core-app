# Warehouse-first inventory — backend SQL requirements (manual review)

**Status:** Frontend is wired. Do **not** claim production-ready until these SQL items are applied and verified on MAIN (`pundggjzzaqzbvykbxvo`).

**Do not modify:** `sync_order_materials`.

---

## 1. Atomic RPC: create/update order material + immediate warehouse issue

| | |
|---|---|
| **Why** | Inserting `order_materials` then calling `issue_order_materials_from_warehouse` is two requests and not atomic. |
| **Affects** | New functions; reuses warehouse stock / movements / FIFO logic from `issue_order_materials_from_warehouse`. |
| **File** | `supabase/manual/20261103220000_add_and_issue_order_catalog_material.PRODUCTION.sql` |
| **Blocks production?** | **Yes** — catalog add-to-order fails with MissingRpcError / stub until production bodies exist. |
| **Type** | Manual SQL function create (replace stub bodies). |

Frontend RPCs:

- `add_and_issue_order_catalog_material`
- `set_order_catalog_material_quantity_with_issue`

Optional follow-up: batch multi-line wrapper for true multi-line atomic create (frontend currently compensates with best-effort returns on create failure).

---

## 2. Active warehouse prerequisite for material catalog creation

| | |
|---|---|
| **Why** | Frontend gates create; authenticated clients can still INSERT `inventory_items` without a warehouse. |
| **Affects** | `inventory_items` insert policies / trigger. |
| **Blocks production?** | Soft — UI enforces; backend hardens bypass. |
| **Type** | Manual policy/trigger. |

---

## 3. Revoke authenticated EXECUTE on legacy global issue/return

| | |
|---|---|
| **Why** | Frontend no longer calls them; authenticated users could still bypass warehouse accounting. |
| **Affects** | `issue_order_materials`, `return_order_materials` grants. |
| **Blocks production?** | Soft until cutover verified; then **yes** for security. |
| **Type** | Manual `REVOKE` after frontend verification. **Do not revoke in this task.** |

---

## 4. Goods receipt movement ledger

| | |
|---|---|
| **Why** | `crm_post_goods_receipt` updates `warehouse_stock` + `inventory_items.quantity` + batches but does not insert `inventory_movements`. |
| **Affects** | `crm_post_goods_receipt`. |
| **Blocks production?** | Soft for balances; **yes** for complete audit ledger. |
| **Type** | Function replacement (same transaction as post). |

---

## 5. Transfer source + destination movements

| | |
|---|---|
| **Why** | Transfer currently records an incomplete ledger (source-side adjustment only). |
| **Affects** | `crm_post_stock_transfer`. |
| **Blocks production?** | Soft for balances; **yes** for complete audit. |
| **Type** | Function replacement. |

---

## 6. Write-off movement recording

| | |
|---|---|
| **Why** | Confirm write-off movements use correct warehouse/document refs and do not silently round quantities. |
| **Affects** | `crm_post_write_off`, `inventory_movements`. |
| **Blocks production?** | Depends on live function review. |
| **Type** | Function review/replacement. |

---

## 7. Issue movement batch references

| | |
|---|---|
| **Why** | Warehouse issue may not store consumed `batch_id` on the movement; returns cannot restore provenance. |
| **Affects** | `issue_order_materials_from_warehouse`, new atomic RPCs, `return_order_materials_to_warehouse`. |
| **Blocks production?** | Soft for qty; **yes** for cost/expiry provenance. |
| **Type** | Function replacement. |

---

## 8. Return batch restoration

| | |
|---|---|
| **Why** | Without batch on issue movement, returns recreate stock at zero cost. |
| **Affects** | `return_order_materials_to_warehouse` / `stock_batches`. |
| **Blocks production?** | Soft for qty; **yes** for costing. |
| **Type** | Depends on #7. |

---

## 9. Numeric `inventory_movements.quantity`

| | |
|---|---|
| **Why** | Document/stock quantities are numeric; movements are integer — fractional units cannot be ledgered without rounding. |
| **Affects** | `inventory_movements.quantity` column type. |
| **Blocks production?** | Only if fractional units are required in production. |
| **Type** | Migration (alter column) — manual review. |

---

## 10. Negative stock / concurrent over-issuance

| | |
|---|---|
| **Why** | Frontend checks are not enough; row locks + atomic updates required. |
| **Affects** | All issue/receipt/transfer/write-off RPCs. |
| **Blocks production?** | **Yes** if any path can go negative under concurrency. |
| **Type** | Ensure existing RPC lock order + checks; extend into new atomic RPCs. |

---

## Frontend RPC map (current)

| Operation | RPC |
|-----------|-----|
| Goods receipt post | `crm_post_goods_receipt` |
| Transfer post | `crm_post_stock_transfer` |
| Write-off post | `crm_post_write_off` |
| Immediate catalog add + issue | `add_and_issue_order_catalog_material` (**needs SQL**) |
| Catalog qty increase + issue | `set_order_catalog_material_quantity_with_issue` (**needs SQL**) |
| Extra issue (order detail) | `issue_order_materials_from_warehouse` |
| Return | `return_order_materials_to_warehouse` |
| Freeform / request sync | `sync_order_materials` (**unchanged**) |

Legacy (frontend must not call): `issue_order_materials`, `return_order_materials`.
