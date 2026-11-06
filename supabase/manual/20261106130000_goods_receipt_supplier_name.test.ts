import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261106130000_goods_receipt_supplier_name.PRODUCTION.sql"),
  "utf8",
);

describe("goods_receipt_supplier_name SQL", () => {
  it("adds a nullable supplier_name column with an index", () => {
    expect(sql).toMatch(/add column if not exists supplier_name text/);
    expect(sql).toMatch(/goods_receipts_workspace_supplier_name_idx/);
  });

  it("backfills only single-supplier receipts that have no supplier yet", () => {
    expect(sql).toMatch(/pr\.supplier_count = 1/);
    expect(sql).toMatch(/gr\.supplier_name is null/);
    expect(sql).toMatch(/pr\.unknown_lines = 0/);
  });

  it("does not touch stock, totals or posting", () => {
    expect(sql).not.toMatch(/warehouse_stock/);
    expect(sql).not.toMatch(/set\s+total/i);
    expect(sql).not.toMatch(/set\s+status/i);
  });
});
