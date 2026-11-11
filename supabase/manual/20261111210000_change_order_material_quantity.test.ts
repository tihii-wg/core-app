import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261111210000_change_order_material_quantity.PRODUCTION.sql"),
  "utf8",
);

const fn = (name: string) => {
  const needle = `create or replace function public.${name}(`;
  const i = sql.indexOf(needle);
  expect(i).toBeGreaterThan(-1);
  const end = sql.indexOf("$fn$;", i);
  expect(end).toBeGreaterThan(i);
  return sql.slice(i, end);
};

describe("change_order_material_quantity SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/change_order_material_quantity preflight failed/);
    expect(sql).toMatch(/change_order_material_quantity postflight failed/);
  });

  it("creates crm_change_order_material_quantity with membership check", () => {
    expect(sql).toMatch(/create or replace function public\.crm_change_order_material_quantity\(/);
    expect(sql).toMatch(/grant execute on function public\.crm_change_order_material_quantity/);
    expect(sql).toMatch(/is_workspace_member/);
    expect(sql).not.toMatch(/crm_is_workspace_member/);
  });

  it("issues on increase and returns+collapses on shrink past outstanding", () => {
    const body = fn("crm_change_order_material_quantity");
    expect(body).toMatch(/issue_order_materials_from_warehouse/);
    expect(body).toMatch(/return_order_materials_to_warehouse/);
    expect(body).toMatch(/quantity_issued = greatest\(0, coalesce\(quantity_issued, 0\) - v_to_return\)/);
    expect(body).toMatch(/closed_order_immutable/);
    expect(body).toMatch(/cancelled_order_immutable/);
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/order_material:insufficient_stock available=% requested=%/);
    expect(body).toMatch(/warehouse_stock/);
  });

  it("recalculates order totals", () => {
    const body = fn("crm_change_order_material_quantity");
    expect(body).toMatch(/total_price/);
    expect(body).toMatch(/discount_total/);
  });
});
