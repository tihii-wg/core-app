import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106120000_cancel_order_with_payment_void.PRODUCTION.sql"),
  "utf8",
);

describe("cancel_order_with_payment_void SQL", () => {
  it("wraps cancel_order and voids payments in one function", () => {
    expect(sql).toMatch(/create or replace function public\.crm_cancel_order_with_payment_void/);
    expect(sql).toMatch(/v_cancel := public\.cancel_order\(p_order_id, p_workspace_id\)/);
    expect(sql).toMatch(/'void'/);
    expect(sql).toMatch(/related_payment_id/);
  });

  it("skips refunded payments and gates voiding by owner or orders.edit", () => {
    expect(sql).toMatch(/'has_refund'/);
    expect(sql).toMatch(/crm_has_permission\(p_workspace_id, 'orders.edit'\)/);
    expect(sql).toMatch(/order_payment_void:forbidden/);
  });

  it("never deletes payments or changes existing RPCs", () => {
    expect(sql).not.toMatch(/delete from public\.payments/i);
    expect(sql).not.toMatch(/create or replace function public\.cancel_order\(/);
    expect(sql).not.toMatch(/create or replace function public\.delete_order_with_payments/);
    expect(sql).toMatch(/revoke all on function public\.crm_cancel_order_with_payment_void/);
  });
});
