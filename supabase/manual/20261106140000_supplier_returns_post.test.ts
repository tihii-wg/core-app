import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106140000_supplier_returns_post.PRODUCTION.sql"),
  "utf8",
);

describe("supplier_returns_post SQL", () => {
  it("adds posting columns and a posted-line guard", () => {
    expect(sql).toMatch(/add column if not exists posted_at timestamptz/);
    expect(sql).toMatch(/add column if not exists supplier_name text/);
    expect(sql).toMatch(/create trigger crm_guard_posted_supplier_return_lines/);
  });

  it("posts with permission check, receipt-bound limits and batch consumption", () => {
    expect(sql).toMatch(/create or replace function public\.crm_post_supplier_return\(p_return_id uuid\)/);
    expect(sql).toMatch(/inventory\.supplier_returns\.create/);
    expect(sql).toMatch(/b\.goods_receipt_id = v_ret\.goods_receipt_id/);
    expect(sql).toMatch(/crm_consume_batches_fifo/);
    expect(sql).toMatch(/goods receipt is not posted/);
  });

  it("moves stock down and writes a ledger movement", () => {
    expect(sql).toMatch(/update public\.warehouse_stock\s+set quantity = quantity - v_line\.quantity/);
    expect(sql).toMatch(/update public\.inventory_items\s+set quantity = quantity - v_line\.quantity/);
    expect(sql).toMatch(/'supplier_return', v_ret\.id/);
  });

  it("does not touch finance or orders", () => {
    expect(sql).not.toMatch(/finance_transactions/);
    expect(sql).not.toMatch(/order_materials/);
  });
});
