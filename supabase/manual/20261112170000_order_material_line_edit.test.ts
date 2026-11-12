import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "20261112170000_order_material_line_edit.PRODUCTION.sql"),
  "utf8",
);

describe("order_material_line_edit SQL", () => {
  it("is transactional with loud preflight/postflight", () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).toMatch(/order_material_line_edit preflight failed/);
    expect(sql).toMatch(/order_material_line_edit postflight failed/);
  });

  it("creates crm_update_order_material_line with set/clear flags matching the service-line edit", () => {
    expect(sql).toMatch(/create or replace function public\.crm_update_order_material_line\(/);
    expect(sql).toMatch(/p_set_warranty boolean default false/);
    expect(sql).toMatch(/p_set_discount boolean default false/);
    expect(sql).toMatch(/p_set_warehouse boolean default false/);
    expect(sql).toMatch(/p_warranty_months/);
    expect(sql).toMatch(/p_discount_type/);
    expect(sql).toMatch(/warehouse_locked_after_issue/);
  });

  it("reuses crm_change_order_material_quantity for stock and returns crm_get_order_full", () => {
    expect(sql).toMatch(/crm_change_order_material_quantity\(p_order_id, p_line_id/);
    expect(sql).toMatch(/crm_recalc_order_line_totals/);
    expect(sql).toMatch(/return public\.crm_get_order_full\(p_order_id\)/);
    expect(sql).toMatch(/closed_order_immutable/);
    expect(sql).toMatch(/cancelled_order_immutable/);
  });

  it("writes material_updated with a changes payload", () => {
    expect(sql).toMatch(/material_updated/);
    expect(sql).toMatch(/'changes'/);
  });
});
