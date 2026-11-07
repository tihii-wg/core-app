import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261107120000_order_material_line_prices.PRODUCTION.sql"),
  "utf8",
);

describe("order_material_line_prices SQL", () => {
  it("updates only order_materials.price of the order's lines with permission checks", () => {
    expect(sql).toMatch(/create or replace function public\.crm_set_order_material_prices\(p_order_id uuid, p_lines jsonb\)/);
    expect(sql).toMatch(/and m\.order_id = p_order_id/);
    expect(sql).toMatch(/'orders\.edit'/);
    expect(sql).toMatch(/order_material_price:invalid_price/);
  });
  it("never touches catalog prices, stock or sync_order_materials", () => {
    expect(sql).not.toMatch(/update public\.inventory_items/);
    expect(sql).not.toMatch(/warehouse_stock/);
    expect(sql).not.toMatch(/create or replace function public\.sync_order_materials/);
  });
  it("recalculates the total keeping the discount", () => {
    expect(sql).toMatch(/discount_total/);
    expect(sql).toMatch(/update public\.orders set total_price = v_total/);
  });
});
