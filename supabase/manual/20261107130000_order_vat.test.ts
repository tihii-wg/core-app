import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261107130000_order_vat.PRODUCTION.sql"),
  "utf8",
);

describe("order_vat SQL", () => {
  it("snapshots the workspace VAT rate and extracts VAT from the inclusive total", () => {
    expect(sql).toMatch(/add column if not exists vat_rate numeric\(7,3\)/);
    expect(sql).toMatch(/create or replace function public\.crm_workspace_vat_rate/);
    expect(sql).toMatch(/coalesce\(t\.is_included, true\)/);
    expect(sql).toMatch(/new\.total_price::numeric \* v_rate \/ \(100 \+ v_rate\)/);
    expect(sql).toMatch(/before insert or update of total_price, vat_rate on public\.orders/);
  });
  it("never changes the total or backfills closed orders", () => {
    expect(sql).not.toMatch(/new\.total_price :=/);
    expect(sql).not.toMatch(/update public\.orders/);
  });
});
